const { describe, it } = require('node:test');
const assert = require('node:assert');
const { CrashCategory, classifyCrash } = require('../lib/health-checks/crash-classifier');

describe('CrashClassifier', () => {
    describe('classifyCrash', () => {
        it('should classify adapter bugs correctly', () => {
            const logs = [
                'Error: Uncaught exception in adapter.run()',
                'TypeError: Cannot read property \'foo\' of undefined'
            ];
            const result = classifyCrash(logs, 1);
            
            assert.strictEqual(result.category, CrashCategory.ADAPTER_ERROR);
            assert.ok(result.recommendation.includes('Update the adapter'));
        });

        it('should classify configuration errors', () => {
            const logs = [
                'Authentication failed: Invalid credentials',
                'Connection refused - check your configuration'
            ];
            const result = classifyCrash(logs, 1);
            
            assert.strictEqual(result.category, CrashCategory.CONFIG_ERROR);
            assert.ok(result.recommendation.includes('configuration'));
        });

        it('should classify device/network errors', () => {
            const logs = [
                'Error: ETIMEDOUT - connection timed out',
                'Device at 192.168.1.100 is not reachable'
            ];
            const result = classifyCrash(logs, 1);
            
            assert.strictEqual(result.category, CrashCategory.DEVICE_ERROR);
            assert.ok(result.recommendation.includes('unreachable'));
        });

        it('should handle empty logs gracefully', () => {
            const result = classifyCrash([], 1);
            
            assert.strictEqual(result.category, CrashCategory.UNKNOWN);
            assert.ok(result.recommendation.includes('Unable to determine'));
        });

        it('should classify SIGSEGV exit code', () => {
            const logs = ['Process terminated'];
            const result = classifyCrash(logs, 139);
            
            assert.strictEqual(result.category, CrashCategory.ADAPTER_ERROR);
            assert.ok(result.recommendation.includes('segmentation fault'));
        });

        it('should handle multiple error types in logs', () => {
            const logs = [
                'Starting adapter...',
                'Connection to device failed',
                'Error: ECONNREFUSED',
                'Adapter stopped'
            ];
            const result = classifyCrash(logs, 1);
            
            // Should match device error first (order matters)
            assert.strictEqual(result.category, CrashCategory.DEVICE_ERROR);
        });

        it('should return UNKNOWN for unrecognized patterns', () => {
            const logs = [
                'Something went wrong',
                'Process exited'
            ];
            const result = classifyCrash(logs, 0);
            
            assert.strictEqual(result.category, CrashCategory.UNKNOWN);
        });
    });
});
