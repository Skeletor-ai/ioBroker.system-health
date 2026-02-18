'use strict';

const utils = require('@iobroker/adapter-core');
const MemoryMonitor = require('./lib/health-checks/memory-monitor');
const CpuMonitor = require('./lib/health-checks/cpu-monitor');
const DiskMonitor = require('./lib/health-checks/disk-monitor');
const CrashDetection = require('./lib/health-checks/crash-detection');

class Health extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: 'system-health',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
        this.memoryMonitor = null;
        this.cpuMonitor = null;
        this.diskMonitor = null;
        
        /** @type {CrashDetection|null} */
        this.crashDetection = null;
    }

    async onReady() {
        this.log.info('ioBroker.system-health starting...');

        try {
            // Always create states and run health checks
            await this.createStates();
            await this.runHealthChecks();

            // Initialize crash detection if enabled
            if (this.config.enableAdapterCrashDetection) {
                this.crashDetection = new CrashDetection(this, 30);
                await this.crashDetection.init();
                this.log.info('Crash detection enabled - running in daemon mode.');
            }
        } catch (err) {
            this.log.error(`Health check failed: ${err.message}`);
        }

        // Schedule mode: stop after checks complete (if not in daemon mode)
        if (!this.config.enableAdapterCrashDetection) {
            this.stop();
        }
    }

    /**
     * Handle state changes (for crash detection).
     * @param {string} id - State ID
     * @param {ioBroker.State | null | undefined} state - State object
     */
    async onStateChange(id, state) {
        if (this.crashDetection && id.includes('.alive')) {
            await this.crashDetection.onAliveStateChange(id, state);
        }
    }

    /**
     * Create ioBroker states for health monitoring.
     */
    async createStates() {
        // Memory monitoring states
        await this.setObjectNotExistsAsync('memory.totalMB', {
            type: 'state',
            common: {
                name: 'Total memory (MB)',
                type: 'number',
                role: 'value',
                read: true,
                write: false,
                unit: 'MB',
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('memory.usedMB', {
            type: 'state',
            common: {
                name: 'Used memory (MB)',
                type: 'number',
                role: 'value',
                read: true,
                write: false,
                unit: 'MB',
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('memory.freeMB', {
            type: 'state',
            common: {
                name: 'Free memory (MB)',
                type: 'number',
                role: 'value',
                read: true,
                write: false,
                unit: 'MB',
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('memory.usedPercent', {
            type: 'state',
            common: {
                name: 'Used memory (%)',
                type: 'number',
                role: 'value',
                read: true,
                write: false,
                unit: '%',
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('memory.status', {
            type: 'state',
            common: {
                name: 'Memory monitoring status',
                type: 'string',
                role: 'text',
                read: true,
                write: false,
                states: {
                    ok: 'OK',
                    warning: 'Warning',
                    critical: 'Critical',
                },
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('memory.leakDetected', {
            type: 'state',
            common: {
                name: 'Memory leak detected',
                type: 'boolean',
                role: 'indicator.alarm',
                read: true,
                write: false,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('memory.warnings', {
            type: 'state',
            common: {
                name: 'Memory warnings',
                type: 'string',
                role: 'text',
                read: true,
                write: false,
            },
            native: {},
        });
    }

    /**
     * Run all enabled health checks.
     */
    async runHealthChecks() {
        const config = this.config;

        // Memory monitoring
        if (config.enableMemoryMonitoring) {
            await this.runMemoryCheck();
        }

        // CPU monitoring
        if (config.enableCpuMonitoring) {
            await this.runCpuCheck();
        }

        // Disk space monitoring
        if (config.enableDiskMonitoring) {
            await this.runDiskCheck();
        }

        // TODO: Other health checks
        // - Stale state detection
        // - Orphaned state detection
        // - Duplicate state detection

        this.log.info('Health checks completed.');
    }

    /**
     * Run memory monitoring check.
     */
    async runMemoryCheck() {
        if (!this.memoryMonitor) {
            this.memoryMonitor = new MemoryMonitor(this, {
                warningThresholdMB: this.config.memoryWarningMB || 500,
                criticalThresholdPercent: 90,
                leakDetectionWindow: 10,
                leakGrowthThresholdMB: 50,
            });
        }

        const result = await this.memoryMonitor.check();

        // Update states
        await this.setStateAsync('memory.totalMB', result.stats.totalMB, true);
        await this.setStateAsync('memory.usedMB', result.stats.usedMB, true);
        await this.setStateAsync('memory.freeMB', result.stats.freeMB, true);
        await this.setStateAsync('memory.usedPercent', result.stats.usedPercent, true);
        await this.setStateAsync('memory.status', result.status, true);
        await this.setStateAsync('memory.leakDetected', !!result.leak, true);

        const allMessages = [...result.warnings, ...result.critical];
        await this.setStateAsync('memory.warnings', allMessages.join('; '), true);

        // Log results
        if (result.status === 'critical') {
            this.log.error(`Memory check: ${result.critical.join(', ')}`);
        } else if (result.status === 'warning') {
            this.log.warn(`Memory check: ${result.warnings.join(', ')}`);
        } else {
            this.log.info(`Memory check: OK (${result.stats.usedMB} MB / ${result.stats.totalMB} MB used)`);
        }

        if (result.leak) {
            this.log.warn(
                `Potential memory leak detected: +${result.leak.avgGrowthMB} MB/sample (${result.leak.trendPercent}% upward trend)`
            );
        }

        if (result.topProcesses && result.topProcesses.length > 0) {
            this.log.debug(`Top memory consumers: ${result.topProcesses.map(p => `${p.command} (${p.memPercent}%)`).join(', ')}`);
        }
    }

    /**
     * Run CPU monitoring check.
     */
    async runCpuCheck() {
        if (!this.cpuMonitor) {
            this.cpuMonitor = new CpuMonitor(this, {
                warningThreshold: this.config.cpuWarningPercent || 70,
                criticalThreshold: this.config.cpuCriticalPercent || 90,
                sampleCount: this.config.cpuSampleCount || 5,
            });
            await this.cpuMonitor.init();
        }

        await this.cpuMonitor.measure();

        this.log.info('CPU check completed.');
    }

    /**
     * Run disk space monitoring check.
     */
    async runDiskCheck() {
        if (!this.diskMonitor) {
            this.diskMonitor = new DiskMonitor(this, {
                warningThresholdPercent: this.config.diskWarningPercent || 80,
                criticalThresholdPercent: this.config.diskCriticalPercent || 90,
                warningThresholdMB: this.config.diskWarningMB || 1000,
                criticalThresholdMB: this.config.diskCriticalMB || 500,
                mountPoints: this.config.diskMountPoints || ['/'],
                historySize: 10,
            });
            await this.diskMonitor.init();
        }

        await this.diskMonitor.measure();

        this.log.info('Disk check completed.');
    }

    /**
     * @param {() => void} callback
     */
    async onUnload(callback) {
        try {
            if (this.crashDetection) {
                await this.crashDetection.cleanup();
            }
            this.log.info('ioBroker.system-health stopped.');
            callback();
        } catch {
            callback();
        }
    }
}

if (require.main !== module) {
    /**
     * @param {Partial<utils.AdapterOptions>} [options]
     */
    module.exports = (options) => new Health(options);
} else {
    new Health();
}
