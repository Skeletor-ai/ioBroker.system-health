const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const OrphanedStateInspector = require('../lib/state-inspector/orphaned-states');

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
        if (pattern === '*') {
            return this.foreignStates;
        }
        return {};
    }

    async getForeignObjectsAsync(pattern, type) {
        if (pattern === '*' && type === 'state') {
            return this.foreignObjects;
        }
        if (pattern.startsWith('system.adapter.')) {
            // Return adapter instances
            const adapters = {};
            for (const [id, obj] of Object.entries(this.foreignObjects)) {
                if (id.startsWith('system.adapter.')) {
                    adapters[id] = obj;
                }
            }
            return adapters;
        }
        return {};
    }
}

describe('OrphanedStateInspector', () => {
    describe('initialization', () => {
        it('should initialize without errors', async () => {
            const adapter = new MockAdapter();
            const inspector = new OrphanedStateInspector(adapter, []);
            
            await inspector.init();

            assert.ok(adapter.objects['system-health.0.inspector.orphanedStates.report']);
            assert.ok(adapter.objects['system-health.0.inspector.orphanedStates.count']);
            assert.ok(adapter.objects['system-health.0.inspector.orphanedStates.hasOrphans']);
        });
    });

    describe('ignore patterns', () => {
        it('should match simple wildcard patterns', () => {
            const adapter = new MockAdapter();
            const inspector = new OrphanedStateInspector(adapter, ['system.*', 'admin.*']);

            assert.strictEqual(inspector.shouldIgnore('system.adapter.test.0'), true);
            assert.strictEqual(inspector.shouldIgnore('admin.0.info'), true);
            assert.strictEqual(inspector.shouldIgnore('zigbee.0.state'), false);
        });

        it('should match suffix wildcards', () => {
            const adapter = new MockAdapter();
            const inspector = new OrphanedStateInspector(adapter, ['*.info.*']);

            assert.strictEqual(inspector.shouldIgnore('test.0.info.connection'), true);
            assert.strictEqual(inspector.shouldIgnore('test.0.state'), false);
        });
    });

    describe('adapter instance detection', () => {
        it('should detect adapter removed', async () => {
            const adapter = new MockAdapter();
            
            // Add a state without corresponding adapter
            adapter.foreignStates['zigbee.0.sensor.temperature'] = { val: 20, ts: Date.now() };
            adapter.foreignObjects['zigbee.0.sensor.temperature'] = {
                common: { type: 'number', role: 'value' },
                ts: Date.now()
            };

            const inspector = new OrphanedStateInspector(adapter, []);
            const adapterInstances = await inspector.getAdapterInstances();
            const referencedStates = new Set();

            const orphan = await inspector.checkOrphaned(
                'zigbee.0.sensor.temperature',
                adapter.foreignObjects['zigbee.0.sensor.temperature'],
                adapterInstances,
                referencedStates
            );

            assert.ok(orphan);
            assert.strictEqual(orphan.category, 'adapter_removed');
            assert.strictEqual(orphan.adapter, 'zigbee.0');
        });

        it('should detect adapter disabled', async () => {
            const adapter = new MockAdapter();
            
            // Add state
            adapter.foreignStates['zigbee.0.sensor.temperature'] = { val: 20, ts: Date.now() };
            adapter.foreignObjects['zigbee.0.sensor.temperature'] = {
                common: { type: 'number', role: 'value' },
                ts: Date.now()
            };

            // Add adapter but disabled
            adapter.foreignObjects['system.adapter.zigbee.0'] = {
                common: { enabled: false }
            };

            const inspector = new OrphanedStateInspector(adapter, []);
            const adapterInstances = await inspector.getAdapterInstances();
            const referencedStates = new Set();

            const orphan = await inspector.checkOrphaned(
                'zigbee.0.sensor.temperature',
                adapter.foreignObjects['zigbee.0.sensor.temperature'],
                adapterInstances,
                referencedStates
            );

            assert.ok(orphan);
            assert.strictEqual(orphan.category, 'adapter_disabled');
        });

        it('should detect unreferenced state', async () => {
            const adapter = new MockAdapter();
            
            // Add state
            adapter.foreignStates['zigbee.0.sensor.temperature'] = { val: 20, ts: Date.now() };
            adapter.foreignObjects['zigbee.0.sensor.temperature'] = {
                common: { type: 'number', role: 'value' },
                ts: Date.now()
            };

            // Add adapter (enabled)
            adapter.foreignObjects['system.adapter.zigbee.0'] = {
                common: { enabled: true }
            };

            const inspector = new OrphanedStateInspector(adapter, []);
            const adapterInstances = await inspector.getAdapterInstances();
            const referencedStates = new Set(); // Empty - not referenced

            const orphan = await inspector.checkOrphaned(
                'zigbee.0.sensor.temperature',
                adapter.foreignObjects['zigbee.0.sensor.temperature'],
                adapterInstances,
                referencedStates
            );

            assert.ok(orphan);
            assert.strictEqual(orphan.category, 'unreferenced');
        });

        it('should not flag referenced state as orphaned', async () => {
            const adapter = new MockAdapter();
            
            // Add state
            adapter.foreignStates['zigbee.0.sensor.temperature'] = { val: 20, ts: Date.now() };
            adapter.foreignObjects['zigbee.0.sensor.temperature'] = {
                common: { type: 'number', role: 'value' },
                ts: Date.now()
            };

            // Add adapter (enabled)
            adapter.foreignObjects['system.adapter.zigbee.0'] = {
                common: { enabled: true }
            };

            const inspector = new OrphanedStateInspector(adapter, []);
            const adapterInstances = await inspector.getAdapterInstances();
            const referencedStates = new Set(['zigbee.0.sensor.temperature']); // Referenced

            const orphan = await inspector.checkOrphaned(
                'zigbee.0.sensor.temperature',
                adapter.foreignObjects['zigbee.0.sensor.temperature'],
                adapterInstances,
                referencedStates
            );

            assert.strictEqual(orphan, null);
        });
    });

    describe('inspection report', () => {
        it('should generate full inspection report', async () => {
            const adapter = new MockAdapter();
            
            // Add some orphaned states
            adapter.foreignStates['old-adapter.0.state1'] = { val: 1, ts: Date.now() };
            adapter.foreignStates['old-adapter.0.state2'] = { val: 2, ts: Date.now() };
            adapter.foreignObjects['old-adapter.0.state1'] = { common: { type: 'number', role: 'value' }, ts: Date.now() };
            adapter.foreignObjects['old-adapter.0.state2'] = { common: { type: 'number', role: 'value' }, ts: Date.now() };

            const inspector = new OrphanedStateInspector(adapter, []);
            await inspector.init();
            const report = await inspector.inspect();

            assert.ok(report.timestamp);
            assert.strictEqual(report.totalOrphaned, 2);
            assert.strictEqual(report.orphanedStates.length, 2);
            assert.ok(report.summary.byCategory);
            assert.ok(report.summary.byAdapter);
        });

        it('should categorize orphans correctly', async () => {
            const adapter = new MockAdapter();
            const inspector = new OrphanedStateInspector(adapter, []);

            inspector.orphanedStates = [
                { category: 'adapter_removed', adapter: 'zigbee.0' },
                { category: 'adapter_removed', adapter: 'modbus.0' },
                { category: 'adapter_disabled', adapter: 'mqtt.0' }
            ];

            const categories = inspector.categorizeOrphans();

            assert.strictEqual(categories.adapter_removed, 2);
            assert.strictEqual(categories.adapter_disabled, 1);
        });

        it('should group by adapter correctly', async () => {
            const adapter = new MockAdapter();
            const inspector = new OrphanedStateInspector(adapter, []);

            inspector.orphanedStates = [
                { adapter: 'zigbee.0' },
                { adapter: 'zigbee.0' },
                { adapter: 'modbus.0' }
            ];

            const grouped = inspector.groupByAdapter();

            assert.strictEqual(grouped['zigbee.0'], 2);
            assert.strictEqual(grouped['modbus.0'], 1);
        });
    });

    describe('cleanup suggestions', () => {
        it('should suggest safe deletions for removed adapters', () => {
            const adapter = new MockAdapter();
            const inspector = new OrphanedStateInspector(adapter, []);

            inspector.orphanedStates = [
                { id: 'old.0.state1', category: 'adapter_removed' },
                { id: 'disabled.0.state', category: 'adapter_disabled' },
                { id: 'active.0.state', category: 'unreferenced' }
            ];

            const suggestions = inspector.getCleanupSuggestions();

            assert.strictEqual(suggestions.safeToDelete.length, 1);
            assert.ok(suggestions.safeToDelete.includes('old.0.state1'));
            assert.strictEqual(suggestions.reviewRequired.length, 2);
        });
    });
});
