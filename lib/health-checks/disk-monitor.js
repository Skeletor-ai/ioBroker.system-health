'use strict';

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const os = require('os');

/**
 * Disk space monitoring with trend tracking.
 */
class DiskMonitor {
    /**
     * @param {object} adapter - ioBroker adapter instance
     * @param {object} config - Configuration options
     * @param {number} config.warningThresholdPercent - Warning threshold (percentage, default: 80)
     * @param {number} config.criticalThresholdPercent - Critical threshold (percentage, default: 90)
     * @param {number} config.warningThresholdMB - Warning threshold (MB free, default: 1000)
     * @param {number} config.criticalThresholdMB - Critical threshold (MB free, default: 500)
     * @param {Array<string>} config.mountPoints - Mount points to monitor (default: ['/'])
     * @param {number} config.historySize - Number of samples for trend tracking (default: 10)
     */
    constructor(adapter, config = {}) {
        this.adapter = adapter;
        this.warningThresholdPercent = config.warningThresholdPercent || 80;
        this.criticalThresholdPercent = config.criticalThresholdPercent || 90;
        this.warningThresholdMB = config.warningThresholdMB || 1000;
        this.criticalThresholdMB = config.criticalThresholdMB || 500;
        this.mountPoints = config.mountPoints || ['/'];
        this.historySize = config.historySize || 10;
        
        this.history = {}; // mountPoint -> [{timestamp, usedPercent, freeMB}]
    }

    /**
     * Initialize disk monitoring.
     */
    async init() {
        this.adapter.log.info('Initializing disk space monitoring...');
        
        // Load history from state if available
        await this.loadHistory();
        
        // Create states
        await this.createStates();
        
        // Take initial measurement
        await this.measure();
        
        this.adapter.log.info('Disk space monitoring initialized.');
    }

    /**
     * Create disk-related states.
     */
    async createStates() {
        const baseId = `${this.adapter.namespace}.disk`;

        await this.adapter.setObjectNotExistsAsync(`${baseId}.partitions`, {
            type: 'state',
            common: {
                name: 'Disk partitions info',
                type: 'string',
                role: 'json',
                read: true,
                write: false
            },
            native: {}
        });

        await this.adapter.setObjectNotExistsAsync(`${baseId}.status`, {
            type: 'state',
            common: {
                name: 'Disk status',
                type: 'string',
                role: 'text',
                read: true,
                write: false,
                states: {
                    'ok': 'OK',
                    'warning': 'Warning',
                    'critical': 'Critical'
                }
            },
            native: {}
        });

        await this.adapter.setObjectNotExistsAsync(`${baseId}.warnings`, {
            type: 'state',
            common: {
                name: 'Disk warnings',
                type: 'string',
                role: 'text',
                read: true,
                write: false
            },
            native: {}
        });

        await this.adapter.setObjectNotExistsAsync(`${baseId}.trends`, {
            type: 'state',
            common: {
                name: 'Disk usage trends',
                type: 'string',
                role: 'json',
                read: true,
                write: false
            },
            native: {}
        });

        await this.adapter.setObjectNotExistsAsync(`${baseId}.history`, {
            type: 'state',
            common: {
                name: 'Disk usage history (internal)',
                type: 'string',
                role: 'json',
                read: true,
                write: false
            },
            native: {}
        });
    }

    /**
     * Measure disk usage for all configured mount points.
     */
    async measure() {
        try {
            const partitions = await this.getDiskUsage();
            
            // Update history
            const timestamp = Date.now();
            for (const partition of partitions) {
                if (!this.history[partition.mountPoint]) {
                    this.history[partition.mountPoint] = [];
                }
                
                this.history[partition.mountPoint].push({
                    timestamp,
                    usedPercent: partition.usedPercent,
                    freeMB: partition.freeMB
                });

                // Limit history size
                if (this.history[partition.mountPoint].length > this.historySize) {
                    this.history[partition.mountPoint].shift();
                }
            }

            // Calculate trends
            const trends = this.calculateTrends();

            // Determine overall status
            const status = this.getStatus(partitions);
            const warnings = this.generateWarnings(partitions, trends);

            // Update states
            await this.adapter.setStateAsync('disk.partitions', JSON.stringify(partitions), true);
            await this.adapter.setStateAsync('disk.status', status, true);
            await this.adapter.setStateAsync('disk.warnings', warnings, true);
            await this.adapter.setStateAsync('disk.trends', JSON.stringify(trends), true);
            
            // Persist history
            await this.saveHistory();

            this.adapter.log.debug(`Disk usage measured: ${partitions.length} partitions, status: ${status}`);
        } catch (err) {
            this.adapter.log.error(`Failed to measure disk usage: ${err.message}`);
        }
    }

    /**
     * Get disk usage information.
     * @returns {Promise<Array<{mountPoint: string, totalMB: number, usedMB: number, freeMB: number, usedPercent: number}>>}
     */
    async getDiskUsage() {
        const platform = os.platform();
        
        if (platform === 'linux' || platform === 'darwin') {
            return this.getDiskUsageUnix();
        } else if (platform === 'win32') {
            return this.getDiskUsageWindows();
        } else {
            throw new Error(`Unsupported platform: ${platform}`);
        }
    }

    /**
     * Get disk usage on Unix-like systems (Linux, macOS).
     * @returns {Promise<Array>}
     */
    async getDiskUsageUnix() {
        try {
            const { stdout } = await execAsync('df -BM');
            const lines = stdout.trim().split('\n').slice(1); // Skip header
            
            const partitions = [];
            
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length < 6) continue;

                const mountPoint = parts[5];
                
                // Filter by configured mount points
                if (!this.mountPoints.includes(mountPoint)) {
                    continue;
                }

                const totalMB = parseInt(parts[1].replace('M', ''), 10);
                const usedMB = parseInt(parts[2].replace('M', ''), 10);
                const freeMB = parseInt(parts[3].replace('M', ''), 10);
                const usedPercent = parseInt(parts[4].replace('%', ''), 10);

                partitions.push({
                    filesystem: parts[0],
                    mountPoint,
                    totalMB,
                    usedMB,
                    freeMB,
                    usedPercent
                });
            }

            return partitions;
        } catch (err) {
            this.adapter.log.error(`Failed to get disk usage (Unix): ${err.message}`);
            return [];
        }
    }

    /**
     * Get disk usage on Windows.
     * @returns {Promise<Array>}
     */
    async getDiskUsageWindows() {
        try {
            const { stdout } = await execAsync('wmic logicaldisk get size,freespace,caption');
            const lines = stdout.trim().split('\n').slice(1); // Skip header
            
            const partitions = [];
            
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length < 3) continue;

                const mountPoint = parts[0];
                const freeMB = Math.round(parseInt(parts[1], 10) / (1024 * 1024));
                const totalMB = Math.round(parseInt(parts[2], 10) / (1024 * 1024));
                const usedMB = totalMB - freeMB;
                const usedPercent = Math.round((usedMB / totalMB) * 100);

                partitions.push({
                    filesystem: mountPoint,
                    mountPoint,
                    totalMB,
                    usedMB,
                    freeMB,
                    usedPercent
                });
            }

            return partitions;
        } catch (err) {
            this.adapter.log.error(`Failed to get disk usage (Windows): ${err.message}`);
            return [];
        }
    }

    /**
     * Calculate usage trends (growth rate).
     * @returns {Object} mountPoint -> {growthRateMBPerHour, eta}
     */
    calculateTrends() {
        const trends = {};

        for (const [mountPoint, history] of Object.entries(this.history)) {
            if (history.length < 2) {
                trends[mountPoint] = { growthRateMBPerHour: 0, eta: null };
                continue;
            }

            const oldest = history[0];
            const newest = history[history.length - 1];
            
            const timeDiffMs = newest.timestamp - oldest.timestamp;
            const usageDiffMB = oldest.freeMB - newest.freeMB; // Positive = growing
            
            if (timeDiffMs === 0) {
                trends[mountPoint] = { growthRateMBPerHour: 0, eta: null };
                continue;
            }

            const growthRateMBPerHour = (usageDiffMB / timeDiffMs) * (1000 * 60 * 60);

            // Estimate time until disk full
            let eta = null;
            if (growthRateMBPerHour > 0 && newest.freeMB > 0) {
                const hoursUntilFull = newest.freeMB / growthRateMBPerHour;
                eta = new Date(Date.now() + hoursUntilFull * 60 * 60 * 1000).toISOString();
            }

            trends[mountPoint] = { 
                growthRateMBPerHour: Math.round(growthRateMBPerHour * 10) / 10,
                eta
            };
        }

        return trends;
    }

    /**
     * Determine overall status.
     * @param {Array} partitions - Partition info
     * @returns {string} 'ok', 'warning', or 'critical'
     */
    getStatus(partitions) {
        let worstStatus = 'ok';

        for (const partition of partitions) {
            if (partition.usedPercent >= this.criticalThresholdPercent ||
                partition.freeMB <= this.criticalThresholdMB) {
                return 'critical'; // Return immediately on critical
            }

            if (partition.usedPercent >= this.warningThresholdPercent ||
                partition.freeMB <= this.warningThresholdMB) {
                worstStatus = 'warning';
            }
        }

        return worstStatus;
    }

    /**
     * Generate human-readable warnings.
     * @param {Array} partitions - Partition info
     * @param {Object} trends - Trend data
     * @returns {string}
     */
    generateWarnings(partitions, trends) {
        const warnings = [];

        for (const partition of partitions) {
            const isCritical = partition.usedPercent >= this.criticalThresholdPercent ||
                               partition.freeMB <= this.criticalThresholdMB;
            const isWarning = partition.usedPercent >= this.warningThresholdPercent ||
                              partition.freeMB <= this.warningThresholdMB;

            if (isCritical) {
                warnings.push(
                    `Critical: ${partition.mountPoint} at ${partition.usedPercent}% ` +
                    `(${partition.freeMB} MB free)`
                );
            } else if (isWarning) {
                warnings.push(
                    `Warning: ${partition.mountPoint} at ${partition.usedPercent}% ` +
                    `(${partition.freeMB} MB free)`
                );
            }

            // Add trend warning if disk filling rapidly
            const trend = trends[partition.mountPoint];
            if (trend && trend.growthRateMBPerHour > 100 && trend.eta) {
                const etaDate = new Date(trend.eta);
                warnings.push(
                    `Trend: ${partition.mountPoint} growing at ${trend.growthRateMBPerHour} MB/h, ` +
                    `estimated full: ${etaDate.toLocaleString()}`
                );
            }
        }

        return warnings.length > 0 ? warnings.join(' | ') : '';
    }

    /**
     * Load history from state.
     */
    async loadHistory() {
        try {
            const historyState = await this.adapter.getStateAsync('disk.history');
            
            if (historyState && historyState.val) {
                this.history = JSON.parse(historyState.val);
                this.adapter.log.debug('Disk usage history loaded.');
            } else {
                this.history = {};
            }
        } catch (err) {
            this.adapter.log.warn(`Failed to load disk history: ${err.message}`);
            this.history = {};
        }
    }

    /**
     * Save history to state.
     */
    async saveHistory() {
        try {
            await this.adapter.setStateAsync('disk.history', JSON.stringify(this.history), true);
        } catch (err) {
            this.adapter.log.error(`Failed to save disk history: ${err.message}`);
        }
    }

    /**
     * Cleanup.
     */
    async cleanup() {
        await this.saveHistory();
        this.adapter.log.info('Disk monitor cleanup complete.');
    }
}

module.exports = DiskMonitor;
