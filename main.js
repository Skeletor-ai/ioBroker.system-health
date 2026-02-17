'use strict';

const utils = require('@iobroker/adapter-core');

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
        this.on('unload', this.onUnload.bind(this));
    }

    async onReady() {
        this.log.info('ioBroker.health starting health checks...');

        try {
            await this.runHealthChecks();
        } catch (err) {
            this.log.error(`Health check failed: ${err.message}`);
        }

        // Schedule mode: stop after checks complete
        this.stop();
    }

    /**
     * Run all enabled health checks.
     */
    async runHealthChecks() {
        // TODO: Implement health checks based on config
        // - Adapter crash detection
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
    onUnload(callback) {
        try {
            this.log.info('ioBroker.health stopped.');
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
