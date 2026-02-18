'use strict';

const { classifyCrash } = require('./crash-classifier');

/**
 * Crash detection and tracking for ioBroker adapters.
 */
class CrashDetection {
    /**
     * @param {object} adapter - ioBroker adapter instance
     * @param {number} retentionDays - How many days to keep crash history (default: 30)
     */
    constructor(adapter, retentionDays = 30) {
        this.adapter = adapter;
        this.retentionDays = retentionDays;
        this.crashHistory = {}; // adapterId -> [crash events]
        this.aliveSubscriptions = new Set();
    }

    /**
     * Initialize crash detection module.
     * Creates necessary states and starts monitoring.
     */
    async init() {
        this.adapter.log.info('Initializing adapter crash detection...');

        // Load existing crash history from states
        await this.loadCrashHistory();

        // Subscribe to alive state changes for real-time detection
        await this.subscribeToAliveStates();

        // Run initial check
        await this.checkForCrashes();

        this.adapter.log.info('Crash detection initialized.');
    }

    /**
     * Subscribe to all adapter alive states for real-time crash detection.
     */
    async subscribeToAliveStates() {
        try {
            const aliveStates = await this.adapter.getForeignStatesAsync('system.adapter.*.alive');
            
            for (const stateId of Object.keys(aliveStates)) {
                await this.adapter.subscribeForeignStatesAsync(stateId);
                this.aliveSubscriptions.add(stateId);
            }

            this.adapter.log.info(`Subscribed to ${this.aliveSubscriptions.size} adapter alive states.`);
        } catch (err) {
            this.adapter.log.error(`Failed to subscribe to alive states: ${err.message}`);
        }
    }

    /**
     * Handle alive state change (called from main adapter).
     * @param {string} id - State ID
     * @param {object} state - State object
     */
    async onAliveStateChange(id, state) {
        if (!id.startsWith('system.adapter.') || !id.endsWith('.alive')) {
            return;
        }

        // Extract adapter name and instance from state ID
        // Format: system.adapter.<name>.<instance>.alive
        const match = id.match(/system\.adapter\.([^.]+)\.(\d+)\.alive/);
        if (!match) return;

        const [, adapterName, instance] = match;
        const adapterId = `${adapterName}.${instance}`;

        // Check if this is a crash (alive changed from true to false)
        if (state && state.val === false && !state.ack) {
            this.adapter.log.warn(`Detected potential crash: ${adapterId}`);
            
            // Wait a moment and check if it's really a crash (not intentional stop)
            setTimeout(async () => {
                await this.handlePotentialCrash(adapterId, adapterName, instance);
            }, 2000);
        }
    }

    /**
     * Check for recent crashes by analyzing adapter instances.
     */
    async checkForCrashes() {
        try {
            const adapters = await this.adapter.getForeignObjectsAsync('system.adapter.*', 'instance');
            
            for (const [id, obj] of Object.entries(adapters)) {
                if (!obj || !obj.common) continue;

                const match = id.match(/system\.adapter\.([^.]+)\.(\d+)/);
                if (!match) continue;

                const [, adapterName, instance] = match;
                const adapterId = `${adapterName}.${instance}`;

                // Check alive state
                const aliveState = await this.adapter.getForeignStateAsync(`system.adapter.${adapterId}.alive`);
                
                if (aliveState && aliveState.val === false) {
                    // Check if this looks like a crash (not intentional stop)
                    await this.analyzePotentialCrash(adapterId, adapterName, instance);
                }
            }
        } catch (err) {
            this.adapter.log.error(`Failed to check for crashes: ${err.message}`);
        }
    }

    /**
     * Analyze a potential crash and record it if confirmed.
     * @param {string} adapterId - Full adapter ID (name.instance)
     * @param {string} adapterName - Adapter name
     * @param {string} instance - Instance number
     */
    async analyzePotentialCrash(adapterId, adapterName, instance) {
        try {
            // Get recent log entries for this adapter
            const logMessages = await this.getRecentLogs(adapterId);
            
            // Look for crash indicators in logs
            const hasCrashIndicators = logMessages.some(msg => 
                /terminated|exception|error|crash|exit.*code/i.test(msg)
            );

            if (hasCrashIndicators) {
                await this.recordCrash(adapterId, adapterName, instance, logMessages);
            }
        } catch (err) {
            this.adapter.log.error(`Failed to analyze crash for ${adapterId}: ${err.message}`);
        }
    }

    /**
     * Handle a potential crash detected via state change.
     * @param {string} adapterId - Full adapter ID
     * @param {string} adapterName - Adapter name
     * @param {string} instance - Instance number
     */
    async handlePotentialCrash(adapterId, adapterName, instance) {
        // Double-check alive state
        const aliveState = await this.adapter.getForeignStateAsync(`system.adapter.${adapterId}.alive`);
        
        if (aliveState && aliveState.val === false) {
            const logMessages = await this.getRecentLogs(adapterId);
            await this.recordCrash(adapterId, adapterName, instance, logMessages);
        }
    }

    /**
     * Record a crash event.
     * @param {string} adapterId - Full adapter ID
     * @param {string} adapterName - Adapter name
     * @param {string} instance - Instance number
     * @param {string[]} logMessages - Recent log messages
     */
    async recordCrash(adapterId, adapterName, instance, logMessages) {
        const timestamp = new Date().toISOString();
        
        // Extract exit code from logs if available
        let exitCode = 0;
        const exitCodeMatch = logMessages.join(' ').match(/exit(?:ed)? (?:with )?code (\d+)/i);
        if (exitCodeMatch) {
            exitCode = parseInt(exitCodeMatch[1], 10);
        }

        // Classify the crash
        const { category, recommendation } = classifyCrash(logMessages, exitCode);

        const crashEvent = {
            timestamp,
            exitCode,
            category,
            recommendation
        };

        // Add to history
        if (!this.crashHistory[adapterId]) {
            this.crashHistory[adapterId] = [];
        }
        this.crashHistory[adapterId].push(crashEvent);

        // Clean old entries
        this.cleanOldCrashes(adapterId);

        // Update states
        await this.updateAdapterStates(adapterId, adapterName, instance, crashEvent);
        
        // Update report
        await this.updateCrashReport();

        this.adapter.log.warn(`Crash recorded for ${adapterId}: ${category} - ${recommendation}`);
    }

    /**
     * Get recent log messages for an adapter.
     * @param {string} adapterId - Adapter ID
     * @returns {Promise<string[]>} Array of log messages
     */
    async getRecentLogs(adapterId) {
        try {
            // Try to get logs from log state
            const logState = await this.adapter.getForeignStateAsync(`system.adapter.${adapterId}.outputCount`);
            
            // In a real implementation, we would fetch actual log entries
            // For now, return a placeholder
            // TODO: Implement proper log fetching via sendToHost or log adapter
            return [];
        } catch (err) {
            this.adapter.log.debug(`Could not fetch logs for ${adapterId}: ${err.message}`);
            return [];
        }
    }

    /**
     * Update adapter-specific states.
     * @param {string} adapterId - Adapter ID
     * @param {string} adapterName - Adapter name
     * @param {string} instance - Instance number
     * @param {object} crashEvent - Crash event details
     */
    async updateAdapterStates(adapterId, adapterName, instance, crashEvent) {
        const baseId = `${this.adapter.namespace}.adapters.${adapterId}`;

        // Create objects if they don't exist
        await this.adapter.setObjectNotExistsAsync(`${baseId}.lastCrash`, {
            type: 'state',
            common: {
                name: `${adapterId} last crash timestamp`,
                type: 'string',
                role: 'value.time',
                read: true,
                write: false
            },
            native: {}
        });

        await this.adapter.setObjectNotExistsAsync(`${baseId}.lastCrashCategory`, {
            type: 'state',
            common: {
                name: `${adapterId} last crash category`,
                type: 'string',
                role: 'text',
                read: true,
                write: false,
                states: {
                    'adapter_error': 'Adapter Bug',
                    'config_error': 'Configuration Error',
                    'device_error': 'Device/Service Unreachable',
                    'unknown': 'Unknown'
                }
            },
            native: {}
        });

        await this.adapter.setObjectNotExistsAsync(`${baseId}.recommendation`, {
            type: 'state',
            common: {
                name: `${adapterId} recommendation`,
                type: 'string',
                role: 'text',
                read: true,
                write: false
            },
            native: {}
        });

        // Crash count states
        const counts = this.getCrashCounts(adapterId);
        
        for (const period of ['24h', '7d', '30d']) {
            await this.adapter.setObjectNotExistsAsync(`${baseId}.crashCount${period}`, {
                type: 'state',
                common: {
                    name: `${adapterId} crashes in last ${period}`,
                    type: 'number',
                    role: 'value',
                    read: true,
                    write: false,
                    unit: 'crashes'
                },
                native: {}
            });
        }

        await this.adapter.setObjectNotExistsAsync(`${baseId}.stable`, {
            type: 'state',
            common: {
                name: `${adapterId} is stable`,
                type: 'boolean',
                role: 'indicator',
                read: true,
                write: false
            },
            native: {}
        });

        // Set state values
        await this.adapter.setStateAsync(`${baseId}.lastCrash`, crashEvent.timestamp, true);
        await this.adapter.setStateAsync(`${baseId}.lastCrashCategory`, crashEvent.category, true);
        await this.adapter.setStateAsync(`${baseId}.recommendation`, crashEvent.recommendation, true);
        await this.adapter.setStateAsync(`${baseId}.crashCount24h`, counts.count24h, true);
        await this.adapter.setStateAsync(`${baseId}.crashCount7d`, counts.count7d, true);
        await this.adapter.setStateAsync(`${baseId}.crashCount30d`, counts.count30d, true);
        await this.adapter.setStateAsync(`${baseId}.stable`, counts.count24h <= 3, true);
    }

    /**
     * Get crash counts for different time periods.
     * @param {string} adapterId - Adapter ID
     * @returns {{count24h: number, count7d: number, count30d: number}}
     */
    getCrashCounts(adapterId) {
        const now = Date.now();
        const history = this.crashHistory[adapterId] || [];

        const count24h = history.filter(e => now - new Date(e.timestamp).getTime() < 24 * 60 * 60 * 1000).length;
        const count7d = history.filter(e => now - new Date(e.timestamp).getTime() < 7 * 24 * 60 * 60 * 1000).length;
        const count30d = history.length; // Already cleaned to 30 days

        return { count24h, count7d, count30d };
    }

    /**
     * Update the crash report summary state.
     */
    async updateCrashReport() {
        const report = {
            generatedAt: new Date().toISOString(),
            adapters: {},
            summary: {
                totalCrashes24h: 0,
                totalCrashes7d: 0,
                totalCrashes30d: 0,
                mostUnstable: null,
                mostUnstableCount: 0
            }
        };

        // Aggregate data for all adapters
        for (const [adapterId, history] of Object.entries(this.crashHistory)) {
            if (history.length === 0) continue;

            const counts = this.getCrashCounts(adapterId);
            const lastCrash = history[history.length - 1];

            report.adapters[adapterId] = {
                crashCount24h: counts.count24h,
                crashCount7d: counts.count7d,
                crashCount30d: counts.count30d,
                lastCrash: lastCrash.timestamp,
                lastCategory: lastCrash.category,
                recommendation: lastCrash.recommendation,
                stable: counts.count24h <= 3
            };

            report.summary.totalCrashes24h += counts.count24h;
            report.summary.totalCrashes7d += counts.count7d;
            report.summary.totalCrashes30d += counts.count30d;

            if (counts.count30d > report.summary.mostUnstableCount) {
                report.summary.mostUnstable = adapterId;
                report.summary.mostUnstableCount = counts.count30d;
            }
        }

        // Create report states
        await this.adapter.setObjectNotExistsAsync(`${this.adapter.namespace}.report.crashReport`, {
            type: 'state',
            common: {
                name: 'Crash report summary',
                type: 'string',
                role: 'json',
                read: true,
                write: false
            },
            native: {}
        });

        await this.adapter.setObjectNotExistsAsync(`${this.adapter.namespace}.report.hasProblems`, {
            type: 'state',
            common: {
                name: 'System has crash problems',
                type: 'boolean',
                role: 'indicator.alarm',
                read: true,
                write: false
            },
            native: {}
        });

        // Set states
        await this.adapter.setStateAsync(`${this.adapter.namespace}.report.crashReport`, JSON.stringify(report, null, 2), true);
        
        const hasProblems = Object.values(report.adapters).some(a => a.crashCount24h > 3);
        await this.adapter.setStateAsync(`${this.adapter.namespace}.report.hasProblems`, hasProblems, true);
    }

    /**
     * Clean old crash entries beyond retention period.
     * @param {string} adapterId - Adapter ID
     */
    cleanOldCrashes(adapterId) {
        if (!this.crashHistory[adapterId]) return;

        const cutoffTime = Date.now() - (this.retentionDays * 24 * 60 * 60 * 1000);
        
        this.crashHistory[adapterId] = this.crashHistory[adapterId].filter(
            event => new Date(event.timestamp).getTime() > cutoffTime
        );
    }

    /**
     * Load crash history from adapter states.
     */
    async loadCrashHistory() {
        try {
            const states = await this.adapter.getStatesAsync(`${this.adapter.namespace}.adapters.*.lastCrash`);
            
            // Initialize empty history for now
            // In production, we'd persist history to a JSON state or file
            this.crashHistory = {};
            
            this.adapter.log.debug('Crash history loaded.');
        } catch (err) {
            this.adapter.log.error(`Failed to load crash history: ${err.message}`);
        }
    }

    /**
     * Cleanup and unsubscribe.
     */
    async cleanup() {
        for (const stateId of this.aliveSubscriptions) {
            await this.adapter.unsubscribeForeignStatesAsync(stateId);
        }
        this.aliveSubscriptions.clear();
        this.adapter.log.info('Crash detection cleanup complete.');
    }
}

module.exports = CrashDetection;
