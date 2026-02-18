const { describe, it, mock } = require('node:test');
const assert = require('node:assert');
const StaleStateDetector = require('../lib/health-checks/stale-state-detector');

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
        this.subscriptions = new Set();
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

    async getForeignStateAsync(id) {
        return this.foreignStates[id] || null;
    }

    async subscribeForeignStatesAsync(id) {
        this.subscriptions.add(id);
    }

    async unsubscribeForeignStatesAsync(id) {
        this.subscriptions.delete(id);
    }
}

describe('StaleStateDetector', () => {
    describe('initialization', () => {
        it('should initialize without errors', async () => {
            const adapter = new MockAdapter();
            const detector = new StaleStateDetector(adapter, []);
            
            await detector.createStates();

            assert.ok(adapter.objects['system-health.0.staleStates.list']);
            assert.ok(adapter.objects['system-health.0.staleStates.count']);
            assert.ok(adapter.objects['system-health.0.staleStates.hasStale']);
        });

        it('should subscribe to watched states', async () => {
            const adapter = new MockAdapter();
            const detector = new StaleStateDetector(adapter, [
                { id: 'test.0.state1', intervalSeconds: 60 },
                { id: 'test.0.state2', intervalSeconds: 120 }
            ]);

            await detector.subscribeToWatchedStates();

            assert.ok(adapter.subscriptions.has('test.0.state1'));
            assert.ok(adapter.subscriptions.has('test.0.state2'));
            assert.strictEqual(adapter.subscriptions.size, 2);
        });
    });

    describe('state change handling', () => {
        it('should update lastUpdate on state change', () => {
            const adapter = new MockAdapter();
            const detector = new StaleStateDetector(adapter, [
                { id: 'test.0.state1', intervalSeconds: 60 }
            ]);

            const now = Date.now();
            detector.onStateChange('test.0.state1', { val: 42, ts: now });

            const config = detector.watchedStates.get('test.0.state1');
            assert.strictEqual(config.lastUpdate, now);
            assert.strictEqual(config.isStale, false);
        });

        it('should ignore unknown states', () => {
            const adapter = new MockAdapter();
            const detector = new StaleStateDetector(adapter, [
                { id: 'test.0.state1', intervalSeconds: 60 }
            ]);

            // Should not throw
            detector.onStateChange('unknown.state', { val: 42, ts: Date.now() });
        });
    });

    describe('staleness detection', () => {
        it('should detect stale states', async () => {
            const adapter = new MockAdapter();
            const now = Date.now();
            const oldTimestamp = now - (120 * 1000); // 120 seconds ago

            const detector = new StaleStateDetector(adapter, [
                { id: 'test.0.state1', intervalSeconds: 60, gracePeriodSeconds: 10 }
            ]);

            // Set old lastUpdate
            detector.watchedStates.get('test.0.state1').lastUpdate = oldTimestamp;

            await detector.createStates();
            const staleStates = await detector.checkStaleness();

            assert.strictEqual(staleStates.length, 1);
            assert.strictEqual(staleStates[0].id, 'test.0.state1');
            assert.ok(staleStates[0].reason.includes('No update'));
        });

        it('should not flag fresh states as stale', async () => {
            const adapter = new MockAdapter();
            const now = Date.now();
            const recentTimestamp = now - (30 * 1000); // 30 seconds ago

            const detector = new StaleStateDetector(adapter, [
                { id: 'test.0.state1', intervalSeconds: 60, gracePeriodSeconds: 10 }
            ]);

            // Set recent lastUpdate
            detector.watchedStates.get('test.0.state1').lastUpdate = recentTimestamp;

            await detector.createStates();
            const staleStates = await detector.checkStaleness();

            assert.strictEqual(staleStates.length, 0);
        });

        it('should apply grace period correctly', async () => {
            const adapter = new MockAdapter();
            const now = Date.now();
            // 65 seconds ago = within grace period (60s interval + 10s grace = 70s total)
            const timestamp = now - (65 * 1000);

            const detector = new StaleStateDetector(adapter, [
                { id: 'test.0.state1', intervalSeconds: 60, gracePeriodSeconds: 10 }
            ]);

            detector.watchedStates.get('test.0.state1').lastUpdate = timestamp;

            await detector.createStates();
            const staleStates = await detector.checkStaleness();

            // Should NOT be stale (still within grace period)
            assert.strictEqual(staleStates.length, 0);
        });

        it('should flag never-updated states', async () => {
            const adapter = new MockAdapter();
            const detector = new StaleStateDetector(adapter, [
                { id: 'test.0.state1', intervalSeconds: 60, gracePeriodSeconds: 10 }
            ]);

            // lastUpdate is null
            await detector.createStates();
            const staleStates = await detector.checkStaleness();

            assert.strictEqual(staleStates.length, 1);
            assert.strictEqual(staleStates[0].reason, 'Never updated');
        });
    });

    describe('add/remove watched states', () => {
        it('should add a new watched state', async () => {
            const adapter = new MockAdapter();
            adapter.foreignStates['new.state'] = { val: 100, ts: Date.now() };

            const detector = new StaleStateDetector(adapter, []);

            await detector.addWatchedState('new.state', 120, 30);

            assert.ok(detector.watchedStates.has('new.state'));
            assert.ok(adapter.subscriptions.has('new.state'));

            const config = detector.watchedStates.get('new.state');
            assert.strictEqual(config.intervalSeconds, 120);
            assert.strictEqual(config.gracePeriodSeconds, 30);
        });

        it('should remove a watched state', async () => {
            const adapter = new MockAdapter();
            const detector = new StaleStateDetector(adapter, [
                { id: 'test.0.state1', intervalSeconds: 60 }
            ]);

            await detector.subscribeToWatchedStates();
            assert.ok(adapter.subscriptions.has('test.0.state1'));

            await detector.removeWatchedState('test.0.state1');

            assert.ok(!detector.watchedStates.has('test.0.state1'));
            assert.ok(!adapter.subscriptions.has('test.0.state1'));
        });
    });

    describe('getStatus', () => {
        it('should return stale state status', () => {
            const adapter = new MockAdapter();
            const detector = new StaleStateDetector(adapter, [
                { id: 'test.0.state1', intervalSeconds: 60 },
                { id: 'test.0.state2', intervalSeconds: 120 }
            ]);

            // Mark one as stale
            detector.watchedStates.get('test.0.state1').isStale = true;
            detector.watchedStates.get('test.0.state1').lastUpdate = Date.now() - 120000;

            const status = detector.getStatus();

            assert.strictEqual(status.staleCount, 1);
            assert.strictEqual(status.staleStates.length, 1);
            assert.strictEqual(status.staleStates[0].id, 'test.0.state1');
        });
    });

    describe('cleanup', () => {
        it('should unsubscribe from all states', async () => {
            const adapter = new MockAdapter();
            const detector = new StaleStateDetector(adapter, [
                { id: 'test.0.state1', intervalSeconds: 60 },
                { id: 'test.0.state2', intervalSeconds: 120 }
            ]);

            await detector.subscribeToWatchedStates();
            assert.strictEqual(adapter.subscriptions.size, 2);

            await detector.cleanup();
            assert.strictEqual(adapter.subscriptions.size, 0);
        });
    });
});
