const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const CrashDetection = require('../lib/health-checks/crash-detection');

// Mock adapter for testing
class MockAdapter {
    constructor() {
        this.namespace = 'system-health.0';
        this.config = {
            enableAdapterCrashDetection: true
        };
        this.log = {
            info: mock.fn(),
            warn: mock.fn(),
            error: mock.fn(),
            debug: mock.fn()
        };
        this.states = {};
        this.objects = {};
        this.subscriptions = new Set();
    }

    async getForeignStatesAsync(pattern) {
        const result = {};
        for (const [key, value] of Object.entries(this.states)) {
            if (this.matchPattern(key, pattern)) {
                result[key] = value;
            }
        }
        return result;
    }

    async getForeignStateAsync(id) {
        return this.states[id] || null;
    }

    async getForeignObjectsAsync(pattern, type) {
        const result = {};
        for (const [key, value] of Object.entries(this.objects)) {
            if (this.matchPattern(key, pattern) && (!type || value.type === type)) {
                result[key] = value;
            }
        }
        return result;
    }

    async getForeignObjectAsync(id) {
        return this.objects[id] || null;
    }

    async subscribeForeignStatesAsync(id) {
        this.subscriptions.add(id);
    }

    async unsubscribeForeignStatesAsync(id) {
        this.subscriptions.delete(id);
    }

    async setObjectNotExistsAsync(id, obj) {
        if (!this.objects[id]) {
            this.objects[id] = obj;
        }
    }

    async setStateAsync(id, value, ack) {
        this.states[id] = { val: value, ack };
    }

    async getStatesAsync(pattern) {
        return this.getForeignStatesAsync(pattern);
    }

    matchPattern(str, pattern) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(str);
    }
}

describe('CrashDetection', () => {
    describe('initialization', () => {
        it('should initialize without errors', async () => {
            const adapter = new MockAdapter();
            const crashDetection = new CrashDetection(adapter, 30);

            await crashDetection.init();

            assert.ok(adapter.log.info.mock.calls.length > 0);
        });

        it('should subscribe to alive states', async () => {
            const adapter = new MockAdapter();
            adapter.states['system.adapter.test.0.alive'] = { val: true, ack: true };
            adapter.states['system.adapter.test.1.alive'] = { val: true, ack: true };

            const crashDetection = new CrashDetection(adapter, 30);
            await crashDetection.init();

            assert.strictEqual(adapter.subscriptions.size, 2);
            assert.ok(adapter.subscriptions.has('system.adapter.test.0.alive'));
        });
    });

    describe('crash detection', () => {
        it('should detect crashes from alive state changes', async () => {
            const adapter = new MockAdapter();
            const crashDetection = new CrashDetection(adapter, 30);
            await crashDetection.init();

            // Set up instance object
            adapter.objects['system.adapter.test.0'] = {
                type: 'instance',
                common: { mode: 'daemon', enabled: true }
            };

            // Simulate crash (js-controller sets ack=true when detecting crashes)
            await crashDetection.onAliveStateChange(
                'system.adapter.test.0.alive',
                { val: false, ack: true }
            );

            // Wait for async processing
            await new Promise(resolve => setTimeout(resolve, 2100));

            assert.ok(adapter.log.warn.mock.calls.some(
                call => call.arguments[0].includes('Detected potential crash')
            ));
        });

        it('should ignore scheduled adapters that stop normally', async () => {
            const adapter = new MockAdapter();
            const crashDetection = new CrashDetection(adapter, 30);
            await crashDetection.init();

            // Set up scheduled adapter instance
            adapter.objects['system.adapter.ical.0'] = {
                type: 'instance',
                common: { mode: 'schedule', enabled: true }
            };

            // Simulate scheduled stop (alive=false)
            await crashDetection.onAliveStateChange(
                'system.adapter.ical.0.alive',
                { val: false, ack: true }
            );

            // Wait for async processing
            await new Promise(resolve => setTimeout(resolve, 2100));

            // Should NOT log a crash warning
            assert.ok(!adapter.log.warn.mock.calls.some(
                call => call.arguments[0].includes('Detected potential crash')
            ));

            // Should log debug message
            assert.ok(adapter.log.debug.mock.calls.some(
                call => call.arguments[0].includes('Ignoring alive=false for scheduled adapter')
            ));
        });

        it('should ignore disabled adapters', async () => {
            const adapter = new MockAdapter();
            const crashDetection = new CrashDetection(adapter, 30);
            await crashDetection.init();

            // Set up disabled adapter instance
            adapter.objects['system.adapter.test.0'] = {
                type: 'instance',
                common: { mode: 'daemon', enabled: false }
            };

            // Simulate stop
            await crashDetection.onAliveStateChange(
                'system.adapter.test.0.alive',
                { val: false, ack: true }
            );

            // Wait for async processing
            await new Promise(resolve => setTimeout(resolve, 2100));

            // Should NOT log a crash warning
            assert.ok(!adapter.log.warn.mock.calls.some(
                call => call.arguments[0].includes('Detected potential crash')
            ));

            // Should log debug message
            assert.ok(adapter.log.debug.mock.calls.some(
                call => call.arguments[0].includes('Ignoring alive=false for disabled adapter')
            ));
        });

        it('should ignore non-alive state changes', async () => {
            const adapter = new MockAdapter();
            const crashDetection = new CrashDetection(adapter, 30);

            await crashDetection.onAliveStateChange(
                'system.adapter.test.0.connected',
                { val: false, ack: true }
            );

            // Should not log any warnings
            assert.strictEqual(adapter.log.warn.mock.calls.length, 0);
        });
    });

    describe('crash counts', () => {
        it('should calculate crash counts correctly', () => {
            const adapter = new MockAdapter();
            const crashDetection = new CrashDetection(adapter, 30);

            const now = Date.now();
            crashDetection.crashHistory['test.0'] = [
                { timestamp: new Date(now - 1 * 60 * 60 * 1000).toISOString() }, // 1h ago
                { timestamp: new Date(now - 12 * 60 * 60 * 1000).toISOString() }, // 12h ago
                { timestamp: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString() }, // 3d ago
                { timestamp: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString() } // 10d ago
            ];

            const counts = crashDetection.getCrashCounts('test.0');

            assert.strictEqual(counts.count24h, 2);
            assert.strictEqual(counts.count7d, 3);
            assert.strictEqual(counts.count30d, 4);
        });
    });

    describe('cleanup', () => {
        it('should clean old crashes beyond retention period', () => {
            const adapter = new MockAdapter();
            const crashDetection = new CrashDetection(adapter, 7); // 7 day retention

            const now = Date.now();
            crashDetection.crashHistory['test.0'] = [
                { timestamp: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString() }, // 1d ago
                { timestamp: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString() }, // 10d ago (should be removed)
                { timestamp: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString() } // 5d ago
            ];

            crashDetection.cleanOldCrashes('test.0');

            assert.strictEqual(crashDetection.crashHistory['test.0'].length, 2);
        });

        it('should unsubscribe from all states on cleanup', async () => {
            const adapter = new MockAdapter();
            adapter.states['system.adapter.test.0.alive'] = { val: true, ack: true };

            const crashDetection = new CrashDetection(adapter, 30);
            await crashDetection.init();

            assert.ok(adapter.subscriptions.size > 0);

            await crashDetection.cleanup();

            assert.strictEqual(adapter.subscriptions.size, 0);
        });
    });

    describe('crash report generation', () => {
        it('should generate crash report with summary', async () => {
            const adapter = new MockAdapter();
            const crashDetection = new CrashDetection(adapter, 30);

            const now = Date.now();
            crashDetection.crashHistory['test.0'] = [
                { timestamp: new Date(now - 1 * 60 * 60 * 1000).toISOString(), category: 'adapter_error', recommendation: 'Update adapter' },
                { timestamp: new Date(now - 12 * 60 * 60 * 1000).toISOString(), category: 'config_error', recommendation: 'Check config' }
            ];

            await crashDetection.updateCrashReport();

            const reportState = adapter.states['system-health.0.report.crashReport'];
            assert.ok(reportState);

            const report = JSON.parse(reportState.val);
            assert.ok(report.adapters['test.0']);
            assert.strictEqual(report.adapters['test.0'].crashCount24h, 2);
            assert.strictEqual(report.summary.mostUnstable, 'test.0');
        });

        it('should set hasProblems flag when crashes exceed threshold', async () => {
            const adapter = new MockAdapter();
            const crashDetection = new CrashDetection(adapter, 30);

            const now = Date.now();
            crashDetection.crashHistory['test.0'] = [
                { timestamp: new Date(now - 1 * 60 * 60 * 1000).toISOString(), category: 'adapter_error', recommendation: 'Update' },
                { timestamp: new Date(now - 2 * 60 * 60 * 1000).toISOString(), category: 'adapter_error', recommendation: 'Update' },
                { timestamp: new Date(now - 3 * 60 * 60 * 1000).toISOString(), category: 'adapter_error', recommendation: 'Update' },
                { timestamp: new Date(now - 4 * 60 * 60 * 1000).toISOString(), category: 'adapter_error', recommendation: 'Update' }
            ];

            await crashDetection.updateCrashReport();

            const hasProblemsState = adapter.states['system-health.0.report.hasProblems'];
            assert.ok(hasProblemsState);
            assert.strictEqual(hasProblemsState.val, true);
        });
    });
});
