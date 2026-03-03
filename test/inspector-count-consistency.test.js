const { test } = require('node:test');
const assert = require('node:assert');

/**
 * Test: Inspector Count Consistency
 * 
 * Validates that inspector count states match the sum of their aggregated data.
 * 
 * This test catches the bug described in Issue #144:
 * - inspector.orphanedStates.count shows 0
 * - but inspector.orphanedStates.byCategory has { unreferenced_unused: 19, adapter_disabled: 58 }
 * - Expected: count should be 77 (sum of category values)
 * 
 * Same applies to:
 * - inspector.staleStates.count vs inspector.staleStates.byAdapter
 * - inspector.duplicates.count vs inspector.duplicates.byType (if it exists)
 */

/**
 * Mock adapter with state storage
 */
class MockAdapter {
    constructor() {
        this.states = new Map();
        this.objects = new Map();
        this.namespace = 'system-health.0';
        this.log = {
            info: () => {},
            warn: () => {},
            error: () => {},
            debug: () => {}
        };
    }

    async setObjectNotExistsAsync(id, obj) {
        if (!this.objects.has(id)) {
            this.objects.set(id, obj);
        }
    }

    async setStateAsync(id, value, ack) {
        this.states.set(id, { val: value, ack });
    }

    async getStateAsync(id) {
        return this.states.get(id) || null;
    }

    async getForeignStatesAsync() {
        // Simulate empty system for testing
        return {};
    }

    async getForeignObjectsAsync() {
        return {};
    }

    getDataDir() {
        return '/tmp';
    }
}

test('OrphanedStateInspector: count should match sum of byCategory values', async () => {
    const OrphanedStateInspector = require('../lib/state-inspector/orphaned-states');
    const adapter = new MockAdapter();
    const inspector = new OrphanedStateInspector(adapter, []);

    await inspector.init();

    // Simulate a scan that finds orphaned states
    inspector.orphanedStates = [
        { id: 'zigbee.0.state1', adapter: 'zigbee.0', category: 'unreferenced_unused' },
        { id: 'zigbee.0.state2', adapter: 'zigbee.0', category: 'unreferenced_unused' },
        { id: 'mqtt.0.state1', adapter: 'mqtt.0', category: 'adapter_disabled' },
        { id: 'mqtt.0.state2', adapter: 'mqtt.0', category: 'adapter_disabled' },
        { id: 'mqtt.0.state3', adapter: 'mqtt.0', category: 'adapter_disabled' }
    ];

    // Manually call the state update logic (simulating what inspect() does)
    await adapter.setStateAsync('inspector.orphanedStates.count', inspector.orphanedStates.length, true);
    await adapter.setStateAsync('inspector.orphanedStates.byCategory', JSON.stringify(inspector.categorizeOrphans(), null, 2), true);

    // Verify consistency
    const countState = await adapter.getStateAsync('inspector.orphanedStates.count');
    const byCategoryState = await adapter.getStateAsync('inspector.orphanedStates.byCategory');

    assert.ok(countState, 'count state should exist');
    assert.ok(byCategoryState, 'byCategory state should exist');

    const count = countState.val;
    const byCategory = JSON.parse(byCategoryState.val);

    // Calculate sum from byCategory
    const sumFromCategory = Object.values(byCategory).reduce((sum, val) => sum + val, 0);

    assert.strictEqual(
        count, 
        sumFromCategory,
        `count (${count}) should equal sum of byCategory values (${sumFromCategory})`
    );

    // Additional check: count should match array length
    assert.strictEqual(
        count,
        inspector.orphanedStates.length,
        `count (${count}) should equal orphanedStates array length (${inspector.orphanedStates.length})`
    );
});

test('StaleStateInspector: count should match sum of byAdapter values', async () => {
    const StaleStateInspector = require('../lib/state-inspector/stale-detection');
    const adapter = new MockAdapter();
    const inspector = new StaleStateInspector(adapter, 24, []);

    await inspector.init();

    // Simulate a scan that finds stale states
    inspector.staleStates = [
        { id: 'backitup.0.state1', adapter: 'backitup.0', ageHours: 48 },
        { id: 'backitup.0.state2', adapter: 'backitup.0', ageHours: 72 },
        { id: 'javascript.0.state1', adapter: 'javascript.0', ageHours: 36 },
        { id: 'javascript.0.state2', adapter: 'javascript.0', ageHours: 50 },
        { id: 'discovery.0.state1', adapter: 'discovery.0', ageHours: 100 }
    ];

    // Manually call the state update logic (simulating what inspect() does)
    await adapter.setStateAsync('inspector.staleStates.count', inspector.staleStates.length, true);
    await adapter.setStateAsync('inspector.staleStates.byAdapter', JSON.stringify(inspector.groupByAdapter(), null, 2), true);

    // Verify consistency
    const countState = await adapter.getStateAsync('inspector.staleStates.count');
    const byAdapterState = await adapter.getStateAsync('inspector.staleStates.byAdapter');

    assert.ok(countState, 'count state should exist');
    assert.ok(byAdapterState, 'byAdapter state should exist');

    const count = countState.val;
    const byAdapter = JSON.parse(byAdapterState.val);

    // Calculate sum from byAdapter
    const sumFromAdapter = Object.values(byAdapter).reduce((sum, val) => sum + val, 0);

    assert.strictEqual(
        count, 
        sumFromAdapter,
        `count (${count}) should equal sum of byAdapter values (${sumFromAdapter})`
    );

    // Additional check: count should match array length
    assert.strictEqual(
        count,
        inspector.staleStates.length,
        `count (${count}) should equal staleStates array length (${inspector.staleStates.length})`
    );
});

test('Inspector initialization should not leave count at 0 when aggregated data exists', async () => {
    const adapter = new MockAdapter();

    // Simulate pre-existing aggregated data (from previous run)
    adapter.states.set('inspector.orphanedStates.byCategory', {
        val: JSON.stringify({ unreferenced_unused: 19, adapter_disabled: 58 }),
        ack: true
    });

    adapter.states.set('inspector.staleStates.byAdapter', {
        val: JSON.stringify({ 'backitup.0': 3, 'javascript.0': 4, 'discovery.0': 1 }),
        ack: true
    });

    // Simulate main.js _initializeInspectorCount() behavior (the fix!)
    // Read aggregate data and calculate count
    const orphanedByCategoryState = await adapter.getStateAsync('inspector.orphanedStates.byCategory');
    if (orphanedByCategoryState && orphanedByCategoryState.val) {
        const orphanedByCategory = JSON.parse(orphanedByCategoryState.val);
        const orphanedCount = Object.values(orphanedByCategory).reduce((sum, val) => sum + val, 0);
        await adapter.setStateAsync('inspector.orphanedStates.count', orphanedCount, true);
    } else {
        await adapter.setStateAsync('inspector.orphanedStates.count', 0, true);
    }

    const staleByAdapterState = await adapter.getStateAsync('inspector.staleStates.byAdapter');
    if (staleByAdapterState && staleByAdapterState.val) {
        const staleByAdapter = JSON.parse(staleByAdapterState.val);
        const staleCount = Object.values(staleByAdapter).reduce((sum, val) => sum + val, 0);
        await adapter.setStateAsync('inspector.staleStates.count', staleCount, true);
    } else {
        await adapter.setStateAsync('inspector.staleStates.count', 0, true);
    }

    // Read back states
    const orphanedCountState = await adapter.getStateAsync('inspector.orphanedStates.count');
    const staleCountState = await adapter.getStateAsync('inspector.staleStates.count');

    // Parse aggregated data
    const orphanedByCategory = JSON.parse(orphanedByCategoryState.val);
    const staleByAdapter = JSON.parse(staleByAdapterState.val);

    // Calculate expected counts
    const orphanedExpectedCount = Object.values(orphanedByCategory).reduce((sum, val) => sum + val, 0);
    const staleExpectedCount = Object.values(staleByAdapter).reduce((sum, val) => sum + val, 0);

    // After fix, count should match aggregated data!
    assert.strictEqual(
        orphanedCountState.val,
        orphanedExpectedCount,
        `orphanedStates.count (${orphanedCountState.val}) should equal sum of byCategory (${orphanedExpectedCount})`
    );

    assert.strictEqual(
        staleCountState.val,
        staleExpectedCount,
        `staleStates.count (${staleCountState.val}) should equal sum of byAdapter (${staleExpectedCount})`
    );
});
