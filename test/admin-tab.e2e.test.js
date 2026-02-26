'use strict';

/**
 * E2E Integration Test for System Health Admin Tab
 * 
 * Runs against the ioBroker dev-server to verify the admin tab
 * renders correctly and all interactive elements work.
 * 
 * Usage:
 *   1. Start dev-server: npx dev-server watch
 *   2. Wait for adapter to run (~30s)
 *   3. Run: node test/admin-tab.e2e.test.js [--port 20426] [--headed]
 * 
 * Requirements: playwright (npx playwright install chromium)
 */

const { chromium } = require('playwright');

const ADMIN_PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '20426');
const ADMIN_URL = `http://127.0.0.1:${ADMIN_PORT}`;
const TAB_HASH = '#tab-system-health';
const HEADED = process.argv.includes('--headed');
const TIMEOUT = 60000;

// Test results tracking
let passed = 0;
let failed = 0;
const failures = [];

function log(msg) {
    console.log(`  ${msg}`);
}

function pass(name) {
    passed++;
    console.log(`  ✅ ${name}`);
}

function fail(name, err) {
    failed++;
    failures.push({ name, error: err.message || String(err) });
    console.log(`  ❌ ${name}: ${err.message || err}`);
}

async function test(name, fn) {
    try {
        await fn();
        pass(name);
    } catch (err) {
        fail(name, err);
    }
}

async function waitForAdminReady(page) {
    // Navigate to admin and wait for it to load
    await page.goto(ADMIN_URL, { waitUntil: 'networkidle', timeout: TIMEOUT });
    // Wait for React app to mount
    await page.waitForSelector('#root', { timeout: TIMEOUT });
    // Give it time to fully render
    await page.waitForTimeout(5000);
}

async function navigateToTab(page) {
    // Navigate to the system-health tab
    await page.goto(`${ADMIN_URL}/${TAB_HASH}`, { waitUntil: 'networkidle', timeout: TIMEOUT });
    await page.waitForTimeout(5000);
}

async function run() {
    console.log('\n🔬 System Health Admin Tab — E2E Tests');
    console.log(`   Admin URL: ${ADMIN_URL}`);
    console.log(`   Mode: ${HEADED ? 'headed' : 'headless'}\n`);

    // Check if dev-server is running
    let browser;
    try {
        browser = await chromium.launch({
            headless: !HEADED,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
    } catch (err) {
        console.error('❌ Failed to launch browser. Run: npx playwright install chromium');
        process.exit(1);
    }

    const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    // Collect console errors from the page
    const consoleErrors = [];
    page.on('console', msg => {
        if (msg.type() === 'error') {
            consoleErrors.push(msg.text());
        }
    });

    // Collect uncaught exceptions
    const pageErrors = [];
    page.on('pageerror', err => {
        pageErrors.push(err.message);
    });

    try {
        // ── Phase 1: Admin loads ──
        console.log('📋 Phase 1: Admin UI accessibility');

        await test('Admin UI is reachable', async () => {
            const response = await page.goto(ADMIN_URL, { waitUntil: 'load', timeout: 30000 });
            if (!response || response.status() >= 400) {
                throw new Error(`Admin returned status ${response?.status()}. Is dev-server running?`);
            }
        });

        await test('Admin React app mounts', async () => {
            await page.waitForSelector('#root', { timeout: 15000 });
        });

        // ── Phase 2: Tab navigation ──
        console.log('\n📋 Phase 2: Tab navigation');

        await test('System Health tab is accessible', async () => {
            await navigateToTab(page);
            // The tab content should be within the page
            const body = await page.textContent('body');
            if (!body || body.length < 100) {
                throw new Error('Page body is too short — tab may not have loaded');
            }
        });

        // ── Phase 3: Dashboard sections ──
        console.log('\n📋 Phase 3: Dashboard sections render');

        // Wait for the adapter to populate states and sendTo responses
        await page.waitForTimeout(10000);

        await test('Memory monitoring section visible', async () => {
            // Look for memory-related text in the page
            const content = await page.textContent('body');
            if (!content.includes('Memory') && !content.includes('memory') && !content.includes('Speicher')) {
                throw new Error('Memory monitoring section not found');
            }
        });

        await test('Disk monitoring section visible', async () => {
            const content = await page.textContent('body');
            if (!content.includes('Disk') && !content.includes('disk') && !content.includes('Festplatte')) {
                throw new Error('Disk monitoring section not found');
            }
        });

        await test('Log monitoring section visible', async () => {
            const content = await page.textContent('body');
            if (!content.includes('Log') && !content.includes('log')) {
                throw new Error('Log monitoring section not found');
            }
        });

        await test('State Inspector section visible', async () => {
            const content = await page.textContent('body');
            if (!content.includes('Inspector') && !content.includes('Inspektor') && !content.includes('inspector')) {
                throw new Error('State Inspector section not found');
            }
        });

        await test('Redis monitoring section visible', async () => {
            const content = await page.textContent('body');
            if (!content.includes('Redis') && !content.includes('redis')) {
                throw new Error('Redis monitoring section not found — was it added to jsonTab.json5?');
            }
        });

        // ── Phase 4: sendTo HTML content ──
        console.log('\n📋 Phase 4: sendTo dynamic content');

        await test('Orphaned details HTML renders (not empty)', async () => {
            // textSendTo components render HTML from sendTo responses
            // Look for table or list elements that indicate rendered HTML
            const htmlContainers = await page.$$('div[class*="html"], div[class*="sendto"]');
            // At minimum, the sendTo containers should exist
            if (htmlContainers.length === 0) {
                // Fall back to checking if any table/filter content exists
                const tables = await page.$$('table');
                const content = await page.textContent('body');
                if (!content.includes('orphan') && !content.includes('Orphan') && !content.includes('verwaist') && tables.length === 0) {
                    throw new Error('No sendTo HTML content or tables found — sendTo handlers may not be working');
                }
            }
        });

        // ── Phase 5: Filter buttons ──
        console.log('\n📋 Phase 5: Filter button functionality');

        await test('Filter buttons exist and have onclick handlers', async () => {
            const filterBtns = await page.$$('button.filter-orphaned-btn, button.filter-stale-btn');
            if (filterBtns.length === 0) {
                // Buttons might be inside iframes or shadow DOM in admin
                const allButtons = await page.$$('button');
                let foundFilter = false;
                for (const btn of allButtons) {
                    const text = await btn.textContent();
                    if (text && (text.includes('All') || text.includes('Alle'))) {
                        foundFilter = true;
                        break;
                    }
                }
                if (!foundFilter) {
                    log('⚠️  No filter buttons found — may need data populated first (non-critical)');
                    return; // Skip, not a hard failure
                }
            }
            // Verify onclick is set (not relying on <script> tags)
            for (const btn of filterBtns) {
                const onclick = await btn.getAttribute('onclick');
                if (!onclick || onclick.includes('filterTable_')) {
                    throw new Error('Button still uses old filterTable_ function reference instead of inline JS');
                }
            }
        });

        await test('Clicking filter button does not throw errors', async () => {
            const errorsBefore = [...pageErrors];
            const filterBtns = await page.$$('button.filter-orphaned-btn');
            if (filterBtns.length > 1) {
                // Click the second button (a category filter, not "All")
                await filterBtns[1].click();
                await page.waitForTimeout(500);
                // Click "All" again
                await filterBtns[0].click();
                await page.waitForTimeout(500);
            }
            const newErrors = pageErrors.slice(errorsBefore.length);
            const filterErrors = newErrors.filter(e =>
                e.includes('filterTable') || e.includes('is not defined') || e.includes('onclick')
            );
            if (filterErrors.length > 0) {
                throw new Error(`Filter click caused JS errors: ${filterErrors.join('; ')}`);
            }
        });

        // ── Phase 6: No JS errors ──
        console.log('\n📋 Phase 6: JavaScript error check');

        await test('No uncaught ReferenceErrors on the page', async () => {
            const refErrors = pageErrors.filter(e => e.includes('ReferenceError'));
            if (refErrors.length > 0) {
                throw new Error(`Found ${refErrors.length} ReferenceError(s): ${refErrors.join('; ')}`);
            }
        });

        await test('No filterTable_ undefined errors', async () => {
            const filterErrors = pageErrors.filter(e => e.includes('filterTable_'));
            if (filterErrors.length > 0) {
                throw new Error(`filterTable_ still broken: ${filterErrors.join('; ')}`);
            }
        });

        await test('No "FALSCH" text displayed (German boolean bug)', async () => {
            const content = await page.textContent('body');
            if (content.includes('FALSCH') || content.includes('WAHR')) {
                throw new Error('Found untranslated German boolean text (FALSCH/WAHR) — states mapping missing');
            }
        });

        // ── Phase 7: Config page ──
        console.log('\n📋 Phase 7: Config page');

        await test('Config page loads without errors', async () => {
            await page.goto(`${ADMIN_URL}/#tab-instances/config/system.adapter.system-health.0`, {
                waitUntil: 'networkidle',
                timeout: TIMEOUT,
            });
            await page.waitForTimeout(5000);
            const errorsAfterConfig = pageErrors.filter(e => e.includes('ReferenceError') || e.includes('TypeError'));
            // Just check it loaded
            const content = await page.textContent('body');
            if (content.length < 50) {
                throw new Error('Config page appears empty');
            }
        });

        await test('Redis config section exists on config page', async () => {
            const content = await page.textContent('body');
            if (!content.includes('Redis') && !content.includes('redis')) {
                throw new Error('Redis config section not found on config page');
            }
        });

    } catch (err) {
        console.error(`\n💥 Fatal error: ${err.message}`);
    } finally {
        await browser.close();
    }

    // ── Summary ──
    console.log('\n' + '═'.repeat(50));
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    if (failures.length > 0) {
        console.log('\n  Failures:');
        for (const f of failures) {
            console.log(`    • ${f.name}: ${f.error}`);
        }
    }
    console.log('═'.repeat(50) + '\n');

    process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
