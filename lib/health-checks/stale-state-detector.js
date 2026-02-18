'use strict';

/**
 * Stale state detection - monitors configured states for staleness.
 */
class StaleStateDetector {
    /**
     * @param {object} adapter - ioBroker adapter instance
     * @param {Array<object>} watchedStates - Array of {id, intervalSeconds, gracePeriodSeconds}
     */
    constructor(adapter, watchedStates = []) {
        this.adapter = adapter;
        this.watchedStates = new Map(); // id -> {intervalSeconds, gracePeriodSeconds, lastUpdate}
        this.subscriptions = new Set();
        
        // Initialize watched states
        for (const config of watchedStates) {
            this.watchedStates.set(config.id, {
                intervalSeconds: config.intervalSeconds,
                gracePeriodSeconds: config.gracePeriodSeconds || 60,
                lastUpdate: null,
                isStale: false
            });
        }
    }

    /**
     * Initialize stale state detection.
     */
    async init() {
        this.adapter.log.info('Initializing stale state detection...');
        
        // Create states
        await this.createStates();
        
        // Subscribe to all watched states
        await this.subscribeToWatchedStates();
        
        // Load last update times from states
        await this.loadLastUpdateTimes();
        
        this.adapter.log.info(`Stale state detection initialized (${this.watchedStates.size} states watched).`);
    }

    /**
     * Create ioBroker states for stale detection reporting.
     */
    async createStates() {
        const baseId = `${this.adapter.namespace}.staleStates`;

        await this.adapter.setObjectNotExistsAsync(`${baseId}.list`, {
            type: 'state',
            common: {
                name: 'List of stale states',
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
                role: 'indicator.alarm',
                read: true,
                write: false
            },
            native: {}
        });
    }

    /**
     * Subscribe to all watched states.
     */
    async subscribeToWatchedStates() {
        for (const stateId of this.watchedStates.keys()) {
            try {
                await this.adapter.subscribeForeignStatesAsync(stateId);
                this.subscriptions.add(stateId);
                this.adapter.log.debug(`Subscribed to ${stateId}`);
            } catch (err) {
                this.adapter.log.error(`Failed to subscribe to ${stateId}: ${err.message}`);
            }
        }
    }

    /**
     * Load last update times for watched states.
     */
    async loadLastUpdateTimes() {
        for (const [stateId, config] of this.watchedStates.entries()) {
            try {
                const state = await this.adapter.getForeignStateAsync(stateId);
                if (state && state.ts) {
                    config.lastUpdate = state.ts;
                    this.adapter.log.debug(`Loaded last update for ${stateId}: ${new Date(state.ts).toISOString()}`);
                } else {
                    this.adapter.log.warn(`No previous state found for ${stateId}`);
                }
            } catch (err) {
                this.adapter.log.error(`Failed to load state ${stateId}: ${err.message}`);
            }
        }
    }

    /**
     * Handle state change (called from main adapter).
     * @param {string} id - State ID
     * @param {object} state - State object
     */
    onStateChange(id, state) {
        if (!this.watchedStates.has(id)) {
            return;
        }

        const config = this.watchedStates.get(id);
        
        if (state && state.ts) {
            config.lastUpdate = state.ts;
            config.isStale = false;
            this.adapter.log.debug(`Updated ${id} at ${new Date(state.ts).toISOString()}`);
        }
    }

    /**
     * Check all watched states for staleness.
     */
    async checkStaleness() {
        const now = Date.now();
        const staleStates = [];

        for (const [stateId, config] of this.watchedStates.entries()) {
            if (!config.lastUpdate) {
                // Never seen this state - mark as stale immediately
                config.isStale = true;
                staleStates.push({
                    id: stateId,
                    lastUpdate: null,
                    expectedInterval: config.intervalSeconds,
                    timeSinceUpdate: null,
                    reason: 'Never updated'
                });
                continue;
            }

            const timeSinceUpdateMs = now - config.lastUpdate;
            const timeSinceUpdateSec = timeSinceUpdateMs / 1000;
            const thresholdSec = config.intervalSeconds + config.gracePeriodSeconds;

            if (timeSinceUpdateSec > thresholdSec) {
                config.isStale = true;
                staleStates.push({
                    id: stateId,
                    lastUpdate: new Date(config.lastUpdate).toISOString(),
                    expectedInterval: config.intervalSeconds,
                    timeSinceUpdate: Math.round(timeSinceUpdateSec),
                    reason: `No update for ${Math.round(timeSinceUpdateSec)}s (expected every ${config.intervalSeconds}s)`
                });
            } else {
                config.isStale = false;
            }
        }

        // Update states
        await this.adapter.setStateAsync('staleStates.list', JSON.stringify(staleStates, null, 2), true);
        await this.adapter.setStateAsync('staleStates.count', staleStates.length, true);
        await this.adapter.setStateAsync('staleStates.hasStale', staleStates.length > 0, true);

        // Log warnings for stale states
        if (staleStates.length > 0) {
            this.adapter.log.warn(`Found ${staleStates.length} stale state(s): ${staleStates.map(s => s.id).join(', ')}`);
        } else {
            this.adapter.log.debug('All watched states are up-to-date.');
        }

        return staleStates;
    }

    /**
     * Get current stale state status.
     * @returns {object} {staleCount, staleStates: [...]}
     */
    getStatus() {
        const staleStates = [];
        
        for (const [stateId, config] of this.watchedStates.entries()) {
            if (config.isStale) {
                staleStates.push({
                    id: stateId,
                    lastUpdate: config.lastUpdate ? new Date(config.lastUpdate).toISOString() : null,
                    intervalSeconds: config.intervalSeconds
                });
            }
        }

        return {
            staleCount: staleStates.length,
            staleStates
        };
    }

    /**
     * Add a state to the watch list.
     * @param {string} stateId - State ID
     * @param {number} intervalSeconds - Expected update interval
     * @param {number} gracePeriodSeconds - Grace period before alerting
     */
    async addWatchedState(stateId, intervalSeconds, gracePeriodSeconds = 60) {
        if (this.watchedStates.has(stateId)) {
            this.adapter.log.warn(`State ${stateId} is already watched.`);
            return;
        }

        this.watchedStates.set(stateId, {
            intervalSeconds,
            gracePeriodSeconds,
            lastUpdate: null,
            isStale: false
        });

        await this.adapter.subscribeForeignStatesAsync(stateId);
        this.subscriptions.add(stateId);

        // Load current value
        const state = await this.adapter.getForeignStateAsync(stateId);
        if (state && state.ts) {
            this.watchedStates.get(stateId).lastUpdate = state.ts;
        }

        this.adapter.log.info(`Added ${stateId} to watch list (interval: ${intervalSeconds}s, grace: ${gracePeriodSeconds}s)`);
    }

    /**
     * Remove a state from the watch list.
     * @param {string} stateId - State ID
     */
    async removeWatchedState(stateId) {
        if (!this.watchedStates.has(stateId)) {
            this.adapter.log.warn(`State ${stateId} is not watched.`);
            return;
        }

        this.watchedStates.delete(stateId);
        
        if (this.subscriptions.has(stateId)) {
            await this.adapter.unsubscribeForeignStatesAsync(stateId);
            this.subscriptions.delete(stateId);
        }

        this.adapter.log.info(`Removed ${stateId} from watch list.`);
    }

    /**
     * Cleanup and unsubscribe.
     */
    async cleanup() {
        for (const stateId of this.subscriptions) {
            await this.adapter.unsubscribeForeignStatesAsync(stateId);
        }
        this.subscriptions.clear();
        this.adapter.log.info('Stale state detection cleanup complete.');
    }
}

module.exports = StaleStateDetector;
