'use strict';

/**
 * Performance analyzer - identifies states with performance/resource usage issues.
 * Focuses on actionable insights without risky deletions:
 * - States updating too frequently (< 100ms)
 * - Unnecessary history logging
 * - Large object trees
 * - Ack handling issues
 */
class PerformanceAnalyzer {
    /**
     * @param {object} adapter - ioBroker adapter instance
     * @param {number} updateFrequencyMs - Threshold for frequent updates (default 100ms)
     * @param {Array<string>} ignorePatterns - State patterns to ignore
     */
    constructor(adapter, updateFrequencyMs = 100, ignorePatterns = []) {
        this.adapter = adapter;
        this.updateFrequencyMs = updateFrequencyMs;
        this.ignorePatterns = [
            'system.*',
            'admin.*',
            '*.info.*',
            '*.alive',
            '*.connected',
            'vis.*',
            ...ignorePatterns
        ];
        this.stateHistory = new Map(); // Track state update timestamps
        this.analysisResults = {
            frequentUpdates: [],
            unnecessaryHistory: [],
            largeObjectTrees: [],
            ackIssues: []
        };

        // Pre-compile ignore patterns
        this.ignoreRegexes = this.ignorePatterns.map(p => {
            const regexPattern = p.replace(/\./g, '\\.').replace(/\*/g, '.*');
            return new RegExp(`^${regexPattern}$`);
        });
    }

    /**
     * Initialize performance analyzer.
     */
    async init() {
        this.adapter.log.info('Initializing performance analyzer...');
        await this.createStates();
        this.adapter.log.info('Performance analyzer initialized.');
    }

    /**
     * Create ioBroker states for analysis results.
     */
    async createStates() {
        const baseId = `${this.adapter.namespace}.inspector.performance`;

        // Report state
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

        // Frequent updates
        await this.adapter.setObjectNotExistsAsync(`${baseId}.frequentUpdates.count`, {
            type: 'state',
            common: {
                name: 'Number of states with frequent updates',
                type: 'number',
                role: 'value',
                read: true,
                write: false
            },
            native: {}
        });

        await this.adapter.setObjectNotExistsAsync(`${baseId}.frequentUpdates.details`, {
            type: 'state',
            common: {
                name: 'States with frequent updates (< 100ms)',
                type: 'string',
                role: 'json',
                read: true,
                write: false
            },
            native: {}
        });

        // Unnecessary history
        await this.adapter.setObjectNotExistsAsync(`${baseId}.unnecessaryHistory.count`, {
            type: 'state',
            common: {
                name: 'Number of states with unnecessary history logging',
                type: 'number',
                role: 'value',
                read: true,
                write: false
            },
            native: {}
        });

        await this.adapter.setObjectNotExistsAsync(`${baseId}.unnecessaryHistory.details`, {
            type: 'state',
            common: {
                name: 'States with unnecessary history logging',
                type: 'string',
                role: 'json',
                read: true,
                write: false
            },
            native: {}
        });

        // Large object trees
        await this.adapter.setObjectNotExistsAsync(`${baseId}.largeObjectTrees.count`, {
            type: 'state',
            common: {
                name: 'Number of large object trees detected',
                type: 'number',
                role: 'value',
                read: true,
                write: false
            },
            native: {}
        });

        await this.adapter.setObjectNotExistsAsync(`${baseId}.largeObjectTrees.details`, {
            type: 'state',
            common: {
                name: 'Large object trees (> 100 states per parent)',
                type: 'string',
                role: 'json',
                read: true,
                write: false
            },
            native: {}
        });

        // Ack issues
        await this.adapter.setObjectNotExistsAsync(`${baseId}.ackIssues.count`, {
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

        await this.adapter.setObjectNotExistsAsync(`${baseId}.ackIssues.details`, {
            type: 'state',
            common: {
                name: 'States with ack handling issues',
                type: 'string',
                role: 'json',
                read: true,
                write: false
            },
            native: {}
        });

        // Summary
        await this.adapter.setObjectNotExistsAsync(`${baseId}.summary`, {
            type: 'state',
            common: {
                name: 'Performance analysis summary',
                type: 'string',
                role: 'json',
                read: true,
                write: false
            },
            native: {}
        });

        // Last scan timestamp
        await this.adapter.setObjectNotExistsAsync(`${baseId}.lastScan`, {
            type: 'state',
            common: {
                name: 'Last performance analysis scan timestamp',
                type: 'number',
                role: 'date',
                read: true,
                write: false
            },
            native: {}
        });
    }

    /**
     * Run performance analysis.
     * @returns {Promise<object>} Analysis report
     */
    async analyse() {
        this.adapter.log.info('Starting performance analysis...');
        
        // Reset results
        this.analysisResults = {
            frequentUpdates: [],
            unnecessaryHistory: [],
            largeObjectTrees: [],
            ackIssues: []
        };

        const now = Date.now();

        // Get all states
        const allStates = await this.adapter.getForeignStatesAsync('*');
        let processed = 0;

        // Analyze each state
        for (const [stateId, state] of Object.entries(allStates)) {
            // Yield to event loop every 100 states
            if (++processed % 100 === 0) {
                await new Promise(resolve => setImmediate(resolve));
            }

            // Skip ignored patterns
            if (this.shouldIgnore(stateId)) {
                continue;
            }

            if (!state) {
                continue;
            }

            // Check for frequent updates
            await this.checkFrequentUpdates(stateId, state);

            // Check for unnecessary history
            await this.checkUnnecessaryHistory(stateId);

            // Check for ack issues
            await this.checkAckIssues(stateId, state);
        }

        // Check for large object trees
        await this.checkLargeObjectTrees();

        const report = this.generateReport();

        // Update states
        const baseId = 'inspector.performance';
        await this.adapter.setStateAsync(`${baseId}.report`, JSON.stringify(report, null, 2), true);
        await this.adapter.setStateAsync(`${baseId}.frequentUpdates.count`, this.analysisResults.frequentUpdates.length, true);
        await this.adapter.setStateAsync(`${baseId}.frequentUpdates.details`, JSON.stringify(this.analysisResults.frequentUpdates.slice(0, 100), null, 2), true);
        await this.adapter.setStateAsync(`${baseId}.unnecessaryHistory.count`, this.analysisResults.unnecessaryHistory.length, true);
        await this.adapter.setStateAsync(`${baseId}.unnecessaryHistory.details`, JSON.stringify(this.analysisResults.unnecessaryHistory.slice(0, 100), null, 2), true);
        await this.adapter.setStateAsync(`${baseId}.largeObjectTrees.count`, this.analysisResults.largeObjectTrees.length, true);
        await this.adapter.setStateAsync(`${baseId}.largeObjectTrees.details`, JSON.stringify(this.analysisResults.largeObjectTrees.slice(0, 100), null, 2), true);
        await this.adapter.setStateAsync(`${baseId}.ackIssues.count`, this.analysisResults.ackIssues.length, true);
        await this.adapter.setStateAsync(`${baseId}.ackIssues.details`, JSON.stringify(this.analysisResults.ackIssues.slice(0, 100), null, 2), true);
        await this.adapter.setStateAsync(`${baseId}.summary`, JSON.stringify(report.summary, null, 2), true);
        await this.adapter.setStateAsync(`${baseId}.lastScan`, now, true);

        this.adapter.log.info('Performance analysis complete.');

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
     * Check for states updating too frequently.
     * Uses ts (timestamp) and lc (lastChange) to detect rapid consecutive updates.
     * @param {string} stateId - State ID
     * @param {object} state - State object
     */
    async checkFrequentUpdates(stateId, state) {
        // Analyze based on timestamp (ts) and lastChange (lc)
        if (!state.ts || typeof state.ts !== 'number') {
            return; // No timestamp data
        }

        // Get the state object to check for rapid changes
        try {
            const obj = await this.adapter.getForeignObjectAsync(stateId);
            if (!obj || !obj.common) {
                return;
            }

            // If lc (lastChange) exists and is very recent compared to ts
            // This suggests the state is being updated very frequently
            if (state.lc && typeof state.lc === 'number') {
                const timeSinceLastChange = state.ts - state.lc;
                
                // If last change happened very recently relative to timestamp,
                // it indicates frequent updates (multiple updates within 100ms window)
                if (timeSinceLastChange < this.updateFrequencyMs && timeSinceLastChange > 0) {
                    const existing = this.analysisResults.frequentUpdates.find(r => r.id === stateId);
                    if (!existing) {
                        this.analysisResults.frequentUpdates.push({
                            id: stateId,
                            adapter: this.extractAdapterName(stateId),
                            timeSinceLastChangeMs: timeSinceLastChange,
                            threshold: this.updateFrequencyMs,
                            suggestion: 'State was updated very recently; consider debouncing or increasing interval',
                            recentValue: state.val,
                            type: state.type || typeof state.val,
                            timestamp: new Date(state.ts).toISOString()
                        });
                    }
                }
            }
        } catch (err) {
            // Silently ignore errors on individual states
        }
    }

    /**
     * Check for unnecessary history logging.
     * Only flags states that are truly static (no change in 7+ days) but have history enabled.
     * @param {string} stateId - State ID
     */
    async checkUnnecessaryHistory(stateId) {
        try {
            // Check both legacy (common.history) and modern (common.custom) history configs
            const obj = await this.adapter.getForeignObjectAsync(stateId);
            if (!obj || !obj.common) {
                return;
            }

            // Check for history via common.history (legacy)
            const legacyHistory = obj.common.history && obj.common.history.length > 0;
            
            // Check for history via common.custom (modern ioBroker)
            let hasHistoryCustom = false;
            if (obj.common.custom && typeof obj.common.custom === 'object') {
                // Check for history adapter configs
                const keys = Object.keys(obj.common.custom);
                hasHistoryCustom = keys.some(k => k.startsWith('history.') || k.includes('history'));
            }

            if (!legacyHistory && !hasHistoryCustom) {
                return; // No history enabled
            }

            // Get the state to check for actual change activity
            const state = await this.adapter.getForeignStateAsync(stateId);
            if (!state) {
                return;
            }

            // Only flag if state is truly static:
            // - No change for 7+ days (lc < 7 days ago)
            // - AND no updates for 24+ hours (ts < 24 hours ago)
            const now = Date.now();
            const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
            const oneDayMs = 24 * 60 * 60 * 1000;

            const lastChangeAge = now - (state.lc || state.ts || now);
            const lastUpdateAge = now - (state.ts || now);

            if (lastChangeAge > sevenDaysMs && lastUpdateAge > oneDayMs) {
                this.analysisResults.unnecessaryHistory.push({
                    id: stateId,
                    adapter: this.extractAdapterName(stateId),
                    historyEnabled: legacyHistory || hasHistoryCustom,
                    lastChangeAgeDays: Math.round(lastChangeAge / (24 * 60 * 60 * 1000)),
                    lastUpdateAgeHours: Math.round(lastUpdateAge / (60 * 60 * 1000)),
                    valueType: typeof state.val,
                    currentValue: state.val,
                    suggestion: 'State has not changed in 7+ days; consider disabling history logging'
                });
            }
        } catch (err) {
            // Silently ignore errors on individual states
        }
    }

    /**
     * Check for ack handling issues.
     * @param {string} stateId - State ID
     * @param {object} state - State object
     */
    async checkAckIssues(stateId, state) {
        try {
            const obj = await this.adapter.getForeignObjectAsync(stateId);
            if (!obj || !obj.common) {
                return;
            }

            // Check if state requires ack but ack is missing
            if (obj.common.ack && obj.common.ack !== false && state && !state.ack) {
                this.analysisResults.ackIssues.push({
                    id: stateId,
                    adapter: this.extractAdapterName(stateId),
                    issue: 'State requires ack but last update not acknowledged',
                    currentValue: state.val,
                    timestamp: new Date(state.ts || Date.now()).toISOString()
                });
            }
        } catch (err) {
            // Silently ignore errors
        }
    }

    /**
     * Check for large object trees (many children under one parent).
     */
    async checkLargeObjectTrees() {
        try {
            const allObjects = await this.adapter.getForeignObjectsAsync('*');
            const childrenPerParent = {};

            // Count children per parent
            for (const id of Object.keys(allObjects)) {
                const parts = id.split('.');
                if (parts.length > 1) {
                    const parent = parts.slice(0, -1).join('.');
                    childrenPerParent[parent] = (childrenPerParent[parent] || 0) + 1;
                }
            }

            // Find parents with > 100 children
            for (const [parent, count] of Object.entries(childrenPerParent)) {
                if (count > 100) {
                    const firstChild = Object.keys(allObjects).filter(id => id.startsWith(parent + '.')).slice(0, 3);
                    this.analysisResults.largeObjectTrees.push({
                        parentId: parent,
                        childCount: count,
                        suggestion: 'Consider restructuring state hierarchy',
                        sampleChildren: firstChild
                    });
                }
            }
        } catch (err) {
            this.adapter.log.warn(`Error checking object trees: ${err.message}`);
        }
    }

    /**
     * Extract adapter name from state ID.
     * @param {string} stateId - State ID
     * @returns {string}
     */
    extractAdapterName(stateId) {
        const match = stateId.match(/^([^.]+\.\d+)/);
        return match ? match[1] : 'unknown';
    }

    /**
     * Generate analysis report.
     * @returns {object}
     */
    generateReport() {
        const total = 
            this.analysisResults.frequentUpdates.length +
            this.analysisResults.unnecessaryHistory.length +
            this.analysisResults.largeObjectTrees.length +
            this.analysisResults.ackIssues.length;

        return {
            timestamp: new Date().toISOString(),
            config: {
                updateFrequencyThresholdMs: this.updateFrequencyMs
            },
            summary: {
                totalIssuesFound: total,
                frequentUpdateCount: this.analysisResults.frequentUpdates.length,
                unnecessaryHistoryCount: this.analysisResults.unnecessaryHistory.length,
                largeObjectTreeCount: this.analysisResults.largeObjectTrees.length,
                ackIssueCount: this.analysisResults.ackIssues.length
            },
            issues: {
                frequentUpdates: this.analysisResults.frequentUpdates.slice(0, 500),
                unnecessaryHistory: this.analysisResults.unnecessaryHistory.slice(0, 500),
                largeObjectTrees: this.analysisResults.largeObjectTrees.slice(0, 500),
                ackIssues: this.analysisResults.ackIssues.slice(0, 500)
            }
        };
    }

    /**
     * Cleanup.
     */
    async cleanup() {
        this.stateHistory.clear();
        this.analysisResults = {
            frequentUpdates: [],
            unnecessaryHistory: [],
            largeObjectTrees: [],
            ackIssues: []
        };
        this.adapter.log.info('Performance analyzer cleanup complete.');
    }
}

module.exports = PerformanceAnalyzer;
