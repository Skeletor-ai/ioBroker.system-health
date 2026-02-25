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

        // Monitoring data
        this.stateChanges = new Map(); // stateId -> [timestamps]
        this.subscriptionActive = false;
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
            ackIssues: []
        };

        // 1. Analyze object tree sizes
        this.adapter.log.debug('Analyzing object tree sizes...');
        report.largeObjectTrees = await this.analyzeLargeObjectTrees();

        // 2. Analyze history usage
        this.adapter.log.debug('Analyzing history usage...');
        report.historyWaste = await this.analyzeHistoryWaste();

        // 3. Monitor state changes for frequency and ack issues
        this.adapter.log.debug(`Monitoring state changes for ${this.monitoringDurationMs}ms...`);
        await this.monitorStateChanges(this.monitoringDurationMs);
        
        report.highFrequencyStates = this.analyzeHighFrequencyStates();
        report.ackIssues = this.analyzeAckIssues();

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
     * Analyze adapters with large object trees.
     * @returns {Promise<Array>}
     */
    async analyzeLargeObjectTrees() {
        const allStates = await this.adapter.getForeignStatesAsync('*');
        const adapterStateCounts = new Map();

        for (const stateId of Object.keys(allStates)) {
            if (this.shouldIgnore(stateId)) continue;

            const match = stateId.match(/^([^.]+\.\d+)\./);
            const adapterId = match ? match[1] : 'unknown';

            adapterStateCounts.set(adapterId, (adapterStateCounts.get(adapterId) || 0) + 1);
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
     * @returns {Promise<Array>}
     */
    async analyzeHistoryWaste() {
        const allStates = await this.adapter.getForeignStatesAsync('*');
        const allObjects = await this.adapter.getForeignObjectsAsync('*', 'state');
        const historyWaste = [];

        const thresholdMs = 7 * 24 * 60 * 60 * 1000; // 7 days

        for (const [stateId, state] of Object.entries(allStates)) {
            if (this.shouldIgnore(stateId)) continue;

            const obj = allObjects[stateId];
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
                const adapterId = match ? match[1] : 'unknown';

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

        return historyWaste.sort((a, b) => b.ageDays - a.ageDays).slice(0, 100);
    }

    /**
     * Monitor state changes for the configured duration.
     * @param {number} durationMs - Duration to monitor (ms)
     * @returns {Promise<void>}
     */
    async monitorStateChanges(durationMs) {
        this.stateChanges.clear();
        this.ackIssueTracking = new Map(); // stateId -> { totalWrites, ackFalse }

        // Subscribe to all state changes
        await this.adapter.subscribeForeignStatesAsync('*');
        this.subscriptionActive = true;

        // Set up state change handler
        const originalHandler = this.adapter._stateChangeHandler;
        this.adapter._stateChangeHandler = (id, state) => {
            if (originalHandler) originalHandler.call(this.adapter, id, state);
            this.trackStateChange(id, state);
        };

        // Wait for monitoring duration
        await new Promise(resolve => setTimeout(resolve, durationMs));

        // Clean up
        await this.adapter.unsubscribeForeignStatesAsync('*');
        this.subscriptionActive = false;
        this.adapter._stateChangeHandler = originalHandler;
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
     * Cleanup.
     */
    async cleanup() {
        if (this.subscriptionActive) {
            await this.adapter.unsubscribeForeignStatesAsync('*');
            this.subscriptionActive = false;
        }
        this.stateChanges.clear();
        this.ackIssueTracking = null;
        this.adapter.log.info('Performance analysis inspector cleanup complete.');
    }
}

module.exports = PerformanceAnalysisInspector;
