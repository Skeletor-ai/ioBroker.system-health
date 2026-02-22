'use strict';

const utils = require('@iobroker/adapter-core');
const MemoryMonitor = require('./lib/health-checks/memory-monitor');
const CpuMonitor = require('./lib/health-checks/cpu-monitor');
const DiskMonitor = require('./lib/health-checks/disk-monitor');
const CrashDetection = require('./lib/health-checks/crash-detection');
const DuplicateStateInspector = require('./lib/state-inspector/duplicate-detection');
const OrphanedStateInspector = require('./lib/state-inspector/orphaned-states');
const StaleStateInspector = require('./lib/state-inspector/stale-detection');

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
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
        this.memoryMonitor = null;
        this.cpuMonitor = null;
        this.diskMonitor = null;
        
        /** @type {CrashDetection|null} */
        this.crashDetection = null;
        
        /** @type {DuplicateStateInspector|null} */
        this.duplicateInspector = null;
        
        /** @type {OrphanedStateInspector|null} */
        this.orphanedInspector = null;
        
        /** @type {StaleStateInspector|null} */
        this.staleInspector = null;
        
        /** @type {NodeJS.Timeout|null} */
        this.healthCheckInterval = null;
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
            
            // Start periodic health checks
            let intervalMinutes = this.config.healthCheckIntervalMinutes || 5;
            if (intervalMinutes < 1 || intervalMinutes > 60) {
                this.log.warn(`Invalid healthCheckIntervalMinutes: ${intervalMinutes}. Using default: 5`);
                intervalMinutes = 5;
            }
            
            const intervalMs = intervalMinutes * 60 * 1000;
            this.healthCheckInterval = setInterval(async () => {
                this.log.debug(`Running periodic health checks (interval: ${intervalMinutes} min)...`);
                try {
                    await this.runHealthChecks();
                } catch (err) {
                    this.log.error(`Periodic health check failed: ${err.message}`);
                }
            }, intervalMs);
            
            this.log.info(`Periodic health checks enabled (interval: ${intervalMinutes} minutes)`);
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
     * Handle messages from admin UI.
     * @param {ioBroker.Message} obj - Message object
     */
    async onMessage(obj) {
        if (typeof obj === 'object' && obj.message) {
            if (obj.command === 'getDashboardData') {
                try {
                    const data = await this.getDashboardData();
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, data, obj.callback);
                    }
                } catch (err) {
                    this.log.error(`getDashboardData failed: ${err.message}`);
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, { error: err.message }, obj.callback);
                    }
                }
            }
        }
    }

    /**
     * Get dashboard data for admin UI.
     * @returns {Promise<object>} Dashboard data object
     */
    async getDashboardData() {
        const data = {
            duplicates: [],
            staleCount: this.staleInspector ? this.staleInspector.staleStates.length : 0,
            orphanedCount: this.orphanedInspector ? this.orphanedInspector.orphanedStates.length : 0,
            issues: []
        };

        // Get duplicate states
        if (this.duplicateInspector) {
            try {
                const duplicates = await this.duplicateInspector.scan();
                data.duplicates = duplicates.map(group => ({
                    states: group.states,
                    similarity: group.similarity
                }));
            } catch (err) {
                this.log.error(`Failed to get duplicate states: ${err.message}`);
            }
        } else if (this.config.enableDuplicateDetection) {
            // Initialize if needed
            const threshold = this.config.duplicateSimilarityThreshold || 0.9;
            this.duplicateInspector = new DuplicateStateInspector(this, threshold);
            await this.duplicateInspector.init();
            const duplicates = await this.duplicateInspector.scan();
            data.duplicates = duplicates.map(group => ({
                states: group.states,
                similarity: group.similarity
            }));
        }

        // Collect issues from states
        const memoryStatus = await this.getStateAsync('memory.status');
        if (memoryStatus && memoryStatus.val !== 'ok' && memoryStatus.val !== 'OK') {
            const warnings = await this.getStateAsync('memory.warnings');
            data.issues.push({
                title: 'Speicherproblem',
                description: warnings ? warnings.val : 'Speicherstatus: ' + memoryStatus.val,
                severity: memoryStatus.val === 'critical' ? 'critical' : 'warning'
            });
        }

        const diskStatus = await this.getStateAsync('disk.status');
        if (diskStatus && diskStatus.val !== 'ok' && diskStatus.val !== 'OK') {
            const warnings = await this.getStateAsync('disk.warnings');
            data.issues.push({
                title: 'Festplattenproblem',
                description: warnings ? warnings.val : 'Festplattenstatus: ' + diskStatus.val,
                severity: diskStatus.val === 'critical' ? 'critical' : 'warning'
            });
        }

        const memoryLeak = await this.getStateAsync('memory.leakDetected');
        if (memoryLeak && memoryLeak.val === true) {
            data.issues.push({
                title: 'Speicherleck erkannt',
                description: 'Ein mögliches Speicherleck wurde entdeckt',
                severity: 'warning'
            });
        }

        return data;
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

        // State Inspector summary states
        await this.setObjectNotExistsAsync('stateInspector.totalIssues', {
            type: 'state',
            common: {
                name: 'Total state inspector issues',
                type: 'number',
                role: 'value',
                read: true,
                write: false,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('stateInspector.orphaned', {
            type: 'state',
            common: {
                name: 'Number of orphaned states',
                type: 'number',
                role: 'value',
                read: true,
                write: false,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('stateInspector.stale', {
            type: 'state',
            common: {
                name: 'Number of stale states',
                type: 'number',
                role: 'value',
                read: true,
                write: false,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('stateInspector.duplicates', {
            type: 'state',
            common: {
                name: 'Number of duplicate state groups',
                type: 'number',
                role: 'value',
                read: true,
                write: false,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('stateInspector.details', {
            type: 'state',
            common: {
                name: 'Full state inspector details (JSON)',
                type: 'string',
                role: 'json',
                read: true,
                write: false,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('stateInspector.lastScan', {
            type: 'state',
            common: {
                name: 'Last state inspector scan timestamp',
                type: 'number',
                role: 'date',
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

        // State inspector checks
        if (config.enableDuplicateDetection) {
            await this.runDuplicateDetection();
        }

        if (config.enableOrphanDetection) {
            await this.runOrphanDetection();
        }

        if (config.enableStaleDetection) {
            await this.runStaleDetection();
        }

        // Update summary states
        await this.updateStateInspectorSummary();

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
     * Run duplicate state detection.
     */
    async runDuplicateDetection() {
        if (!this.duplicateInspector) {
            const threshold = this.config.duplicateSimilarityThreshold || 0.9;
            this.duplicateInspector = new DuplicateStateInspector(this, threshold);
            await this.duplicateInspector.init();
        }

        const duplicates = await this.duplicateInspector.scan();

        if (duplicates.length > 0) {
            this.log.warn(`Found ${duplicates.length} duplicate state groups`);
        } else {
            this.log.info('No duplicate states detected');
        }
    }

    /**
     * Run orphaned state detection.
     */
    async runOrphanDetection() {
        if (!this.orphanedInspector) {
            const ignoreList = this.config.orphanIgnorePatterns || ['system.*', 'admin.*'];
            this.orphanedInspector = new OrphanedStateInspector(this, ignoreList);
            await this.orphanedInspector.init();
        }

        const report = await this.orphanedInspector.inspect();

        if (report.totalOrphaned > 0) {
            this.log.warn(`Found ${report.totalOrphaned} orphaned state(s)`);
        } else {
            this.log.info('No orphaned states detected');
        }
    }

    /**
     * Run stale state detection.
     */
    async runStaleDetection() {
        if (!this.staleInspector) {
            const thresholdHours = this.config.staleThresholdHours || 24;
            const ignorePatterns = this.config.staleIgnorePatterns || [];
            this.staleInspector = new StaleStateInspector(this, thresholdHours, ignorePatterns);
            await this.staleInspector.init();
        }

        const report = await this.staleInspector.inspect();

        if (report.totalStale > 0) {
            this.log.warn(`Found ${report.totalStale} stale state(s)`);
        } else {
            this.log.info('No stale states detected');
        }
    }

    /**
     * Update the stateInspector summary states with counts from all inspectors.
     */
    async updateStateInspectorSummary() {
        const orphanedCount = this.orphanedInspector ? this.orphanedInspector.orphanedStates.length : 0;
        const staleCount = this.staleInspector ? this.staleInspector.staleStates.length : 0;
        const duplicateCount = this.duplicateInspector ? this.duplicateInspector.duplicates.length : 0;
        const totalIssues = orphanedCount + staleCount + duplicateCount;

        await this.setStateAsync('stateInspector.totalIssues', totalIssues, true);
        await this.setStateAsync('stateInspector.orphaned', orphanedCount, true);
        await this.setStateAsync('stateInspector.stale', staleCount, true);
        await this.setStateAsync('stateInspector.duplicates', duplicateCount, true);
        await this.setStateAsync('stateInspector.lastScan', Date.now(), true);

        const details = {
            timestamp: new Date().toISOString(),
            totalIssues,
            categories: {
                orphaned: orphanedCount,
                stale: staleCount,
                duplicates: duplicateCount
            },
            orphanedByCategory: this.orphanedInspector ? this.orphanedInspector.categorizeOrphans() : {},
            staleByAdapter: this.staleInspector ? this.staleInspector.groupByAdapter() : {},
            duplicateGroups: this.duplicateInspector ? this.duplicateInspector.duplicates.length : 0
        };

        await this.setStateAsync('stateInspector.details', JSON.stringify(details, null, 2), true);

        this.log.info(`State Inspector summary: ${totalIssues} total issues (${orphanedCount} orphaned, ${staleCount} stale, ${duplicateCount} duplicates)`);
    }

    /**
     * @param {() => void} callback
     */
    async onUnload(callback) {
        try {
            // Clear health check interval
            if (this.healthCheckInterval) {
                clearInterval(this.healthCheckInterval);
                this.healthCheckInterval = null;
                this.log.debug('Health check interval cleared');
            }
            
            if (this.crashDetection) {
                await this.crashDetection.cleanup();
            }
            if (this.duplicateInspector) {
                await this.duplicateInspector.stop();
            }
            if (this.orphanedInspector) {
                await this.orphanedInspector.cleanup();
            }
            if (this.staleInspector) {
                await this.staleInspector.cleanup();
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
