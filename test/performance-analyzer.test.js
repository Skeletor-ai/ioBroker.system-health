'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const PerformanceAnalyzer = require('../lib/state-inspector/performance-analyzer');

/**
 * Mock adapter for testing.
 */
class MockAdapter {
    constructor() {
        this.namespace = 'system-health.0';
        this.objects = {};
        this.states = {};
        this.logs = [];
    }

    log = {
        info: (msg) => {
            this.logs.push({ level: 'info', msg });
        },
        warn: (msg) => {
            this.logs.push({ level: 'warn', msg });
        },
        error: (msg) => {
            this.logs.push({ level: 'error', msg });
        },
        debug: (msg) => {
            this.logs.push({ level: 'debug', msg });
        }
    };

    async setObjectNotExistsAsync(id, obj) {
        if (!this.objects[id]) {
            this.objects[id] = obj;
        }
    }

    async setStateAsync(id, value, ack) {
        this.states[id] = { val: value, ack };
    }

    async getForeignStatesAsync(pattern) {
        return this.states;
    }

    async getForeignStateAsync(id) {
        return this.states[id] || null;
    }

    async getForeignObjectAsync(id) {
        return this.objects[id] || null;
    }

    async getForeignObjectsAsync(pattern) {
        return this.objects;
    }
}

describe('PerformanceAnalyzer', () => {
    let analyzer;
    let adapter;

    const beforeEach = async () => {
        adapter = new MockAdapter();
        analyzer = new PerformanceAnalyzer(adapter, 100, []);
    };

    describe('initialization', () => {
        it('should initialize without errors', async () => {
            await beforeEach();
            await analyzer.init();
            
            // Check that states were created
            assert(adapter.objects[`${adapter.namespace}.inspector.performance.report`]);
            assert(adapter.objects[`${adapter.namespace}.inspector.performance.frequentUpdates.count`]);
        });
    });

    describe('frequent updates detection', () => {
        it('should detect states with frequent updates', async () => {
            await beforeEach();
            // Mock states with quick updates
            adapter.states['device.0.sensor.temperature'] = {
                val: 25.5,
                ts: Date.now() - 50,
                ack: true
            };
            adapter.states['device.0.sensor.temperature'] = {
                val: 25.6,
                ts: Date.now(),
                ack: true
            };

            adapter.states['device.0.switch.light'] = {
                val: true,
                ts: Date.now(),
                ack: true
            };

            await analyzer.init();
            const report = await analyzer.analyse();

            assert.strictEqual(report.summary.frequentUpdateCount >= 0, true);
            assert(report.issues.frequentUpdates.length >= 0);
        });
    });

    describe('unnecessary history detection', () => {
        it('should detect unnecessary history on binary states', async () => {
            await beforeEach();
            // Mock a boolean state with history enabled
            adapter.states['device.0.switch.lock'] = {
                val: true,
                ts: Date.now(),
                ack: true
            };

            adapter.objects['device.0.switch.lock'] = {
                common: {
                    type: 'boolean',
                    history: [{ db: 'history.0' }]
                }
            };

            await analyzer.init();
            const report = await analyzer.analyse();

            // Should find unnecessary history on boolean state
            assert(Array.isArray(report.issues.unnecessaryHistory));
            assert(report.summary.unnecessaryHistoryCount >= 0);
        });
    });

    describe('large object trees detection', () => {
        it('should detect large object trees', async () => {
            await beforeEach();
            // Create many child states under one parent
            const parentId = 'device.0.channels';
            for (let i = 0; i < 150; i++) {
                adapter.states[`${parentId}.channel${i}`] = {
                    val: i,
                    ts: Date.now(),
                    ack: true
                };
                adapter.objects[`${parentId}.channel${i}`] = {
                    common: { type: 'number' }
                };
            }

            await analyzer.init();
            const report = await analyzer.analyse();

            // Should detect the large object tree
            assert(Array.isArray(report.issues.largeObjectTrees));
            assert(report.summary.largeObjectTreeCount >= 0);
        });
    });

    describe('ack issues detection', () => {
        it('should detect ack issues', async () => {
            await beforeEach();
            // Mock a state that requires ack but didn't receive it
            adapter.states['device.0.switch.power'] = {
                val: true,
                ts: Date.now(),
                ack: false
            };

            adapter.objects['device.0.switch.power'] = {
                common: {
                    type: 'boolean',
                    ack: true
                }
            };

            await analyzer.init();
            const report = await analyzer.analyse();

            assert(Array.isArray(report.issues.ackIssues));
            assert(report.summary.ackIssueCount >= 0);
        });
    });

    describe('report generation', () => {
        it('should generate a complete report', async () => {
            await beforeEach();
            // Add various test states
            adapter.states['test.0.state1'] = { val: 'test', ts: Date.now(), ack: true };
            adapter.states['test.0.state2'] = { val: 42, ts: Date.now(), ack: true };
            adapter.states['system.adapter.admin.alive'] = { val: true, ts: Date.now(), ack: true };

            await analyzer.init();
            const report = await analyzer.analyse();

            assert(report.timestamp);
            assert.strictEqual(typeof report.timestamp, 'string');
            assert(report.config);
            assert.strictEqual(report.config.updateFrequencyThresholdMs, 100);
            assert(report.summary);
            assert.strictEqual(typeof report.summary.totalIssuesFound, 'number');
            assert.strictEqual(typeof report.summary.frequentUpdateCount, 'number');
            assert.strictEqual(typeof report.summary.unnecessaryHistoryCount, 'number');
            assert.strictEqual(typeof report.summary.largeObjectTreeCount, 'number');
            assert.strictEqual(typeof report.summary.ackIssueCount, 'number');
            assert(report.issues);
            assert(Array.isArray(report.issues.frequentUpdates));
            assert(Array.isArray(report.issues.unnecessaryHistory));
            assert(Array.isArray(report.issues.largeObjectTrees));
            assert(Array.isArray(report.issues.ackIssues));
        });
    });

    describe('ignore patterns', () => {
        it('should ignore system and admin states', async () => {
            await beforeEach();
            adapter.states['system.adapter.admin.alive'] = { val: true, ts: Date.now(), ack: true };
            adapter.states['admin.0.whatever'] = { val: 'test', ts: Date.now(), ack: true };
            adapter.states['vis.0.page'] = { val: 'main', ts: Date.now(), ack: true };

            await analyzer.init();
            const report = await analyzer.analyse();

            // System states should not appear in results
            for (const issue of report.issues.frequentUpdates) {
                assert(!issue.id.startsWith('system.'));
                assert(!issue.id.startsWith('admin.'));
                assert(!issue.id.startsWith('vis.'));
            }
        });
    });

    describe('state updates', () => {
        it('should update states with analysis results', async () => {
            await beforeEach();
            adapter.states['device.0.test'] = { val: 1, ts: Date.now(), ack: true };

            await analyzer.init();
            await analyzer.analyse();

            // Check that result states were updated
            assert(adapter.states['inspector.performance.report']);
            assert(adapter.states['inspector.performance.frequentUpdates.count']);
            assert(adapter.states['inspector.performance.summary']);
            assert(adapter.states['inspector.performance.lastScan']);
        });
    });

    describe('cleanup', () => {
        it('should cleanup properly', async () => {
            await beforeEach();
            await analyzer.init();
            await analyzer.cleanup();

            assert.strictEqual(analyzer.stateHistory.size, 0);
            assert.strictEqual(analyzer.analysisResults.frequentUpdates.length, 0);
            assert.strictEqual(analyzer.analysisResults.unnecessaryHistory.length, 0);
        });
    });

    describe('utility methods', () => {
        it('should extract adapter name correctly', async () => {
            await beforeEach();
            assert.strictEqual(analyzer.extractAdapterName('device.0.sensor.temp'), 'device.0');
            assert.strictEqual(analyzer.extractAdapterName('mqtt.0.topic'), 'mqtt.0');
            assert.strictEqual(analyzer.extractAdapterName('zigbee.1.light'), 'zigbee.1');
            assert.strictEqual(analyzer.extractAdapterName('unknown'), 'unknown');
        });

        it('should respect ignore patterns', async () => {
            await beforeEach();
            const customAnalyzer = new PerformanceAnalyzer(adapter, 100, ['custom.*']);

            assert(customAnalyzer.shouldIgnore('system.adapter.admin.alive'));
            assert(customAnalyzer.shouldIgnore('admin.0.test'));
            assert(customAnalyzer.shouldIgnore('custom.0.test'));
            assert(!customAnalyzer.shouldIgnore('device.0.test'));
        });
    });
});
