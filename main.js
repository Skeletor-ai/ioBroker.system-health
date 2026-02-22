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

        // Update summary states only if at least one inspector ran
        if (this.duplicateInspector || this.orphanedInspector || this.staleInspector) {
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
            'stateId': { en: 'State ID', de: 'State ID' },
            'category': { en: 'Category', de: 'Kategorie' },
            'reason': { en: 'Reason', de: 'Grund' },
            'adapter': { en: 'Adapter', de: 'Adapter' },
            'lastUpdate': { en: 'Last Update', de: 'Letztes Update' },
            'ageHours': { en: 'Age (h)', de: 'Alter (h)' },
            'states': { en: 'States', de: 'States' },
            'similarity': { en: 'Similarity', de: 'Ähnlichkeit' },
            'showingXofY': { en: 'Showing {0} of {1}', de: 'Zeige {0} von {1}' },
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

        const MAX = 50;
        const states = this.orphanedInspector.orphanedStates.slice(0, MAX);
        const total = this.orphanedInspector.orphanedStates.length;

        let html = '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
        html += `<tr style="opacity:0.7;font-weight:bold;"><th style="padding:6px;text-align:left;">${this.t('stateId', lang)}</th><th style="padding:6px;text-align:left;">${this.t('category', lang)}</th><th style="padding:6px;text-align:left;">${this.t('reason', lang)}</th></tr>`;

        for (const s of states) {
            html += '<tr style="border-bottom:1px solid currentColor;border-opacity:0.15;">';
            html += `<td style="padding:4px 6px;font-family:monospace;font-size:12px;">${this.escapeHtml(s.id)}</td>`;
            html += `<td style="padding:4px 6px;">${this.escapeHtml(s.category)}</td>`;
            html += `<td style="padding:4px 6px;">${this.escapeHtml(s.reason)}</td>`;
            html += '</tr>';
        }

        html += '</table>';
        if (total > MAX) {
            html += `<div style="padding:8px;opacity:0.6;font-size:12px;">${this.t('showingXofY', lang).replace('{0}', MAX).replace('{1}', total)}</div>`;
        }
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

        const MAX = 50;
        const states = this.staleInspector.staleStates.slice(0, MAX);
        const total = this.staleInspector.staleStates.length;

        let html = '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
        html += `<tr style="opacity:0.7;font-weight:bold;"><th style="padding:6px;text-align:left;">${this.t('stateId', lang)}</th><th style="padding:6px;text-align:left;">${this.t('adapter', lang)}</th><th style="padding:6px;text-align:left;">${this.t('lastUpdate', lang)}</th><th style="padding:6px;text-align:left;">${this.t('ageHours', lang)}</th></tr>`;

        for (const s of states) {
            html += '<tr style="border-bottom:1px solid currentColor;border-opacity:0.15;">';
            html += `<td style="padding:4px 6px;font-family:monospace;font-size:12px;">${this.escapeHtml(s.id)}</td>`;
            html += `<td style="padding:4px 6px;">${this.escapeHtml(s.adapter)}</td>`;
            html += `<td style="padding:4px 6px;">${this.escapeHtml(s.lastUpdate)}</td>`;
            html += `<td style="padding:4px 6px;">${s.ageHours}</td>`;
            html += '</tr>';
        }

        html += '</table>';
        if (total > MAX) {
            html += `<div style="padding:8px;opacity:0.6;font-size:12px;">${this.t('showingXofY', lang).replace('{0}', MAX).replace('{1}', total)}</div>`;
        }
        return html;
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
            const statesStr = (group.states || []).map(s => this.escapeHtml(s)).join('<br>');
            const similarity = group.similarity ? (group.similarity * 100).toFixed(0) + '%' : '-';
            html += '<tr style="border-bottom:1px solid currentColor;border-opacity:0.15;">';
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
