'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const LogMonitor = require('../lib/health-checks/log-monitor');

describe('LogMonitor', () => {
    let adapter;
    let monitor;

    beforeEach(() => {
        adapter = {
            log: {
                info: () => {},
                warn: () => {},
                error: () => {},
            },
            host: 'testhost',
            sendToHostAsync: async () => [],
        };
        monitor = new LogMonitor(adapter);
    });

    describe('parseSeverity', () => {
        test('should detect error messages', () => {
            assert.strictEqual(monitor.parseSeverity('2024-02-25 16:13:00 - error: Something failed'), 'error');
            assert.strictEqual(monitor.parseSeverity('[ERROR] Database connection lost'), 'error');
            assert.strictEqual(monitor.parseSeverity('Error: Cannot read property'), 'error');
        });

        test('should detect warning messages', () => {
            assert.strictEqual(monitor.parseSeverity('2024-02-25 16:13:00 - warn: Connection slow'), 'warn');
            assert.strictEqual(monitor.parseSeverity('[WARN] Retry attempt 3'), 'warn');
            assert.strictEqual(monitor.parseSeverity('Warn: Configuration incomplete'), 'warn');
        });

        test('should return null for info/debug messages', () => {
            assert.strictEqual(monitor.parseSeverity('2024-02-25 16:13:00 - info: Started successfully'), null);
            assert.strictEqual(monitor.parseSeverity('[DEBUG] Processing data'), null);
        });
    });

    describe('extractInstance', () => {
        test('should extract adapter instance from log message', () => {
            const msg = '2024-02-25 16:13:00 - info: system.adapter.admin.0 (12345) Started';
            assert.strictEqual(monitor.extractInstance(msg), 'admin.0');
        });

        test('should extract instance with hyphen in adapter name', () => {
            const msg = 'system.adapter.system-health.0 Something happened';
            assert.strictEqual(monitor.extractInstance(msg), 'system-health.0');
        });

        test('should return null if no instance found', () => {
            assert.strictEqual(monitor.extractInstance('Generic error message'), null);
        });
    });

    describe('classifyMessage', () => {
        test('should extract first meaningful word', () => {
            assert.strictEqual(monitor.classifyMessage('Error: Connection timeout'), 'connection');
            assert.strictEqual(monitor.classifyMessage('warn: The database is slow'), 'database');
        });

        test('should skip common words', () => {
            assert.strictEqual(monitor.classifyMessage('Error: A connection was lost'), 'connection');
        });

        test('should return "unknown" for empty or uninformative messages', () => {
            assert.strictEqual(monitor.classifyMessage('Error: '), 'unknown');
            assert.strictEqual(monitor.classifyMessage('warn:'), 'unknown');
        });
    });

    describe('processLogs', () => {
        test('should count errors and warnings per instance', () => {
            const logs = [
                { message: 'system.adapter.admin.0 - error: Connection failed', ts: Date.now() },
                { message: 'system.adapter.admin.0 - warn: Retry attempt', ts: Date.now() },
                { message: 'system.adapter.javascript.0 - error: Script error', ts: Date.now() },
                { message: 'system.adapter.admin.0 - error: Connection failed', ts: Date.now() },
            ];

            const stats = monitor.processLogs(logs);

            assert.strictEqual(stats.totalErrors, 3);
            assert.strictEqual(stats.totalWarnings, 1);
            assert.strictEqual(stats.byInstance.size, 2);

            const adminStats = stats.byInstance.get('admin.0');
            assert.strictEqual(adminStats.totalErrors, 2);
            assert.strictEqual(adminStats.totalWarnings, 1);
        });

        test('should filter out old log entries', () => {
            const now = Date.now();
            const twoHoursAgo = now - 2 * 60 * 60 * 1000;
            const twoDaysAgo = now - 48 * 60 * 60 * 1000;

            const logs = [
                { message: 'system.adapter.admin.0 - error: Recent error', ts: twoHoursAgo },
                { message: 'system.adapter.admin.0 - error: Old error', ts: twoDaysAgo },
            ];

            const stats = monitor.processLogs(logs);

            assert.strictEqual(stats.totalErrors, 1);
        });

        test('should group errors by classification', () => {
            const logs = [
                { message: 'system.adapter.admin.0 - error: Connection timeout', ts: Date.now() },
                { message: 'system.adapter.admin.0 - error: Connection lost', ts: Date.now() },
                { message: 'system.adapter.admin.0 - error: Database error', ts: Date.now() },
            ];

            const stats = monitor.processLogs(logs);
            const adminStats = stats.byInstance.get('admin.0');

            assert.strictEqual(adminStats.errors.get('connection'), 2);
            assert.strictEqual(adminStats.errors.get('database'), 1);
        });
    });

    describe('getTopTypes', () => {
        test('should return top N types sorted by count', () => {
            const typeMap = new Map([
                ['connection', 10],
                ['database', 5],
                ['timeout', 8],
                ['syntax', 2],
            ]);

            const top3 = monitor.getTopTypes(typeMap, 3);

            assert.strictEqual(top3.length, 3);
            assert.strictEqual(top3[0].type, 'connection');
            assert.strictEqual(top3[0].count, 10);
            assert.strictEqual(top3[1].type, 'timeout');
            assert.strictEqual(top3[1].count, 8);
            assert.strictEqual(top3[2].type, 'database');
            assert.strictEqual(top3[2].count, 5);
        });
    });

    describe('check', () => {
        test('should return ok status when no errors/warnings found', async () => {
            adapter.sendToHostAsync = async () => [
                { message: 'system.adapter.admin.0 - info: Started', ts: Date.now() },
            ];

            const result = await monitor.check();

            assert.strictEqual(result.status, 'ok');
            assert.strictEqual(result.summary.totalErrors, 0);
            assert.strictEqual(result.summary.totalWarnings, 0);
        });

        test('should return warning status when errors are found', async () => {
            adapter.sendToHostAsync = async () => [
                { message: 'system.adapter.admin.0 - error: Failed', ts: Date.now() },
            ];

            const result = await monitor.check();

            assert.strictEqual(result.status, 'warning');
            assert.strictEqual(result.summary.totalErrors, 1);
        });

        test('should sort instances by total issues', async () => {
            adapter.sendToHostAsync = async () => [
                { message: 'system.adapter.admin.0 - error: E1', ts: Date.now() },
                { message: 'system.adapter.javascript.0 - error: E2', ts: Date.now() },
                { message: 'system.adapter.javascript.0 - warn: W1', ts: Date.now() },
                { message: 'system.adapter.javascript.0 - warn: W2', ts: Date.now() },
            ];

            const result = await monitor.check();

            assert.strictEqual(result.instances[0].instance, 'javascript.0');
            assert.strictEqual(result.instances[0].totalErrors + result.instances[0].totalWarnings, 3);
        });
    });
});
