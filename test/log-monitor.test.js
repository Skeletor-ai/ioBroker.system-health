const { describe, it, mock, beforeEach } = require('node:test');
const assert = require('node:assert');
const LogMonitor = require('../lib/health-checks/log-monitor');

// Mock adapter
class MockAdapter {
    constructor() {
        this.namespace = 'system-health.0';
        this.host = 'test-host';
        this.log = {
            info: mock.fn(),
            warn: mock.fn(),
            error: mock.fn(),
            debug: mock.fn()
        };
        this.sendToHostAsync = mock.fn();
    }
}

describe('LogMonitor', () => {
    let adapter;
    let monitor;

    beforeEach(() => {
        adapter = new MockAdapter();
        monitor = new LogMonitor(adapter, {
            maxLogLines: 100,
            trackingWindowHours: 24,
        });
    });

    describe('parseSeverity', () => {
        describe('Standard ioBroker Format', () => {
            it('should detect "- error:" pattern', () => {
                const message = '2026-03-03 16:30:00.123  - error: javascript.0 (12345) Script error in script.common.Test';
                assert.strictEqual(monitor.parseSeverity(message), 'error');
            });

            it('should detect "- warn:" pattern', () => {
                const message = '2026-03-03 16:30:00.456  - warn: admin.0 Connection timeout';
                assert.strictEqual(monitor.parseSeverity(message), 'warn');
            });

            it('should detect "- warning:" pattern', () => {
                const message = '2026-03-03 16:30:00.789  - warning: influxdb.0 Database slow';
                assert.strictEqual(monitor.parseSeverity(message), 'warn');
            });
        });

        describe('Bracket Format', () => {
            it('should detect "[error]" pattern', () => {
                const message = '[ERROR] adapter.0 Critical failure';
                assert.strictEqual(monitor.parseSeverity(message), 'error');
            });

            it('should detect "[Error]" pattern (case insensitive)', () => {
                const message = '[Error] adapter.0 Critical failure';
                assert.strictEqual(monitor.parseSeverity(message), 'error');
            });

            it('should detect "[warn]" pattern', () => {
                const message = '[WARN] adapter.0 Memory usage high';
                assert.strictEqual(monitor.parseSeverity(message), 'warn');
            });

            it('should detect "[warning]" pattern', () => {
                const message = '[WARNING] adapter.0 Memory usage high';
                assert.strictEqual(monitor.parseSeverity(message), 'warn');
            });
        });

        describe('Inline Error Format', () => {
            it('should detect "error:" mid-message', () => {
                const message = 'adapter.0 error: connection refused';
                assert.strictEqual(monitor.parseSeverity(message), 'error');
            });

            it('should detect "warn:" mid-message', () => {
                const message = 'adapter.0 warn: retry attempt 3/5';
                assert.strictEqual(monitor.parseSeverity(message), 'warn');
            });
        });

        describe('No Match Cases', () => {
            it('should return null for info messages', () => {
                const message = '2026-03-03 16:30:00.123  - info: adapter.0 Started successfully';
                assert.strictEqual(monitor.parseSeverity(message), null);
            });

            it('should return null for debug messages', () => {
                const message = '2026-03-03 16:30:00.123  - debug: adapter.0 Debug info';
                assert.strictEqual(monitor.parseSeverity(message), null);
            });

            it('should return null for empty string', () => {
                assert.strictEqual(monitor.parseSeverity(''), null);
            });

            it('should not match "error" or "warn" in unrelated context', () => {
                // These should NOT be detected as errors/warnings:
                const falsePositives = [
                    'My terror is great',           // "error" is substring of "terror"
                    'I warned you yesterday',       // "warn" with suffix
                    'The warning light is on',      // "warning" in plain text
                ];
                
                falsePositives.forEach(msg => {
                    assert.strictEqual(monitor.parseSeverity(msg), null);
                });
            });
        });

        describe('Edge Cases', () => {
            it('should handle multiple error keywords (take first)', () => {
                const message = '- error: An error occurred with warning';
                assert.strictEqual(monitor.parseSeverity(message), 'error');
            });

            it('should handle ERROR in caps', () => {
                const message = '- ERROR: something bad';
                assert.strictEqual(monitor.parseSeverity(message), 'error');
            });

            it('should handle WARN in caps', () => {
                const message = '- WARN: something concerning';
                assert.strictEqual(monitor.parseSeverity(message), 'warn');
            });
        });
    });

    describe('extractInstance', () => {
        it('should extract adapter instance from standard format', () => {
            const message = '2024-02-25 16:13:00.123  - info: system.adapter.admin.0 (12345) Started';
            assert.strictEqual(monitor.extractInstance(message), 'admin.0');
        });

        it('should extract multi-digit instance number', () => {
            const message = 'system.adapter.javascript.15 Error occurred';
            assert.strictEqual(monitor.extractInstance(message), 'javascript.15');
        });

        it('should return null if no instance found', () => {
            const message = 'Generic error message without instance';
            assert.strictEqual(monitor.extractInstance(message), null);
        });
    });

    describe('classifyMessage', () => {
        it('should extract first meaningful word after severity', () => {
            const message = '2024-02-25 16:13:00.123  - error: Connection timeout';
            assert.strictEqual(monitor.classifyMessage(message), 'connection');
        });

        it('should skip common words', () => {
            const message = 'error: The connection was lost';
            assert.strictEqual(monitor.classifyMessage(message), 'connection');
        });

        it('should return "unknown" for empty message', () => {
            assert.strictEqual(monitor.classifyMessage('error:'), 'unknown');
        });
    });

    describe('processLogs', () => {
        it('should count errors and warnings correctly', () => {
            const logs = [
                { message: '- error: adapter.0 Test error 1', ts: Date.now() },
                { message: '- error: adapter.0 Test error 2', ts: Date.now() },
                { message: '- warn: adapter.0 Test warning', ts: Date.now() },
                { message: '- info: adapter.0 Test info', ts: Date.now() },
            ];

            const stats = monitor.processLogs(logs);
            assert.strictEqual(stats.totalErrors, 2);
            assert.strictEqual(stats.totalWarnings, 1);
        });

        it('should filter out old entries based on tracking window', () => {
            const now = Date.now();
            const oldTimestamp = now - (25 * 60 * 60 * 1000); // 25 hours ago (outside 24h window)

            const logs = [
                { message: '- error: adapter.0 Recent error', ts: now },
                { message: '- error: adapter.0 Old error', ts: oldTimestamp },
            ];

            const stats = monitor.processLogs(logs);
            assert.strictEqual(stats.totalErrors, 1); // Only the recent one
        });

        it('should handle missing message field', () => {
            const logs = [
                { message: '- error: adapter.0 Valid error', ts: Date.now() },
                { ts: Date.now() }, // Missing message
                null,               // Null entry
            ];

            const stats = monitor.processLogs(logs);
            assert.strictEqual(stats.totalErrors, 1);
        });
    });
});
