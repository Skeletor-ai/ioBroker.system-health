'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Prevents the innerHTML + <script> bug from recurring.
 * Browsers do NOT execute <script> tags inserted via innerHTML (HTML5 spec).
 * Any function defined in such a script tag will be undefined at runtime.
 * 
 * If you need inline JS in dynamically rendered HTML, use:
 * - Inline onclick/onchange handlers
 * - Event delegation from a parent element
 * - Manual script injection via document.createElement('script')
 */
describe('No script tags in innerHTML/template strings', () => {
    const srcDir = path.join(__dirname, '..');
    const filesToCheck = [
        'main.js',
        ...fs.readdirSync(path.join(srcDir, 'lib', 'health-checks')).map(f => `lib/health-checks/${f}`),
        ...fs.readdirSync(path.join(srcDir, 'lib', 'state-inspector')).map(f => `lib/state-inspector/${f}`),
    ].filter(f => f.endsWith('.js'));

    for (const file of filesToCheck) {
        test(`${file} does not contain <script> in template strings`, () => {
            const content = fs.readFileSync(path.join(srcDir, file), 'utf8');

            // Look for <script> inside template literals or string concatenations
            // that would be used for innerHTML injection
            const scriptInTemplate = /<script[\s>]/i;
            const lines = content.split('\n');
            const violations = [];

            for (let i = 0; i < lines.length; i++) {
                if (scriptInTemplate.test(lines[i])) {
                    violations.push(`  Line ${i + 1}: ${lines[i].trim().substring(0, 100)}`);
                }
            }

            assert.strictEqual(violations.length, 0,
                `Found <script> tags in ${file} — these won't execute when set via innerHTML!\n` +
                `Use inline event handlers instead.\n${violations.join('\n')}`);
        });
    }
});
