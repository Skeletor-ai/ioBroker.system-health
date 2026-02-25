'use strict';

/**
 * Log monitoring and error/warning counter.
 * Tracks warnings and errors from log entries, grouped per instance.
 */
class LogMonitor {
    /**
     * @param {object} adapter - ioBroker adapter instance
     * @param {object} config - Configuration options
     * @param {number} config.maxLogLines - Maximum number of log lines to analyze
     * @param {number} config.trackingWindowHours - How many hours of logs to track
     */
    constructor(adapter, config = {}) {
        this.adapter = adapter;
        this.config = {
            maxLogLines: config.maxLogLines || 1000,
            trackingWindowHours: config.trackingWindowHours || 24,
        };
        
        // Store error/warning counts per instance
        // Format: { 'adapter.instance': { errors: Map, warnings: Map, lastCheck: timestamp } }
        this.logStats = new Map();
    }

    /**
     * Parse log severity from log entry.
     * @param {string} message - Log message
     * @returns {string|null} 'error', 'warn', or null
     */
    parseSeverity(message) {
        const lowerMsg = message.toLowerCase();
        if (lowerMsg.includes(' error ') || lowerMsg.includes('[error]') || lowerMsg.match(/\berror:/i)) {
            return 'error';
        }
        if (lowerMsg.includes(' warn ') || lowerMsg.includes('[warn]') || lowerMsg.match(/\bwarn:/i)) {
            return 'warn';
        }
        return null;
    }

    /**
     * Extract adapter instance from log message.
     * ioBroker log format: "2024-02-25 16:13:00.123  - info: system.adapter.admin.0 (12345) ..."
     * @param {string} message - Log message
     * @returns {string|null} Adapter instance (e.g., 'admin.0') or null
     */
    extractInstance(message) {
        // Match pattern: system.adapter.<name>.<instance>
        const match = message.match(/system\.adapter\.([a-z0-9-]+\.\d+)/i);
        if (match) {
            return match[1]; // e.g., 'admin.0'
        }
        return null;
    }

    /**
     * Classify error/warning type from message.
     * @param {string} message - Log message
     * @returns {string} Classification key (first significant word after severity)
     */
    classifyMessage(message) {
        // Remove timestamp prefix if present
        let cleaned = message.replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+-\s+/, '');
        
        // Remove adapter instance prefix (e.g., "system.adapter.admin.0 - ")
        cleaned = cleaned.replace(/system\.adapter\.[a-z0-9-]+\.\d+\s+-\s+/i, '');
        
        // Remove severity prefix
        cleaned = cleaned.replace(/\b(error|warn|warning):\s*/gi, '');
        
        // Extract first meaningful word (skip common words)
        const words = cleaned.split(/\s+/);
        const skipWords = new Set(['the', 'a', 'an', 'is', 'was', 'are', 'were', 'in', 'on', 'at', 'to', 'for', 'of']);
        
        for (const word of words) {
            const cleaned = word.replace(/[^\w]/g, '').toLowerCase();
            if (cleaned.length > 2 && !skipWords.has(cleaned)) {
                return cleaned;
            }
        }
        
        return 'unknown';
    }

    /**
     * Fetch recent log entries from host.
     * @returns {Promise<Array>} Array of log entries
     */
    async fetchLogs() {
        try {
            const logs = await this.adapter.sendToHostAsync(
                this.adapter.host,
                'getLog',
                { lines: this.config.maxLogLines }
            );
            
            if (!logs || !Array.isArray(logs)) {
                this.adapter.log.warn('getLog returned invalid data');
                return [];
            }
            
            return logs;
        } catch (err) {
            this.adapter.log.error(`Failed to fetch logs: ${err.message}`);
            return [];
        }
    }

    /**
     * Process log entries and count errors/warnings per instance.
     * @param {Array} logs - Array of log entries
     * @returns {object} Processed statistics
     */
    processLogs(logs) {
        const now = Date.now();
        const cutoffTime = now - (this.config.trackingWindowHours * 60 * 60 * 1000);
        
        const stats = {
            totalErrors: 0,
            totalWarnings: 0,
            byInstance: new Map(),
            timestamp: now,
        };
        
        for (const entry of logs) {
            if (!entry || !entry.message) continue;
            
            // Parse timestamp if available
            const timestamp = entry.ts || now;
            if (timestamp < cutoffTime) {
                continue; // Skip old entries
            }
            
            const severity = this.parseSeverity(entry.message);
            if (!severity) continue;
            
            const instance = this.extractInstance(entry.message) || 'unknown';
            const classification = this.classifyMessage(entry.message);
            
            // Initialize instance stats if needed
            if (!stats.byInstance.has(instance)) {
                stats.byInstance.set(instance, {
                    errors: new Map(),
                    warnings: new Map(),
                    totalErrors: 0,
                    totalWarnings: 0,
                });
            }
            
            const instanceStats = stats.byInstance.get(instance);
            
            if (severity === 'error') {
                stats.totalErrors++;
                instanceStats.totalErrors++;
                
                const count = instanceStats.errors.get(classification) || 0;
                instanceStats.errors.set(classification, count + 1);
            } else if (severity === 'warn') {
                stats.totalWarnings++;
                instanceStats.totalWarnings++;
                
                const count = instanceStats.warnings.get(classification) || 0;
                instanceStats.warnings.set(classification, count + 1);
            }
        }
        
        return stats;
    }

    /**
     * Get top N error/warning types for an instance.
     * @param {Map} typeMap - Map of type -> count
     * @param {number} topN - Number of top entries to return
     * @returns {Array} Array of {type, count} objects
     */
    getTopTypes(typeMap, topN = 5) {
        return Array.from(typeMap.entries())
            .map(([type, count]) => ({ type, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, topN);
    }

    /**
     * Run log monitoring check.
     * @returns {Promise<object>} Check result
     */
    async check() {
        const logs = await this.fetchLogs();
        const stats = this.processLogs(logs);
        
        const result = {
            status: 'ok',
            summary: {
                totalErrors: stats.totalErrors,
                totalWarnings: stats.totalWarnings,
                instanceCount: stats.byInstance.size,
            },
            instances: [],
            timestamp: stats.timestamp,
        };
        
        // Convert to array format for easier JSON storage
        for (const [instance, instanceStats] of stats.byInstance.entries()) {
            const topErrors = this.getTopTypes(instanceStats.errors, 5);
            const topWarnings = this.getTopTypes(instanceStats.warnings, 5);
            
            result.instances.push({
                instance,
                totalErrors: instanceStats.totalErrors,
                totalWarnings: instanceStats.totalWarnings,
                topErrors,
                topWarnings,
            });
        }
        
        // Sort by total issues (errors + warnings)
        result.instances.sort((a, b) => {
            const sumA = a.totalErrors + a.totalWarnings;
            const sumB = b.totalErrors + b.totalWarnings;
            return sumB - sumA;
        });
        
        // Set status based on findings
        if (stats.totalErrors > 0) {
            result.status = 'warning';
        }
        
        return result;
    }
}

module.exports = LogMonitor;
