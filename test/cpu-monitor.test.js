const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const CpuMonitor = require('../lib/health-checks/cpu-monitor');

// Mock adapter
class MockAdapter {
    constructor() {
        this.namespace = 'system-health.0';
        this.log = {
            info: mock.fn(),
            warn: mock.fn(),
            error: mock.fn(),
            debug: mock.fn()
        };
        this.states = {};
        this.objects = {};
    }

    async setObjectNotExistsAsync(id, obj) {
        if (!this.objects[id]) {
            this.objects[id] = obj;
        }
    }

    async setStateAsync(id, val, ack) {
        const fullId = id.startsWith(this.namespace) ? id : `${this.namespace}.${id}`;
        this.states[fullId] = { val, ack };
    }

    async getStateAsync(id) {
        const fullId = id.startsWith(this.namespace) ? id : `${this.namespace}.${id}`;
        return this.states[fullId] || null;
    }
}

describe('CpuMonitor', () => {
    describe('initialization', () => {
        it('should initialize without errors', async () => {
            const adapter = new MockAdapter();
            const cpuMonitor = new CpuMonitor(adapter);
            
            await cpuMonitor.init();

            assert.ok(adapter.log.info.mock.calls.length > 0);
            assert.ok(adapter.objects['system-health.0.cpu.usage']);
            assert.ok(adapter.objects['system-health.0.cpu.status']);
        });

        it('should create all required states', async () => {
            const adapter = new MockAdapter();
            const cpuMonitor = new CpuMonitor(adapter);
            
            await cpuMonitor.createStates();

            assert.ok(adapter.objects['system-health.0.cpu.usage']);
            assert.ok(adapter.objects['system-health.0.cpu.usagePerCore']);
            assert.ok(adapter.objects['system-health.0.cpu.status']);
            assert.ok(adapter.objects['system-health.0.cpu.sustainedHighLoad']);
            assert.ok(adapter.objects['system-health.0.cpu.warnings']);
            assert.ok(adapter.objects['system-health.0.cpu.topProcesses']);
        });
    });

    describe('CPU usage measurement', () => {
        it('should measure CPU usage', async () => {
            const adapter = new MockAdapter();
            const cpuMonitor = new CpuMonitor(adapter);
            
            const usage = await cpuMonitor.getCpuUsage();

            assert.ok(typeof usage === 'number');
            assert.ok(usage >= 0 && usage <= 100);
        });

        it('should update states after measurement', async () => {
            const adapter = new MockAdapter();
            const cpuMonitor = new CpuMonitor(adapter);
            await cpuMonitor.createStates();

            await cpuMonitor.measure();

            const usageState = await adapter.getStateAsync('cpu.usage');
            assert.ok(usageState);
            assert.ok(typeof usageState.val === 'number');

            const statusState = await adapter.getStateAsync('cpu.status');
            assert.ok(statusState);
            assert.ok(['ok', 'warning', 'critical'].includes(statusState.val));
        });
    });

    describe('status determination', () => {
        it('should return "ok" for low usage', () => {
            const adapter = new MockAdapter();
            const cpuMonitor = new CpuMonitor(adapter, { 
                warningThreshold: 70, 
                criticalThreshold: 90 
            });

            const status = cpuMonitor.getStatus(50);
            assert.strictEqual(status, 'ok');
        });

        it('should return "warning" for medium usage', () => {
            const adapter = new MockAdapter();
            const cpuMonitor = new CpuMonitor(adapter, { 
                warningThreshold: 70, 
                criticalThreshold: 90 
            });

            const status = cpuMonitor.getStatus(75);
            assert.strictEqual(status, 'warning');
        });

        it('should return "critical" for high usage', () => {
            const adapter = new MockAdapter();
            const cpuMonitor = new CpuMonitor(adapter, { 
                warningThreshold: 70, 
                criticalThreshold: 90 
            });

            const status = cpuMonitor.getStatus(95);
            assert.strictEqual(status, 'critical');
        });
    });

    describe('sustained load detection', () => {
        it('should detect sustained high load', () => {
            const adapter = new MockAdapter();
            const cpuMonitor = new CpuMonitor(adapter, { 
                warningThreshold: 70,
                sampleCount: 3
            });

            // Fill samples with high values
            cpuMonitor.samples = [75, 80, 85];

            const sustained = cpuMonitor.checkSustainedLoad();
            assert.strictEqual(sustained, true);
        });

        it('should not detect sustained load with mixed values', () => {
            const adapter = new MockAdapter();
            const cpuMonitor = new CpuMonitor(adapter, { 
                warningThreshold: 70,
                sampleCount: 3
            });

            cpuMonitor.samples = [75, 50, 85];

            const sustained = cpuMonitor.checkSustainedLoad();
            assert.strictEqual(sustained, false);
        });

        it('should require enough samples', () => {
            const adapter = new MockAdapter();
            const cpuMonitor = new CpuMonitor(adapter, { 
                warningThreshold: 70,
                sampleCount: 5
            });

            cpuMonitor.samples = [75, 80];

            const sustained = cpuMonitor.checkSustainedLoad();
            assert.strictEqual(sustained, false);
        });
    });

    describe('warning generation', () => {
        it('should generate critical warning', () => {
            const adapter = new MockAdapter();
            const cpuMonitor = new CpuMonitor(adapter, { 
                criticalThreshold: 90 
            });

            const warnings = cpuMonitor.generateWarnings(95, false);
            assert.ok(warnings.includes('Critical'));
            assert.ok(warnings.includes('95'));
        });

        it('should include sustained load warning', () => {
            const adapter = new MockAdapter();
            const cpuMonitor = new CpuMonitor(adapter);

            const warnings = cpuMonitor.generateWarnings(75, true);
            assert.ok(warnings.includes('Sustained'));
        });

        it('should return empty string for ok status', () => {
            const adapter = new MockAdapter();
            const cpuMonitor = new CpuMonitor(adapter, { 
                warningThreshold: 70 
            });

            const warnings = cpuMonitor.generateWarnings(50, false);
            assert.strictEqual(warnings, '');
        });
    });
});
