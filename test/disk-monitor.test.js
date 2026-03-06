const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const DiskMonitor = require('../lib/health-checks/disk-monitor');

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

describe('DiskMonitor', () => {
    describe('initialization', () => {
        it('should initialize without errors', async () => {
            const adapter = new MockAdapter();
            const diskMonitor = new DiskMonitor(adapter);
            
            await diskMonitor.createStates();

            assert.ok(adapter.log.info.mock.calls.length === 0); // createStates doesn't log
            assert.ok(adapter.objects['system-health.0.disk.partitions']);
            assert.ok(adapter.objects['system-health.0.disk.status']);
        });

        it('should create all required states', async () => {
            const adapter = new MockAdapter();
            const diskMonitor = new DiskMonitor(adapter);
            
            await diskMonitor.createStates();

            assert.ok(adapter.objects['system-health.0.disk.partitions']);
            assert.ok(adapter.objects['system-health.0.disk.status']);
            assert.ok(adapter.objects['system-health.0.disk.warnings']);
            assert.ok(adapter.objects['system-health.0.disk.trends']);
            assert.ok(adapter.objects['system-health.0.disk.history']);
            assert.ok(adapter.objects['system-health.0.disk.usedPercent']);
            assert.ok(adapter.objects['system-health.0.disk.freeMB']);
            assert.ok(adapter.objects['system-health.0.disk.totalMB']);
            assert.ok(adapter.objects['system-health.0.disk.usedMB']);
        });

        it('should define scalar states with correct types and units', async () => {
            const adapter = new MockAdapter();
            const diskMonitor = new DiskMonitor(adapter);

            await diskMonitor.createStates();

            const usedPercent = adapter.objects['system-health.0.disk.usedPercent'];
            assert.strictEqual(usedPercent.common.type, 'number');
            assert.strictEqual(usedPercent.common.unit, '%');

            const freeMB = adapter.objects['system-health.0.disk.freeMB'];
            assert.strictEqual(freeMB.common.type, 'number');
            assert.strictEqual(freeMB.common.unit, 'MB');

            const totalMB = adapter.objects['system-health.0.disk.totalMB'];
            assert.strictEqual(totalMB.common.type, 'number');
            assert.strictEqual(totalMB.common.unit, 'MB');

            const usedMB = adapter.objects['system-health.0.disk.usedMB'];
            assert.strictEqual(usedMB.common.type, 'number');
            assert.strictEqual(usedMB.common.unit, 'MB');
        });
    });

    describe('status determination', () => {
        it('should return "ok" for low usage', () => {
            const adapter = new MockAdapter();
            const diskMonitor = new DiskMonitor(adapter, {
                warningThresholdPercent: 80,
                criticalThresholdPercent: 90,
                warningThresholdMB: 1000,
                criticalThresholdMB: 500
            });

            const partitions = [
                { mountPoint: '/', usedPercent: 50, freeMB: 5000 }
            ];

            const status = diskMonitor.getStatus(partitions);
            assert.strictEqual(status, 'ok');
        });

        it('should return "warning" for high percentage usage', () => {
            const adapter = new MockAdapter();
            const diskMonitor = new DiskMonitor(adapter, {
                warningThresholdPercent: 80,
                criticalThresholdPercent: 90
            });

            const partitions = [
                { mountPoint: '/', usedPercent: 85, freeMB: 5000 }
            ];

            const status = diskMonitor.getStatus(partitions);
            assert.strictEqual(status, 'warning');
        });

        it('should return "warning" for low free space', () => {
            const adapter = new MockAdapter();
            const diskMonitor = new DiskMonitor(adapter, {
                warningThresholdMB: 1000,
                criticalThresholdMB: 500
            });

            const partitions = [
                { mountPoint: '/', usedPercent: 70, freeMB: 800 }
            ];

            const status = diskMonitor.getStatus(partitions);
            assert.strictEqual(status, 'warning');
        });

        it('should return "critical" for very high usage', () => {
            const adapter = new MockAdapter();
            const diskMonitor = new DiskMonitor(adapter, {
                criticalThresholdPercent: 90
            });

            const partitions = [
                { mountPoint: '/', usedPercent: 95, freeMB: 5000 }
            ];

            const status = diskMonitor.getStatus(partitions);
            assert.strictEqual(status, 'critical');
        });

        it('should return "critical" for very low free space', () => {
            const adapter = new MockAdapter();
            const diskMonitor = new DiskMonitor(adapter, {
                criticalThresholdMB: 500
            });

            const partitions = [
                { mountPoint: '/', usedPercent: 80, freeMB: 300 }
            ];

            const status = diskMonitor.getStatus(partitions);
            assert.strictEqual(status, 'critical');
        });
    });

    describe('trend calculation', () => {
        it('should calculate growth rate', () => {
            const adapter = new MockAdapter();
            const diskMonitor = new DiskMonitor(adapter);

            const now = Date.now();
            diskMonitor.history = {
                '/': [
                    { timestamp: now - 3600000, usedPercent: 50, freeMB: 10000 }, // 1 hour ago
                    { timestamp: now, usedPercent: 51, freeMB: 9900 } // now (100 MB used)
                ]
            };

            const trends = diskMonitor.calculateTrends();
            
            assert.ok(trends['/']);
            assert.ok(trends['/'].growthRateMBPerHour > 0);
            assert.ok(Math.abs(trends['/'].growthRateMBPerHour - 100) < 10); // ~100 MB/h
        });

        it('should estimate ETA for disk full', () => {
            const adapter = new MockAdapter();
            const diskMonitor = new DiskMonitor(adapter);

            const now = Date.now();
            diskMonitor.history = {
                '/': [
                    { timestamp: now - 3600000, freeMB: 10000 },
                    { timestamp: now, freeMB: 9000 } // 1000 MB used in 1 hour
                ]
            };

            const trends = diskMonitor.calculateTrends();
            
            assert.ok(trends['/'].eta);
            // At 1000 MB/h, 9000 MB should be gone in ~9 hours
            const etaDate = new Date(trends['/'].eta);
            const hoursUntilFull = (etaDate - Date.now()) / (1000 * 60 * 60);
            assert.ok(hoursUntilFull > 8 && hoursUntilFull < 10);
        });

        it('should return zero growth for insufficient history', () => {
            const adapter = new MockAdapter();
            const diskMonitor = new DiskMonitor(adapter);

            diskMonitor.history = {
                '/': [
                    { timestamp: Date.now(), freeMB: 10000 }
                ]
            };

            const trends = diskMonitor.calculateTrends();
            
            assert.ok(trends['/']);
            assert.strictEqual(trends['/'].growthRateMBPerHour, 0);
            assert.strictEqual(trends['/'].eta, null);
        });
    });

    describe('warning generation', () => {
        it('should generate critical warning', () => {
            const adapter = new MockAdapter();
            const diskMonitor = new DiskMonitor(adapter, {
                criticalThresholdPercent: 90
            });

            const partitions = [
                { mountPoint: '/', usedPercent: 95, freeMB: 500 }
            ];
            const trends = {};

            const warnings = diskMonitor.generateWarnings(partitions, trends);
            
            assert.ok(warnings.includes('Critical'));
            assert.ok(warnings.includes('/'));
            assert.ok(warnings.includes('95%'));
        });

        it('should include trend warning for rapid growth', () => {
            const adapter = new MockAdapter();
            const diskMonitor = new DiskMonitor(adapter);

            const partitions = [
                { mountPoint: '/', usedPercent: 70, freeMB: 5000 }
            ];
            const trends = {
                '/': {
                    growthRateMBPerHour: 150,
                    eta: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
                }
            };

            const warnings = diskMonitor.generateWarnings(partitions, trends);
            
            assert.ok(warnings.includes('Trend'));
            assert.ok(warnings.includes('150 MB/h'));
        });

        it('should return empty string for ok status', () => {
            const adapter = new MockAdapter();
            const diskMonitor = new DiskMonitor(adapter, {
                warningThresholdPercent: 80
            });

            const partitions = [
                { mountPoint: '/', usedPercent: 50, freeMB: 10000 }
            ];
            const trends = {
                '/': { growthRateMBPerHour: 10, eta: null }
            };

            const warnings = diskMonitor.generateWarnings(partitions, trends);
            
            assert.strictEqual(warnings, '');
        });
    });

    describe('scalar states', () => {
        it('should set scalar states from root partition during measure', async () => {
            const adapter = new MockAdapter();
            const diskMonitor = new DiskMonitor(adapter, { mountPoints: ['/'] });

            // Override getDiskUsage to return controlled data
            diskMonitor.getDiskUsage = async () => [
                { filesystem: '/dev/sda1', mountPoint: '/', totalMB: 50000, usedMB: 20000, freeMB: 30000, usedPercent: 40 }
            ];

            await diskMonitor.createStates();
            await diskMonitor.measure();

            assert.strictEqual(adapter.states['system-health.0.disk.usedPercent'].val, 40);
            assert.strictEqual(adapter.states['system-health.0.disk.freeMB'].val, 30000);
            assert.strictEqual(adapter.states['system-health.0.disk.totalMB'].val, 50000);
            assert.strictEqual(adapter.states['system-health.0.disk.usedMB'].val, 20000);
        });

        it('should fall back to first partition if no root partition found', async () => {
            const adapter = new MockAdapter();
            const diskMonitor = new DiskMonitor(adapter, { mountPoints: ['/data'] });

            diskMonitor.getDiskUsage = async () => [
                { filesystem: '/dev/sdb1', mountPoint: '/data', totalMB: 100000, usedMB: 60000, freeMB: 40000, usedPercent: 60 }
            ];

            await diskMonitor.createStates();
            await diskMonitor.measure();

            assert.strictEqual(adapter.states['system-health.0.disk.usedPercent'].val, 60);
            assert.strictEqual(adapter.states['system-health.0.disk.freeMB'].val, 40000);
        });
    });

    describe('history persistence', () => {
        it('should save and load history', async () => {
            const adapter = new MockAdapter();
            const diskMonitor = new DiskMonitor(adapter);

            diskMonitor.history = {
                '/': [
                    { timestamp: 123456, usedPercent: 50, freeMB: 10000 }
                ]
            };

            await diskMonitor.saveHistory();
            
            const historyState = await adapter.getStateAsync('disk.history');
            assert.ok(historyState);
            
            const loaded = JSON.parse(historyState.val);
            assert.ok(loaded['/']);
            assert.strictEqual(loaded['/'][0].timestamp, 123456);
        });
    });
});
