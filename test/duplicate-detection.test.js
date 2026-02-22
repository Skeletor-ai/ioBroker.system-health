const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const DuplicateStateInspector = require('../lib/state-inspector/duplicate-detection');

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
        
        // Support both calling styles:
        // setStateAsync(id, val, ack) and setStateAsync(id, { val, ack })
        if (typeof val === 'object' && val !== null && 'val' in val) {
            this.states[fullId] = { val: val.val, ack: val.ack };
        } else {
            this.states[fullId] = { val, ack };
        }
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
        return {};
    }
}

describe('DuplicateStateInspector', () => {
    describe('init', () => {
        it('should create required states', async () => {
            const adapter = new MockAdapter();
            const inspector = new DuplicateStateInspector(adapter);
            
            await inspector.init();

            assert.ok(adapter.objects['system-health.0.inspector.duplicates.report']);
            assert.ok(adapter.objects['system-health.0.inspector.duplicates.count']);
            assert.ok(adapter.objects['system-health.0.inspector.duplicates.lastScan']);
        });

        it('should accept custom similarity threshold', async () => {
            const adapter = new MockAdapter();
            const inspector = new DuplicateStateInspector(adapter, 0.8);
            
            assert.strictEqual(inspector.similarityThreshold, 0.8);
        });
    });

    describe('detectValueDuplicates', () => {
        it('should detect identical values across states', async () => {
            const adapter = new MockAdapter();
            const inspector = new DuplicateStateInspector(adapter);

            // Setup test data - same temperature value from two sensors
            const now = Date.now();
            const stateMap = new Map([
                ['hm-rpc.0.livingroom.temperature', {
                    id: 'hm-rpc.0.livingroom.temperature',
                    value: 21.5,
                    ts: now,
                    lc: now,
                    type: 'number',
                    role: 'value.temperature',
                    name: 'Living Room Temperature',
                    unit: '°C'
                }],
                ['zigbee.0.livingroom.temp', {
                    id: 'zigbee.0.livingroom.temp',
                    value: 21.5,
                    ts: now,
                    lc: now,
                    type: 'number',
                    role: 'value.temperature',
                    name: 'Living Room Temp',
                    unit: '°C'
                }]
            ]);

            const duplicates = inspector.detectValueDuplicates(stateMap);

            assert.strictEqual(duplicates.length, 1);
            assert.strictEqual(duplicates[0].type, 'value');
            assert.strictEqual(duplicates[0].value, 21.5);
            assert.strictEqual(duplicates[0].states.length, 2);
        });

        it('should not report single states as duplicates', async () => {
            const adapter = new MockAdapter();
            const inspector = new DuplicateStateInspector(adapter);

            const now = Date.now();
            const stateMap = new Map([
                ['hm-rpc.0.livingroom.temperature', {
                    id: 'hm-rpc.0.livingroom.temperature',
                    value: 21.5,
                    ts: now,
                    lc: now,
                    type: 'number',
                    role: 'value.temperature',
                    name: 'Living Room Temperature',
                    unit: '°C'
                }],
                ['hm-rpc.0.bedroom.temperature', {
                    id: 'hm-rpc.0.bedroom.temperature',
                    value: 19.0,
                    ts: now,
                    lc: now,
                    type: 'number',
                    role: 'value.temperature',
                    name: 'Bedroom Temperature',
                    unit: '°C'
                }]
            ]);

            const duplicates = inspector.detectValueDuplicates(stateMap);

            assert.strictEqual(duplicates.length, 0);
        });

        it('should skip system and admin states', async () => {
            const adapter = new MockAdapter();
            const inspector = new DuplicateStateInspector(adapter);

            const now = Date.now();
            const stateMap = new Map([
                ['system.adapter.admin.0.alive', {
                    id: 'system.adapter.admin.0.alive',
                    value: true,
                    ts: now,
                    lc: now,
                    type: 'boolean',
                    role: 'indicator.state',
                    name: 'Alive'
                }],
                ['admin.0.info.connection', {
                    id: 'admin.0.info.connection',
                    value: true,
                    ts: now,
                    lc: now,
                    type: 'boolean',
                    role: 'indicator.state',
                    name: 'Connection'
                }]
            ]);

            const duplicates = inspector.detectValueDuplicates(stateMap);

            assert.strictEqual(duplicates.length, 0);
        });

        it('should identify stale duplicates', async () => {
            const adapter = new MockAdapter();
            const inspector = new DuplicateStateInspector(adapter);

            const now = Date.now();
            const dayAgo = now - 25 * 60 * 60 * 1000; // 25 hours ago

            const stateMap = new Map([
                ['sensor.0.temp1', {
                    id: 'sensor.0.temp1',
                    value: 20.0,
                    ts: now,
                    lc: dayAgo,
                    type: 'number',
                    role: 'value.temperature',
                    name: 'Sensor 1',
                    unit: '°C'
                }],
                ['sensor.0.temp2', {
                    id: 'sensor.0.temp2',
                    value: 20.0,
                    ts: now,
                    lc: now,
                    type: 'number',
                    role: 'value.temperature',
                    name: 'Sensor 2',
                    unit: '°C'
                }]
            ]);

            const duplicates = inspector.detectValueDuplicates(stateMap);

            assert.strictEqual(duplicates.length, 1);
            assert.strictEqual(duplicates[0].states[0].isStale, true);
            assert.strictEqual(duplicates[0].states[1].isStale, false);
        });
    });

    describe('detectNamingDuplicates', () => {
        it('should detect similar naming patterns', async () => {
            const adapter = new MockAdapter();
            const inspector = new DuplicateStateInspector(adapter, 0.85);

            const now = Date.now();
            const stateMap = new Map([
                ['hm-rpc.0.device123.temperature', {
                    id: 'hm-rpc.0.device123.temperature',
                    value: 21.5,
                    ts: now,
                    lc: now,
                    type: 'number',
                    role: 'value.temperature',
                    name: 'Temperature'
                }],
                ['hm-rpc.0.device123.temperatur', {
                    id: 'hm-rpc.0.device123.temperatur',
                    value: 21.6,
                    ts: now,
                    lc: now,
                    type: 'number',
                    role: 'value.temperature',
                    name: 'Temperatur'
                }]
            ]);

            const duplicates = await inspector.detectNamingDuplicates(stateMap);

            assert.ok(duplicates.length > 0);
            assert.strictEqual(duplicates[0].type, 'naming');
        });

        it('should skip unrelated states', async () => {
            const adapter = new MockAdapter();
            const inspector = new DuplicateStateInspector(adapter, 0.9);

            const now = Date.now();
            const stateMap = new Map([
                ['hm-rpc.0.device1.temperature', {
                    id: 'hm-rpc.0.device1.temperature',
                    value: 21.5,
                    ts: now,
                    lc: now,
                    type: 'number',
                    role: 'value.temperature',
                    name: 'Temperature'
                }],
                ['zigbee.0.sensor9.humidity', {
                    id: 'zigbee.0.sensor9.humidity',
                    value: 60,
                    ts: now,
                    lc: now,
                    type: 'number',
                    role: 'value.humidity',
                    name: 'Humidity'
                }]
            ]);

            const duplicates = await inspector.detectNamingDuplicates(stateMap);

            assert.strictEqual(duplicates.length, 0);
        });
    });

    describe('levenshteinDistance', () => {
        it('should calculate edit distance correctly', () => {
            const adapter = new MockAdapter();
            const inspector = new DuplicateStateInspector(adapter);

            assert.strictEqual(inspector.levenshteinDistance('kitten', 'sitting'), 3);
            assert.strictEqual(inspector.levenshteinDistance('hello', 'hello'), 0);
            assert.strictEqual(inspector.levenshteinDistance('test', 'tent'), 1);
        });
    });

    describe('levenshteinSimilarity', () => {
        it('should return 1 for identical strings', () => {
            const adapter = new MockAdapter();
            const inspector = new DuplicateStateInspector(adapter);

            assert.strictEqual(inspector.levenshteinSimilarity('test', 'test'), 1);
        });

        it('should return value between 0 and 1 for different strings', () => {
            const adapter = new MockAdapter();
            const inspector = new DuplicateStateInspector(adapter);

            const similarity = inspector.levenshteinSimilarity('temperature', 'temp');
            assert.ok(similarity > 0 && similarity < 1);
        });
    });

    describe('extractCommonPattern', () => {
        it('should extract common prefix and suffix', () => {
            const adapter = new MockAdapter();
            const inspector = new DuplicateStateInspector(adapter);

            const ids = [
                'hm-rpc.0.device123.temperature',
                'hm-rpc.0.device123.temp',
                'hm-rpc.0.device123.temperatur'
            ];

            const pattern = inspector.extractCommonPattern(ids);
            assert.ok(pattern.includes('hm-rpc.0.device123'));
        });

        it('should handle single ID', () => {
            const adapter = new MockAdapter();
            const inspector = new DuplicateStateInspector(adapter);

            const pattern = inspector.extractCommonPattern(['test.state.id']);
            assert.strictEqual(pattern, 'test.state.id');
        });

        it('should handle empty array', () => {
            const adapter = new MockAdapter();
            const inspector = new DuplicateStateInspector(adapter);

            const pattern = inspector.extractCommonPattern([]);
            assert.strictEqual(pattern, '');
        });
    });

    describe('scan', () => {
        it('should run full scan and update states', async () => {
            const adapter = new MockAdapter();
            const inspector = new DuplicateStateInspector(adapter);

            // Setup test data
            const now = Date.now();
            adapter.foreignStates = {
                'sensor.0.temp1': { val: 20.0, ts: now, lc: now },
                'sensor.0.temp2': { val: 20.0, ts: now, lc: now }
            };
            adapter.foreignObjects = {
                'sensor.0.temp1': {
                    type: 'state',
                    common: { type: 'number', role: 'value.temperature', name: 'Temp 1', unit: '°C' }
                },
                'sensor.0.temp2': {
                    type: 'state',
                    common: { type: 'number', role: 'value.temperature', name: 'Temp 2', unit: '°C' }
                }
            };

            await inspector.init();
            const duplicates = await inspector.scan();

            // Should find value duplicates
            assert.ok(duplicates.length > 0);

            // Check if states were updated
            const countState = adapter.states['system-health.0.inspector.duplicates.count'];
            assert.ok(countState);
            assert.strictEqual(typeof countState.val, 'number');
            assert.ok(countState.val >= 0);
        });

        it('should handle empty object tree', async () => {
            const adapter = new MockAdapter();
            const inspector = new DuplicateStateInspector(adapter);

            adapter.foreignStates = {};
            adapter.foreignObjects = {};

            await inspector.init();
            const duplicates = await inspector.scan();

            assert.strictEqual(duplicates.length, 0);
        });
    });

    describe('mergeResults', () => {
        it('should merge non-overlapping results', () => {
            const adapter = new MockAdapter();
            const inspector = new DuplicateStateInspector(adapter);

            const valueDups = [{
                type: 'value',
                states: [
                    { id: 'state1' },
                    { id: 'state2' }
                ]
            }];

            const namingDups = [{
                type: 'naming',
                states: [
                    { id: 'state3' },
                    { id: 'state4' }
                ]
            }];

            const merged = inspector.mergeResults(valueDups, namingDups);

            assert.strictEqual(merged.length, 2);
        });

        it('should skip overlapping results', () => {
            const adapter = new MockAdapter();
            const inspector = new DuplicateStateInspector(adapter);

            const valueDups = [{
                type: 'value',
                states: [
                    { id: 'state1' },
                    { id: 'state2' }
                ]
            }];

            const namingDups = [{
                type: 'naming',
                states: [
                    { id: 'state1' },  // Overlap!
                    { id: 'state3' }
                ]
            }];

            const merged = inspector.mergeResults(valueDups, namingDups);

            assert.strictEqual(merged.length, 1);
        });
    });
});
