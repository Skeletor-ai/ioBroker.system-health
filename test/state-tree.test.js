const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

// Mock adapter with the methods under test
class MockAdapterWithTreeMethods {
    constructor() {
        this.log = {
            info: () => {},
            warn: () => {},
            error: () => {},
            debug: () => {},
        };
    }

    /**
     * Build a hierarchical tree from flat state list.
     * @param {Array} states - Array of state objects with {id, reason}
     * @returns {object} Tree structure
     */
    buildStateTree(states) {
        const tree = {};
        
        for (const state of states) {
            const parts = state.id.split('.');
            let current = tree;
            
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                
                if (i === parts.length - 1) {
                    // Leaf node - store the state data
                    if (!current._leaves) current._leaves = [];
                    current._leaves.push(state);
                } else {
                    // Folder node
                    if (!current[part]) {
                        current[part] = {};
                    }
                    current = current[part];
                }
            }
        }
        
        return tree;
    }

    /**
     * Count total states in a tree (including all subtrees).
     * @param {object} tree - Tree structure
     * @returns {number} Total count
     */
    countStatesInTree(tree) {
        let count = (tree._leaves || []).length;
        for (const key of Object.keys(tree)) {
            if (key !== '_leaves') {
                count += this.countStatesInTree(tree[key]);
            }
        }
        return count;
    }

    /**
     * Render a state tree as collapsible HTML.
     * @param {object} tree - Tree structure from buildStateTree
     * @param {string} path - Current path (for display)
     * @param {string} lang - Language code
     * @param {number} depth - Current depth (for indentation)
     * @returns {string} HTML string
     */
    renderStateTree(tree, path, lang, depth = 0) {
        let html = '';
        const indent = depth * 20;
        const folders = Object.keys(tree).filter(k => k !== '_leaves').sort();
        const leaves = tree._leaves || [];

        // Render folders first
        for (const folder of folders) {
            const fullPath = path ? `${path}.${folder}` : folder;
            const count = this.countStatesInTree(tree[folder]);
            
            // Generate unique ID for collapse toggle
            const toggleId = `toggle_${fullPath.replace(/[^a-zA-Z0-9]/g, '_')}`;
            
            html += `<div style="margin-left:${indent}px;margin-top:4px;">`;
            html += `<div style="cursor:pointer;padding:4px;background:rgba(128,128,128,0.1);border-radius:3px;font-family:monospace;font-size:12px;" onclick="document.getElementById('${toggleId}').style.display = document.getElementById('${toggleId}').style.display === 'none' ? 'block' : 'none';">`;
            html += `<span style="display:inline-block;width:16px;">▶</span>`;
            html += `<strong>${this.escapeHtml(folder)}</strong>`;
            html += ` <span style="opacity:0.6;font-size:11px;">(${count})</span>`;
            html += `</div>`;
            html += `<div id="${toggleId}" style="display:none;">`;
            html += this.renderStateTree(tree[folder], fullPath, lang, depth + 1);
            html += `</div>`;
            html += `</div>`;
        }

        // Render leaf states
        if (leaves.length > 0) {
            html += '<div style="' + (depth > 0 ? `margin-left:${indent + 20}px;` : '') + 'margin-top:4px;">';
            for (const leaf of leaves) {
                const leafName = leaf.id.split('.').pop();
                html += `<div style="padding:4px;border-bottom:1px solid rgba(128,128,128,0.1);font-size:12px;">`;
                html += `<div style="font-family:monospace;font-weight:500;">${this.escapeHtml(leafName)}</div>`;
                html += `<div style="opacity:0.7;font-size:11px;margin-top:2px;">${this.escapeHtml(leaf.reason)}</div>`;
                html += `</div>`;
            }
            html += '</div>';
        }

        return html;
    }

    /**
     * Escape HTML special characters.
     * @param {string} str - String to escape
     * @returns {string} Escaped string
     */
    escapeHtml(str) {
        if (typeof str !== 'string') return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

describe('State Tree Methods', () => {
    let adapter;

    beforeEach(() => {
        adapter = new MockAdapterWithTreeMethods();
    });

    describe('buildStateTree', () => {
        it('should build a flat tree for single-level states', () => {
            const states = [
                { id: 'adapter1', reason: 'Test reason 1' },
                { id: 'adapter2', reason: 'Test reason 2' }
            ];

            const tree = adapter.buildStateTree(states);

            assert.ok(tree._leaves, 'Tree should have _leaves array');
            assert.strictEqual(tree._leaves.length, 2, 'Should have 2 leaf states');
            assert.strictEqual(tree._leaves[0].id, 'adapter1');
            assert.strictEqual(tree._leaves[1].id, 'adapter2');
        });

        it('should build nested tree for multi-level states', () => {
            const states = [
                { id: 'zigbee.0.device1.temperature', reason: 'Orphaned' },
                { id: 'zigbee.0.device1.humidity', reason: 'Orphaned' },
                { id: 'zigbee.0.device2.battery', reason: 'Orphaned' }
            ];

            const tree = adapter.buildStateTree(states);

            // Check structure
            assert.ok(tree.zigbee, 'Should have zigbee folder');
            assert.ok(tree.zigbee['0'], 'Should have instance 0');
            assert.ok(tree.zigbee['0'].device1, 'Should have device1 folder');
            assert.ok(tree.zigbee['0'].device2, 'Should have device2 folder');
            
            // Check leaves
            assert.strictEqual(tree.zigbee['0'].device1._leaves.length, 2, 'device1 should have 2 leaves');
            assert.strictEqual(tree.zigbee['0'].device2._leaves.length, 1, 'device2 should have 1 leaf');
            
            // Verify leaf content
            assert.strictEqual(tree.zigbee['0'].device1._leaves[0].id, 'zigbee.0.device1.temperature');
            assert.strictEqual(tree.zigbee['0'].device1._leaves[1].id, 'zigbee.0.device1.humidity');
        });

        it('should handle mixed depth states correctly', () => {
            const states = [
                { id: 'system.host.cpu', reason: 'System state' },
                { id: 'adapter.0.connection.status.online', reason: 'Deep nested' },
                { id: 'simple', reason: 'Top level' }
            ];

            const tree = adapter.buildStateTree(states);

            // Check all levels exist
            assert.ok(tree.system, 'Should have system folder');
            assert.ok(tree.adapter, 'Should have adapter folder');
            assert.ok(tree._leaves, 'Should have top-level leaves');
            
            // Verify deep nesting
            assert.ok(tree.adapter['0'].connection.status._leaves, 'Should reach deepest level');
            assert.strictEqual(tree.adapter['0'].connection.status._leaves[0].id, 'adapter.0.connection.status.online');
        });

        it('should handle empty state array', () => {
            const tree = adapter.buildStateTree([]);
            assert.deepStrictEqual(tree, {}, 'Empty array should return empty tree');
        });

        it('should preserve all state properties in leaves', () => {
            const states = [
                { 
                    id: 'test.0.state', 
                    reason: 'Test', 
                    adapter: 'test.0',
                    usage: 'never_used',
                    lastChange: '2025-01-01'
                }
            ];

            const tree = adapter.buildStateTree(states);
            const leaf = tree.test['0']._leaves[0];
            
            assert.strictEqual(leaf.reason, 'Test');
            assert.strictEqual(leaf.adapter, 'test.0');
            assert.strictEqual(leaf.usage, 'never_used');
            assert.strictEqual(leaf.lastChange, '2025-01-01');
        });
    });

    describe('countStatesInTree', () => {
        it('should count states in a flat tree', () => {
            const tree = {
                _leaves: [
                    { id: 'state1' },
                    { id: 'state2' }
                ]
            };

            const count = adapter.countStatesInTree(tree);
            assert.strictEqual(count, 2, 'Should count 2 states');
        });

        it('should count states recursively in nested tree', () => {
            const tree = {
                folder1: {
                    _leaves: [{ id: 'state1' }, { id: 'state2' }]
                },
                folder2: {
                    subfolder: {
                        _leaves: [{ id: 'state3' }]
                    },
                    _leaves: [{ id: 'state4' }]
                },
                _leaves: [{ id: 'state5' }]
            };

            const count = adapter.countStatesInTree(tree);
            assert.strictEqual(count, 5, 'Should count all 5 states across all levels');
        });

        it('should return 0 for empty tree', () => {
            const count = adapter.countStatesInTree({});
            assert.strictEqual(count, 0, 'Empty tree should have 0 states');
        });

        it('should return 0 for tree with folders but no leaves', () => {
            const tree = {
                folder1: {
                    subfolder: {}
                },
                folder2: {}
            };

            const count = adapter.countStatesInTree(tree);
            assert.strictEqual(count, 0, 'Tree without leaves should count as 0');
        });

        it('should count deeply nested states correctly', () => {
            const tree = {
                a: {
                    b: {
                        c: {
                            d: {
                                _leaves: [{ id: '1' }, { id: '2' }, { id: '3' }]
                            }
                        }
                    }
                }
            };

            const count = adapter.countStatesInTree(tree);
            assert.strictEqual(count, 3, 'Should count states at any depth');
        });
    });

    describe('renderStateTree', () => {
        it('should render simple tree with folders and leaves', () => {
            const states = [
                { id: 'zigbee.0.device1', reason: 'Adapter removed' }
            ];
            const tree = adapter.buildStateTree(states);
            const html = adapter.renderStateTree(tree, '', 'en');

            // Check for folder structure
            assert.ok(html.includes('zigbee'), 'Should contain zigbee folder');
            assert.ok(html.includes('toggle_zigbee'), 'Should have toggle ID');
            
            // Check for leaf rendering
            assert.ok(html.includes('device1'), 'Should contain device1 leaf');
            assert.ok(html.includes('Adapter removed'), 'Should contain reason text');
        });

        it('should generate unique toggle IDs for folders', () => {
            const states = [
                { id: 'adapter.0.test', reason: 'Test' }
            ];
            const tree = adapter.buildStateTree(states);
            const html = adapter.renderStateTree(tree, '', 'en');

            // Toggle ID should sanitize special characters
            assert.ok(html.includes('toggle_adapter'), 'Should have sanitized toggle ID for adapter');
            assert.ok(html.includes('toggle_adapter_0'), 'Should have sanitized toggle ID for instance');
        });

        it('should escape HTML in state IDs and reasons', () => {
            const states = [
                { id: 'test.0.state', reason: '<script>alert("XSS")</script>' }
            ];
            const tree = adapter.buildStateTree(states);
            const html = adapter.renderStateTree(tree, '', 'en');

            // Should NOT contain raw script tag
            assert.ok(!html.includes('<script>'), 'Should not contain unescaped script tag');
            assert.ok(html.includes('&lt;script&gt;'), 'Should contain escaped script tag');
        });

        it('should apply correct indentation for nested levels', () => {
            const states = [
                { id: 'a.b.c.state', reason: 'Deep state' }
            ];
            const tree = adapter.buildStateTree(states);
            const html = adapter.renderStateTree(tree, '', 'en', 0);

            // Check for increasing indentation
            assert.ok(html.includes('margin-left:0px'), 'Top level should have 0px indent');
            assert.ok(html.includes('margin-left:20px'), 'Second level should have 20px indent');
            assert.ok(html.includes('margin-left:40px'), 'Third level should have 40px indent');
        });

        it('should display state count in folder badges', () => {
            const states = [
                { id: 'zigbee.0.device1.temp', reason: 'Test 1' },
                { id: 'zigbee.0.device1.hum', reason: 'Test 2' },
                { id: 'zigbee.0.device2.bat', reason: 'Test 3' }
            ];
            const tree = adapter.buildStateTree(states);
            const html = adapter.renderStateTree(tree, '', 'en');

            // Should show count (3) for zigbee.0
            assert.ok(html.includes('(3)'), 'Should show total count for zigbee.0');
            // Should show count (2) for device1
            assert.ok(html.includes('(2)'), 'Should show count for device1');
        });

        it('should render collapsible folder elements', () => {
            const states = [
                { id: 'test.0.state', reason: 'Test' }
            ];
            const tree = adapter.buildStateTree(states);
            const html = adapter.renderStateTree(tree, '', 'en');

            // Check for collapse toggle mechanism
            assert.ok(html.includes('onclick='), 'Should have click handler');
            assert.ok(html.includes('display:none'), 'Folders should start collapsed');
            assert.ok(html.includes('cursor:pointer'), 'Folders should be clickable');
        });

        it('should return empty string for empty tree', () => {
            const html = adapter.renderStateTree({}, '', 'en');
            assert.strictEqual(html, '', 'Empty tree should produce empty HTML');
        });
    });

    describe('Integration: buildStateTree → renderStateTree', () => {
        it('should produce valid HTML for realistic orphaned states', () => {
            const states = [
                { id: 'zigbee.0.device1.temperature', reason: 'Adapter removed' },
                { id: 'zigbee.0.device1.humidity', reason: 'Adapter removed' },
                { id: 'zigbee.0.device2.battery', reason: 'Adapter disabled' },
                { id: 'modbus.0.holding.register1', reason: 'Never used' },
                { id: 'system.adapter.test.alive', reason: 'Orphaned' }
            ];

            const tree = adapter.buildStateTree(states);
            const html = adapter.renderStateTree(tree, '', 'en');

            // Verify all adapters are present
            assert.ok(html.includes('zigbee'), 'Should contain zigbee');
            assert.ok(html.includes('modbus'), 'Should contain modbus');
            assert.ok(html.includes('system'), 'Should contain system');
            
            // Verify folder structure
            assert.ok(html.includes('device1'), 'Should have device1 folder');
            assert.ok(html.includes('device2'), 'Should have device2 folder');
            
            // Verify leaf content
            assert.ok(html.includes('temperature'), 'Should show temperature state');
            assert.ok(html.includes('humidity'), 'Should show humidity state');
            assert.ok(html.includes('battery'), 'Should show battery state');
            
            // Verify reasons are shown
            assert.ok(html.includes('Adapter removed'), 'Should show removal reason');
            assert.ok(html.includes('Adapter disabled'), 'Should show disabled reason');
            assert.ok(html.includes('Never used'), 'Should show usage reason');
        });

        it('should handle states with special characters safely', () => {
            const states = [
                { id: 'test.0.state-with-dash', reason: 'Test & <test>' },
                { id: 'weird.name_with.special/chars', reason: 'Quote "test"' }
            ];

            const tree = adapter.buildStateTree(states);
            const html = adapter.renderStateTree(tree, '', 'en');

            // All special chars should be escaped
            assert.ok(!html.includes('<test>'), 'Should not have unescaped brackets');
            assert.ok(html.includes('&amp;'), 'Should escape ampersand');
            assert.ok(html.includes('&lt;'), 'Should escape less-than');
            assert.ok(html.includes('&quot;'), 'Should escape quotes');
        });
    });
});
