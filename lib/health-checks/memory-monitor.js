'use strict';

const os = require('os');

/**
 * Memory monitoring and leak detection.
 * Tracks RAM usage over time and detects abnormal memory growth patterns.
 */
class MemoryMonitor {
    /**
     * @param {object} adapter - ioBroker adapter instance
     * @param {object} config - Configuration options
     * @param {number} config.warningThresholdMB - Warning threshold in MB
     * @param {number} config.criticalThresholdPercent - Critical threshold as percentage of total memory
     * @param {number} config.leakDetectionWindow - Number of samples to analyze for leak detection
     * @param {number} config.leakGrowthThresholdMB - MB growth per sample that indicates a leak
     */
    constructor(adapter, config = {}) {
        this.adapter = adapter;
        this.config = {
            warningThresholdMB: config.warningThresholdMB || 500,
            criticalThresholdPercent: config.criticalThresholdPercent || 90,
            leakDetectionWindow: config.leakDetectionWindow || 10,
            leakGrowthThresholdMB: config.leakGrowthThresholdMB || 50,
        };
        this.history = [];
    }

    /**
     * Get current memory usage statistics.
     * @returns {object} Memory statistics
     */
    getMemoryStats() {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const usedPercent = (usedMem / totalMem) * 100;

        return {
            totalMB: Math.round(totalMem / 1024 / 1024),
            usedMB: Math.round(usedMem / 1024 / 1024),
            freeMB: Math.round(freeMem / 1024 / 1024),
            usedPercent: Math.round(usedPercent * 100) / 100,
            timestamp: Date.now(),
        };
    }

    /**
     * Detect potential memory leaks based on historical data.
     * @returns {object|null} Leak detection result or null if no leak detected
     */
    detectLeak() {
        if (this.history.length < this.config.leakDetectionWindow) {
            return null; // Not enough data yet
        }

        const recentSamples = this.history.slice(-this.config.leakDetectionWindow);
        const growthRates = [];

        for (let i = 1; i < recentSamples.length; i++) {
            const growth = recentSamples[i].usedMB - recentSamples[i - 1].usedMB;
            growthRates.push(growth);
        }

        // Check if memory is consistently growing
        const avgGrowth = growthRates.reduce((a, b) => a + b, 0) / growthRates.length;
        const positiveGrowthCount = growthRates.filter(g => g > 0).length;
        const positiveGrowthPercent = (positiveGrowthCount / growthRates.length) * 100;

        // Leak detected if:
        // 1. Average growth exceeds threshold
        // 2. More than 70% of samples show positive growth
        if (avgGrowth > this.config.leakGrowthThresholdMB && positiveGrowthPercent > 70) {
            return {
                detected: true,
                avgGrowthMB: Math.round(avgGrowth * 100) / 100,
                trendPercent: Math.round(positiveGrowthPercent),
                sampleCount: recentSamples.length,
            };
        }

        return null;
    }

    /**
     * Get top memory-consuming processes (Linux only).
     * @returns {Promise<Array>} Top processes by memory usage
     */
    async getTopProcesses() {
        if (os.platform() !== 'linux') {
            return [];
        }

        try {
            const { execSync } = require('child_process');
            const output = execSync('ps aux --sort=-%mem | head -11').toString();
            const lines = output.trim().split('\n').slice(1); // Skip header

            return lines.map(line => {
                const parts = line.trim().split(/\s+/);
                return {
                    user: parts[0],
                    pid: parseInt(parts[1]),
                    memPercent: parseFloat(parts[3]),
                    command: parts.slice(10).join(' '),
                };
            });
        } catch (err) {
            this.adapter.log.warn(`Could not fetch top processes: ${err.message}`);
            return [];
        }
    }

    /**
     * Run memory monitoring check.
     * @returns {Promise<object>} Check result
     */
    async check() {
        const stats = this.getMemoryStats();
        this.history.push(stats);

        // Keep only last 100 samples
        if (this.history.length > 100) {
            this.history.shift();
        }

        const result = {
            status: 'ok',
            stats,
            warnings: [],
            critical: [],
        };

        // Check absolute threshold (free memory)
        if (stats.freeMB < this.config.warningThresholdMB) {
            result.warnings.push(
                `Free memory (${stats.freeMB} MB) is below warning threshold (${this.config.warningThresholdMB} MB)`
            );
        }

        // Check percentage threshold
        if (stats.usedPercent > this.config.criticalThresholdPercent) {
            result.critical.push(
                `Memory usage (${stats.usedPercent}%) exceeds critical threshold (${this.config.criticalThresholdPercent}%)`
            );
            result.status = 'critical';
        }

        // Detect leaks
        const leak = this.detectLeak();
        if (leak) {
            result.warnings.push(
                `Potential memory leak detected: +${leak.avgGrowthMB} MB/sample (${leak.trendPercent}% upward trend)`
            );
            result.leak = leak;
        }

        // Get top processes
        result.topProcesses = await this.getTopProcesses();

        if (result.warnings.length > 0 && result.status === 'ok') {
            result.status = 'warning';
        }

        return result;
    }

    /**
     * Reset historical data.
     */
    reset() {
        this.history = [];
    }
}

module.exports = MemoryMonitor;
