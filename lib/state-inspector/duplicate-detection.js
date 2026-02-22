'use strict';

/**
 * Duplicate state detection - identifies data points with identical values or naming patterns.
 */
class DuplicateStateInspector {
    /**
     * @param {object} adapter - ioBroker adapter instance
     * @param {number} similarityThreshold - Threshold for similarity detection (0-1, default 0.9)
     */
    constructor(adapter, similarityThreshold = 0.9) {
        this.adapter = adapter;
        this.similarityThreshold = similarityThreshold;
        this.duplicates = [];
    }

    /**
     * Initialize duplicate state inspector.
     */
    async init() {
        this.adapter.log.info('Initializing duplicate state inspector...');
        
        // Create states
        await this.createStates();
        
        this.adapter.log.info('Duplicate state inspector initialized.');
    }

    /**
     * Create ioBroker states for inspection results.
     */
    async createStates() {
        const baseId = `${this.adapter.namespace}.inspector.duplicates`;

        await this.adapter.setObjectNotExistsAsync(`${baseId}.report`, {
            type: 'state',
            common: {
                name: 'Duplicate states report',
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
                name: 'Number of duplicate groups',
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
                name: 'Last scan timestamp',
                type: 'number',
                role: 'value.time',
                read: true,
                write: false
            },
            native: {}
        });
    }

    /**
     * Run duplicate detection scan.
     * @returns {Promise<Array>} Array of duplicate groups
     */
    async scan() {
        this.adapter.log.info('Starting duplicate state scan...');
        this.duplicates = [];

        try {
            // Get all states
            this.adapter.log.debug('Fetching states and objects...');
            const states = await this.adapter.getForeignStatesAsync('*');
            const objects = await this.adapter.getForeignObjectsAsync('*', 'state');

            this.adapter.log.debug(`Retrieved ${Object.keys(states).length} states and ${Object.keys(objects).length} objects`);

            // Build state map with metadata
            const stateMap = new Map();
            let processedCount = 0;
            for (const [id, state] of Object.entries(states)) {
                if (!state || !objects[id]) continue;
                
                // Skip system/admin states early
                if (id.startsWith('system.') || id.startsWith('admin.')) continue;
                
                const obj = objects[id];
                stateMap.set(id, {
                    id,
                    value: state.val,
                    ts: state.ts,
                    lc: state.lc,
                    type: obj.common?.type,
                    role: obj.common?.role,
                    name: obj.common?.name || '',
                    unit: obj.common?.unit
                });

                processedCount++;
                // Yield to event loop every 1000 states
                if (processedCount % 1000 === 0) {
                    this.adapter.log.debug(`Processed ${processedCount} states...`);
                    await this.sleep(0);
                }
            }

            this.adapter.log.info(`Built state map with ${stateMap.size} entries`);

            // Detect duplicates by value
            this.adapter.log.debug('Detecting value duplicates...');
            const valueDuplicates = this.detectValueDuplicates(stateMap);
            this.adapter.log.debug(`Found ${valueDuplicates.length} value duplicate groups`);
            
            // Detect naming pattern duplicates
            this.adapter.log.debug('Detecting naming duplicates...');
            const nameDuplicates = await this.detectNamingDuplicates(stateMap);
            this.adapter.log.debug(`Found ${nameDuplicates.length} naming duplicate groups`);

            // Merge and deduplicate results
            this.duplicates = this.mergeResults(valueDuplicates, nameDuplicates);

            // Update adapter states
            await this.updateStates();

            this.adapter.log.info(`Duplicate scan completed. Found ${this.duplicates.length} duplicate groups.`);
            return this.duplicates;

        } catch (err) {
            this.adapter.log.error(`Duplicate scan failed: ${err.message}`);
            this.adapter.log.error(`Stack: ${err.stack}`);
            throw err;
        }
    }

    /**
     * Sleep helper for yielding to event loop.
     * @param {number} ms - Milliseconds to sleep
     * @returns {Promise<void>}
     */
    sleep(ms) {
        return new Promise(resolve => setImmediate(resolve));
    }

    /**
     * Detect states with identical values.
     * @param {Map} stateMap - Map of state IDs to metadata
     * @returns {Array} Array of duplicate groups
     */
    detectValueDuplicates(stateMap) {
        const valueGroups = new Map();

        for (const [id, metadata] of stateMap) {
            // Skip system states
            if (id.startsWith('system.') || id.startsWith('admin.')) continue;
            
            // Skip states with null/undefined values
            if (metadata.value === null || metadata.value === undefined) continue;

            // Create value key (value + type + unit)
            const valueKey = `${JSON.stringify(metadata.value)}_${metadata.type}_${metadata.unit}`;

            if (!valueGroups.has(valueKey)) {
                valueGroups.set(valueKey, []);
            }
            valueGroups.get(valueKey).push(metadata);
        }

        // Filter groups with more than one state
        const duplicates = [];
        for (const [valueKey, group] of valueGroups) {
            if (group.length > 1) {
                // Check if values have been updated recently (within 5 minutes)
                const now = Date.now();
                const recentlyUpdated = group.filter(s => (now - s.lc) < 5 * 60 * 1000);
                
                duplicates.push({
                    type: 'value',
                    reason: 'Identical value across multiple states',
                    value: group[0].value,
                    dataType: group[0].type,
                    unit: group[0].unit,
                    states: group.map(s => ({
                        id: s.id,
                        name: s.name,
                        lastChanged: s.lc,
                        isStale: (now - s.lc) > 24 * 60 * 60 * 1000
                    })),
                    confidence: recentlyUpdated.length > 1 ? 'high' : 'medium'
                });
            }
        }

        return duplicates;
    }

    /**
     * Detect states with similar naming patterns.
     * @param {Map} stateMap - Map of state IDs to metadata
     * @returns {Promise<Array>} Array of duplicate groups
     */
    async detectNamingDuplicates(stateMap) {
        const duplicates = [];
        const processed = new Set();

        const stateArray = Array.from(stateMap.values());
        const totalStates = stateArray.length;
        
        // Limit comparison scope for large systems
        const MAX_COMPARISONS = 50000;
        let comparisonCount = 0;

        this.adapter.log.debug(`Starting naming comparison for ${totalStates} states (max ${MAX_COMPARISONS} comparisons)`);

        for (let i = 0; i < stateArray.length; i++) {
            if (processed.has(stateArray[i].id)) continue;
            
            const baseState = stateArray[i];
            
            // Skip system states
            if (baseState.id.startsWith('system.') || baseState.id.startsWith('admin.')) continue;

            const similarStates = [baseState];

            for (let j = i + 1; j < stateArray.length; j++) {
                if (processed.has(stateArray[j].id)) continue;
                
                const compareState = stateArray[j];
                
                // Calculate similarity
                try {
                    const similarity = this.calculateSimilarity(baseState, compareState);
                    
                    if (similarity >= this.similarityThreshold) {
                        similarStates.push(compareState);
                        processed.add(compareState.id);
                    }

                    comparisonCount++;

                    // Yield every 100 comparisons to prevent blocking
                    if (comparisonCount % 100 === 0) {
                        await this.sleep(0);
                    }

                    // Safety limit for very large systems
                    if (comparisonCount >= MAX_COMPARISONS) {
                        this.adapter.log.warn(`Reached maximum comparison limit (${MAX_COMPARISONS}). Stopping naming duplicate detection.`);
                        this.adapter.log.warn(`Processed ${i + 1}/${totalStates} base states. Consider reducing scope.`);
                        break;
                    }
                } catch (err) {
                    this.adapter.log.debug(`Error comparing ${baseState.id} with ${compareState.id}: ${err.message}`);
                }
            }

            if (similarStates.length > 1) {
                processed.add(baseState.id);
                
                const now = Date.now();
                duplicates.push({
                    type: 'naming',
                    reason: 'Similar naming pattern detected',
                    pattern: this.extractCommonPattern(similarStates.map(s => s.id)),
                    states: similarStates.map(s => ({
                        id: s.id,
                        name: s.name,
                        value: s.value,
                        lastChanged: s.lc,
                        isStale: (now - s.lc) > 24 * 60 * 60 * 1000
                    })),
                    confidence: 'medium'
                });
            }

            // Yield progress every 10 base states
            if (i % 10 === 0) {
                await this.sleep(0);
            }

            // Stop early if comparison limit reached
            if (comparisonCount >= MAX_COMPARISONS) {
                break;
            }
        }

        this.adapter.log.debug(`Naming comparison completed: ${comparisonCount} comparisons, ${duplicates.length} groups found`);

        return duplicates;
    }

    /**
     * Calculate similarity between two states based on naming and properties.
     * @param {object} state1 - First state metadata
     * @param {object} state2 - Second state metadata
     * @returns {number} Similarity score (0-1)
     */
    calculateSimilarity(state1, state2) {
        let score = 0;
        let factors = 0;

        // Compare IDs (normalized Levenshtein distance)
        const idSimilarity = this.levenshteinSimilarity(state1.id, state2.id);
        score += idSimilarity * 0.4;
        factors += 0.4;

        // Compare names
        if (state1.name && state2.name) {
            const nameSimilarity = this.levenshteinSimilarity(
                String(state1.name), 
                String(state2.name)
            );
            score += nameSimilarity * 0.3;
            factors += 0.3;
        }

        // Same type and role
        if (state1.type === state2.type) {
            score += 0.15;
        }
        factors += 0.15;

        if (state1.role === state2.role) {
            score += 0.15;
        }
        factors += 0.15;

        return factors > 0 ? score / factors : 0;
    }

    /**
     * Calculate Levenshtein similarity (normalized, 0-1).
     * @param {string} str1 - First string
     * @param {string} str2 - Second string
     * @returns {number} Similarity score (0-1)
     */
    levenshteinSimilarity(str1, str2) {
        const distance = this.levenshteinDistance(str1, str2);
        const maxLength = Math.max(str1.length, str2.length);
        return maxLength === 0 ? 1 : 1 - (distance / maxLength);
    }

    /**
     * Calculate Levenshtein distance between two strings.
     * @param {string} str1 - First string
     * @param {string} str2 - Second string
     * @returns {number} Edit distance
     */
    levenshteinDistance(str1, str2) {
        const matrix = [];

        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }

        return matrix[str2.length][str1.length];
    }

    /**
     * Extract common pattern from state IDs.
     * @param {Array<string>} ids - Array of state IDs
     * @returns {string} Common pattern
     */
    extractCommonPattern(ids) {
        if (ids.length === 0) return '';
        if (ids.length === 1) return ids[0];

        // Find common prefix
        let prefix = ids[0];
        for (let i = 1; i < ids.length; i++) {
            while (!ids[i].startsWith(prefix)) {
                prefix = prefix.slice(0, -1);
                if (prefix === '') break;
            }
        }

        // Find common suffix
        let suffix = ids[0];
        for (let i = 1; i < ids.length; i++) {
            while (!ids[i].endsWith(suffix)) {
                suffix = suffix.slice(1);
                if (suffix === '') break;
            }
        }

        if (prefix && suffix) {
            return `${prefix}*${suffix}`;
        } else if (prefix) {
            return `${prefix}*`;
        } else if (suffix) {
            return `*${suffix}`;
        }
        
        return ids.join(', ').substring(0, 100) + '...';
    }

    /**
     * Merge duplicate detection results and remove overlaps.
     * @param {Array} valueDuplicates - Duplicates by value
     * @param {Array} nameDuplicates - Duplicates by naming
     * @returns {Array} Merged and deduplicated results
     */
    mergeResults(valueDuplicates, nameDuplicates) {
        const merged = [...valueDuplicates];
        const existingIds = new Set();

        // Collect all IDs from value duplicates
        for (const dup of valueDuplicates) {
            for (const state of dup.states) {
                existingIds.add(state.id);
            }
        }

        // Add naming duplicates that don't overlap
        for (const dup of nameDuplicates) {
            const stateIds = dup.states.map(s => s.id);
            const hasOverlap = stateIds.some(id => existingIds.has(id));
            
            if (!hasOverlap) {
                merged.push(dup);
                stateIds.forEach(id => existingIds.add(id));
            }
        }

        return merged;
    }

    /**
     * Update adapter states with scan results.
     */
    async updateStates() {
        const baseId = `${this.adapter.namespace}.inspector.duplicates`;

        // Generate report
        const report = {
            timestamp: Date.now(),
            duplicateGroups: this.duplicates.length,
            totalDuplicateStates: this.duplicates.reduce((sum, dup) => sum + dup.states.length, 0),
            duplicates: this.duplicates
        };

        await this.adapter.setStateAsync(`${baseId}.report`, {
            val: JSON.stringify(report, null, 2),
            ack: true
        });

        await this.adapter.setStateAsync(`${baseId}.count`, {
            val: this.duplicates.length,
            ack: true
        });

        await this.adapter.setStateAsync(`${baseId}.lastScan`, {
            val: Date.now(),
            ack: true
        });
    }

    /**
     * Stop the inspector.
     */
    async stop() {
        this.adapter.log.info('Stopping duplicate state inspector...');
    }
}

module.exports = DuplicateStateInspector;
