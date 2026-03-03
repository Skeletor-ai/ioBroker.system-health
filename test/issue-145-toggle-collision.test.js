const test = require('node:test');
const assert = require('node:assert');

/**
 * Test for Issue 145: Cleanup folder toggle ID collisions
 * 
 * When rendering cleanup suggestions with overlapping folder names
 * across categories (safeToDelete, reviewRequired), HTML toggle IDs
 * must be unique to prevent collisions in JavaScript.
 */

class MockAdapter {
    buildStateTree(states) {
        const tree = {};
        for (const state of states) {
            const parts = state.id.split('.');
            let current = tree;
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (i === parts.length - 1) {
                    if (!current._leaves) current._leaves = [];
                    current._leaves.push(state);
                } else {
                    if (!current[part]) {
                        current[part] = {};
                    }
                    current = current[part];
                }
            }
        }
        return tree;
    }

    countStatesInTree(tree) {
        let count = (tree._leaves || []).length;
        for (const key of Object.keys(tree)) {
            if (key !== '_leaves') {
                count += this.countStatesInTree(tree[key]);
            }
        }
        return count;
    }

    renderStateTree(tree, path, depth, category) {
        let html = '';
        const folders = Object.keys(tree).filter(k => k !== '_leaves').sort();
        const leaves = tree._leaves || [];

        for (const folder of folders) {
            const fullPath = path ? `${path}.${folder}` : folder;
            const count = this.countStatesInTree(tree[folder]);
            const categoryPrefix = category ? `${category}_` : '';
            const toggleId = `toggle_${categoryPrefix}${fullPath.replace(/[^a-zA-Z0-9]/g, '_')}`;
            
            html += `<div data-toggle-id="${toggleId}">`;
            html += folder;
            html += this.renderStateTree(tree[folder], fullPath, depth + 1, category);
            html += '</div>';
        }

        if (leaves.length > 0) {
            for (const leaf of leaves) {
                const leafName = leaf.id.split('.').pop();
                html += `<span data-leaf="${leafName}">`;
                html += leafName;
                html += '</span>';
            }
        }

        return html;
    }
}

test('Issue 145: Toggle ID Collisions in Cleanup Suggestions', async (t) => {
    await t.test('should generate unique toggle IDs when same folder appears in both categories', () => {
        const adapter = new MockAdapter();
        
        const safeToDelete = [
            { id: 'javascript.0.a', reason: 'Old' },
            { id: 'javascript.0.b', reason: 'Dead' }
        ];
        
        const reviewRequired = [
            { id: 'javascript.0.c', reason: 'Unclear' },
            { id: 'javascript.0.d', reason: 'Maybe used' }
        ];

        const safeTree = adapter.buildStateTree(safeToDelete);
        const reviewTree = adapter.buildStateTree(reviewRequired);

        const safeHtml = adapter.renderStateTree(safeTree, '', 0, 'safeToDelete');
        const reviewHtml = adapter.renderStateTree(reviewTree, '', 0, 'reviewRequired');

        assert.match(safeHtml, /toggle_safeToDelete_javascript_0/);
        assert.match(reviewHtml, /toggle_reviewRequired_javascript_0/);
        
        assert.ok(!safeHtml.includes('toggle_reviewRequired_javascript_0'));
        assert.ok(!reviewHtml.includes('toggle_safeToDelete_javascript_0'));
    });

    await t.test('side-by-side rendering produces unique toggle IDs', () => {
        const adapter = new MockAdapter();
        
        const safeToDelete = [
            { id: 'javascript.0.a', reason: 'Old' }
        ];
        
        const reviewRequired = [
            { id: 'javascript.0.b', reason: 'Unclear' }
        ];

        const safeTree = adapter.buildStateTree(safeToDelete);
        const reviewTree = adapter.buildStateTree(reviewRequired);

        let page = '<div id="safe">';
        page += adapter.renderStateTree(safeTree, '', 0, 'safeToDelete');
        page += '</div><div id="review">';
        page += adapter.renderStateTree(reviewTree, '', 0, 'reviewRequired');
        page += '</div>';

        // Key assertion: different categories should have DIFFERENT toggle ID prefixes
        assert.ok(page.includes('toggle_safeToDelete_'), 'Safe-to-delete should have category prefix');
        assert.ok(page.includes('toggle_reviewRequired_'), 'Review-required should have category prefix');
        
        // Verify they are NOT interchanged
        assert.ok(!page.match(/toggle_reviewRequired_javascript_0.*toggle_safeToDelete/), 
            'Categories should not be intermixed in same tree');
    });
});
