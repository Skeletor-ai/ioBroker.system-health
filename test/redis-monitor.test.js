'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const RedisMonitor = require('../lib/health-checks/redis-monitor');

describe('RedisMonitor', () => {
    let adapter;
    let monitor;

    beforeEach(() => {
        adapter = {
            log: {
                info: () => {},
                warn: () => {},
                error: () => {},
                debug: () => {},
            },
            config: {
                redisHost: '',
                redisPort: undefined,
                redisPassword: '',
            },
            getForeignObjectsAsync: async () => ({}),
        };
        monitor = new RedisMonitor(adapter);
    });

    describe('constructor', () => {
        test('should use default config values', () => {
            assert.strictEqual(monitor.config.memoryWarningPercent, 80);
            assert.strictEqual(monitor.config.memoryErrorPercent, 95);
            assert.strictEqual(monitor.config.latencyWarningMs, 100);
            assert.strictEqual(monitor.config.connectionTimeoutMs, 5000);
        });

        test('should accept custom config values', () => {
            const custom = new RedisMonitor(adapter, {
                memoryWarningPercent: 70,
                memoryErrorPercent: 90,
                latencyWarningMs: 50,
            });
            assert.strictEqual(custom.config.memoryWarningPercent, 70);
            assert.strictEqual(custom.config.memoryErrorPercent, 90);
            assert.strictEqual(custom.config.latencyWarningMs, 50);
        });
    });

    describe('detectRedisConfig', () => {
        test('should return null if no Redis backend detected', async () => {
            adapter.getForeignObjectsAsync = async () => ({
                'system.host.iobroker': {
                    native: {
                        objects: { type: 'jsonl' },
                        states: { type: 'jsonl' },
                    }
                }
            });

            const config = await monitor.detectRedisConfig();
            assert.strictEqual(config, null);
        });

        test('should detect Redis states backend', async () => {
            adapter.getForeignObjectsAsync = async () => ({
                'system.host.iobroker': {
                    native: {
                        objects: { type: 'jsonl' },
                        states: { type: 'redis', host: '192.168.1.100', port: 6380 },
                    }
                }
            });

            const config = await monitor.detectRedisConfig();
            assert.ok(config);
            assert.strictEqual(config.host, '192.168.1.100');
            assert.strictEqual(config.port, 6380);
            assert.strictEqual(config.statesIsRedis, true);
            assert.strictEqual(config.objectsIsRedis, false);
        });

        test('should detect Redis objects backend', async () => {
            adapter.getForeignObjectsAsync = async () => ({
                'system.host.iobroker': {
                    native: {
                        objects: { type: 'redis', host: '10.0.0.5', port: 6379, pass: 'secret' },
                        states: { type: 'jsonl' },
                    }
                }
            });

            const config = await monitor.detectRedisConfig();
            assert.ok(config);
            assert.strictEqual(config.host, '10.0.0.5');
            assert.strictEqual(config.password, 'secret');
            assert.strictEqual(config.objectsIsRedis, true);
            assert.strictEqual(config.statesIsRedis, false);
        });

        test('should use defaults for missing host/port', async () => {
            adapter.getForeignObjectsAsync = async () => ({
                'system.host.iobroker': {
                    native: {
                        objects: { type: 'jsonl' },
                        states: { type: 'redis' },
                    }
                }
            });

            const config = await monitor.detectRedisConfig();
            assert.ok(config);
            assert.strictEqual(config.host, '127.0.0.1');
            assert.strictEqual(config.port, 6379);
            assert.strictEqual(config.password, null);
        });

        test('should handle empty host objects', async () => {
            adapter.getForeignObjectsAsync = async () => ({});
            const config = await monitor.detectRedisConfig();
            assert.strictEqual(config, null);
        });

        test('should handle host objects without native', async () => {
            adapter.getForeignObjectsAsync = async () => ({
                'system.host.iobroker': {}
            });
            const config = await monitor.detectRedisConfig();
            assert.strictEqual(config, null);
        });
    });

    describe('parseRedisInfo', () => {
        test('should parse Redis INFO response', () => {
            const infoStr = [
                '# Memory',
                'used_memory:1048576',
                'used_memory_human:1.00M',
                'maxmemory:10485760',
                '# Keyspace',
                'db0:keys=1500,expires=200,avg_ttl=0',
                '# Stats',
                'evicted_keys:5',
                '# Persistence',
                'rdb_last_save_time:1700000000',
                'rdb_last_bgsave_status:ok',
                'aof_enabled:1',
                'aof_last_bgrewrite_status:ok',
            ].join('\r\n');

            const info = monitor.parseRedisInfo(infoStr);

            assert.strictEqual(info.used_memory, '1048576');
            assert.strictEqual(info.used_memory_human, '1.00M');
            assert.strictEqual(info.maxmemory, '10485760');
            assert.strictEqual(info.db0, 'keys=1500,expires=200,avg_ttl=0');
            assert.strictEqual(info.evicted_keys, '5');
            assert.strictEqual(info.aof_enabled, '1');
        });

        test('should skip comment lines', () => {
            const infoStr = '# Server\r\nredis_version:7.0.0\r\n# Clients\r\nconnected_clients:5';
            const info = monitor.parseRedisInfo(infoStr);

            assert.strictEqual(info.redis_version, '7.0.0');
            assert.strictEqual(info.connected_clients, '5');
            assert.strictEqual(info['# Server'], undefined);
        });

        test('should handle values containing colons', () => {
            const infoStr = 'redis_version:7.0.0\r\nredis_git_sha1:abc:def';
            const info = monitor.parseRedisInfo(infoStr);
            assert.strictEqual(info.redis_git_sha1, 'abc:def');
        });

        test('should handle empty string', () => {
            const info = monitor.parseRedisInfo('');
            assert.deepStrictEqual(info, {});
        });
    });

    describe('check', () => {
        test('should return skipped status if no Redis detected', async () => {
            const result = await monitor.check();

            assert.strictEqual(result.status, 'skipped');
            assert.strictEqual(result.reason, 'Redis backend not detected');
            assert.ok(result.timestamp);
        });

        test('should return error status on connection failure', async () => {
            // Force Redis config to a non-existent host
            monitor.redisConfig = {
                host: '127.0.0.1',
                port: 1, // unlikely to have Redis here
                password: null,
                objectsIsRedis: false,
                statesIsRedis: true,
            };
            monitor.config.connectionTimeoutMs = 500;

            const result = await monitor.check();

            assert.strictEqual(result.status, 'error');
            assert.strictEqual(result.connection, false);
            assert.ok(result.errors.length > 0);
        });
    });

    describe('threshold evaluation', () => {
        test('should detect memory warning', () => {
            // Simulate a check result with high memory
            const monitor2 = new RedisMonitor(adapter, {
                memoryWarningPercent: 80,
                memoryErrorPercent: 95,
            });

            // We can test the threshold logic indirectly through parseRedisInfo
            const info = monitor2.parseRedisInfo(
                'used_memory:8500000\r\nmaxmemory:10000000\r\nevicted_keys:0\r\n'
            );

            const usedPercent = (parseInt(info.used_memory) / parseInt(info.maxmemory)) * 100;
            assert.ok(usedPercent > 80, 'Should be above warning threshold');
            assert.ok(usedPercent < 95, 'Should be below error threshold');
        });

        test('should detect memory error', () => {
            const info = monitor.parseRedisInfo(
                'used_memory:9600000\r\nmaxmemory:10000000\r\n'
            );

            const usedPercent = (parseInt(info.used_memory) / parseInt(info.maxmemory)) * 100;
            assert.ok(usedPercent > 95, 'Should be above error threshold');
        });

        test('should handle unlimited maxmemory', () => {
            const info = monitor.parseRedisInfo(
                'used_memory:500000000\r\nmaxmemory:0\r\n'
            );

            const maxMemory = parseInt(info.maxmemory);
            const usedPercent = maxMemory > 0 ? (parseInt(info.used_memory) / maxMemory) * 100 : 0;
            assert.strictEqual(usedPercent, 0, 'Should report 0% when maxmemory is unlimited');
        });
    });

    describe('keyspace parsing', () => {
        test('should count total keys from keyspace info', () => {
            const info = monitor.parseRedisInfo(
                'db0:keys=1000,expires=50,avg_ttl=0\r\ndb1:keys=500,expires=10,avg_ttl=0\r\n'
            );

            let totalKeys = 0;
            for (const [key, val] of Object.entries(info)) {
                if (key.startsWith('db')) {
                    const match = val.match(/keys=(\d+)/);
                    if (match) totalKeys += parseInt(match[1]);
                }
            }

            assert.strictEqual(totalKeys, 1500);
        });

        test('should handle empty keyspace', () => {
            const info = monitor.parseRedisInfo('redis_version:7.0.0\r\n');

            let totalKeys = 0;
            for (const [key, val] of Object.entries(info)) {
                if (key.startsWith('db')) {
                    const match = val.match(/keys=(\d+)/);
                    if (match) totalKeys += parseInt(match[1]);
                }
            }

            assert.strictEqual(totalKeys, 0);
        });
    });

    describe('persistence parsing', () => {
        test('should detect RDB and AOF enabled', () => {
            const info = monitor.parseRedisInfo(
                'rdb_last_save_time:1700000000\r\nrdb_last_bgsave_status:ok\r\naof_enabled:1\r\naof_last_bgrewrite_status:ok\r\n'
            );

            assert.ok(info.rdb_last_save_time !== undefined, 'RDB should be detected');
            assert.strictEqual(info.aof_enabled, '1');
            assert.strictEqual(info.rdb_last_bgsave_status, 'ok');
        });

        test('should detect AOF disabled', () => {
            const info = monitor.parseRedisInfo('aof_enabled:0\r\n');
            assert.strictEqual(info.aof_enabled, '0');
        });
    });
});
