'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const RedisMonitor = require('../lib/health-checks/redis-monitor');

describe('Redis Detection', () => {
    let mockAdapter;
    let mockDataDir;
    let originalExistsSync;
    let originalReadFileSync;

    beforeEach(() => {
        mockDataDir = '/tmp/test-iobroker-data';
        mockAdapter = {
            log: {
                debug: () => {},
                info: () => {},
                warn: () => {},
                error: () => {},
            },
            config: {},
            getDataDir: () => mockDataDir,
            getForeignObjectsAsync: () => Promise.resolve({}),
        };

        // Store original implementations
        originalExistsSync = fs.existsSync;
        originalReadFileSync = fs.readFileSync;
    });

    describe('detectRedisConfig', () => {
        it('should detect Redis from iobroker.json (states: redis, objects: file)', async () => {
            // Arrange
            const mockConfig = {
                objects: {
                    type: 'file',
                    host: '127.0.0.1',
                    port: 9001,
                },
                states: {
                    type: 'redis',
                    host: '192.168.1.100',
                    port: 6379,
                },
            };

            fs.existsSync = () => true;
            fs.readFileSync = () => JSON.stringify(mockConfig);

            const monitor = new RedisMonitor(mockAdapter);

            // Act
            const config = await monitor.detectRedisConfig();

            // Assert
            assert.notEqual(config, null);
            assert.equal(config.host, '192.168.1.100');
            assert.equal(config.port, 6379);
            assert.equal(config.statesIsRedis, true);
            assert.equal(config.objectsIsRedis, false);
            assert.equal(config.detectedVia, 'iobroker.json');

            // Restore
            fs.existsSync = originalExistsSync;
            fs.readFileSync = originalReadFileSync;
        });

        it('should detect Redis from iobroker.json (both objects and states: redis)', async () => {
            // Arrange
            const mockConfig = {
                objects: {
                    type: 'redis',
                    host: '10.0.0.50',
                    port: 6380,
                },
                states: {
                    type: 'redis',
                    host: '10.0.0.51',
                    port: 6381,
                },
            };

            fs.existsSync = () => true;
            fs.readFileSync = () => JSON.stringify(mockConfig);

            const monitor = new RedisMonitor(mockAdapter);

            // Act
            const config = await monitor.detectRedisConfig();

            // Assert
            assert.notEqual(config, null);
            // Should prefer states config over objects config
            assert.equal(config.host, '10.0.0.51');
            assert.equal(config.port, 6381);
            assert.equal(config.statesIsRedis, true);
            assert.equal(config.objectsIsRedis, true);
            assert.equal(config.detectedVia, 'iobroker.json');

            // Restore
            fs.existsSync = originalExistsSync;
            fs.readFileSync = originalReadFileSync;
        });

        it('should detect Redis from iobroker.json (only objects: redis)', async () => {
            // Arrange
            const mockConfig = {
                objects: {
                    type: 'redis',
                    host: '172.16.0.10',
                    port: 6379,
                },
                states: {
                    type: 'file',
                },
            };

            fs.existsSync = () => true;
            fs.readFileSync = () => JSON.stringify(mockConfig);

            const monitor = new RedisMonitor(mockAdapter);

            // Act
            const config = await monitor.detectRedisConfig();

            // Assert
            assert.notEqual(config, null);
            assert.equal(config.host, '172.16.0.10');
            assert.equal(config.port, 6379);
            assert.equal(config.statesIsRedis, false);
            assert.equal(config.objectsIsRedis, true);
            assert.equal(config.detectedVia, 'iobroker.json');

            // Restore
            fs.existsSync = originalExistsSync;
            fs.readFileSync = originalReadFileSync;
        });

        it('should return null if iobroker.json contains no Redis backend', async () => {
            // Arrange
            const mockConfig = {
                objects: { type: 'file' },
                states: { type: 'file' },
            };

            fs.existsSync = () => true;
            fs.readFileSync = () => JSON.stringify(mockConfig);

            const monitor = new RedisMonitor(mockAdapter);

            // Act
            const config = await monitor.detectRedisConfig();

            // Assert
            assert.equal(config, null);

            // Restore
            fs.existsSync = originalExistsSync;
            fs.readFileSync = originalReadFileSync;
        });

        it('should return null if iobroker.json does not exist', async () => {
            // Arrange
            fs.existsSync = () => false;

            const monitor = new RedisMonitor(mockAdapter);

            // Act
            const config = await monitor.detectRedisConfig();

            // Assert
            assert.equal(config, null);

            // Restore
            fs.existsSync = originalExistsSync;
        });

        it('should use default host/port if missing in iobroker.json', async () => {
            // Arrange
            const mockConfig = {
                states: {
                    type: 'redis',
                    // host and port missing
                },
            };

            fs.existsSync = () => true;
            fs.readFileSync = () => JSON.stringify(mockConfig);

            const monitor = new RedisMonitor(mockAdapter);

            // Act
            const config = await monitor.detectRedisConfig();

            // Assert
            assert.notEqual(config, null);
            assert.equal(config.host, '127.0.0.1');
            assert.equal(config.port, 6379);

            // Restore
            fs.existsSync = originalExistsSync;
            fs.readFileSync = originalReadFileSync;
        });

        it('should handle malformed JSON gracefully', async () => {
            // Arrange
            fs.existsSync = () => true;
            fs.readFileSync = () => '{ invalid json }';

            const logMessages = [];
            mockAdapter.log.debug = (msg) => logMessages.push(msg);

            const monitor = new RedisMonitor(mockAdapter);

            // Act
            const config = await monitor.detectRedisConfig();

            // Assert
            assert.equal(config, null);
            assert.ok(logMessages.some(msg => msg.includes('Could not read iobroker.json')));

            // Restore
            fs.existsSync = originalExistsSync;
            fs.readFileSync = originalReadFileSync;
        });

        it('should prefer manual config over iobroker.json auto-detection', async () => {
            // Arrange
            mockAdapter.config.redisHost = '10.99.99.99';
            mockAdapter.config.redisPort = 7777;

            const mockConfig = {
                states: { type: 'redis', host: '192.168.1.1', port: 6379 },
            };

            fs.existsSync = () => true;
            fs.readFileSync = () => JSON.stringify(mockConfig);

            const logMessages = [];
            mockAdapter.log.debug = (msg) => logMessages.push(msg);

            const monitor = new RedisMonitor(mockAdapter);

            // Act
            const config = await monitor.detectRedisConfig();

            // Assert
            assert.notEqual(config, null);
            assert.equal(config.host, '10.99.99.99');
            assert.equal(config.port, 7777);
            assert.ok(logMessages.some(msg => msg.includes('Using manual Redis configuration')));

            // Restore
            fs.existsSync = originalExistsSync;
            fs.readFileSync = originalReadFileSync;
        });
    });
});
