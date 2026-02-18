'use strict';

const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * CPU usage monitoring with sustained high load detection.
 */
class CpuMonitor {
    /**
     * @param {object} adapter - ioBroker adapter instance
     * @param {object} config - Configuration options
     * @param {number} config.warningThreshold - Warning threshold (percentage, default: 70)
     * @param {number} config.criticalThreshold - Critical threshold (percentage, default: 90)
     * @param {number} config.sampleCount - Number of samples for sustained check (default: 5)
     */
    constructor(adapter, config = {}) {
        this.adapter = adapter;
        this.warningThreshold = config.warningThreshold || 70;
        this.criticalThreshold = config.criticalThreshold || 90;
        this.sampleCount = config.sampleCount || 5;
        
        this.samples = [];
        this.lastCpuUsage = null;
    }

    /**
     * Initialize CPU monitoring.
     */
    async init() {
        this.adapter.log.info('Initializing CPU monitoring...');
        
        // Create states
        await this.createStates();
        
        // Take initial measurement
        await this.measure();
        
        this.adapter.log.info('CPU monitoring initialized.');
    }

    /**
     * Create CPU-related states.
     */
    async createStates() {
        const baseId = `${this.adapter.namespace}.cpu`;

        await this.adapter.setObjectNotExistsAsync(`${baseId}.usage`, {
            type: 'state',
            common: {
                name: 'CPU usage (average)',
                type: 'number',
                role: 'value',
                read: true,
                write: false,
                unit: '%'
            },
            native: {}
        });

        await this.adapter.setObjectNotExistsAsync(`${baseId}.usagePerCore`, {
            type: 'state',
            common: {
                name: 'CPU usage per core',
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
                name: 'CPU status',
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

        await this.adapter.setObjectNotExistsAsync(`${baseId}.sustainedHighLoad`, {
            type: 'state',
            common: {
                name: 'Sustained high CPU load detected',
                type: 'boolean',
                role: 'indicator.alarm',
                read: true,
                write: false
            },
            native: {}
        });

        await this.adapter.setObjectNotExistsAsync(`${baseId}.warnings`, {
            type: 'state',
            common: {
                name: 'CPU warnings',
                type: 'string',
                role: 'text',
                read: true,
                write: false
            },
            native: {}
        });

        await this.adapter.setObjectNotExistsAsync(`${baseId}.topProcesses`, {
            type: 'state',
            common: {
                name: 'Top CPU-consuming processes',
                type: 'string',
                role: 'json',
                read: true,
                write: false
            },
            native: {}
        });
    }

    /**
     * Measure current CPU usage.
     */
    async measure() {
        try {
            const usage = await this.getCpuUsage();
            
            // Store sample for sustained check
            this.samples.push(usage);
            if (this.samples.length > this.sampleCount) {
                this.samples.shift();
            }

            // Determine status
            const status = this.getStatus(usage);
            const sustainedHighLoad = this.checkSustainedLoad();
            
            // Update states
            await this.adapter.setStateAsync('cpu.usage', usage, true);
            await this.adapter.setStateAsync('cpu.status', status, true);
            await this.adapter.setStateAsync('cpu.sustainedHighLoad', sustainedHighLoad, true);

            // Get per-core usage
            const perCore = await this.getPerCoreUsage();
            await this.adapter.setStateAsync('cpu.usagePerCore', JSON.stringify(perCore), true);

            // Generate warnings
            const warnings = this.generateWarnings(usage, sustainedHighLoad);
            await this.adapter.setStateAsync('cpu.warnings', warnings, true);

            // If threshold exceeded, get top processes
            if (status !== 'ok') {
                const topProcesses = await this.getTopProcesses();
                await this.adapter.setStateAsync('cpu.topProcesses', JSON.stringify(topProcesses), true);
            }

            this.adapter.log.debug(`CPU usage: ${usage.toFixed(1)}% (status: ${status})`);
        } catch (err) {
            this.adapter.log.error(`Failed to measure CPU usage: ${err.message}`);
        }
    }

    /**
     * Get overall CPU usage percentage.
     * @returns {Promise<number>} CPU usage (0-100)
     */
    async getCpuUsage() {
        return new Promise((resolve) => {
            const startMeasure = this.cpuAverage();

            setTimeout(() => {
                const endMeasure = this.cpuAverage();
                
                const idleDiff = endMeasure.idle - startMeasure.idle;
                const totalDiff = endMeasure.total - startMeasure.total;
                
                const usage = 100 - ~~(100 * idleDiff / totalDiff);
                resolve(usage);
            }, 1000);
        });
    }

    /**
     * Get average CPU idle and total across all cores.
     * @returns {{idle: number, total: number}}
     */
    cpuAverage() {
        const cpus = os.cpus();
        let idle = 0;
        let total = 0;

        cpus.forEach(cpu => {
            for (const type in cpu.times) {
                total += cpu.times[type];
            }
            idle += cpu.times.idle;
        });

        return { idle, total };
    }

    /**
     * Get CPU usage per core.
     * @returns {Promise<Array<{core: number, usage: number}>>}
     */
    async getPerCoreUsage() {
        // Simplified per-core reporting (average over measurement window)
        const cpus = os.cpus();
        return cpus.map((cpu, idx) => {
            const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
            const idle = cpu.times.idle;
            const usage = 100 - ~~(100 * idle / total);
            return { core: idx, usage };
        });
    }

    /**
     * Get top CPU-consuming processes (Linux only).
     * @returns {Promise<Array<{pid: number, cpu: number, command: string}>>}
     */
    async getTopProcesses() {
        try {
            // Use ps command to get top processes
            const { stdout } = await execAsync('ps aux --sort=-%cpu | head -n 11');
            const lines = stdout.trim().split('\n').slice(1); // Skip header
            
            const processes = lines.map(line => {
                const parts = line.trim().split(/\s+/);
                return {
                    user: parts[0],
                    pid: parseInt(parts[1], 10),
                    cpu: parseFloat(parts[2]),
                    mem: parseFloat(parts[3]),
                    command: parts.slice(10).join(' ')
                };
            });

            return processes.slice(0, 5); // Top 5
        } catch (err) {
            this.adapter.log.debug(`Could not fetch top processes: ${err.message}`);
            return [];
        }
    }

    /**
     * Determine status based on current usage.
     * @param {number} usage - CPU usage percentage
     * @returns {string} 'ok', 'warning', or 'critical'
     */
    getStatus(usage) {
        if (usage >= this.criticalThreshold) {
            return 'critical';
        }
        if (usage >= this.warningThreshold) {
            return 'warning';
        }
        return 'ok';
    }

    /**
     * Check if high load is sustained over multiple samples.
     * @returns {boolean}
     */
    checkSustainedLoad() {
        if (this.samples.length < this.sampleCount) {
            return false;
        }

        // Check if all recent samples exceed warning threshold
        return this.samples.every(usage => usage >= this.warningThreshold);
    }

    /**
     * Generate human-readable warnings.
     * @param {number} usage - Current CPU usage
     * @param {boolean} sustainedHighLoad - Sustained load flag
     * @returns {string}
     */
    generateWarnings(usage, sustainedHighLoad) {
        const warnings = [];

        if (usage >= this.criticalThreshold) {
            warnings.push(`Critical: CPU usage at ${usage.toFixed(1)}% (threshold: ${this.criticalThreshold}%)`);
        } else if (usage >= this.warningThreshold) {
            warnings.push(`Warning: CPU usage at ${usage.toFixed(1)}% (threshold: ${this.warningThreshold}%)`);
        }

        if (sustainedHighLoad) {
            warnings.push('Sustained high CPU load detected over multiple samples.');
        }

        return warnings.length > 0 ? warnings.join(' ') : '';
    }

    /**
     * Cleanup.
     */
    async cleanup() {
        this.samples = [];
        this.adapter.log.info('CPU monitor cleanup complete.');
    }
}

module.exports = CpuMonitor;
