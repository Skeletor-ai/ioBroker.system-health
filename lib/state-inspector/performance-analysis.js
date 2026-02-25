'use strict';

/**
 * Performance and resource usage analysis - identifies states causing performance issues or wasting resources.
 */
class PerformanceAnalysisInspector {
    /**
     * @param {object} adapter - ioBroker adapter instance
     * @param {object} config - Inspector configuration
     * @param {number} [config.updateFrequencyThresholdMs=100] - Threshold for high-frequency updates (ms)
     * @param {number} [config.largeTreeThreshold=1000] - State count threshold for large object trees
     * @param {number} [config.monitoringDurationMs=60000] - Duration to monitor state changes (ms)
     * @param {Array<string>} [config.ignorePatterns=[]] - State patterns to ignore
     */
    constructor(adapter, config = {}) {
        this.adapter = adapter;
        this.updateFrequencyThresholdMs = config.updateFrequencyThresholdMs || 100;
        this.largeTreeThreshold = config.largeTreeThreshold || 1000;
        this.monitoringDurationMs = config.monitoringDurationMs || 60000;
        this.ignorePatterns = [
            'system.*',
            'admin.*',
            '*.alive',
            '*.connected',
            ...(config.ignorePatterns || [])
        ];

        // Pre-compile ignore patterns
        this.ignoreRegexes = this.ignorePatterns.map(p => {
            const regexPattern = p.replace(/\./g, '\\.').replace(/\*/g, '.*');
            return new RegExp(`^${regexPattern}$`);
        });

        // Monitoring data - initialize in constructor (fix #5)
        this.stateChanges = new Map(); // stateId -> [timestamps]
        this.ackIssueTracking = new Map(); // stateId -> { totalWrites, ackFalse }
        this.subscriptionActive = false;
        this.stateChangeHandler = null;
        this.monitoringTimeout = null;
    }

    /**
     * Initialize performance inspector.
     */
    async init() {
        this.adapter.log.info('Initializing performance analysis inspector...');
        await this.createStates();
        this.adapter.log.info('Performance analysis inspector initialized.');
    }

    /**
     * Create ioBroker states for inspection results.
     */
    async createStates() {
        const baseId = `${this.adapter.namespace}.inspector.performance`;

        await this.adapter.setObjectNotExistsAsync(`${baseId}.report`, {
            type: 'state',
            common: {
                name: 'Performance analysis report',
                type: 'string',
                role: 'json',
                read: true,
                write: false
            },
            native: {}
        });

        await this.adapter.setObjectNotExistsAsync(`${baseId}.highFrequencyCount`, {
            type: 'state',
            common: {
                name: 'Number of high-frequency states',
                type: 'number',
                role: 'value',
                read: true,
                write: false
            },
            native: {}
        });

        await this.adapter.setObjectNotExistsAsync(`${baseId}.largeTreeCount`, {
            type: 'state',
            common: {
                name: 'Number of adapters with large object trees',
                type: 'number',
                role: 'value',
                read: true,
                write: false
            },
            native: {}
        });

        await this.adapter.setObjectNotExistsAsync(`${baseId}.historyWasteCount`, {
            type: 'state',
            common: {
                name: 'Number of states with wasteful history usage',
                type: 'number',
                role: 'value',
                read: true,
                write: false
            },
            native: {}
        });

        await this.adapter.setObjectNotExistsAsync(`${baseId}.ackIssuesCount`, {
            type: 'state',
            common: {
                name: 'Number of states with ack issues',
                type: 'number',
                role: 'value',
                read: true,
                write: false
            },
            native: {}
        });

        await this.adapter.setObjectNotExistsAsync(`${baseId}.lastScan`, {
            type: 'state',
            common: {
                name: 'Last performance scan timestamp',
                type: 'number',
                role: 'date',
                read: true,
                write: false
            },
            native: {}
        });
    }

    /**
     * Run performance analysis inspection.
     * @returns {Promise<object>} Scan report
     */
    async inspect() {
        this.adapter.log.info('Starting performance analysis inspection...');
        
        const report = {
            timestamp: new Date().toISOString(),
            config: {
                updateFrequencyThresholdMs: this.updateFrequencyThresholdMs,
                largeTreeThreshold: this.largeTreeThreshold,
                monitoringDurationMs: this.monitoringDurationMs
            },
            highFrequencyStates: [],
            largeObjectTrees: [],
            historyWaste: [],
            ackIssues: [],
            monitoring: {
                active: this.subscriptionActive,
                note: this.subscriptionActive 
                    ? 'Results from ongoing background monitoring' 
                    : 'Start monitoring with startMonitoring() for frequency/ack analysis'
            }
        };

        // 1. Analyze object tree sizes (non-blocking, per-adapter iteration)
        this.adapter.log.debug('Analyzing object tree sizes...');
        report.largeObjectTrees = await this.analyzeLargeObjectTrees();

        // 2. Analyze history usage (non-blocking, per-adapter iteration)
        this.adapter.log.debug('Analyzing history usage...');
        report.historyWaste = await this.analyzeHistoryWaste();

        // 3. Report current monitoring data (non-blocking)
        if (this.subscriptionActive) {
            this.adapter.log.debug('Analyzing monitored state change data...');
            report.highFrequencyStates = this.analyzeHighFrequencyStates();
            report.ackIssues = this.analyzeAckIssues();
        } else {
            this.adapter.log.debug('No active monitoring - frequency/ack analysis skipped.');
        }

        // Update states
        const baseId = 'inspector.performance';
        await this.adapter.setStateAsync(`${baseId}.report`, JSON.stringify(report, null, 2), true);
        await this.adapter.setStateAsync(`${baseId}.highFrequencyCount`, report.highFrequencyStates.length, true);
        await this.adapter.setStateAsync(`${baseId}.largeTreeCount`, report.largeObjectTrees.length, true);
        await this.adapter.setStateAsync(`${baseId}.historyWasteCount`, report.historyWaste.length, true);
        await this.adapter.setStateAsync(`${baseId}.ackIssuesCount`, report.ackIssues.length, true);
        await this.adapter.setStateAsync(`${baseId}.lastScan`, Date.now(), true);

        this.adapter.log.info(
            `Performance analysis complete: ` +
            `${report.highFrequencyStates.length} high-frequency, ` +
            `${report.largeObjectTrees.length} large trees, ` +
            `${report.historyWaste.length} history waste, ` +
            `${report.ackIssues.length} ack issues`
        );

        return report;
    }

    /**
     * Start background monitoring of state changes.
     * This runs continuously and aggregates data over time.
     * Call inspect() periodically to get reports based on collected data.
     * @returns {Promise<void>}
     */
    async startMonitoring() {
        if (this.subscriptionActive) {
            this.adapter.log.warn('Monitoring already active.');
            return;
        }

        this.adapter.log.info('Starting background state change monitoring...');
        this.stateChanges.clear();
        this.ackIssueTracking.clear();

        // Use adapter.on('stateChange', ...) instead of internal _stateChangeHandler (fix #1)
        this.stateChangeHandler = (id, state) => {
            this.trackStateChange(id, state);
        };

        this.adapter.on('stateChange', this.stateChangeHandler);

        // Subscribe to all state changes (fix #3: acknowledge this is heavy)
        // Alternative: could subscribe per-adapter namespace if too heavy in production
        await this.adapter.subscribeForeignStatesAsync('*');
        this.subscriptionActive = true;

        this.adapter.log.info('Background monitoring started.');
    }

    /**
     * Stop background monitoring.
     * @returns {Promise<void>}
     */
    async stopMonitoring() {
        if (!this.subscriptionActive) {
            this.adapter.log.warn('Monitoring not active.');
            return;
        }

        this.adapter.log.info('Stopping background state change monitoring...');

        if (this.stateChangeHandler) {
            this.adapter.removeListener('stateChange', this.stateChangeHandler);
            this.stateChangeHandler = null;
        }

        await this.adapter.unsubscribeForeignStatesAsync('*');
        this.subscriptionActive = false;

        this.adapter.log.info('Background monitoring stopped.');
    }

    /**
     * Analyze adapters with large object trees.
     * Uses per-adapter iteration instead of loading all states at once (fix #2).
     * @returns {Promise<Array>}
     */
    async analyzeLargeObjectTrees() {
        const adapterStateCounts = new Map();

        // Get list of adapter instances
        const instances = await this.adapter.getObjectViewAsync('system', 'instance', {});
        
        for (const row of instances.rows) {
            const instanceId = row.id.replace('system.adapter.', '');
            
            if (this.shouldIgnore(instanceId)) continue;

            try {
                // Count states per adapter namespace (more memory-efficient than loading all)
                const states = await this.adapter.getForeignStatesAsync(`${instanceId}.*`);
                const count = Object.keys(states).length;
                
                if (count > 0) {
                    adapterStateCounts.set(instanceId, count);
                }
            } catch (err) {
                this.adapter.log.debug(`Could not count states for ${instanceId}: ${err.message}`);
            }
        }

        const largeAdapters = [];
        for (const [adapterId, count] of adapterStateCounts) {
            if (count > this.largeTreeThreshold) {
                largeAdapters.push({
                    adapter: adapterId,
                    stateCount: count,
                    recommendation: `Consider reviewing ${adapterId} configuration - ${count} states may indicate bloated setup`
                });
            }
        }

        return largeAdapters.sort((a, b) => b.stateCount - a.stateCount);
    }

    /**
     * Analyze states with history enabled that rarely change.
     * Uses per-adapter iteration instead of loading all states at once (fix #2).
     * @returns {Promise<Array>}
     */
    async analyzeHistoryWaste() {
        const historyWaste = [];
        const thresholdMs = 7 * 24 * 60 * 60 * 1000; // 7 days

        // Get list of adapter instances
        const instances = await this.adapter.getObjectViewAsync('system', 'instance', {});
        
        for (const row of instances.rows) {
            const instanceId = row.id.replace('system.adapter.', '');
            
            if (this.shouldIgnore(instanceId)) continue;

            try {
                // Load states and objects per adapter namespace
                const states = await this.adapter.getForeignStatesAsync(`${instanceId}.*`);
                const objects = await this.adapter.getForeignObjectsAsync(`${instanceId}.*`, 'state');

                for (const [stateId, state] of Object.entries(states)) {
                    if (this.shouldIgnore(stateId)) continue;

                    const obj = objects[stateId];
                    if (!obj || !obj.common) continue;

                    // Check if state has history enabled (custom property set by history adapters)
                    const hasHistory = obj.common.custom && Object.keys(obj.common.custom).some(
                        key => key.includes('history') || key.includes('influxdb') || key.includes('sql')
                    );

                    if (!hasHistory) continue;

                    // Check if state hasn't changed in a long time
                    const age = state && state.ts ? Date.now() - state.ts : Infinity;
                    
                    if (age > thresholdMs) {
                        const match = stateId.match(/^([^.]+\.\d+)\./);
                        const adapterId = match ? match[1] : instanceId;

                        historyWaste.push({
                            id: stateId,
                            adapter: adapterId,
                            lastUpdate: state && state.ts ? new Date(state.ts).toISOString() : 'never',
                            ageDays: Math.round(age / (24 * 60 * 60 * 1000)),
                            historyAdapters: obj.common.custom ? Object.keys(obj.common.custom) : [],
                            recommendation: 'State rarely changes but has history enabled - consider disabling history to save storage'
                        });
                    }
                }
            } catch (err) {
                this.adapter.log.debug(`Could not analyze history for ${instanceId}: ${err.message}`);
            }
        }

        return historyWaste.sort((a, b) => b.ageDays - a.ageDays).slice(0, 100);
    }

    /**
     * Track state change for frequency and ack analysis.
     * @param {string} id - State ID
     * @param {object} state - State object
     */
    trackStateChange(id, state) {
        if (this.shouldIgnore(id)) return;

        // Track timestamp for frequency analysis
        if (!this.stateChanges.has(id)) {
            this.stateChanges.set(id, []);
        }
        this.stateChanges.get(id).push(Date.now());

        // Limit memory: keep only last 1000 timestamps per state
        const timestamps = this.stateChanges.get(id);
        if (timestamps.length > 1000) {
            timestamps.shift();
        }

        // Track ack status
        if (!this.ackIssueTracking.has(id)) {
            this.ackIssueTracking.set(id, { totalWrites: 0, ackFalse: 0 });
        }
        const tracking = this.ackIssueTracking.get(id);
        tracking.totalWrites++;
        if (state && state.ack === false) {
            tracking.ackFalse++;
        }
    }

    /**
     * Analyze high-frequency state updates.
     * @returns {Array}
     */
    analyzeHighFrequencyStates() {
        const highFrequency = [];

        for (const [stateId, timestamps] of this.stateChanges) {
            if (timestamps.length < 2) continue;

            // Calculate intervals between consecutive updates
            const intervals = [];
            for (let i = 1; i < timestamps.length; i++) {
                intervals.push(timestamps[i] - timestamps[i - 1]);
            }

            const minInterval = Math.min(...intervals);
            const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

            if (minInterval < this.updateFrequencyThresholdMs) {
                const match = stateId.match(/^([^.]+\.\d+)\./);
                const adapterId = match ? match[1] : 'unknown';

                highFrequency.push({
                    id: stateId,
                    adapter: adapterId,
                    updateCount: timestamps.length,
                    minIntervalMs: Math.round(minInterval),
                    avgIntervalMs: Math.round(avgInterval),
                    updatesPerSecond: (1000 / avgInterval).toFixed(2),
                    recommendation: `Very frequent updates (min ${Math.round(minInterval)}ms) - consider rate limiting or debouncing`
                });
            }
        }

        return highFrequency.sort((a, b) => a.minIntervalMs - b.minIntervalMs).slice(0, 50);
    }

    /**
     * Analyze ack=false issues.
     * @returns {Array}
     */
    analyzeAckIssues() {
        const ackIssues = [];
        const MIN_WRITES = 5; // Only flag states with at least this many writes
        const ACK_FALSE_THRESHOLD = 0.8; // Flag if > 80% writes have ack=false

        for (const [stateId, tracking] of this.ackIssueTracking) {
            if (tracking.totalWrites < MIN_WRITES) continue;

            const ackFalseRatio = tracking.ackFalse / tracking.totalWrites;

            if (ackFalseRatio > ACK_FALSE_THRESHOLD) {
                const match = stateId.match(/^([^.]+\.\d+)\./);
                const adapterId = match ? match[1] : 'unknown';

                ackIssues.push({
                    id: stateId,
                    adapter: adapterId,
                    totalWrites: tracking.totalWrites,
                    ackFalseCount: tracking.ackFalse,
                    ackFalseRatio: (ackFalseRatio * 100).toFixed(1) + '%',
                    recommendation: 'High rate of non-acknowledged writes - may indicate command confirmation issues'
                });
            }
        }

        return ackIssues.sort((a, b) => b.ackFalseCount - a.ackFalseCount).slice(0, 50);
    }

    /**
     * Check if a state ID matches any ignore pattern.
     * @param {string} stateId - State ID
     * @returns {boolean}
     */
    shouldIgnore(stateId) {
        for (const regex of this.ignoreRegexes) {
            if (regex.test(stateId)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Cleanup (fix #6 - called from main.js onUnload).
     */
    async cleanup() {
        if (this.monitoringTimeout) {
            clearTimeout(this.monitoringTimeout);
            this.monitoringTimeout = null;
        }

        if (this.subscriptionActive) {
            await this.stopMonitoring();
        }

        this.stateChanges.clear();
        this.ackIssueTracking.clear();
        this.adapter.log.info('Performance analysis inspector cleanup complete.');
    }
}

module.exports = PerformanceAnalysisInspector;
