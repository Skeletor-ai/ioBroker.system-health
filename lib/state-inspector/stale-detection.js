'use strict';

/**
 * Stale state detection - identifies states that haven't been updated within a configured threshold.
 */
class StaleStateInspector {
    /**
     * @param {object} adapter - ioBroker adapter instance
     * @param {number} thresholdHours - Hours after which a state is considered stale
     * @param {Array<string>} ignorePatterns - State patterns to ignore
     */
    constructor(adapter, thresholdHours = 24, ignorePatterns = []) {
        this.adapter = adapter;
        this.thresholdHours = thresholdHours;
        this.ignorePatterns = [
            'system.*',
            'admin.*',
            '*.info.*',
            '*.alive',
            '*.connected',
            ...ignorePatterns
        ];
        this.staleStates = [];

        // Pre-compile ignore patterns
        this.ignoreRegexes = this.ignorePatterns.map(p => {
            const regexPattern = p.replace(/\./g, '\\.').replace(/\*/g, '.*');
            return new RegExp(`^${regexPattern}$`);
        });
    }

    /**
     * Initialize stale state inspector.
     */
    async init() {
        this.adapter.log.info('Initializing stale state inspector...');
        await this.createStates();
        this.adapter.log.info('Stale state inspector initialized.');
    }

    /**
     * Create ioBroker states for inspection results.
     */
    async createStates() {
        const baseId = `${this.adapter.namespace}.inspector.staleStates`;

        await this.adapter.setObjectNotExistsAsync(`${baseId}.report`, {
            type: 'state',
            common: {
                name: 'Stale states report',
                type: 'string',
                role: 'json',
                read: true,
                write: false
            },
            native: {}
        });

        await this.adapter.setObjectNotExistsAsync(`${baseId}.count`, {
            type: 'state',
            common: {
                name: 'Number of stale states',
                type: 'number',
                role: 'value',
                read: true,
                write: false
            },
            native: {}
        });

        await this.adapter.setObjectNotExistsAsync(`${baseId}.hasStale`, {
            type: 'state',
            common: {
                name: 'System has stale states',
                type: 'boolean',
                role: 'indicator',
                read: true,
                write: false
            },
            native: {}
        });

        await this.adapter.setObjectNotExistsAsync(`${baseId}.byAdapter`, {
            type: 'state',
            common: {
                name: 'Stale states grouped by adapter',
                type: 'string',
                role: 'json',
                read: true,
                write: false
            },
            native: {}
        });

        await this.adapter.setObjectNotExistsAsync(`${baseId}.lastScan`, {
            type: 'state',
            common: {
                name: 'Last stale state scan timestamp',
                type: 'number',
                role: 'date',
                read: true,
                write: false
            },
            native: {}
        });
    }

    /**
     * Run stale state detection.
     * @returns {Promise<object>} Scan report
     */
    async inspect() {
        this.adapter.log.info('Starting stale state inspection...');
        this.staleStates = [];

        const now = Date.now();
        const thresholdMs = this.thresholdHours * 60 * 60 * 1000;

        // Get all states
        const allStates = await this.adapter.getForeignStatesAsync('*');
        let processed = 0;

        for (const [stateId, state] of Object.entries(allStates)) {
            // Yield to event loop every 100 states
            if (++processed % 100 === 0) {
                await new Promise(resolve => setImmediate(resolve));
            }

            // Skip ignored patterns
            if (this.shouldIgnore(stateId)) {
                continue;
            }

            // Skip states without timestamp
            if (!state || !state.ts) {
                continue;
            }

            const age = now - state.ts;
            if (age > thresholdMs) {
                const match = stateId.match(/^([^.]+\.\d+)\./);
                this.staleStates.push({
                    id: stateId,
                    adapter: match ? match[1] : 'unknown',
                    lastUpdate: new Date(state.ts).toISOString(),
                    ageHours: Math.round(age / (60 * 60 * 1000)),
                    value: state.val
                });
            }
        }

        // Sort by age (oldest first)
        this.staleStates.sort((a, b) => b.ageHours - a.ageHours);

        const report = this.generateReport();

        // Update states
        const baseId = 'inspector.staleStates';
        await this.adapter.setStateAsync(`${baseId}.report`, JSON.stringify(report, null, 2), true);
        await this.adapter.setStateAsync(`${baseId}.count`, this.staleStates.length, true);
        await this.adapter.setStateAsync(`${baseId}.hasStale`, this.staleStates.length > 0, true);
        await this.adapter.setStateAsync(`${baseId}.byAdapter`, JSON.stringify(this.groupByAdapter(), null, 2), true);
        await this.adapter.setStateAsync(`${baseId}.lastScan`, now, true);

        this.adapter.log.info(`Stale state inspection complete: ${this.staleStates.length} stale state(s) found.`);

        return report;
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
     * Generate inspection report.
     * @returns {object}
     */
    generateReport() {
        const MAX_REPORT_ENTRIES = 500;
        return {
            timestamp: new Date().toISOString(),
            thresholdHours: this.thresholdHours,
            totalStale: this.staleStates.length,
            truncated: this.staleStates.length > MAX_REPORT_ENTRIES,
            staleStates: this.staleStates.slice(0, MAX_REPORT_ENTRIES).map(({ id, adapter, lastUpdate, ageHours }) => ({
                id, adapter, lastUpdate, ageHours
            })),
            summary: {
                byAdapter: this.groupByAdapter()
            }
        };
    }

    /**
     * Group stale states by adapter.
     * @returns {object} Adapter ID -> count
     */
    groupByAdapter() {
        const adapters = {};
        for (const state of this.staleStates) {
            adapters[state.adapter] = (adapters[state.adapter] || 0) + 1;
        }
        return adapters;
    }

    /**
     * Get cleanup suggestions for stale states.
     * @returns {object}
     */
    getCleanupSuggestions() {
        const suggestions = {
            safeToDelete: [],
            reviewRequired: [],
            keepForNow: []
        };

        for (const state of this.staleStates) {
            // States not updated for > 3x threshold are likely safe to delete
            const veryOldThreshold = this.thresholdHours * 3;
            
            if (state.ageHours > veryOldThreshold) {
                suggestions.safeToDelete.push({
                    id: state.id,
                    reason: `Not updated for ${state.ageHours}h (> ${veryOldThreshold}h threshold)`,
                    lastUpdate: state.lastUpdate
                });
            } else {
                // Recent stale states might still be relevant
                suggestions.reviewRequired.push({
                    id: state.id,
                    reason: `Stale for ${state.ageHours}h (< ${veryOldThreshold}h threshold)`,
                    lastUpdate: state.lastUpdate
                });
            }
        }

        return suggestions;
    }

    /**
     * Cleanup.
     */
    async cleanup() {
        this.staleStates = [];
        this.adapter.log.info('Stale state inspector cleanup complete.');
    }
}

module.exports = StaleStateInspector;
