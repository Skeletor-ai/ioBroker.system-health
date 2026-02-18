'use strict';

/**
 * Classification categories for adapter crashes.
 * @readonly
 * @enum {string}
 */
const CrashCategory = {
    ADAPTER_ERROR: 'adapter_error',
    CONFIG_ERROR: 'config_error',
    DEVICE_ERROR: 'device_error',
    UNKNOWN: 'unknown'
};

/**
 * Pattern definitions for crash classification.
 * Each pattern has a regex, category, and recommendation.
 */
const CLASSIFICATION_PATTERNS = [
    // Adapter bugs
    {
        pattern: /uncaught exception|unhandled rejection|TypeError|ReferenceError|segmentation fault|SIGSEGV|SIGABRT/i,
        category: CrashCategory.ADAPTER_ERROR,
        recommendation: 'Update the adapter to the latest version. If the issue persists, report a bug at the adapter\'s GitHub repository.'
    },
    {
        pattern: /cannot read propert|undefined is not|null is not an object/i,
        category: CrashCategory.ADAPTER_ERROR,
        recommendation: 'Update the adapter to the latest version. If the issue persists, report a bug at the adapter\'s GitHub repository.'
    },
    // Configuration errors
    {
        pattern: /authentication failed|invalid credentials|unauthorized|403 forbidden|401 unauthorized/i,
        category: CrashCategory.CONFIG_ERROR,
        recommendation: 'Check the adapter configuration in the admin panel. Verify credentials, IP addresses, and required settings.'
    },
    {
        pattern: /invalid configuration|missing required|config error|ECONNREFUSED.*after config/i,
        category: CrashCategory.CONFIG_ERROR,
        recommendation: 'Check the adapter configuration in the admin panel. Verify credentials, IP addresses, and required settings.'
    },
    {
        pattern: /wrong ip|wrong port|invalid.*address|parse.*config/i,
        category: CrashCategory.CONFIG_ERROR,
        recommendation: 'Check the adapter configuration in the admin panel. Verify credentials, IP addresses, and required settings.'
    },
    // Device/service unreachable
    {
        pattern: /EHOSTUNREACH|ETIMEDOUT|ECONNREFUSED|ENETUNREACH|host unreachable/i,
        category: CrashCategory.DEVICE_ERROR,
        recommendation: 'The target device or service appears to be offline or unreachable. Check network connectivity and whether the device/service is running.'
    },
    {
        pattern: /dns.*fail|getaddrinfo.*ENOTFOUND|no route to host/i,
        category: CrashCategory.DEVICE_ERROR,
        recommendation: 'The target device or service appears to be offline or unreachable. Check network connectivity and whether the device/service is running.'
    },
    {
        pattern: /connection refused|connection timeout|device offline|service unavailable/i,
        category: CrashCategory.DEVICE_ERROR,
        recommendation: 'The target device or service appears to be offline or unreachable. Check network connectivity and whether the device/service is running.'
    }
];

/**
 * Classifies a crash based on log messages and exit code.
 * 
 * @param {string[]} logMessages - Array of recent log messages from the adapter
 * @param {number} exitCode - Exit code of the crashed process
 * @returns {{category: string, recommendation: string}} Classification result
 */
function classifyCrash(logMessages, exitCode) {
    if (!Array.isArray(logMessages) || logMessages.length === 0) {
        return {
            category: CrashCategory.UNKNOWN,
            recommendation: 'Unable to determine crash cause. Check adapter logs for more details.'
        };
    }

    // Join all log messages for pattern matching
    const combinedLogs = logMessages.join(' ');

    // Check each pattern
    for (const { pattern, category, recommendation } of CLASSIFICATION_PATTERNS) {
        if (pattern.test(combinedLogs)) {
            return { category, recommendation };
        }
    }

    // Exit code analysis as fallback
    if (exitCode === 1) {
        return {
            category: CrashCategory.ADAPTER_ERROR,
            recommendation: 'The adapter exited with an error code. Update to the latest version or check the adapter logs for details.'
        };
    }

    if (exitCode === 139) { // SIGSEGV
        return {
            category: CrashCategory.ADAPTER_ERROR,
            recommendation: 'The adapter crashed due to a segmentation fault. Update the adapter to the latest version and report the issue if it persists.'
        };
    }

    return {
        category: CrashCategory.UNKNOWN,
        recommendation: 'Unable to determine crash cause. Check adapter logs for more details.'
    };
}

module.exports = {
    CrashCategory,
    CLASSIFICATION_PATTERNS,
    classifyCrash
};
