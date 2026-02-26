const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const StaleStateInspector = require('../lib/state-inspector/stale-detection');

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
        this.foreignStates = {};
        this.foreignObjects = {};
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

    async getForeignStatesAsync(pattern) {
        return this.foreignStates;
    }

    async getForeignObjectsAsync(pattern, type) {
        if (type === 'state') {
            return this.foreignObjects;
        }
        if (type === 'instance') {
            // Return adapter instances
            const instances = {};
            for (const key in this.foreignObjects) {
                if (key.startsWith('system.adapter.')) {
                    instances[key] = this.foreignObjects[key];
                }
            }
            return instances;
        }
        return {};
    }
}

describe('StaleStateInspector', () => {
    describe('initialization', () => {
        it('should initialize without errors', async () => {
            const adapter = new MockAdapter();
            const inspector = new StaleStateInspector(adapter, 24, []);

            await inspector.createStates();

            assert.ok(adapter.objects['system-health.0.inspector.staleStates.report']);
            assert.ok(adapter.objects['system-health.0.inspector.staleStates.count']);
            assert.ok(adapter.objects['system-health.0.inspector.staleStates.hasStale']);
            assert.ok(adapter.objects['system-health.0.inspector.staleStates.byAdapter']);
            assert.ok(adapter.objects['system-health.0.inspector.staleStates.lastScan']);
        });
    });

    describe('stale detection criteria', () => {
        it('should detect writable stale states from active adapters', async () => {
            const adapter = new MockAdapter();
            const now = Date.now();
            const oldTimestamp = now - (25 * 60 * 60 * 1000); // 25 hours ago

            // Setup: writable state from active adapter
            adapter.foreignStates = {
                'mqtt.0.sensor.temperature': { val: 21.5, ts: oldTimestamp }
            };

            adapter.foreignObjects = {
                'mqtt.0.sensor.temperature': {
                    common: {
                        name: 'Temperature',
                        type: 'number',
                        read: true,
                        write: true // Writable state
                    }
                },
                'system.adapter.mqtt.0': {
                    common: {
                        enabled: true // Active adapter
                    }
                }
            };

            const inspector = new StaleStateInspector(adapter, 24, []);
            const report = await inspector.inspect();

            assert.strictEqual(inspector.staleStates.length, 1);
            assert.strictEqual(inspector.staleStates[0].id, 'mqtt.0.sensor.temperature');
            assert.strictEqual(inspector.staleStates[0].adapter, 'mqtt.0');
        });

        it('should include read-only states (common.write === false)', async () => {
            const adapter = new MockAdapter();
            const now = Date.now();
            const oldTimestamp = now - (25 * 60 * 60 * 1000);

            adapter.foreignStates = {
                'mqtt.0.config.version': { val: '1.0.0', ts: oldTimestamp }
            };

            adapter.foreignObjects = {
                'mqtt.0.config.version': {
                    common: {
                        name: 'Version',
                        type: 'string',
                        read: true,
                        write: false // Read-only
                    }
                },
                'system.adapter.mqtt.0': {
                    common: { enabled: true }
                }
            };

            const inspector = new StaleStateInspector(adapter, 24, []);
            await inspector.inspect();

            assert.strictEqual(inspector.staleStates.length, 1, 'Should include read-only states');
        });

        it('should include states with read=true and write=undefined (implicitly read-only)', async () => {
            const adapter = new MockAdapter();
            const now = Date.now();
            const oldTimestamp = now - (25 * 60 * 60 * 1000);

            adapter.foreignStates = {
                'mqtt.0.sensor.connection': { val: true, ts: oldTimestamp }
            };

            adapter.foreignObjects = {
                'mqtt.0.sensor.connection': {
                    common: {
                        name: 'Connection',
                        type: 'boolean',
                        read: true,
                        // write: undefined (implicitly read-only)
                    }
                },
                'system.adapter.mqtt.0': {
                    common: { enabled: true }
                }
            };

            const inspector = new StaleStateInspector(adapter, 24, []);
            await inspector.inspect();

            assert.strictEqual(inspector.staleStates.length, 1, 'Should include implicitly read-only states');
        });

        it('should skip states from inactive adapters', async () => {
            const adapter = new MockAdapter();
            const now = Date.now();
            const oldTimestamp = now - (25 * 60 * 60 * 1000);

            adapter.foreignStates = {
                'mqtt.0.sensor.temperature': { val: 21.5, ts: oldTimestamp }
            };

            adapter.foreignObjects = {
                'mqtt.0.sensor.temperature': {
                    common: {
                        name: 'Temperature',
                        type: 'number',
                        read: true,
                        write: true
                    }
                },
                'system.adapter.mqtt.0': {
                    common: {
                        enabled: false // Disabled adapter
                    }
                }
            };

            const inspector = new StaleStateInspector(adapter, 24, []);
            await inspector.inspect();

            assert.strictEqual(inspector.staleStates.length, 0, 'Should skip states from inactive adapters');
        });

        it('should skip states matching ignore patterns', async () => {
            const adapter = new MockAdapter();
            const now = Date.now();
            const oldTimestamp = now - (25 * 60 * 60 * 1000);

            adapter.foreignStates = {
                'system.host.hostname': { val: 'iobroker', ts: oldTimestamp }
            };

            adapter.foreignObjects = {
                'system.host.hostname': {
                    common: {
                        name: 'Hostname',
                        type: 'string',
                        read: true,
                        write: true
                    }
                }
            };

            const inspector = new StaleStateInspector(adapter, 24, []); // Default ignores system.*
            await inspector.inspect();

            assert.strictEqual(inspector.staleStates.length, 0, 'Should skip system.* states');
        });

        it('should skip states without object definition', async () => {
            const adapter = new MockAdapter();
            const now = Date.now();
            const oldTimestamp = now - (25 * 60 * 60 * 1000);

            adapter.foreignStates = {
                'orphan.state': { val: 42, ts: oldTimestamp }
            };

            adapter.foreignObjects = {};

            const inspector = new StaleStateInspector(adapter, 24, []);
            await inspector.inspect();

            assert.strictEqual(inspector.staleStates.length, 0, 'Should skip states without object definition');
        });

        it('should handle states without timestamps', async () => {
            const adapter = new MockAdapter();

            adapter.foreignStates = {
                'mqtt.0.sensor.temperature': { val: 21.5 } // No timestamp
            };

            adapter.foreignObjects = {
                'mqtt.0.sensor.temperature': {
                    common: {
                        name: 'Temperature',
                        type: 'number',
                        read: true,
                        write: true
                    }
                },
                'system.adapter.mqtt.0': {
                    common: { enabled: true }
                }
            };

            const inspector = new StaleStateInspector(adapter, 24, []);
            await inspector.inspect();

            assert.strictEqual(inspector.staleStates.length, 0, 'Should skip states without timestamp');
        });
    });

    describe('report generation', () => {
        it('should generate correct report structure', async () => {
            const adapter = new MockAdapter();
            const now = Date.now();
            const oldTimestamp = now - (25 * 60 * 60 * 1000);

            adapter.foreignStates = {
                'mqtt.0.sensor.temperature': { val: 21.5, ts: oldTimestamp },
                'zigbee.0.device.humidity': { val: 65, ts: oldTimestamp }
            };

            adapter.foreignObjects = {
                'mqtt.0.sensor.temperature': {
                    common: { name: 'Temperature', type: 'number', read: true, write: true }
                },
                'zigbee.0.device.humidity': {
                    common: { name: 'Humidity', type: 'number', read: true, write: true }
                },
                'system.adapter.mqtt.0': { common: { enabled: true } },
                'system.adapter.zigbee.0': { common: { enabled: true } }
            };

            const inspector = new StaleStateInspector(adapter, 24, []);
            const report = await inspector.inspect();

            assert.ok(report.timestamp);
            assert.strictEqual(report.thresholdHours, 24);
            assert.strictEqual(report.totalStale, 2);
            assert.ok(Array.isArray(report.staleStates));
            assert.ok(report.summary.byAdapter);
            assert.strictEqual(report.summary.byAdapter['mqtt.0'], 1);
            assert.strictEqual(report.summary.byAdapter['zigbee.0'], 1);
        });

        it('should sort states by age (oldest first)', async () => {
            const adapter = new MockAdapter();
            const now = Date.now();
            const veryOld = now - (100 * 60 * 60 * 1000); // 100 hours ago
            const old = now - (50 * 60 * 60 * 1000); // 50 hours ago

            adapter.foreignStates = {
                'mqtt.0.sensor1': { val: 1, ts: old },
                'mqtt.0.sensor2': { val: 2, ts: veryOld }
            };

            adapter.foreignObjects = {
                'mqtt.0.sensor1': {
                    common: { name: 'Sensor 1', type: 'number', read: true, write: true }
                },
                'mqtt.0.sensor2': {
                    common: { name: 'Sensor 2', type: 'number', read: true, write: true }
                },
                'system.adapter.mqtt.0': { common: { enabled: true } }
            };

            const inspector = new StaleStateInspector(adapter, 24, []);
            await inspector.inspect();

            // Should be sorted by age descending (oldest first)
            assert.strictEqual(inspector.staleStates[0].id, 'mqtt.0.sensor2');
            assert.strictEqual(inspector.staleStates[1].id, 'mqtt.0.sensor1');
            assert.ok(inspector.staleStates[0].ageHours > inspector.staleStates[1].ageHours);
        });
    });

    describe('getRunningAdapters', () => {
        it('should identify enabled adapters', async () => {
            const adapter = new MockAdapter();

            adapter.foreignObjects = {
                'system.adapter.mqtt.0': {
                    common: { enabled: true }
                },
                'system.adapter.zigbee.0': {
                    common: { enabled: false }
                },
                'system.adapter.modbus.0': {
                    common: { enabled: true }
                }
            };

            const inspector = new StaleStateInspector(adapter, 24, []);
            const runningAdapters = await inspector.getRunningAdapters();

            assert.ok(runningAdapters.has('mqtt.0'));
            assert.ok(runningAdapters.has('modbus.0'));
            assert.ok(!runningAdapters.has('zigbee.0')); // Disabled
        });
    });
});
