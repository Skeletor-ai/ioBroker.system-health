const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

/**
 * Test: Inspector state initialization
 * 
 * These tests validate that main.js defines all required inspector.*
 * and stateInspector.* state objects and initializes them.
 * 
 * We use static analysis (grep) instead of runtime testing because
 * main.js requires @iobroker/adapter-core which is only available
 * in the ioBroker environment, not in test runs.
 */

const mainJsPath = path.join(__dirname, '..', 'main.js');
const mainJsContent = fs.readFileSync(mainJsPath, 'utf8');

/**
 * Helper: Check if a setObjectNotExistsAsync call exists for a state
 */
function hasObjectDefinition(stateId) {
    const regex = new RegExp(`await\\s+this\\.setObjectNotExistsAsync\\s*\\(\\s*['"\`]${stateId.replace(/\./g, '\\.')}['"\`]`, 'g');
    return regex.test(mainJsContent);
}

/**
 * Helper: Check if a setStateAsync call exists for a state with a specific default value
 */
function hasStateInitialization(stateId, defaultValue = null) {
    // Match: await this.setStateAsync('inspector.status', 'idle', true);
    // or:    await this.setStateAsync('inspector.duplicates.count', 0, true);
    const escapedId = stateId.replace(/\./g, '\\.');
    
    if (defaultValue === null) {
        // Just check if ANY initialization exists
        const regex = new RegExp(`await\\s+this\\.setStateAsync\\s*\\(\\s*['"\`]${escapedId}['"\`]`, 'g');
        return regex.test(mainJsContent);
    }
    
    // Check for specific value
    let valuePattern;
    if (typeof defaultValue === 'string') {
        valuePattern = `['"\`]${defaultValue}['"\`]`;
    } else if (typeof defaultValue === 'number') {
        valuePattern = defaultValue.toString();
    } else if (typeof defaultValue === 'boolean') {
        valuePattern = defaultValue.toString();
    } else {
        throw new Error(`Unsupported default value type: ${typeof defaultValue}`);
    }
    
    const regex = new RegExp(`await\\s+this\\.setStateAsync\\s*\\(\\s*['"\`]${escapedId}['"\`]\\s*,\\s*${valuePattern}\\s*,\\s*true`, 'g');
    return regex.test(mainJsContent);
}

test('inspector.duplicates.* states should be defined', () => {
    assert.ok(hasObjectDefinition('inspector.duplicates.report'), 'inspector.duplicates.report object should exist');
    assert.ok(hasObjectDefinition('inspector.duplicates.count'), 'inspector.duplicates.count object should exist');
    assert.ok(hasObjectDefinition('inspector.duplicates.lastScan'), 'inspector.duplicates.lastScan object should exist');
});

test('inspector.orphanedStates.* states should be defined', () => {
    assert.ok(hasObjectDefinition('inspector.orphanedStates.report'), 'inspector.orphanedStates.report object should exist');
    assert.ok(hasObjectDefinition('inspector.orphanedStates.count'), 'inspector.orphanedStates.count object should exist');
    assert.ok(hasObjectDefinition('inspector.orphanedStates.lastScan'), 'inspector.orphanedStates.lastScan object should exist');
});

test('inspector.staleStates.* states should be defined', () => {
    assert.ok(hasObjectDefinition('inspector.staleStates.report'), 'inspector.staleStates.report object should exist');
    assert.ok(hasObjectDefinition('inspector.staleStates.count'), 'inspector.staleStates.count object should exist');
    assert.ok(hasObjectDefinition('inspector.staleStates.lastScan'), 'inspector.staleStates.lastScan object should exist');
});

test('inspector.* top-level states should be defined', () => {
    assert.ok(hasObjectDefinition('inspector.status'), 'inspector.status object should exist');
    assert.ok(hasObjectDefinition('inspector.timestamp'), 'inspector.timestamp object should exist');
    assert.ok(hasObjectDefinition('inspector.lastScan'), 'inspector.lastScan object should exist');
});

test('inspector.* count states should be initialized to 0', () => {
    assert.ok(hasStateInitialization('inspector.duplicates.count', 0), 'inspector.duplicates.count should be initialized to 0');
    assert.ok(hasStateInitialization('inspector.orphanedStates.count', 0), 'inspector.orphanedStates.count should be initialized to 0');
    assert.ok(hasStateInitialization('inspector.staleStates.count', 0), 'inspector.staleStates.count should be initialized to 0');
});

test('inspector.status should be initialized to "idle"', () => {
    assert.ok(hasStateInitialization('inspector.status', 'idle'), 'inspector.status should be initialized to "idle"');
});

test('inspector.* report states should be initialized to empty string', () => {
    assert.ok(hasStateInitialization('inspector.duplicates.report', ''), 'inspector.duplicates.report should be initialized to ""');
    assert.ok(hasStateInitialization('inspector.orphanedStates.report', ''), 'inspector.orphanedStates.report should be initialized to ""');
    assert.ok(hasStateInitialization('inspector.staleStates.report', ''), 'inspector.staleStates.report should be initialized to ""');
});

test('stateInspector.* missing states should be defined', () => {
    assert.ok(hasObjectDefinition('stateInspector.report'), 'stateInspector.report object should exist');
    assert.ok(hasObjectDefinition('stateInspector.status'), 'stateInspector.status object should exist');
    assert.ok(hasObjectDefinition('stateInspector.history'), 'stateInspector.history object should exist');
    assert.ok(hasObjectDefinition('stateInspector.scanning'), 'stateInspector.scanning object should exist');
});

test('stateInspector.* missing states should be initialized', () => {
    assert.ok(hasStateInitialization('stateInspector.report', ''), 'stateInspector.report should be initialized to ""');
    assert.ok(hasStateInitialization('stateInspector.status', 'idle'), 'stateInspector.status should be initialized to "idle"');
    assert.ok(hasStateInitialization('stateInspector.history'), 'stateInspector.history should be initialized');
    assert.ok(hasStateInitialization('stateInspector.scanning', false), 'stateInspector.scanning should be initialized to false');
});
