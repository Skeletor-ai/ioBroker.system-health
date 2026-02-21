const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const MemoryMonitor = require('../lib/health-checks/memory-monitor');

// Mock adapter
const mockAdapter = {
    log: {
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
    },
};

describe('MemoryMonitor', () => {
    let monitor;

    beforeEach(() => {
        monitor = new MemoryMonitor(mockAdapter, {
            warningThresholdMB: 500,
            criticalThresholdPercent: 90,
            leakDetectionWindow: 5,
            leakGrowthThresholdMB: 10,
        });
    });

    describe('getMemoryStats', () => {
        it('should return memory statistics', () => {
            const stats = monitor.getMemoryStats();
            assert.ok(stats.totalMB > 0, 'Total memory should be positive');
            assert.ok(stats.usedMB >= 0, 'Used memory should be non-negative');
            assert.ok(stats.freeMB >= 0, 'Free memory should be non-negative');
            assert.ok(stats.usedPercent >= 0 && stats.usedPercent <= 100, 'Used percent should be 0-100');
            assert.ok(stats.timestamp > 0, 'Timestamp should be set');
        });
    });

    describe('check', () => {
        it('should return ok status when memory is normal', async () => {
            // Set very low threshold to ensure OK status (free memory will be above this)
            monitor.config.warningThresholdMB = 1;
            monitor.config.criticalThresholdPercent = 99;
            
            const result = await monitor.check();
            assert.strictEqual(result.status, 'ok');
            assert.ok(result.stats);
            assert.ok(Array.isArray(result.warnings));
            assert.ok(Array.isArray(result.critical));
        });

        it('should detect low free memory', async () => {
            // Configure very high threshold to trigger warning (free memory will be below this)
            monitor.config.warningThresholdMB = 999999;
            const result = await monitor.check();
            
            // Should have warning status if free memory < threshold (which it will be)
            if (result.stats.freeMB < 999999) {
                assert.strictEqual(result.status, 'warning');
                assert.ok(result.warnings.length > 0);
                assert.ok(result.warnings[0].includes('Free memory'));
            }
        });

        it('should store history', async () => {
            await monitor.check();
            await monitor.check();
            assert.strictEqual(monitor.history.length, 2);
        });

        it('should limit history to 100 samples', async () => {
            for (let i = 0; i < 110; i++) {
                await monitor.check();
            }
            assert.strictEqual(monitor.history.length, 100);
        });
    });

    describe('detectLeak', () => {
        it('should return null when insufficient data', () => {
            monitor.history = [
                { usedMB: 100, timestamp: 1000 },
                { usedMB: 110, timestamp: 2000 },
            ];
            const leak = monitor.detectLeak();
            assert.strictEqual(leak, null);
        });

        it('should detect consistent memory growth', () => {
            // Simulate consistent growth
            for (let i = 0; i < 10; i++) {
                monitor.history.push({
                    usedMB: 100 + i * 15, // Growing by 15 MB each time
                    timestamp: 1000 + i * 1000,
                });
            }

            const leak = monitor.detectLeak();
            assert.ok(leak, 'Should detect leak');
            assert.ok(leak.detected);
            assert.ok(leak.avgGrowthMB > monitor.config.leakGrowthThresholdMB);
        });

        it('should not detect leak with fluctuating memory', () => {
            // Simulate fluctuating memory (no leak)
            monitor.history = [
                { usedMB: 100, timestamp: 1000 },
                { usedMB: 95, timestamp: 2000 },
                { usedMB: 105, timestamp: 3000 },
                { usedMB: 98, timestamp: 4000 },
                { usedMB: 102, timestamp: 5000 },
                { usedMB: 97, timestamp: 6000 },
            ];

            const leak = monitor.detectLeak();
            assert.strictEqual(leak, null);
        });
    });

    describe('reset', () => {
        it('should clear history', async () => {
            await monitor.check();
            await monitor.check();
            assert.ok(monitor.history.length > 0);
            
            monitor.reset();
            assert.strictEqual(monitor.history.length, 0);
        });
    });

    describe('getTopProcesses', () => {
        it('should return array', async () => {
            const processes = await monitor.getTopProcesses();
            assert.ok(Array.isArray(processes));
        });
    });
});
