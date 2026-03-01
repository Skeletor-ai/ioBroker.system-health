'use strict';

const net = require('node:net');

/**
 * Redis database health monitoring.
 * Monitors Redis health metrics for ioBroker installations using Redis backend.
 */
class RedisMonitor {
    /**
     * @param {object} adapter - ioBroker adapter instance
     * @param {object} config - Configuration options
     * @param {number} [config.memoryWarningPercent=80] - Memory warning threshold (%)
     * @param {number} [config.memoryErrorPercent=95] - Memory error threshold (%)
     * @param {number} [config.latencyWarningMs=100] - Latency warning threshold (ms)
     * @param {number} [config.connectionTimeoutMs=5000] - Connection timeout (ms)
     */
    constructor(adapter, config = {}) {
        this.adapter = adapter;
        this.config = {
            memoryWarningPercent: config.memoryWarningPercent || 80,
            memoryErrorPercent: config.memoryErrorPercent || 95,
            latencyWarningMs: config.latencyWarningMs || 100,
            connectionTimeoutMs: config.connectionTimeoutMs || 5000,
        };
        this.redisConfig = null; // { host, port, password } — detected at runtime
    }

    /**
     * Detect Redis configuration from ioBroker system config.
     * @returns {Promise<object|null>} Redis config or null if not using Redis
     */
    async detectRedisConfig() {
        // Manual configuration takes precedence
        const manualHost = this.adapter.config.redisHost;
        const manualPort = this.adapter.config.redisPort;
        const manualPassword = this.adapter.config.redisPassword;

        if (manualHost) {
            this.adapter.log.debug('Using manual Redis configuration');
            return {
                host: manualHost,
                port: manualPort || 6379,
                password: manualPassword || null,
                objectsIsRedis: false, // Unknown from manual config
                statesIsRedis: false,  // Unknown from manual config
            };
        }

        // Try automatic detection from ioBroker host config
        try {
            // Read ioBroker system host object which contains DB config
            const hostObjs = await this.adapter.getForeignObjectsAsync('system.host.*', 'host');

            for (const [, hostObj] of Object.entries(hostObjs)) {
                if (!hostObj || !hostObj.native) continue;

                // Check objects and states config
                const objectsConfig = hostObj.native.objects || {};
                const statesConfig = hostObj.native.states || {};

                const objectsIsRedis = objectsConfig.type === 'redis';
                const statesIsRedis = statesConfig.type === 'redis';

                if (objectsIsRedis || statesIsRedis) {
                    // Prefer states config, fall back to objects config
                    const redisConf = statesIsRedis ? statesConfig : objectsConfig;
                    this.adapter.log.debug('Redis detected via auto-detection');
                    return {
                        host: redisConf.host || '127.0.0.1',
                        port: redisConf.port || 6379,
                        password: redisConf.pass || redisConf.password || null,
                        objectsIsRedis,
                        statesIsRedis,
                    };
                }
            }
        } catch (err) {
            this.adapter.log.debug(`Could not detect Redis config from host objects: ${err.message}`);
        }

        return null;
    }

    /**
     * Send a raw Redis command and get the response.
     * @param {string} host
     * @param {number} port
     * @param {string|null} password
     * @param {string} command
     * @param {number} timeoutMs
     * @returns {Promise<string>} Raw response
     */
    sendRedisCommand(host, port, password, command, timeoutMs) {
        return new Promise((resolve, reject) => {
            let data = '';
            let authenticated = !password; // If no password, already "authenticated"
            let commandSent = false;
            const socket = new net.Socket();

            const timer = setTimeout(() => {
                socket.destroy();
                reject(new Error(`Redis connection timeout after ${timeoutMs}ms`));
            }, timeoutMs);

            socket.connect(port, host, () => {
                if (password) {
                    socket.write(`AUTH ${password}\r\n`);
                } else {
                    socket.write(`${command}\r\n`);
                    commandSent = true;
                }
            });

            socket.on('data', (chunk) => {
                data += chunk.toString();

                // Handle AUTH response
                if (!authenticated && data.includes('+OK')) {
                    authenticated = true;
                    data = '';
                    socket.write(`${command}\r\n`);
                    commandSent = true;
                    return;
                }

                if (!authenticated && data.includes('-ERR')) {
                    clearTimeout(timer);
                    socket.destroy();
                    reject(new Error('Redis AUTH failed'));
                    return;
                }

                // For INFO command, wait for the full bulk string response
                if (commandSent && command.startsWith('INFO')) {
                    // Redis bulk string: $<length>\r\n<data>\r\n
                    const match = data.match(/^\$(\d+)\r\n/);
                    if (match) {
                        const expectedLen = parseInt(match[1]);
                        const bodyStart = data.indexOf('\r\n') + 2;
                        const body = data.substring(bodyStart);
                        if (body.length >= expectedLen) {
                            clearTimeout(timer);
                            socket.destroy();
                            resolve(body.substring(0, expectedLen));
                            return;
                        }
                    }
                }

                // For PING, response is simple +PONG
                if (commandSent && command === 'PING' && data.includes('+PONG')) {
                    clearTimeout(timer);
                    socket.destroy();
                    resolve('+PONG');
                }
            });

            socket.on('error', (err) => {
                clearTimeout(timer);
                reject(err);
            });

            socket.on('close', () => {
                clearTimeout(timer);
                if (commandSent && data) {
                    resolve(data);
                } else if (!commandSent || !data) {
                    reject(new Error('Redis connection closed unexpectedly'));
                }
            });
        });
    }

    /**
     * Parse Redis INFO response into key-value object.
     * @param {string} infoStr - Raw INFO response
     * @returns {object} Parsed key-value pairs
     */
    parseRedisInfo(infoStr) {
        const result = {};
        const lines = infoStr.split('\r\n');
        for (const line of lines) {
            if (line.startsWith('#') || !line.includes(':')) continue;
            const [key, ...valueParts] = line.split(':');
            result[key.trim()] = valueParts.join(':').trim();
        }
        return result;
    }

    /**
     * Measure Redis PING latency.
     * @param {string} host
     * @param {number} port
     * @param {string|null} password
     * @returns {Promise<number>} Latency in ms
     */
    async measureLatency(host, port, password) {
        const start = Date.now();
        await this.sendRedisCommand(host, port, password, 'PING', this.config.connectionTimeoutMs);
        return Date.now() - start;
    }

    /**
     * Run Redis health check.
     * @returns {Promise<object>} Check result
     */
    async check() {
        // Detect Redis config if not yet done
        if (!this.redisConfig) {
            this.redisConfig = await this.detectRedisConfig();
        }

        if (!this.redisConfig) {
            return {
                status: 'skipped',
                reason: 'Redis backend not detected',
                timestamp: Date.now(),
            };
        }

        const { host, port, password, objectsIsRedis, statesIsRedis } = this.redisConfig;
        const result = {
            status: 'ok',
            connection: false,
            backend: {
                objects: objectsIsRedis,
                states: statesIsRedis,
            },
            memory: null,
            keys: null,
            evictedKeys: null,
            latencyMs: null,
            persistence: null,
            warnings: [],
            errors: [],
            timestamp: Date.now(),
        };

        // 1. Measure latency (also tests connection)
        try {
            result.latencyMs = await this.measureLatency(host, port, password);
            result.connection = true;

            if (result.latencyMs > this.config.latencyWarningMs) {
                result.warnings.push(
                    `Redis latency (${result.latencyMs}ms) exceeds warning threshold (${this.config.latencyWarningMs}ms)`
                );
            }
        } catch (err) {
            result.connection = false;
            result.errors.push(`Redis connection failed: ${err.message}`);
            result.status = 'error';
            return result;
        }

        // 2. Get INFO
        try {
            const infoStr = await this.sendRedisCommand(host, port, password, 'INFO', this.config.connectionTimeoutMs);
            const info = this.parseRedisInfo(infoStr);

            // Memory
            const usedMemory = parseInt(info.used_memory) || 0;
            const maxMemory = parseInt(info.maxmemory) || 0;
            const usedPercent = maxMemory > 0 ? (usedMemory / maxMemory) * 100 : 0;

            result.memory = {
                usedBytes: usedMemory,
                usedHuman: info.used_memory_human || `${Math.round(usedMemory / 1024 / 1024)}MB`,
                maxBytes: maxMemory,
                maxHuman: maxMemory > 0 ? `${Math.round(maxMemory / 1024 / 1024)}MB` : 'unlimited',
                usedPercent: Math.round(usedPercent * 100) / 100,
            };

            // Memory thresholds (only if maxmemory is set)
            if (maxMemory > 0) {
                if (usedPercent > this.config.memoryErrorPercent) {
                    result.errors.push(
                        `Redis memory (${result.memory.usedPercent}%) exceeds error threshold (${this.config.memoryErrorPercent}%)`
                    );
                } else if (usedPercent > this.config.memoryWarningPercent) {
                    result.warnings.push(
                        `Redis memory (${result.memory.usedPercent}%) exceeds warning threshold (${this.config.memoryWarningPercent}%)`
                    );
                }
            }

            // Keyspace
            let totalKeys = 0;
            for (const [key, val] of Object.entries(info)) {
                if (key.startsWith('db')) {
                    const match = val.match(/keys=(\d+)/);
                    if (match) totalKeys += parseInt(match[1]);
                }
            }
            result.keys = totalKeys;

            // Evicted keys
            result.evictedKeys = parseInt(info.evicted_keys) || 0;
            if (result.evictedKeys > 0) {
                result.warnings.push(
                    `Redis has evicted ${result.evictedKeys} keys (memory pressure detected)`
                );
            }

            // Persistence
            const rdbEnabled = info.rdb_last_save_time !== undefined;
            const aofEnabled = info.aof_enabled === '1';
            result.persistence = {
                rdb: rdbEnabled,
                aof: aofEnabled,
                lastRdbSave: rdbEnabled ? parseInt(info.rdb_last_save_time) || 0 : null,
                rdbStatus: info.rdb_last_bgsave_status || 'unknown',
                aofStatus: aofEnabled ? (info.aof_last_bgrewrite_status || 'unknown') : null,
            };

        } catch (err) {
            result.warnings.push(`Could not fetch Redis INFO: ${err.message}`);
        }

        // Determine overall status
        if (result.errors.length > 0) {
            result.status = 'error';
        } else if (result.warnings.length > 0) {
            result.status = 'warning';
        }

        return result;
    }
}

module.exports = RedisMonitor;
