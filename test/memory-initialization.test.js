'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

describe('Memory state initialization wiring (static)', () => {
    const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

    test('defines all memory.* state objects', () => {
        const requiredObjects = [
            "setObjectNotExistsAsync('memory.totalMB'",
            "setObjectNotExistsAsync('memory.usedMB'",
            "setObjectNotExistsAsync('memory.freeMB'",
            "setObjectNotExistsAsync('memory.usedPercent'",
            "setObjectNotExistsAsync('memory.status'",
            "setObjectNotExistsAsync('memory.leakDetected'",
            "setObjectNotExistsAsync('memory.warnings'",
        ];

        for (const snippet of requiredObjects) {
            assert.ok(
                mainJs.includes(snippet),
                `Missing memory object definition snippet: ${snippet}`,
            );
        }
    });

    test('initializes all memory.* states on startup', () => {
        const requiredStateInits = [
            "setStateAsync('memory.totalMB', totalMemoryMB, true)",
            "setStateAsync('memory.usedMB', usedMemoryMB, true)",
            "setStateAsync('memory.freeMB', freeMemoryMB, true)",
            "setStateAsync('memory.usedPercent', usedMemoryPercent, true)",
            "setStateAsync('memory.status', memoryStatus, true)",
            "setStateAsync('memory.leakDetected', false, true)",
            "setStateAsync('memory.warnings', memoryWarnings.join('; '), true)",
        ];

        for (const snippet of requiredStateInits) {
            assert.ok(
                mainJs.includes(snippet),
                `Missing startup memory state init snippet: ${snippet}`,
            );
        }
    });

    test('has sensible default value logic', () => {
        assert.ok(mainJs.includes("let memoryStatus = 'ok';"), 'Expected default memoryStatus=ok');
        assert.ok(mainJs.includes("const memoryWarnings = [];"), 'Expected default memoryWarnings=[]');
        assert.ok(mainJs.includes("setStateAsync('memory.leakDetected', false, true)"), 'Expected default leakDetected=false');
    });
});
