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
        this.ignoreList = [
            'system.*',
            'admin.*',
            '0_userdata.*',
            'alias.*',
            'system-health.*',
            ...ignoreList
        ];
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
        
        // Build reference map
        const referenceMap = await this.buildReferenceMap();
        
        // Analyze state usage (read/write patterns)
        const usageMap = await this.analyzeUsagePatterns(allStates);
        
        for (const [stateId, state] of Object.entries(allStates)) {
            // Skip ignored patterns
            if (this.shouldIgnore(stateId)) {
                continue;
            }

            const obj = allObjects[stateId];
            if (!obj) {
                continue; // State without object definition
            }

            const orphanInfo = await this.checkOrphaned(
                stateId, 
                obj, 
                state,
                adapterInstances, 
                referenceMap,
                usageMap
            );
            
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
     * Build reference map from scripts, vis, aliases.
     * @returns {Promise<Map<string, Array<string>>>} Map of state ID -> references
     */
    async buildReferenceMap() {
        const referenceMap = new Map();

        try {
            // 1. Scan JavaScript/Blockly scripts
            const scripts = await this.adapter.getForeignObjectsAsync('script.js.*', 'script');
            
            for (const [scriptId, scriptObj] of Object.entries(scripts)) {
                if (!scriptObj?.common?.source) continue;
                
                const source = scriptObj.common.source;
                
                // Extract state IDs from script (simple regex-based detection)
                const stateReferences = this.extractStateReferences(source);
                
                for (const stateId of stateReferences) {
                    if (!referenceMap.has(stateId)) {
                        referenceMap.set(stateId, []);
                    }
                    referenceMap.get(stateId).push(`script:${scriptId}`);
                }
            }

            // 2. Scan vis projects
            const visProjects = await this.adapter.getForeignObjectsAsync('vis.*', 'meta');
            
            for (const [visId, visObj] of Object.entries(visProjects)) {
                if (visObj?.type === 'meta' && visObj?.common?.type === 'project') {
                    // vis project data contains widget bindings
                    const visData = JSON.stringify(visObj);
                    const stateReferences = this.extractStateReferences(visData);
                    
                    for (const stateId of stateReferences) {
                        if (!referenceMap.has(stateId)) {
                            referenceMap.set(stateId, []);
                        }
                        referenceMap.get(stateId).push(`vis:${visId}`);
                    }
                }
            }

            // 3. Scan alias structures
            const aliases = await this.adapter.getForeignObjectsAsync('alias.0.*', 'state');
            
            for (const [aliasId, aliasObj] of Object.entries(aliases)) {
                if (!aliasObj?.common?.alias?.id) continue;
                
                const targetStateId = aliasObj.common.alias.id;
                
                if (!referenceMap.has(targetStateId)) {
                    referenceMap.set(targetStateId, []);
                }
                referenceMap.get(targetStateId).push(`alias:${aliasId}`);
            }

            this.adapter.log.debug(`Built reference map with ${referenceMap.size} referenced states`);

        } catch (err) {
            this.adapter.log.error(`Error building reference map: ${err.message}`);
        }

        return referenceMap;
    }

    /**
     * Extract state IDs from source code or config.
     * @param {string} source - Source code or JSON config
     * @returns {Set<string>} Set of state IDs
     */
    extractStateReferences(source) {
        const stateIds = new Set();
        
        // Match patterns like:
        // getState('adapter.0.state')
        // setState('adapter.0.state', ...)
        // $('adapter.0.state')
        // "oid": "adapter.0.state"
        // 'adapter.0.*' subscriptions
        
        const patterns = [
            /['"`]([a-zA-Z0-9_-]+\.\d+\.[a-zA-Z0-9_./-]+)['"`]/g,  // Quoted state IDs
            /\$\(['"`]([a-zA-Z0-9_-]+\.\d+\.[a-zA-Z0-9_./-]+)['"`]\)/g,  // $('state')
            /getState\(['"`]([a-zA-Z0-9_-]+\.\d+\.[a-zA-Z0-9_./-]+)['"`]\)/g,  // getState('state')
            /setState\(['"`]([a-zA-Z0-9_-]+\.\d+\.[a-zA-Z0-9_./-]+)['"`]/g,  // setState('state', ...)
        ];
        
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(source)) !== null) {
                const stateId = match[1];
                
                // Filter out false positives (URLs, etc.)
                if (stateId.includes('.') && !stateId.startsWith('http')) {
                    stateIds.add(stateId);
                }
            }
        }
        
        return stateIds;
    }

    /**
     * Analyze usage patterns (read/write activity).
     * @param {object} allStates - All states with metadata
     * @returns {Promise<Map<string, object>>} Map of state ID -> usage info
     */
    async analyzeUsagePatterns(allStates) {
        const usageMap = new Map();
        const now = Date.now();
        const ONE_MONTH = 30 * 24 * 60 * 60 * 1000;

        for (const [stateId, state] of Object.entries(allStates)) {
            const usage = {
                recentlyRead: false,
                recentlyWritten: false,
                neverUsed: false,
                readOnly: false,
                writeOnly: false
            };

            const lastChange = state?.lc || 0;
            const lastAccess = state?.ts || 0;
            
            const timeSinceChange = now - lastChange;
            const timeSinceAccess = now - lastAccess;

            // Determine usage pattern
            if (timeSinceChange > ONE_MONTH && timeSinceAccess > ONE_MONTH) {
                usage.neverUsed = true;
            } else {
                if (timeSinceAccess < ONE_MONTH) {
                    usage.recentlyRead = true;
                }
                if (timeSinceChange < ONE_MONTH) {
                    usage.recentlyWritten = true;
                }

                // Read-only: accessed but not changed
                if (usage.recentlyRead && !usage.recentlyWritten && lastChange < lastAccess) {
                    usage.readOnly = true;
                }

                // Write-only: changed but not accessed
                if (usage.recentlyWritten && !usage.recentlyRead && lastAccess < lastChange) {
                    usage.writeOnly = true;
                }
            }

            usageMap.set(stateId, usage);
        }

        return usageMap;
    }

    /**
     * Check if a state is orphaned.
     * @param {string} stateId - State ID
     * @param {object} obj - State object definition
     * @param {object} state - State value and metadata
     * @param {Map} adapterInstances - Map of adapter instances
     * @param {Map} referenceMap - Map of state references
     * @param {Map} usageMap - Map of usage patterns
     * @returns {object|null} Orphan info or null if not orphaned
     */
    async checkOrphaned(stateId, obj, state, adapterInstances, referenceMap, usageMap) {
        // Extract adapter name from state ID (e.g., 'zigbee.0.state' -> 'zigbee.0')
        const match = stateId.match(/^([^.]+\.\d+)\./);
        
        if (!match) {
            // System states or malformed IDs
            return null;
        }

        const adapterId = match[1];
        
        // Check if adapter instance exists
        const adapterExists = adapterInstances.has(adapterId);
        const adapterEnabled = adapterInstances.get(adapterId)?.common?.enabled;
        
        // Check if state is referenced
        const references = referenceMap.get(stateId) || [];
        const isReferenced = references.length > 0;
        
        // Get usage info
        const usage = usageMap.get(stateId) || {};
        
        // Determine orphan category
        let category = null;
        let reason = '';
        let usageType = 'unknown';
        
        // Determine usage type for reporting
        if (usage.neverUsed) {
            usageType = 'never_used';
        } else if (usage.readOnly) {
            usageType = 'read_only';
        } else if (usage.writeOnly) {
            usageType = 'write_only';
        } else if (usage.recentlyRead || usage.recentlyWritten) {
            usageType = 'active';
        }
        
        // Classification logic
        if (!adapterExists) {
            category = 'adapter_removed';
            reason = `Adapter ${adapterId} no longer installed`;
        } else if (!adapterEnabled) {
            category = 'adapter_disabled';
            reason = `Adapter ${adapterId} is disabled`;
        } else if (!isReferenced && usage.neverUsed) {
            category = 'unreferenced_unused';
            reason = 'State not referenced and never used';
        } else if (!isReferenced && adapterEnabled) {
            category = 'unreferenced_but_active';
            reason = 'State not referenced in scripts/vis/aliases but adapter is active';
        }
        
        // Only report true orphans (not states that are actively used by their adapter)
        if (category && category !== 'unreferenced_but_active') {
            return {
                id: stateId,
                adapter: adapterId,
                category,
                reason,
                references: references.length > 0 ? references : undefined,
                usage: usageType,
                lastChange: state?.lc ? new Date(state.lc).toISOString() : null,
                lastAccess: state?.ts ? new Date(state.ts).toISOString() : null,
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
                byAdapter: this.groupByAdapter(),
                byUsage: this.groupByUsage()
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
     * Group orphaned states by usage pattern.
     * @returns {object} Usage type -> count
     */
    groupByUsage() {
        const usageTypes = {};
        
        for (const orphan of this.orphanedStates) {
            const usage = orphan.usage || 'unknown';
            usageTypes[usage] = (usageTypes[usage] || 0) + 1;
        }
        
        return usageTypes;
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
            const suggestion = {
                id: orphan.id,
                reason: orphan.reason,
                usage: orphan.usage,
                lastChange: orphan.lastChange,
                lastAccess: orphan.lastAccess,
                adapter: orphan.adapter,
                references: orphan.references
            };

            if (orphan.category === 'adapter_removed' && orphan.usage === 'never_used') {
                // Adapter removed AND never used - safe to delete
                suggestions.safeToDelete.push(suggestion);
            } else if (orphan.category === 'unreferenced_unused') {
                // Unreferenced and unused - likely safe but review recommended
                suggestions.reviewRequired.push(suggestion);
            } else if (orphan.category === 'adapter_disabled') {
                // Adapter disabled - might be re-enabled
                suggestions.keepForNow.push(suggestion);
            } else {
                // Default: review required
                suggestions.reviewRequired.push(suggestion);
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
