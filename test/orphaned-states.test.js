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
        if (pattern.startsWith('script.js.')) {
            // Return script objects
            const scripts = {};
            for (const [id, obj] of Object.entries(this.foreignObjects)) {
                if (id.startsWith('script.js.')) {
                    scripts[id] = obj;
                }
            }
            return scripts;
        }
        if (pattern.startsWith('vis.')) {
            // Return vis objects
            const visObjects = {};
            for (const [id, obj] of Object.entries(this.foreignObjects)) {
                if (id.startsWith('vis.')) {
                    visObjects[id] = obj;
                }
            }
            return visObjects;
        }
        if (pattern.startsWith('alias.0.')) {
            // Return alias objects
            const aliases = {};
            for (const [id, obj] of Object.entries(this.foreignObjects)) {
                if (id.startsWith('alias.0.')) {
                    aliases[id] = obj;
                }
            }
            return aliases;
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

        it('should ignore 0_userdata states by default', () => {
            const adapter = new MockAdapter();
            const inspector = new OrphanedStateInspector(adapter, []);

            assert.strictEqual(inspector.shouldIgnore('0_userdata.0.mydata'), true);
            assert.strictEqual(inspector.shouldIgnore('0_userdata.0.sensors.temperature'), true);
            assert.strictEqual(inspector.shouldIgnore('zigbee.0.state'), false);
        });

        it('should ignore alias states by default', () => {
            const adapter = new MockAdapter();
            const inspector = new OrphanedStateInspector(adapter, []);

            assert.strictEqual(inspector.shouldIgnore('alias.0.myAlias'), true);
            assert.strictEqual(inspector.shouldIgnore('alias.0.sensor.temperature'), true);
            assert.strictEqual(inspector.shouldIgnore('zigbee.0.state'), false);
        });

        it('should ignore own system-health states by default', () => {
            const adapter = new MockAdapter();
            const inspector = new OrphanedStateInspector(adapter, []);

            assert.strictEqual(inspector.shouldIgnore('system-health.0.logs.totalErrors'), true);
            assert.strictEqual(inspector.shouldIgnore('system-health.0.stateInspector.lastScan'), true);
            assert.strictEqual(inspector.shouldIgnore('system-health.0.inspector.orphanedStates.count'), true);
            assert.strictEqual(inspector.shouldIgnore('zigbee.0.state'), false);
        });
    });

    describe('reference extraction', () => {
        it('should extract state IDs from JavaScript code', () => {
            const adapter = new MockAdapter();
            const inspector = new OrphanedStateInspector(adapter, []);

            const source = `
                getState('zigbee.0.sensor.temperature');
                setState('mqtt.0.device.state', true);
                $('modbus.0.register.value').on(change => {});
            `;

            const references = inspector.extractStateReferences(source);

            assert.ok(references.has('zigbee.0.sensor.temperature'));
            assert.ok(references.has('mqtt.0.device.state'));
            assert.ok(references.has('modbus.0.register.value'));
        });

        it('should extract state IDs from vis config', () => {
            const adapter = new MockAdapter();
            const inspector = new OrphanedStateInspector(adapter, []);

            const visConfig = JSON.stringify({
                widgets: {
                    w1: { oid: 'zigbee.0.lamp.power' },
                    w2: { binding: 'mqtt.0.sensor.value' }
                }
            });

            const references = inspector.extractStateReferences(visConfig);

            assert.ok(references.has('zigbee.0.lamp.power'));
            assert.ok(references.has('mqtt.0.sensor.value'));
        });

        it('should not extract URLs as state IDs', () => {
            const adapter = new MockAdapter();
            const inspector = new OrphanedStateInspector(adapter, []);

            const source = `
                const url = 'https://example.com/api/v1.0/data';
                setState('mqtt.0.state', true);
            `;

            const references = inspector.extractStateReferences(source);

            assert.ok(references.has('mqtt.0.state'));
            assert.ok(!references.has('https://example.com/api/v1.0/data'));
        });
    });

    describe('usage pattern analysis', () => {
        it('should detect never-used states', async () => {
            const adapter = new MockAdapter();
            const inspector = new OrphanedStateInspector(adapter, []);

            const now = Date.now();
            const twoMonthsAgo = now - (60 * 24 * 60 * 60 * 1000);

            const allStates = {
                'old.0.state': {
                    val: 0,
                    lc: twoMonthsAgo,
                    ts: twoMonthsAgo
                }
            };

            const usageMap = await inspector.analyzeUsagePatterns(allStates);
            const usage = usageMap.get('old.0.state');

            assert.strictEqual(usage.neverUsed, true);
            assert.strictEqual(usage.recentlyRead, false);
            assert.strictEqual(usage.recentlyWritten, false);
        });

        it('should detect read-only states', async () => {
            const adapter = new MockAdapter();
            const inspector = new OrphanedStateInspector(adapter, []);

            const now = Date.now();
            const recentRead = now - (1 * 24 * 60 * 60 * 1000); // 1 day ago
            const oldWrite = now - (60 * 24 * 60 * 60 * 1000); // 2 months ago

            const allStates = {
                'sensor.0.value': {
                    val: 42,
                    lc: oldWrite,
                    ts: recentRead
                }
            };

            const usageMap = await inspector.analyzeUsagePatterns(allStates);
            const usage = usageMap.get('sensor.0.value');

            assert.strictEqual(usage.readOnly, true);
            assert.strictEqual(usage.recentlyRead, true);
            assert.strictEqual(usage.recentlyWritten, false);
        });

        it('should detect write-only states', async () => {
            const adapter = new MockAdapter();
            const inspector = new OrphanedStateInspector(adapter, []);

            const now = Date.now();
            const recentWrite = now - (1 * 24 * 60 * 60 * 1000); // 1 day ago
            const oldRead = now - (60 * 24 * 60 * 60 * 1000); // 2 months ago

            const allStates = {
                'actuator.0.command': {
                    val: 1,
                    lc: recentWrite,
                    ts: oldRead
                }
            };

            const usageMap = await inspector.analyzeUsagePatterns(allStates);
            const usage = usageMap.get('actuator.0.command');

            assert.strictEqual(usage.writeOnly, true);
            assert.strictEqual(usage.recentlyWritten, true);
            assert.strictEqual(usage.recentlyRead, false);
        });
    });

    describe('adapter instance detection', () => {
        it('should detect adapter removed', async () => {
            const adapter = new MockAdapter();
            
            // Add a state without corresponding adapter
            const now = Date.now();
            adapter.foreignStates['zigbee.0.sensor.temperature'] = { val: 20, ts: now, lc: now };
            adapter.foreignObjects['zigbee.0.sensor.temperature'] = {
                common: { type: 'number', role: 'value' },
                ts: now
            };

            const inspector = new OrphanedStateInspector(adapter, []);
            const adapterInstances = await inspector.getAdapterInstances();
            const referenceMap = new Map();
            const usageMap = new Map();
            usageMap.set('zigbee.0.sensor.temperature', { neverUsed: false, recentlyRead: true, recentlyWritten: true });

            const orphan = await inspector.checkOrphaned(
                'zigbee.0.sensor.temperature',
                adapter.foreignObjects['zigbee.0.sensor.temperature'],
                adapter.foreignStates['zigbee.0.sensor.temperature'],
                adapterInstances,
                referenceMap,
                usageMap
            );

            assert.ok(orphan);
            assert.strictEqual(orphan.category, 'adapter_removed');
            assert.strictEqual(orphan.adapter, 'zigbee.0');
        });

        it('should detect adapter disabled', async () => {
            const adapter = new MockAdapter();
            
            const now = Date.now();
            // Add state
            adapter.foreignStates['zigbee.0.sensor.temperature'] = { val: 20, ts: now, lc: now };
            adapter.foreignObjects['zigbee.0.sensor.temperature'] = {
                common: { type: 'number', role: 'value' },
                ts: now
            };

            // Add adapter but disabled
            adapter.foreignObjects['system.adapter.zigbee.0'] = {
                common: { enabled: false }
            };

            const inspector = new OrphanedStateInspector(adapter, []);
            const adapterInstances = await inspector.getAdapterInstances();
            const referenceMap = new Map();
            const usageMap = new Map();
            usageMap.set('zigbee.0.sensor.temperature', { neverUsed: false, recentlyRead: true, recentlyWritten: true });

            const orphan = await inspector.checkOrphaned(
                'zigbee.0.sensor.temperature',
                adapter.foreignObjects['zigbee.0.sensor.temperature'],
                adapter.foreignStates['zigbee.0.sensor.temperature'],
                adapterInstances,
                referenceMap,
                usageMap
            );

            assert.ok(orphan);
            assert.strictEqual(orphan.category, 'adapter_disabled');
        });

        it('should detect unreferenced unused state', async () => {
            const adapter = new MockAdapter();
            
            const now = Date.now();
            const oldTimestamp = now - (60 * 24 * 60 * 60 * 1000);
            
            // Add state
            adapter.foreignStates['zigbee.0.sensor.temperature'] = { val: 20, ts: oldTimestamp, lc: oldTimestamp };
            adapter.foreignObjects['zigbee.0.sensor.temperature'] = {
                common: { type: 'number', role: 'value' },
                ts: oldTimestamp
            };

            // Add adapter (enabled)
            adapter.foreignObjects['system.adapter.zigbee.0'] = {
                common: { enabled: true }
            };

            const inspector = new OrphanedStateInspector(adapter, []);
            const adapterInstances = await inspector.getAdapterInstances();
            const referenceMap = new Map(); // No references
            const usageMap = new Map();
            usageMap.set('zigbee.0.sensor.temperature', { neverUsed: true, recentlyRead: false, recentlyWritten: false });

            const orphan = await inspector.checkOrphaned(
                'zigbee.0.sensor.temperature',
                adapter.foreignObjects['zigbee.0.sensor.temperature'],
                adapter.foreignStates['zigbee.0.sensor.temperature'],
                adapterInstances,
                referenceMap,
                usageMap
            );

            assert.ok(orphan);
            assert.strictEqual(orphan.category, 'unreferenced_unused');
            assert.strictEqual(orphan.usage, 'never_used');
        });

        it('should not flag referenced state as orphaned', async () => {
            const adapter = new MockAdapter();
            
            const now = Date.now();
            // Add state
            adapter.foreignStates['zigbee.0.sensor.temperature'] = { val: 20, ts: now, lc: now };
            adapter.foreignObjects['zigbee.0.sensor.temperature'] = {
                common: { type: 'number', role: 'value' },
                ts: now
            };

            // Add adapter (enabled)
            adapter.foreignObjects['system.adapter.zigbee.0'] = {
                common: { enabled: true }
            };

            const inspector = new OrphanedStateInspector(adapter, []);
            const adapterInstances = await inspector.getAdapterInstances();
            const referenceMap = new Map();
            referenceMap.set('zigbee.0.sensor.temperature', ['script:script.js.0.test']);
            const usageMap = new Map();
            usageMap.set('zigbee.0.sensor.temperature', { neverUsed: false, recentlyRead: true, recentlyWritten: true });

            const orphan = await inspector.checkOrphaned(
                'zigbee.0.sensor.temperature',
                adapter.foreignObjects['zigbee.0.sensor.temperature'],
                adapter.foreignStates['zigbee.0.sensor.temperature'],
                adapterInstances,
                referenceMap,
                usageMap
            );

            assert.strictEqual(orphan, null);
        });

        it('should not flag unreferenced but active adapter state as orphaned', async () => {
            const adapter = new MockAdapter();
            
            const now = Date.now();
            // Add state (recently used)
            adapter.foreignStates['zigbee.0.sensor.temperature'] = { val: 20, ts: now, lc: now };
            adapter.foreignObjects['zigbee.0.sensor.temperature'] = {
                common: { type: 'number', role: 'value' },
                ts: now
            };

            // Add adapter (enabled)
            adapter.foreignObjects['system.adapter.zigbee.0'] = {
                common: { enabled: true }
            };

            const inspector = new OrphanedStateInspector(adapter, []);
            const adapterInstances = await inspector.getAdapterInstances();
            const referenceMap = new Map(); // No references
            const usageMap = new Map();
            usageMap.set('zigbee.0.sensor.temperature', { neverUsed: false, recentlyRead: true, recentlyWritten: true });

            const orphan = await inspector.checkOrphaned(
                'zigbee.0.sensor.temperature',
                adapter.foreignObjects['zigbee.0.sensor.temperature'],
                adapter.foreignStates['zigbee.0.sensor.temperature'],
                adapterInstances,
                referenceMap,
                usageMap
            );

            // Should NOT be reported as orphan if adapter is active
            assert.strictEqual(orphan, null);
        });
    });

    describe('reference map building', () => {
        it('should detect script references', async () => {
            const adapter = new MockAdapter();
            
            adapter.foreignObjects['script.js.0.myScript'] = {
                type: 'script',
                common: {
                    source: `
                        const temp = getState('zigbee.0.sensor.temperature');
                        setState('mqtt.0.status', 'online');
                    `
                }
            };

            const inspector = new OrphanedStateInspector(adapter, []);
            const referenceMap = await inspector.buildReferenceMap();

            assert.ok(referenceMap.has('zigbee.0.sensor.temperature'));
            assert.ok(referenceMap.has('mqtt.0.status'));
            assert.ok(referenceMap.get('zigbee.0.sensor.temperature').includes('script:script.js.0.myScript'));
        });

        it('should detect alias references', async () => {
            const adapter = new MockAdapter();
            
            adapter.foreignObjects['alias.0.myAlias'] = {
                type: 'state',
                common: {
                    alias: {
                        id: 'zigbee.0.lamp.power'
                    }
                }
            };

            const inspector = new OrphanedStateInspector(adapter, []);
            const referenceMap = await inspector.buildReferenceMap();

            assert.ok(referenceMap.has('zigbee.0.lamp.power'));
            assert.ok(referenceMap.get('zigbee.0.lamp.power').includes('alias:alias.0.myAlias'));
        });
    });

    describe('inspection report', () => {
        it('should generate full inspection report', async () => {
            const adapter = new MockAdapter();
            
            const now = Date.now();
            const oldTimestamp = now - (60 * 24 * 60 * 60 * 1000);
            
            // Add some orphaned states
            adapter.foreignStates['old-adapter.0.state1'] = { val: 1, ts: oldTimestamp, lc: oldTimestamp };
            adapter.foreignStates['old-adapter.0.state2'] = { val: 2, ts: oldTimestamp, lc: oldTimestamp };
            adapter.foreignObjects['old-adapter.0.state1'] = { common: { type: 'number', role: 'value' }, ts: oldTimestamp };
            adapter.foreignObjects['old-adapter.0.state2'] = { common: { type: 'number', role: 'value' }, ts: oldTimestamp };

            const inspector = new OrphanedStateInspector(adapter, []);
            await inspector.init();
            const report = await inspector.inspect();

            assert.ok(report.timestamp);
            assert.strictEqual(report.totalOrphaned, 2);
            assert.strictEqual(report.orphanedStates.length, 2);
            assert.ok(report.summary.byCategory);
            assert.ok(report.summary.byAdapter);
            assert.ok(report.summary.byUsage);
        });

        it('should categorize orphans correctly', async () => {
            const adapter = new MockAdapter();
            const inspector = new OrphanedStateInspector(adapter, []);

            inspector.orphanedStates = [
                { category: 'adapter_removed', adapter: 'zigbee.0', usage: 'never_used' },
                { category: 'adapter_removed', adapter: 'modbus.0', usage: 'never_used' },
                { category: 'adapter_disabled', adapter: 'mqtt.0', usage: 'active' }
            ];

            const categories = inspector.categorizeOrphans();

            assert.strictEqual(categories.adapter_removed, 2);
            assert.strictEqual(categories.adapter_disabled, 1);
        });

        it('should group by adapter correctly', async () => {
            const adapter = new MockAdapter();
            const inspector = new OrphanedStateInspector(adapter, []);

            inspector.orphanedStates = [
                { adapter: 'zigbee.0', usage: 'never_used' },
                { adapter: 'zigbee.0', usage: 'read_only' },
                { adapter: 'modbus.0', usage: 'never_used' }
            ];

            const grouped = inspector.groupByAdapter();

            assert.strictEqual(grouped['zigbee.0'], 2);
            assert.strictEqual(grouped['modbus.0'], 1);
        });

        it('should group by usage correctly', async () => {
            const adapter = new MockAdapter();
            const inspector = new OrphanedStateInspector(adapter, []);

            inspector.orphanedStates = [
                { adapter: 'zigbee.0', usage: 'never_used' },
                { adapter: 'modbus.0', usage: 'never_used' },
                { adapter: 'mqtt.0', usage: 'read_only' }
            ];

            const grouped = inspector.groupByUsage();

            assert.strictEqual(grouped.never_used, 2);
            assert.strictEqual(grouped.read_only, 1);
        });
    });

    describe('cleanup suggestions', () => {
        it('should suggest safe deletions for removed adapters with never-used states', () => {
            const adapter = new MockAdapter();
            const inspector = new OrphanedStateInspector(adapter, []);

            inspector.orphanedStates = [
                { id: 'old.0.state1', category: 'adapter_removed', reason: 'Adapter removed', adapter: 'old.0', usage: 'never_used' },
                { id: 'old.0.state2', category: 'adapter_removed', reason: 'Adapter removed', adapter: 'old.0', usage: 'active' },
                { id: 'disabled.0.state', category: 'adapter_disabled', reason: 'Adapter disabled', adapter: 'disabled.0', usage: 'active' },
                { id: 'active.0.state', category: 'unreferenced_unused', reason: 'Unreferenced and unused', adapter: 'active.0', usage: 'never_used' }
            ];

            const suggestions = inspector.getCleanupSuggestions();

            assert.strictEqual(suggestions.safeToDelete.length, 1);
            assert.strictEqual(suggestions.safeToDelete[0].id, 'old.0.state1');
            assert.strictEqual(suggestions.reviewRequired.length, 2);
            assert.strictEqual(suggestions.keepForNow.length, 1);
        });
    });
});
