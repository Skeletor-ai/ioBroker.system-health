'use strict';

const utils = require('@iobroker/adapter-core');
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
        
        /** @type {CrashDetection|null} */
        this.crashDetection = null;
    }

    async onReady() {
        this.log.info('ioBroker.system-health starting...');

        try {
            // Initialize crash detection if enabled
            if (this.config.enableAdapterCrashDetection) {
                this.crashDetection = new CrashDetection(this, 30);
                await this.crashDetection.init();
                this.log.info('Crash detection enabled - running in daemon mode.');
                // In daemon mode, keep running for real-time monitoring
                return;
            }

            // Run other health checks
            await this.runHealthChecks();
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
     * Run all enabled health checks.
     */
    async runHealthChecks() {
        // TODO: Implement other health checks based on config
        // - Memory monitoring
        // - Disk space monitoring
        // - Stale state detection
        // - Orphaned state detection
        // - Duplicate state detection
        this.log.info('Health checks completed.');
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
