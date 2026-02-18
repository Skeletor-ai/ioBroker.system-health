'use strict';

/**
 * Orphaned state detection - identifies states without adapters or references.
 */
class OrphanedStateInspector {
    /**
     * @param {object} adapter - ioBroker adapter instance
     * @param {Array<string>} ignoreList - State patterns to ignore (e.g., 'system.*', 'admin.*')
     */
    constructor(adapter, ignoreList = []) {
        this.adapter = adapter;
        this.ignoreList = ignoreList;
        this.orphanedStates = [];
    }

    /**
     * Initialize orphaned state inspector.
     */
    async init() {
        this.adapter.log.info('Initializing orphaned state inspector...');
        
        // Create states
        await this.createStates();
        
        this.adapter.log.info('Orphaned state inspector initialized.');
    }

    /**
     * Create ioBroker states for inspection results.
     */
    async createStates() {
        const baseId = `${this.adapter.namespace}.inspector.orphanedStates`;

        await this.adapter.setObjectNotExistsAsync(`${baseId}.report`, {
            type: 'state',
            common: {
                name: 'Orphaned states report',
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
                name: 'Number of orphaned states',
                type: 'number',
                role: 'value',
                read: true,
                write: false
            },
            native: {}
        });

        await this.adapter.setObjectNotExistsAsync(`${baseId}.hasOrphans`, {
            type: 'state',
            common: {
                name: 'System has orphaned states',
                type: 'boolean',
                role: 'indicator',
                read: true,
                write: false
            },
            native: {}
        });

        await this.adapter.setObjectNotExistsAsync(`${baseId}.byCategory`, {
            type: 'state',
            common: {
                name: 'Orphaned states by category',
                type: 'string',
                role: 'json',
                read: true,
                write: false
            },
            native: {}
        });
    }

    /**
     * Run orphaned state detection.
     */
    async inspect() {
        this.adapter.log.info('Starting orphaned state inspection...');

        this.orphanedStates = [];

        // Get all states
        const allStates = await this.adapter.getForeignStatesAsync('*');
        const allObjects = await this.adapter.getForeignObjectsAsync('*', 'state');
        
        // Get all adapter instances
        const adapterInstances = await this.getAdapterInstances();
        
        // Get referenced states from scripts (simplified - would need full implementation)
        const referencedStates = new Set(); // TODO: Implement script scanning
        
        for (const [stateId, state] of Object.entries(allStates)) {
            // Skip ignored patterns
            if (this.shouldIgnore(stateId)) {
                continue;
            }

            const obj = allObjects[stateId];
            if (!obj) {
                continue; // State without object definition
            }

            const orphanInfo = await this.checkOrphaned(stateId, obj, adapterInstances, referencedStates);
            
            if (orphanInfo) {
                this.orphanedStates.push(orphanInfo);
            }
        }

        // Generate report
        const report = this.generateReport();
        
        // Update states
        await this.adapter.setStateAsync('inspector.orphanedStates.report', JSON.stringify(report, null, 2), true);
        await this.adapter.setStateAsync('inspector.orphanedStates.count', this.orphanedStates.length, true);
        await this.adapter.setStateAsync('inspector.orphanedStates.hasOrphans', this.orphanedStates.length > 0, true);
        await this.adapter.setStateAsync('inspector.orphanedStates.byCategory', JSON.stringify(this.categorizeOrphans(), null, 2), true);

        this.adapter.log.info(`Orphaned state inspection complete: ${this.orphanedStates.length} orphaned state(s) found.`);

        return report;
    }

    /**
     * Check if a state is orphaned.
     * @param {string} stateId - State ID
     * @param {object} obj - State object definition
     * @param {Map} adapterInstances - Map of adapter instances
     * @param {Set} referencedStates - Set of referenced state IDs
     * @returns {object|null} Orphan info or null if not orphaned
     */
    async checkOrphaned(stateId, obj, adapterInstances, referencedStates) {
        // Extract adapter name from state ID (e.g., 'zigbee.0.state' -> 'zigbee.0')
        const match = stateId.match(/^([^.]+\.\d+)\./);
        
        if (!match) {
            // System states or malformed IDs
            return null;
        }

        const adapterId = match[1];
        const adapterName = adapterId.split('.')[0];
        
        // Check if adapter instance exists
        const adapterExists = adapterInstances.has(adapterId);
        const adapterRunning = adapterInstances.get(adapterId)?.common?.enabled;
        
        // Check if state is referenced
        const isReferenced = referencedStates.has(stateId);
        
        // Determine orphan category
        let category = null;
        let reason = '';
        
        if (!adapterExists) {
            category = 'adapter_removed';
            reason = `Adapter ${adapterId} no longer installed`;
        } else if (!adapterRunning) {
            category = 'adapter_disabled';
            reason = `Adapter ${adapterId} is disabled`;
        } else if (!isReferenced) {
            category = 'unreferenced';
            reason = 'State not referenced in scripts/vis/automations';
        }
        
        if (category) {
            return {
                id: stateId,
                adapter: adapterId,
                category,
                reason,
                lastChange: obj.ts ? new Date(obj.ts).toISOString() : null,
                type: obj.common?.type || 'unknown',
                role: obj.common?.role || 'unknown'
            };
        }

        return null;
    }

    /**
     * Get all adapter instances.
     * @returns {Promise<Map>} Map of adapter ID -> adapter object
     */
    async getAdapterInstances() {
        const adapters = await this.adapter.getForeignObjectsAsync('system.adapter.*', 'instance');
        const instances = new Map();
        
        for (const [id, obj] of Object.entries(adapters)) {
            // Extract instance name (e.g., 'system.adapter.zigbee.0' -> 'zigbee.0')
            const match = id.match(/^system\.adapter\.(.+)$/);
            if (match) {
                instances.set(match[1], obj);
            }
        }
        
        return instances;
    }

    /**
     * Check if a state ID matches any ignore pattern.
     * @param {string} stateId - State ID
     * @returns {boolean}
     */
    shouldIgnore(stateId) {
        for (const pattern of this.ignoreList) {
            // Simple wildcard matching (*.pattern or pattern.*)
            const regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
            const regex = new RegExp(`^${regexPattern}$`);
            
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
        return {
            timestamp: new Date().toISOString(),
            totalOrphaned: this.orphanedStates.length,
            orphanedStates: this.orphanedStates,
            summary: {
                byCategory: this.categorizeOrphans(),
                byAdapter: this.groupByAdapter()
            }
        };
    }

    /**
     * Categorize orphaned states.
     * @returns {object} Category -> count
     */
    categorizeOrphans() {
        const categories = {};
        
        for (const orphan of this.orphanedStates) {
            categories[orphan.category] = (categories[orphan.category] || 0) + 1;
        }
        
        return categories;
    }

    /**
     * Group orphaned states by adapter.
     * @returns {object} Adapter ID -> count
     */
    groupByAdapter() {
        const adapters = {};
        
        for (const orphan of this.orphanedStates) {
            adapters[orphan.adapter] = (adapters[orphan.adapter] || 0) + 1;
        }
        
        return adapters;
    }

    /**
     * Get cleanup suggestions for orphaned states.
     * @returns {object}
     */
    getCleanupSuggestions() {
        const suggestions = {
            safeToDelete: [],
            reviewRequired: [],
            keepForNow: []
        };

        for (const orphan of this.orphanedStates) {
            if (orphan.category === 'adapter_removed') {
                // Adapter removed - likely safe to delete
                suggestions.safeToDelete.push(orphan.id);
            } else if (orphan.category === 'adapter_disabled') {
                // Adapter disabled - might be re-enabled
                suggestions.reviewRequired.push(orphan.id);
            } else if (orphan.category === 'unreferenced') {
                // Unreferenced but adapter running - review needed
                suggestions.reviewRequired.push(orphan.id);
            }
        }

        return suggestions;
    }

    /**
     * Cleanup.
     */
    async cleanup() {
        this.orphanedStates = [];
        this.adapter.log.info('Orphaned state inspector cleanup complete.');
    }
}

module.exports = OrphanedStateInspector;
