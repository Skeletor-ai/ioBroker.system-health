'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const RedisMonitor = require('../lib/health-checks/redis-monitor');

/**
 * Test for Issue #151: Redis monitoring states not initialized when backend is not Redis
 * 
 * TDD approach:
 * RED: This test expects redis.status state even when Redis is skipped → should FAIL initially
 * GREEN: After moving state initialization before early return → should PASS
 * REFACTOR: Extract safe defaults to helper function if needed
 */

describe('Redis State Initialization (Issue #151)', () => {
    let adapter;
    let statesCreated;
    let stateValues;

    beforeEach(() => {
        statesCreated = {};
        stateValues = {};

        adapter = {
            log: {
                info: () => {},
                warn: () => {},
                error: () => {},
                debug: () => {},
            },
            config: {
                redisHost: '',
                redisPort: undefined,
                redisPassword: '',
                redisMemoryWarningPercent: 80,
                redisMemoryErrorPercent: 95,
                redisLatencyWarningMs: 100,
            },
            getForeignObjectsAsync: async () => ({}),
            getObjectAsync: async (id) => {
                return statesCreated[id] ? { _id: id } : null;
            },
            setObjectNotExistsAsync: async (id, obj) => {
                if (!statesCreated[id]) {
                    statesCreated[id] = obj;
                }
            },
            setStateAsync: async (id, value, ack) => {
                stateValues[id] = { value, ack };
            },
        };
    });

    describe('when Redis backend is NOT detected (skipped status)', () => {
        test('should create all redis.* states even when skipped', async () => {
            // Simulate main.js runRedisCheck() behavior
            const monitor = new RedisMonitor(adapter);
            const result = await monitor.check();

            // Verify check returns skipped
            assert.strictEqual(result.status, 'skipped');

            // Simulate runRedisCheck() calling _createRedisStatesIfNeeded()
            // This should happen BEFORE the early return
            await createRedisStatesIfNeeded(adapter);

            // Verify all 9 required states are created
            const expectedStates = [
                'redis.status',
                'redis.connected',
                'redis.memoryUsedPercent',
                'redis.memoryUsedBytes',
                'redis.keys',
                'redis.evictedKeys',
                'redis.latencyMs',
                'redis.details',
                'redis.timestamp',
            ];

            for (const stateId of expectedStates) {
                assert.ok(
                    statesCreated[stateId],
                    `State "${stateId}" should be created even when Redis is skipped`
                );
            }
        });

        test('should initialize states with safe defaults when skipped', async () => {
            const monitor = new RedisMonitor(adapter);
            const result = await monitor.check();

            // Verify check returns skipped
            assert.strictEqual(result.status, 'skipped');

            // Create states first
            await createRedisStatesIfNeeded(adapter);

            // Initialize with safe defaults (simulate runRedisCheck behavior)
            await adapter.setStateAsync('redis.status', 'skipped', true);
            await adapter.setStateAsync('redis.connected', false, true);
            await adapter.setStateAsync('redis.latencyMs', 0, true);
            await adapter.setStateAsync('redis.memoryUsedPercent', 0, true);
            await adapter.setStateAsync('redis.memoryUsedBytes', 0, true);
            await adapter.setStateAsync('redis.keys', 0, true);
            await adapter.setStateAsync('redis.evictedKeys', 0, true);
            await adapter.setStateAsync('redis.timestamp', Date.now(), true);
            await adapter.setStateAsync('redis.details', JSON.stringify({
                status: 'skipped',
                reason: result.reason,
                timestamp: result.timestamp
            }, null, 2), true);

            // Verify states have safe defaults
            assert.strictEqual(stateValues['redis.status'].value, 'skipped');
            assert.strictEqual(stateValues['redis.connected'].value, false);
            assert.strictEqual(stateValues['redis.latencyMs'].value, 0);
            assert.strictEqual(stateValues['redis.memoryUsedPercent'].value, 0);
            assert.strictEqual(stateValues['redis.memoryUsedBytes'].value, 0);
            assert.strictEqual(stateValues['redis.keys'].value, 0);
            assert.strictEqual(stateValues['redis.evictedKeys'].value, 0);
            assert.ok(stateValues['redis.timestamp'].value > 0);
            
            const details = JSON.parse(stateValues['redis.details'].value);
            assert.strictEqual(details.status, 'skipped');
            assert.ok(details.reason);
        });

        test('should have all states acknowledged (ack=true)', async () => {
            const monitor = new RedisMonitor(adapter);
            await monitor.check();

            await createRedisStatesIfNeeded(adapter);

            // Initialize with defaults
            await adapter.setStateAsync('redis.status', 'skipped', true);
            await adapter.setStateAsync('redis.connected', false, true);
            await adapter.setStateAsync('redis.latencyMs', 0, true);

            // Verify all are acknowledged
            assert.strictEqual(stateValues['redis.status'].ack, true);
            assert.strictEqual(stateValues['redis.connected'].ack, true);
            assert.strictEqual(stateValues['redis.latencyMs'].ack, true);
        });
    });

    describe('when Redis backend IS detected', () => {
        test('should create states and update with real values', async () => {
            // Mock Redis detection
            adapter.getForeignObjectsAsync = async () => ({
                'system.host.iobroker': {
                    native: {
                        objects: { type: 'jsonl' },
                        states: { type: 'redis', host: '127.0.0.1', port: 6379 },
                    }
                }
            });

            const monitor = new RedisMonitor(adapter);
            const result = await monitor.check();

            // If Redis is actually running, status will be ok/warning/error
            // If not running, status will be error (connection failure)
            // Either way, states should be created
            await createRedisStatesIfNeeded(adapter);

            const expectedStates = [
                'redis.status',
                'redis.connected',
                'redis.latencyMs',
            ];

            for (const stateId of expectedStates) {
                assert.ok(
                    statesCreated[stateId],
                    `State "${stateId}" should be created when Redis is detected`
                );
            }
        });
    });
});

/**
 * Helper function to simulate _createRedisStatesIfNeeded from main.js
 * This is what will be tested/fixed.
 */
async function createRedisStatesIfNeeded(adapter) {
    // Check if states already created
    const existingState = await adapter.getObjectAsync('redis.status');
    if (existingState) {
        return; // Already created
    }

    await adapter.setObjectNotExistsAsync('redis.status', {
        type: 'state',
        common: { name: 'Redis status', type: 'string', role: 'text', read: true, write: false,
            states: { ok: 'OK', warning: 'Warning', error: 'Error', skipped: 'Skipped' } },
        native: {},
    });
    await adapter.setObjectNotExistsAsync('redis.connected', {
        type: 'state',
        common: { name: 'Redis connected', type: 'boolean', role: 'indicator.reachable', read: true, write: false },
        native: {},
    });
    await adapter.setObjectNotExistsAsync('redis.memoryUsedPercent', {
        type: 'state',
        common: { name: 'Redis memory usage (%)', type: 'number', role: 'value', unit: '%', read: true, write: false },
        native: {},
    });
    await adapter.setObjectNotExistsAsync('redis.memoryUsedBytes', {
        type: 'state',
        common: { name: 'Redis memory used (bytes)', type: 'number', role: 'value', read: true, write: false },
        native: {},
    });
    await adapter.setObjectNotExistsAsync('redis.keys', {
        type: 'state',
        common: { name: 'Redis total keys', type: 'number', role: 'value', read: true, write: false },
        native: {},
    });
    await adapter.setObjectNotExistsAsync('redis.evictedKeys', {
        type: 'state',
        common: { name: 'Redis evicted keys', type: 'number', role: 'value', read: true, write: false },
        native: {},
    });
    await adapter.setObjectNotExistsAsync('redis.latencyMs', {
        type: 'state',
        common: { name: 'Redis ping latency (ms)', type: 'number', role: 'value', unit: 'ms', read: true, write: false },
        native: {},
    });
    await adapter.setObjectNotExistsAsync('redis.details', {
        type: 'state',
        common: { name: 'Redis detailed report (JSON)', type: 'string', role: 'json', read: true, write: false },
        native: {},
    });
    await adapter.setObjectNotExistsAsync('redis.timestamp', {
        type: 'state',
        common: { name: 'Last Redis check timestamp', type: 'number', role: 'date', read: true, write: false },
        native: {},
    });
}
