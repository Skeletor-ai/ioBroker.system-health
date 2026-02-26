'use strict';

const utils = require('@iobroker/adapter-core');
const MemoryMonitor = require('./lib/health-checks/memory-monitor');
const CpuMonitor = require('./lib/health-checks/cpu-monitor');
const DiskMonitor = require('./lib/health-checks/disk-monitor');
const CrashDetection = require('./lib/health-checks/crash-detection');
const LogMonitor = require('./lib/health-checks/log-monitor');
const DuplicateStateInspector = require('./lib/state-inspector/duplicate-detection');
const OrphanedStateInspector = require('./lib/state-inspector/orphaned-states');
const StaleStateInspector = require('./lib/state-inspector/stale-detection');
const PerformanceAnalysisInspector = require('./lib/state-inspector/performance-analysis');
const RedisMonitor = require('./lib/health-checks/redis-monitor');

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
        
        /** @type {LogMonitor|null} */
        this.logMonitor = null;
        
        /** @type {DuplicateStateInspector|null} */
        this.duplicateInspector = null;
        
        /** @type {OrphanedStateInspector|null} */
        this.orphanedInspector = null;
        
        /** @type {StaleStateInspector|null} */
        this.staleInspector = null;
        
        /** @type {PerformanceAnalysisInspector|null} */
        this.performanceInspector = null;
        
        /** @type {RedisMonitor|null} */
        this.redisMonitor = null;
        
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
        if (typeof obj === 'object') {
            const command = obj.command;

            if (command === 'getOrphanedDetails') {
                const lang = (obj.message && obj.message.lang) || 'en';
                const html = this.renderOrphanedDetailsHtml(lang);
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, html, obj.callback);
                }
            } else if (command === 'getStaleDetails') {
                const lang = (obj.message && obj.message.lang) || 'en';
                const html = this.renderStaleDetailsHtml(lang);
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, html, obj.callback);
                }
            } else if (command === 'getDuplicateDetails') {
                const lang = (obj.message && obj.message.lang) || 'en';
                const html = this.renderDuplicateDetailsHtml(lang);
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, html, obj.callback);
                }
            } else if (command === 'getCleanupSuggestions') {
                const lang = (obj.message && obj.message.lang) || 'en';
                const html = await this.renderCleanupSuggestionsHtml(lang);
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, html, obj.callback);
                }
            } else if (command === 'getLogDetails') {
                const lang = (obj.message && obj.message.lang) || 'en';
                const html = await this.renderLogDetailsHtml(lang);
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, html, obj.callback);
                }
            }
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

        // Log monitoring states
        await this.setObjectNotExistsAsync('logs.totalErrors', {
            type: 'state',
            common: {
                name: 'Total error count',
                type: 'number',
                role: 'value',
                read: true,
                write: false,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('logs.totalWarnings', {
            type: 'state',
            common: {
                name: 'Total warning count',
                type: 'number',
                role: 'value',
                read: true,
                write: false,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('logs.instanceCount', {
            type: 'state',
            common: {
                name: 'Number of instances with errors/warnings',
                type: 'number',
                role: 'value',
                read: true,
                write: false,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('logs.status', {
            type: 'state',
            common: {
                name: 'Log monitoring status',
                type: 'string',
                role: 'text',
                read: true,
                write: false,
                states: {
                    ok: 'OK',
                    warning: 'Errors/warnings detected',
                },
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('logs.timestamp', {
            type: 'state',
            common: {
                name: 'Last log check timestamp',
                type: 'number',
                role: 'date',
                read: true,
                write: false,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('logs.details', {
            type: 'state',
            common: {
                name: 'Detailed log statistics (JSON)',
                type: 'string',
                role: 'json',
                read: true,
                write: false,
            },
            native: {},
        });

        // Redis monitoring states
        await this.setObjectNotExistsAsync('redis.status', {
            type: 'state',
            common: { name: 'Redis status', type: 'string', role: 'text', read: true, write: false,
                states: { ok: 'OK', warning: 'Warning', error: 'Error', skipped: 'Skipped' } },
            native: {},
        });
        await this.setObjectNotExistsAsync('redis.connected', {
            type: 'state',
            common: { name: 'Redis connected', type: 'boolean', role: 'indicator.reachable', read: true, write: false },
            native: {},
        });
        await this.setObjectNotExistsAsync('redis.memoryUsedPercent', {
            type: 'state',
            common: { name: 'Redis memory usage (%)', type: 'number', role: 'value', unit: '%', read: true, write: false },
            native: {},
        });
        await this.setObjectNotExistsAsync('redis.memoryUsedBytes', {
            type: 'state',
            common: { name: 'Redis memory used (bytes)', type: 'number', role: 'value', read: true, write: false },
            native: {},
        });
        await this.setObjectNotExistsAsync('redis.keys', {
            type: 'state',
            common: { name: 'Redis total keys', type: 'number', role: 'value', read: true, write: false },
            native: {},
        });
        await this.setObjectNotExistsAsync('redis.evictedKeys', {
            type: 'state',
            common: { name: 'Redis evicted keys', type: 'number', role: 'value', read: true, write: false },
            native: {},
        });
        await this.setObjectNotExistsAsync('redis.latencyMs', {
            type: 'state',
            common: { name: 'Redis ping latency (ms)', type: 'number', role: 'value', unit: 'ms', read: true, write: false },
            native: {},
        });
        await this.setObjectNotExistsAsync('redis.details', {
            type: 'state',
            common: { name: 'Redis detailed report (JSON)', type: 'string', role: 'json', read: true, write: false },
            native: {},
        });
        await this.setObjectNotExistsAsync('redis.timestamp', {
            type: 'state',
            common: { name: 'Last Redis check timestamp', type: 'number', role: 'date', read: true, write: false },
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

        await this.setObjectNotExistsAsync('stateInspector.lastScanFormatted', {
            type: 'state',
            common: {
                name: 'Last state inspector scan (human readable)',
                type: 'string',
                role: 'text',
                read: true,
                write: false,
            },
            native: {},
        });

        // Cleanup suggestions states
        await this.setObjectNotExistsAsync('stateInspector.cleanupSuggestions', {
            type: 'state',
            common: {
                name: 'State cleanup suggestions',
                type: 'string',
                role: 'json',
                read: true,
                write: false,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('stateInspector.safeToDeleteCount', {
            type: 'state',
            common: {
                name: 'States safe to delete (count)',
                type: 'number',
                role: 'value',
                read: true,
                write: false,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('stateInspector.reviewRequiredCount', {
            type: 'state',
            common: {
                name: 'States requiring review (count)',
                type: 'number',
                role: 'value',
                read: true,
                write: false,
            },
            native: {},
        });

        // Initialize inspector summary values to avoid null values in admin UI
        // before the first complete scan has finished.
        await this.setStateAsync('stateInspector.totalIssues', 0, true);
        await this.setStateAsync('stateInspector.orphaned', 0, true);
        await this.setStateAsync('stateInspector.stale', 0, true);
        await this.setStateAsync('stateInspector.duplicates', 0, true);
        await this.setStateAsync('stateInspector.safeToDeleteCount', 0, true);
        await this.setStateAsync('stateInspector.reviewRequiredCount', 0, true);

        await this.setStateAsync('stateInspector.details', JSON.stringify({
            timestamp: null,
            totalIssues: 0,
            categories: {
                orphaned: 0,
                stale: 0,
                duplicates: 0
            }
        }, null, 2), true);
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

        // Log monitoring
        if (config.enableLogMonitoring) {
            await this.runLogCheck();
        }

        // Redis monitoring
        if (config.enableRedisMonitoring !== false) {
            await this.runRedisCheck();
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

        if (config.enablePerformanceAnalysis) {
            await this.runPerformanceAnalysis();
        }

        // Update summary states only if at least one inspector ran
        if (this.duplicateInspector || this.orphanedInspector || this.staleInspector || this.performanceInspector) {
            await this.updateStateInspectorSummary();
        }

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
     * Run log monitoring check.
     */
    async runLogCheck() {
        if (!this.logMonitor) {
            this.logMonitor = new LogMonitor(this, {
                maxLogLines: this.config.logMaxLines || 1000,
                trackingWindowHours: this.config.logTrackingWindowHours || 24,
            });
        }

        const result = await this.logMonitor.check();

        // Update states
        await this.setStateAsync('logs.totalErrors', result.summary.totalErrors, true);
        await this.setStateAsync('logs.totalWarnings', result.summary.totalWarnings, true);
        await this.setStateAsync('logs.instanceCount', result.summary.instanceCount, true);
        await this.setStateAsync('logs.status', result.status, true);
        await this.setStateAsync('logs.timestamp', result.timestamp, true);

        // Store detailed data as JSON
        await this.setStateAsync('logs.details', JSON.stringify(result.instances), true);

        // Log results
        if (result.summary.totalErrors > 0 || result.summary.totalWarnings > 0) {
            this.log.warn(
                `Log check: ${result.summary.totalErrors} errors, ${result.summary.totalWarnings} warnings across ${result.summary.instanceCount} instances`
            );
        } else {
            this.log.info('Log check: No errors or warnings detected');
        }

        this.log.info('Log check completed.');
    }

    /**
     * Run Redis health check.
     */
    async runRedisCheck() {
        if (!this.redisMonitor) {
            this.redisMonitor = new RedisMonitor(this, {
                memoryWarningPercent: this.config.redisMemoryWarningPercent || 80,
                memoryErrorPercent: this.config.redisMemoryErrorPercent || 95,
                latencyWarningMs: this.config.redisLatencyWarningMs || 100,
            });
        }

        const result = await this.redisMonitor.check();

        if (result.status === 'skipped') {
            this.log.debug('Redis monitoring skipped: ' + result.reason);
            return;
        }

        // Update states
        await this.setStateAsync('redis.status', result.status, true);
        await this.setStateAsync('redis.connected', result.connection, true);
        await this.setStateAsync('redis.latencyMs', result.latencyMs || 0, true);
        await this.setStateAsync('redis.timestamp', result.timestamp, true);

        if (result.memory) {
            await this.setStateAsync('redis.memoryUsedPercent', result.memory.usedPercent, true);
            await this.setStateAsync('redis.memoryUsedBytes', result.memory.usedBytes, true);
        }

        if (result.keys !== null) {
            await this.setStateAsync('redis.keys', result.keys, true);
        }

        if (result.evictedKeys !== null) {
            await this.setStateAsync('redis.evictedKeys', result.evictedKeys, true);
        }

        await this.setStateAsync('redis.details', JSON.stringify(result, null, 2), true);

        // Log results
        if (result.errors.length > 0) {
            for (const err of result.errors) {
                this.log.error(`Redis: ${err}`);
            }
        }
        if (result.warnings.length > 0) {
            for (const warn of result.warnings) {
                this.log.warn(`Redis: ${warn}`);
            }
        }
        if (result.status === 'ok') {
            this.log.info(`Redis check: OK (latency: ${result.latencyMs}ms, keys: ${result.keys})`);
        }
    }

    /**
     * Run duplicate state detection.
     */
    async runDuplicateDetection() {
        if (!this.duplicateInspector) {
            const threshold = this.config.duplicateSimilarityThreshold || 0.9;
            const ignorePatterns = this._parseIgnorePatterns(this.config.stateInspectorIgnorePatterns);
            this.duplicateInspector = new DuplicateStateInspector(this, threshold, ignorePatterns);
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
            const ignorePatterns = this._parseIgnorePatterns(this.config.stateInspectorIgnorePatterns);
            this.orphanedInspector = new OrphanedStateInspector(this, ignorePatterns);
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
            const ignorePatterns = this._parseIgnorePatterns(this.config.stateInspectorIgnorePatterns);
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
     * Run performance analysis inspection.
     */
    async runPerformanceAnalysis() {
        if (!this.performanceInspector) {
            const config = {
                updateFrequencyThresholdMs: this.config.performanceFrequencyThresholdMs || 100,
                largeTreeThreshold: this.config.performanceLargeTreeThreshold || 1000,
                monitoringDurationMs: this.config.performanceMonitoringDurationMs || 60000,
                ignorePatterns: this._parseIgnorePatterns(this.config.stateInspectorIgnorePatterns)
            };
            this.performanceInspector = new PerformanceAnalysisInspector(this, config);
            await this.performanceInspector.init();
        }

        const report = await this.performanceInspector.inspect();

        const totalIssues = 
            report.highFrequencyStates.length +
            report.largeObjectTrees.length +
            report.historyWaste.length +
            report.ackIssues.length;

        if (totalIssues > 0) {
            this.log.warn(
                `Performance analysis found ${totalIssues} issue(s): ` +
                `${report.highFrequencyStates.length} high-freq, ` +
                `${report.largeObjectTrees.length} large trees, ` +
                `${report.historyWaste.length} history waste, ` +
                `${report.ackIssues.length} ack issues`
            );
        } else {
            this.log.info('No performance issues detected');
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
        
        const now = Date.now();
        await this.setStateAsync('stateInspector.lastScan', now, true);
        await this.setStateAsync('stateInspector.lastScanFormatted', new Date(now).toLocaleString('en-GB', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }), true);

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

        // Collect cleanup suggestions from all inspectors
        const cleanupSuggestions = {
            timestamp: new Date().toISOString(),
            safeToDelete: [],
            reviewRequired: [],
            keepForNow: []
        };

        if (this.orphanedInspector) {
            const orphanSuggestions = this.orphanedInspector.getCleanupSuggestions();
            cleanupSuggestions.safeToDelete.push(...orphanSuggestions.safeToDelete);
            cleanupSuggestions.reviewRequired.push(...orphanSuggestions.reviewRequired);
            cleanupSuggestions.keepForNow.push(...orphanSuggestions.keepForNow);
        }

        if (this.staleInspector) {
            const staleSuggestions = this.staleInspector.getCleanupSuggestions();
            cleanupSuggestions.safeToDelete.push(...staleSuggestions.safeToDelete);
            cleanupSuggestions.reviewRequired.push(...staleSuggestions.reviewRequired);
            cleanupSuggestions.keepForNow.push(...staleSuggestions.keepForNow);
        }

        // Update cleanup suggestion states
        await this.setStateAsync('stateInspector.cleanupSuggestions', JSON.stringify(cleanupSuggestions, null, 2), true);
        await this.setStateAsync('stateInspector.safeToDeleteCount', cleanupSuggestions.safeToDelete.length, true);
        await this.setStateAsync('stateInspector.reviewRequiredCount', cleanupSuggestions.reviewRequired.length, true);

        this.log.info(`State Inspector summary: ${totalIssues} total issues (${orphanedCount} orphaned, ${staleCount} stale, ${duplicateCount} duplicates)`);
        this.log.info(`Cleanup suggestions: ${cleanupSuggestions.safeToDelete.length} safe to delete, ${cleanupSuggestions.reviewRequired.length} review required`);
    }

    /**
     * Get translation for a key based on language.
     * @param {string} key - Translation key
     * @param {string} lang - Language code (de, en, ...)
     * @returns {string} Translated string
     */
    t(key, lang) {
        const translations = {
            'noOrphanedStates': { en: 'No orphaned states found.', de: 'Keine verwaisten States gefunden.' },
            'noStaleStates': { en: 'No stale states found.', de: 'Keine veralteten States gefunden.' },
            'noDuplicates': { en: 'No duplicate states found.', de: 'Keine Duplikate gefunden.' },
            'noCleanupSuggestions': { en: 'No cleanup suggestions available.', de: 'Keine Bereinigungsvorschläge verfügbar.' },
            'stateId': { en: 'State ID', de: 'State ID' },
            'category': { en: 'Category', de: 'Kategorie' },
            'reason': { en: 'Reason', de: 'Grund' },
            'adapter': { en: 'Adapter', de: 'Adapter' },
            'lastUpdate': { en: 'Last Update', de: 'Letztes Update' },
            'ageHours': { en: 'Age (h)', de: 'Alter (h)' },
            'states': { en: 'States', de: 'States' },
            'similarity': { en: 'Similarity', de: 'Ähnlichkeit' },
            'showingXofY': { en: 'Showing {0} of {1}', de: 'Zeige {0} von {1}' },
            'safeToDelete': { en: 'Safe to Delete', de: 'Sicher zu löschen' },
            'reviewRequired': { en: 'Review Required', de: 'Überprüfung erforderlich' },
            'safeToDeleteDescription': { en: 'These states are likely obsolete and can be safely deleted.', de: 'Diese States sind wahrscheinlich veraltet und können sicher gelöscht werden.' },
            'reviewRequiredDescription': { en: 'These states should be reviewed before deletion.', de: 'Diese States sollten vor dem Löschen überprüft werden.' },
            'warning': { en: 'Warning', de: 'Warnung' },
            'cleanupWarning': { en: 'This is a report-only feature. No states will be deleted automatically. Always backup your ioBroker system before manually deleting states.', de: 'Dies ist nur ein Bericht. Es werden keine States automatisch gelöscht. Erstellen Sie immer ein Backup Ihres ioBroker-Systems, bevor Sie States manuell löschen.' },
        };
        const entry = translations[key];
        if (!entry) return key;
        return entry[lang] || entry.en || key;
    }

    /**
     * Render HTML table for orphaned state details.
     * @param {string} [lang] - Language code
     * @returns {string} HTML string
     */
    renderOrphanedDetailsHtml(lang = 'en') {
        if (!this.orphanedInspector || this.orphanedInspector.orphanedStates.length === 0) {
            return `<div style="padding:8px;opacity:0.6;">${this.t('noOrphanedStates', lang)}</div>`;
        }

        const states = this.orphanedInspector.orphanedStates;
        const total = states.length;
        const DISPLAY_LIMIT = 200;
        const displayStates = states.slice(0, DISPLAY_LIMIT);
        const hasMore = states.length > DISPLAY_LIMIT;

        // Collect unique categories
        const categories = [...new Set(states.map(s => s.category))].sort();

        // Build category filter buttons with onclick handlers
        let html = '<div style="margin-bottom:12px;padding:8px;background:rgba(128,128,128,0.05);border-radius:4px;">';
        html += `<span style="margin-right:8px;opacity:0.7;font-weight:bold;">${this.t('filterByCategory', lang) || 'Filter by category'}:</span>`;
        html += `<button onclick="filterTable_orphaned(this, '')" class="filter-orphaned-btn" style="margin:2px 4px;padding:4px 12px;border:1px solid rgba(128,128,128,0.3);border-radius:3px;background:#1976d2;color:#fff;font-weight:bold;cursor:pointer;font-size:12px;">${this.t('all', lang) || 'All'} (${total})</button>`;
        
        for (const cat of categories) {
            const count = states.filter(s => s.category === cat).length;
            const escapedCat = this.escapeHtml(cat).replace(/'/g, "\\'");
            html += `<button onclick="filterTable_orphaned(this, '${escapedCat}')" class="filter-orphaned-btn" style="margin:2px 4px;padding:4px 12px;border:1px solid rgba(128,128,128,0.3);border-radius:3px;background:#fff;cursor:pointer;font-size:12px;">${this.escapeHtml(cat)} (${count})</button>`;
        }
        html += '</div>';

        // Build table with data-category attributes for filtering
        html += '<table id="orphanedTable" style="width:100%;border-collapse:collapse;font-size:13px;">';
        html += `<tr style="opacity:0.7;font-weight:bold;"><th style="padding:6px;text-align:left;">${this.t('stateId', lang)}</th><th style="padding:6px;text-align:left;">${this.t('category', lang)}</th><th style="padding:6px;text-align:left;">${this.t('reason', lang)}</th></tr>`;

        for (const s of displayStates) {
            html += `<tr class="orphaned-row" data-category="${this.escapeHtml(s.category)}" style="border-bottom:1px solid rgba(128,128,128,0.2);">`;
            html += `<td style="padding:4px 6px;font-family:monospace;font-size:12px;">${this.escapeHtml(s.id)}</td>`;
            html += `<td style="padding:4px 6px;">${this.escapeHtml(s.category)}</td>`;
            html += `<td style="padding:4px 6px;">${this.escapeHtml(s.reason)}</td>`;
            html += '</tr>';
        }

        html += '</table>';

        if (hasMore) {
            html += `<div style="padding:8px;opacity:0.6;font-style:italic;">${this.t('showingFirst', lang) || 'Showing first'} ${DISPLAY_LIMIT} ${this.t('of', lang) || 'of'} ${total} ${this.t('states', lang) || 'states'}. ${this.t('useFilters', lang) || 'Use filters to narrow down results'}.</div>`;
        }

        // Add client-side filtering script using event delegation
        html += this.renderTableFilterScript('orphaned');

        return html;
    }

    /**
     * Render HTML table for stale state details.
     * @param {string} [lang] - Language code
     * @returns {string} HTML string
     */
    renderStaleDetailsHtml(lang = 'en') {
        if (!this.staleInspector || this.staleInspector.staleStates.length === 0) {
            return `<div style="padding:8px;opacity:0.6;">${this.t('noStaleStates', lang)}</div>`;
        }

        const states = this.staleInspector.staleStates;
        const total = states.length;
        const DISPLAY_LIMIT = 200;
        const displayStates = states.slice(0, DISPLAY_LIMIT);
        const hasMore = states.length > DISPLAY_LIMIT;

        // Collect unique adapters
        const adapters = [...new Set(states.map(s => s.adapter))].sort();

        // Build adapter filter buttons with onclick handlers
        let html = '<div style="margin-bottom:12px;padding:8px;background:rgba(128,128,128,0.05);border-radius:4px;">';
        html += `<span style="margin-right:8px;opacity:0.7;font-weight:bold;">${this.t('filterByAdapter', lang) || 'Filter by adapter'}:</span>`;
        html += `<button onclick="filterTable_stale(this, '')" class="filter-stale-btn" style="margin:2px 4px;padding:4px 12px;border:1px solid rgba(128,128,128,0.3);border-radius:3px;background:#1976d2;color:#fff;font-weight:bold;cursor:pointer;font-size:12px;">${this.t('all', lang) || 'All'} (${total})</button>`;
        
        for (const adapter of adapters) {
            const count = states.filter(s => s.adapter === adapter).length;
            const escapedAdapter = this.escapeHtml(adapter).replace(/'/g, "\\'");
            html += `<button onclick="filterTable_stale(this, '${escapedAdapter}')" class="filter-stale-btn" style="margin:2px 4px;padding:4px 12px;border:1px solid rgba(128,128,128,0.3);border-radius:3px;background:#fff;cursor:pointer;font-size:12px;">${this.escapeHtml(adapter)} (${count})</button>`;
        }
        html += '</div>';

        // Build table with data-adapter attributes for filtering
        html += '<table id="staleTable" style="width:100%;border-collapse:collapse;font-size:13px;">';
        html += `<tr style="opacity:0.7;font-weight:bold;"><th style="padding:6px;text-align:left;">${this.t('stateId', lang)}</th><th style="padding:6px;text-align:left;">${this.t('adapter', lang)}</th><th style="padding:6px;text-align:left;">${this.t('lastUpdate', lang)}</th><th style="padding:6px;text-align:left;">${this.t('ageHours', lang)}</th></tr>`;

        for (const s of displayStates) {
            html += `<tr class="stale-row" data-adapter="${this.escapeHtml(s.adapter)}" style="border-bottom:1px solid rgba(128,128,128,0.2);">`;
            html += `<td style="padding:4px 6px;font-family:monospace;font-size:12px;">${this.escapeHtml(s.id)}</td>`;
            html += `<td style="padding:4px 6px;">${this.escapeHtml(s.adapter)}</td>`;
            html += `<td style="padding:4px 6px;">${this.escapeHtml(s.lastUpdate)}</td>`;
            html += `<td style="padding:4px 6px;">${s.ageHours}</td>`;
            html += '</tr>';
        }

        html += '</table>';

        if (hasMore) {
            html += `<div style="padding:8px;opacity:0.6;font-style:italic;">${this.t('showingFirst', lang) || 'Showing first'} ${DISPLAY_LIMIT} ${this.t('of', lang) || 'of'} ${total} ${this.t('states', lang) || 'states'}. ${this.t('useFilters', lang) || 'Use filters to narrow down results'}.</div>`;
        }

        // Add client-side filtering script using event delegation
        html += this.renderTableFilterScript('stale');

        return html;
    }

    /**
     * Shared helper for table filtering scripts.
     * @param {string} type - 'orphaned' or 'stale'
     * @returns {string} HTML script tag
     */
    renderTableFilterScript(type) {
        const rowClass = type === 'orphaned' ? 'orphaned-row' : 'stale-row';
        const dataAttr = type === 'orphaned' ? 'category' : 'adapter';
        const btnClass = type === 'orphaned' ? 'filter-orphaned-btn' : 'filter-stale-btn';
        const tableId = type === 'orphaned' ? 'orphanedTable' : 'staleTable';
        
        return `
<script>
window.filterTable_${type} = function(btn, filterValue) {
    const rows = document.querySelectorAll('.${rowClass}');
    rows.forEach(row => {
        const rowValue = row.getAttribute('data-${dataAttr}');
        if (filterValue === '' || rowValue === filterValue) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
    
    // Update button styles
    const buttons = document.querySelectorAll('.${btnClass}');
    buttons.forEach(b => {
        if (b === btn) {
            b.style.background = '#1976d2';
            b.style.color = '#fff';
            b.style.fontWeight = 'bold';
        } else {
            b.style.background = '#fff';
            b.style.color = '#000';
            b.style.fontWeight = 'normal';
        }
    });
};
</script>`;
    }

    /**
     * Render HTML table for duplicate state details.
     * @param {string} [lang] - Language code
     * @returns {string} HTML string
     */
    renderDuplicateDetailsHtml(lang = 'en') {
        if (!this.duplicateInspector || this.duplicateInspector.duplicates.length === 0) {
            return `<div style="padding:8px;opacity:0.6;">${this.t('noDuplicates', lang)}</div>`;
        }

        const MAX = 50;
        const groups = this.duplicateInspector.duplicates.slice(0, MAX);
        const total = this.duplicateInspector.duplicates.length;

        let html = '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
        html += `<tr style="opacity:0.7;font-weight:bold;"><th style="padding:6px;text-align:left;">#</th><th style="padding:6px;text-align:left;">${this.t('states', lang)}</th><th style="padding:6px;text-align:left;">${this.t('similarity', lang)}</th></tr>`;

        groups.forEach((group, i) => {
            const statesStr = (group.states || []).map(s => {
                // Handle both string IDs and state objects
                const id = typeof s === 'string' ? s : s.id;
                return this.escapeHtml(id);
            }).join('<br>');
            const similarity = group.similarity ? (group.similarity * 100).toFixed(0) + '%' : '-';
            html += '<tr style="border-bottom:1px solid rgba(128,128,128,0.2);">';
            html += `<td style="padding:4px 6px;">${i + 1}</td>`;
            html += `<td style="padding:4px 6px;font-family:monospace;font-size:12px;">${statesStr}</td>`;
            html += `<td style="padding:4px 6px;">${similarity}</td>`;
            html += '</tr>';
        });

        html += '</table>';
        if (total > MAX) {
            html += `<div style="padding:8px;opacity:0.6;font-size:12px;">${this.t('showingXofY', lang).replace('{0}', MAX).replace('{1}', total)}</div>`;
        }
        return html;
    }

    /**
     * Escape HTML special characters.
     * @param {string} str - Input string
     * @returns {string} Escaped string
     */
    escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /**
     * Render HTML for cleanup suggestions.
     * @param {string} [lang] - Language code
     * @returns {string} HTML string
     */
    async renderCleanupSuggestionsHtml(lang = 'en') {
        // Read cleanup suggestions from state
        const suggestionsState = await this.getStateAsync('stateInspector.cleanupSuggestions');
        
        if (!suggestionsState || !suggestionsState.val) {
            return `<div style="padding:8px;opacity:0.6;">${this.t('noCleanupSuggestions', lang)}</div>`;
        }

        let suggestions;
        try {
            suggestions = JSON.parse(suggestionsState.val);
        } catch (e) {
            return `<div style="padding:8px;opacity:0.6;color:red;">Error parsing cleanup suggestions</div>`;
        }

        if (suggestions.safeToDelete.length === 0 && suggestions.reviewRequired.length === 0) {
            return `<div style="padding:8px;opacity:0.6;">${this.t('noCleanupSuggestions', lang)}</div>`;
        }

        let html = '<div style="font-size:13px;">';

        // Safe to delete section
        if (suggestions.safeToDelete.length > 0) {
            html += `<div style="margin-bottom:20px;">`;
            html += `<h4 style="margin:8px 0;color:#4caf50;">${this.t('safeToDelete', lang)} (${suggestions.safeToDelete.length})</h4>`;
            html += `<p style="font-size:12px;opacity:0.7;margin:4px 0 8px 0;">${this.t('safeToDeleteDescription', lang)}</p>`;
            html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
            html += `<tr style="opacity:0.7;font-weight:bold;"><th style="padding:6px;text-align:left;">${this.t('stateId', lang)}</th><th style="padding:6px;text-align:left;">${this.t('reason', lang)}</th></tr>`;
            
            const MAX = 20;
            for (const s of suggestions.safeToDelete.slice(0, MAX)) {
                html += '<tr style="border-bottom:1px solid rgba(128,128,128,0.2);">';
                html += `<td style="padding:4px 6px;font-family:monospace;">${this.escapeHtml(s.id)}</td>`;
                html += `<td style="padding:4px 6px;">${this.escapeHtml(s.reason)}</td>`;
                html += '</tr>';
            }
            html += '</table>';
            if (suggestions.safeToDelete.length > MAX) {
                html += `<div style="padding:8px;opacity:0.6;font-size:11px;">${this.t('showingXofY', lang).replace('{0}', MAX).replace('{1}', suggestions.safeToDelete.length)}</div>`;
            }
            html += '</div>';
        }

        // Review required section
        if (suggestions.reviewRequired.length > 0) {
            html += `<div style="margin-bottom:20px;">`;
            html += `<h4 style="margin:8px 0;color:#ff9800;">${this.t('reviewRequired', lang)} (${suggestions.reviewRequired.length})</h4>`;
            html += `<p style="font-size:12px;opacity:0.7;margin:4px 0 8px 0;">${this.t('reviewRequiredDescription', lang)}</p>`;
            html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
            html += `<tr style="opacity:0.7;font-weight:bold;"><th style="padding:6px;text-align:left;">${this.t('stateId', lang)}</th><th style="padding:6px;text-align:left;">${this.t('reason', lang)}</th></tr>`;
            
            const MAX = 20;
            for (const s of suggestions.reviewRequired.slice(0, MAX)) {
                html += '<tr style="border-bottom:1px solid rgba(128,128,128,0.2);">';
                html += `<td style="padding:4px 6px;font-family:monospace;">${this.escapeHtml(s.id)}</td>`;
                html += `<td style="padding:4px 6px;">${this.escapeHtml(s.reason)}</td>`;
                html += '</tr>';
            }
            html += '</table>';
            if (suggestions.reviewRequired.length > MAX) {
                html += `<div style="padding:8px;opacity:0.6;font-size:11px;">${this.t('showingXofY', lang).replace('{0}', MAX).replace('{1}', suggestions.reviewRequired.length)}</div>`;
            }
            html += '</div>';
        }

        html += `<div style="padding:12px;background:rgba(255,193,7,0.1);border-left:3px solid #ff9800;margin-top:16px;font-size:12px;">`;
        html += `<strong>⚠️ ${this.t('warning', lang)}:</strong> ${this.t('cleanupWarning', lang)}`;
        html += `</div>`;

        html += '</div>';
        return html;
    }

    /**
     * Render HTML table for log monitoring details.
     * @param {string} [lang] - Language code
     * @returns {Promise<string>} HTML string
     */
    async renderLogDetailsHtml(lang = 'en') {
        // Read log details from state
        const detailsState = await this.getStateAsync('logs.details');
        
        if (!detailsState || !detailsState.val) {
            return `<div style="padding:8px;opacity:0.6;">${this.t('noDataAvailable', lang)}</div>`;
        }

        let instances;
        try {
            instances = JSON.parse(detailsState.val);
        } catch (e) {
            return `<div style="padding:8px;opacity:0.6;color:red;">Error parsing log details</div>`;
        }

        if (!Array.isArray(instances) || instances.length === 0) {
            return `<div style="padding:8px;opacity:0.6;">${this.t('noIssuesFound', lang)}</div>`;
        }

        let html = '<div style="font-size:13px;">';

        // Summary section
        const totalErrors = instances.reduce((sum, i) => sum + i.totalErrors, 0);
        const totalWarnings = instances.reduce((sum, i) => sum + i.totalWarnings, 0);
        
        html += '<div style="margin-bottom:16px;padding:12px;background:rgba(128,128,128,0.05);border-radius:4px;">';
        html += `<div style="font-weight:bold;margin-bottom:8px;">${this.t('summary', lang) || 'Summary'}:</div>`;
        html += `<div style="display:flex;gap:20px;">`;
        html += `<div><span style="color:#f44336;font-weight:bold;">${totalErrors}</span> ${this.t('errors', lang) || 'Errors'}</div>`;
        html += `<div><span style="color:#ff9800;font-weight:bold;">${totalWarnings}</span> ${this.t('warnings', lang) || 'Warnings'}</div>`;
        html += `<div><span style="font-weight:bold;">${instances.length}</span> ${this.t('instances', lang) || 'Instances'}</div>`;
        html += `</div></div>`;

        // Per-instance breakdown
        for (const instance of instances) {
            const hasErrors = instance.totalErrors > 0;
            const hasWarnings = instance.totalWarnings > 0;
            
            if (!hasErrors && !hasWarnings) continue;

            const statusColor = hasErrors ? '#f44336' : '#ff9800';
            
            html += `<div style="margin-bottom:20px;padding:12px;border-left:3px solid ${statusColor};background:rgba(128,128,128,0.02);">`;
            html += `<div style="font-weight:bold;margin-bottom:8px;color:${statusColor};">${this.escapeHtml(instance.instance)}</div>`;
            
            if (hasErrors && instance.topErrors.length > 0) {
                html += `<div style="margin-bottom:8px;">`;
                html += `<span style="color:#f44336;font-weight:bold;">${this.t('errors', lang) || 'Errors'}</span> (${instance.totalErrors}):`;
                html += '<ul style="margin:4px 0;padding-left:20px;font-size:12px;">';
                for (const err of instance.topErrors) {
                    html += `<li>${this.escapeHtml(err.type)}: ${err.count}×</li>`;
                }
                html += '</ul></div>';
            }
            
            if (hasWarnings && instance.topWarnings.length > 0) {
                html += `<div>`;
                html += `<span style="color:#ff9800;font-weight:bold;">${this.t('warnings', lang) || 'Warnings'}</span> (${instance.totalWarnings}):`;
                html += '<ul style="margin:4px 0;padding-left:20px;font-size:12px;">';
                for (const warn of instance.topWarnings) {
                    html += `<li>${this.escapeHtml(warn.type)}: ${warn.count}×</li>`;
                }
                html += '</ul></div>';
            }
            
            html += '</div>';
        }

        html += '</div>';
        return html;
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
            if (this.performanceInspector) {
                await this.performanceInspector.cleanup();
            }
            this.log.info('ioBroker.system-health stopped.');
            callback();
        } catch {
            callback();
        }
    }

    /**
     * Parse ignore patterns from config.
     * Handles both array and string (comma/newline delimited) formats.
     * @param {string|string[]|null|undefined} patterns
     * @returns {string[]}
     */
    _parseIgnorePatterns(patterns) {
        if (Array.isArray(patterns)) {
            return patterns.filter(p => typeof p === 'string' && p.trim()).map(p => p.trim());
        }
        if (typeof patterns === 'string' && patterns.trim()) {
            // Split by comma or newline
            return patterns
                .split(/[,\n]/)
                .map(p => p.trim())
                .filter(p => p);
        }
        return [];
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
