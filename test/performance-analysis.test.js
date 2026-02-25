'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const PerformanceAnalysisInspector = require('../lib/state-inspector/performance-analysis');

/**
 * Mock adapter for testing
 */
function createMockAdapter() {
    const states = new Map();
    const objects = new Map();
    const subscriptions = new Set();
    
    return {
        namespace: 'system-health.0',
        log: {
            info: () => {},
            warn: () => {},
            debug: () => {},
            error: () => {},
        },
        setObjectNotExistsAsync: async (id, obj) => {
            objects.set(id, obj);
        },
        setStateAsync: async (id, value, ack) => {
            states.set(id, { val: value, ack });
        },
        getStateAsync: async (id) => states.get(id),
        getForeignStatesAsync: async (pattern) => {
            const mockStates = {
                'mqtt.0.device.temp': { val: 20, ts: Date.now() - 50 },
                'mqtt.0.device.humidity': { val: 60, ts: Date.now() - 200000 },
                'influxdb.0.data.point1': { val: 100, ts: Date.now() - 10000000 },
                'system.adapter.mqtt.0.alive': { val: true, ts: Date.now() },
                'admin.0.info.version': { val: '1.0.0', ts: Date.now() }
            };
            return mockStates;
        },
        getForeignObjectsAsync: async (pattern, type) => {
            const mockObjects = {
                'mqtt.0.device.temp': {
                    _id: 'mqtt.0.device.temp',
                    type: 'state',
                    common: { name: 'Temperature', write: true, read: true }
                },
                'mqtt.0.device.humidity': {
                    _id: 'mqtt.0.device.humidity',
                    type: 'state',
                    common: { 
                        name: 'Humidity', 
                        write: true, 
                        read: true,
                        custom: {
                            'influxdb.0': { enabled: true }
                        }
                    }
                },
                'influxdb.0.data.point1': {
                    _id: 'influxdb.0.data.point1',
                    type: 'state',
                    common: { 
                        name: 'Data Point', 
                        write: true,
                        custom: {
                            'history.0': { enabled: true }
                        }
                    }
                }
            };
            return mockObjects;
        },
        subscribeForeignStatesAsync: async (pattern) => {
            subscriptions.add(pattern);
        },
        unsubscribeForeignStatesAsync: async (pattern) => {
            subscriptions.delete(pattern);
        },
        _stateChangeHandler: null,
        states,
        objects,
        subscriptions
    };
}

describe('PerformanceAnalysisInspector', () => {
    let adapter;
    let inspector;

    before(async () => {
        adapter = createMockAdapter();
        inspector = new PerformanceAnalysisInspector(adapter, {
            updateFrequencyThresholdMs: 100,
            largeTreeThreshold: 2,
            monitoringDurationMs: 100
        });
    });

    after(async () => {
        if (inspector) {
            await inspector.cleanup();
        }
    });

    describe('initialization', () => {
        it('should initialize without errors', async () => {
            await inspector.init();
            assert.ok(adapter.objects.size > 0, 'Should create state objects');
        });

        it('should create all required states', async () => {
            await inspector.init();
            const expectedStates = [
                'system-health.0.inspector.performance.report',
                'system-health.0.inspector.performance.highFrequencyCount',
                'system-health.0.inspector.performance.largeTreeCount',
                'system-health.0.inspector.performance.historyWasteCount',
                'system-health.0.inspector.performance.ackIssuesCount',
                'system-health.0.inspector.performance.lastScan'
            ];
            
            for (const stateId of expectedStates) {
                assert.ok(adapter.objects.has(stateId), `State ${stateId} should exist`);
            }
        });
    });

    describe('large object tree detection', () => {
        it('should detect adapters with many states', async () => {
            const largeAdapters = await inspector.analyzeLargeObjectTrees();
            
            // mqtt.0 has 2 states (temp + humidity), threshold is 2
            // Should flag adapters with > threshold
            assert.ok(Array.isArray(largeAdapters), 'Should return array');
        });
    });

    describe('history waste analysis', () => {
        it('should identify states with wasteful history usage', async () => {
            const historyWaste = await inspector.analyzeHistoryWaste();
            
            assert.ok(Array.isArray(historyWaste), 'Should return array');
            
            // influxdb.0.data.point1 hasn't changed in ~2.8 hours but has history enabled
            if (historyWaste.length > 0) {
                const waste = historyWaste[0];
                assert.ok(waste.id, 'Should have state ID');
                assert.ok(waste.adapter, 'Should have adapter ID');
                assert.ok(waste.recommendation, 'Should have recommendation');
            }
        });
    });

    describe('ignore patterns', () => {
        it('should respect ignore patterns', () => {
            assert.strictEqual(inspector.shouldIgnore('system.adapter.test.0'), true, 'Should ignore system.*');
            assert.strictEqual(inspector.shouldIgnore('admin.0.info'), true, 'Should ignore admin.*');
            assert.strictEqual(inspector.shouldIgnore('mqtt.0.device.temp'), false, 'Should not ignore mqtt.0');
        });
    });

    describe('monitoring and analysis', () => {
        it('should complete inspection without errors', async () => {
            await inspector.init();
            const report = await inspector.inspect();
            
            assert.ok(report, 'Should return report');
            assert.ok(report.timestamp, 'Report should have timestamp');
            assert.ok(Array.isArray(report.highFrequencyStates), 'Should have highFrequencyStates array');
            assert.ok(Array.isArray(report.largeObjectTrees), 'Should have largeObjectTrees array');
            assert.ok(Array.isArray(report.historyWaste), 'Should have historyWaste array');
            assert.ok(Array.isArray(report.ackIssues), 'Should have ackIssues array');
        });
    });

    describe('state updates', () => {
        it('should update inspector states after scan', async () => {
            await inspector.init();
            await inspector.inspect();
            
            const baseId = 'inspector.performance';
            assert.ok(adapter.states.has(`${baseId}.report`), 'Should update report state');
            assert.ok(adapter.states.has(`${baseId}.highFrequencyCount`), 'Should update highFrequencyCount');
            assert.ok(adapter.states.has(`${baseId}.largeTreeCount`), 'Should update largeTreeCount');
            assert.ok(adapter.states.has(`${baseId}.historyWasteCount`), 'Should update historyWasteCount');
            assert.ok(adapter.states.has(`${baseId}.ackIssuesCount`), 'Should update ackIssuesCount');
            assert.ok(adapter.states.has(`${baseId}.lastScan`), 'Should update lastScan');
        });
    });
});
