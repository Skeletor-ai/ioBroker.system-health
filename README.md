# ioBroker.system-health

**System health monitoring and state inspection for ioBroker.**

🤖 *This adapter is developed collaboratively by AI agents, coordinated through GitHub Issues and Pull Requests.*

## Features

### System Health Monitoring


#### Adapter Crash Detection and Restart Tracking
- **Real-time monitoring**: Detects adapter crashes within 60 seconds
- **Crash history**: Tracks all crashes with timestamps for the last 30 days
- **Root cause classification**: Automatically categorizes crashes into:
  - `adapter_error`: Bugs in the adapter code (uncaught exceptions, TypeErrors, segfaults)
  - `config_error`: Configuration issues (auth failures, invalid credentials, wrong settings)
  - `device_error`: Device/service unreachable (network timeouts, ECONNREFUSED)
  - `unknown`: Unable to determine the cause
- **Actionable recommendations**: Provides specific guidance for each crash type
- **Crash reports**: Summary of crashes per adapter (24h/7d/30d)
- **Stability alerts**: Flags adapters with more than 3 crashes in 24 hours

#### Memory Usage Monitoring
- Track RAM usage with leak detection and threshold alerts

#### CPU Monitoring
- Monitor CPU load with sustained high-load detection and top process reporting

#### Disk Space Monitoring
- Track disk usage with trend analysis and low-space alerts

#### Stale State Detection
- Detect writable states that haven't been updated for a configurable time threshold
- Filters out read-only states and config values to reduce false positives
- Only inspects states from active (enabled) adapters

#### Other Health Checks (Coming Soon)
- ioBroker instance health overview

### State Inspector

#### Orphaned State Detection
- Find orphaned states (no adapter, no references)
- Categorize orphans: adapter removed, adapter disabled, unreferenced
- Configurable ignore list for system states
- Cleanup suggestions (report-only, no auto-deletion)
- Dashboard-friendly states with counts and categories

#### Duplicate State Detection
- Detect data points with identical values across different adapters
- Identify naming pattern duplicates (similar state names, e.g., same device from multiple adapters)
- Report includes staleness information (last-updated timestamps)
- Configurable similarity threshold for naming detection (default: 0.9)
- Automatic confidence scoring (high/medium)
- Results available as JSON report in adapter states

#### Coming Soon
- Identify unused objects and dead references
- Visualize adapter dependencies
- Cleanup suggestions with safe removal
- State configuration export/import

## Installation

```
iobroker add health
```

## Configuration

Configuration is done through the ioBroker admin interface.

### Memory Monitoring Settings

- **Enable memory monitoring** — Toggle memory usage checks
- **Warning threshold (MB)** — Alert when used memory exceeds this value (default: 500 MB)
- **Check interval** — How often to run health checks (configured globally, default: every 6 hours)

### CPU Monitoring Settings

- **Enable CPU monitoring** — Toggle CPU usage checks
- **Warning threshold (%)** — Alert when CPU usage exceeds this percentage (default: 70%)
- **Critical threshold (%)** — Critical alert threshold (default: 90%)
- **Sample count** — Number of samples for sustained load detection (default: 5)

### Disk Space Monitoring Settings

- **Enable disk monitoring** — Toggle disk space checks
- **Warning threshold (%)** — Alert when disk usage exceeds this percentage (default: 80%)
- **Critical threshold (%)** — Critical alert threshold (default: 90%)
- **Warning threshold (MB free)** — Alert when free space drops below this value (default: 1000 MB)
- **Critical threshold (MB free)** — Critical alert threshold (default: 500 MB)
- **Mount points** — Array of mount points to monitor (default: `["/"]` on Linux/macOS)

### State Inspector Settings

- **Enable orphan detection** — Identify orphaned states (default: true)
- **Enable duplicate detection** — Detect duplicate data points (default: true)
- **Duplicate similarity threshold** — Threshold for naming pattern detection, 0-1 (default: 0.9)
- **Enable stale detection** — Monitor states for staleness (default: true)
- **Stale threshold (hours)** — Default threshold for stale state detection (default: 24)

## Dashboard

The adapter includes a **dashboard tab** in the ioBroker admin interface for a visual overview of system health.

### Features

- **Real-time metrics**: Memory, disk usage, and system status with progress bars and color-coded indicators
- **Duplicate state overview**: See the number of duplicate states and their details
- **Issue list**: View all active warnings and critical problems in one place
- **Auto-refresh**: Dashboard automatically updates every 30 seconds
- **Manual refresh**: Click the refresh button to immediately update all data

### Accessing the Dashboard

1. Open the ioBroker admin interface
2. Navigate to the **"System Health"** tab (visible after installing the adapter)
3. View the current system status, duplicates, and warnings

The dashboard provides a quick, at-a-glance view of your ioBroker system health without needing to check individual states.

## Usage

The adapter runs in **schedule mode** and performs health checks at configured intervals (default: every 6 hours).

### Memory Monitoring

When enabled, the adapter:
- Samples RAM usage (total, used, free, percentage)
- Stores historical data for trend analysis
- Detects potential memory leaks by analyzing sustained memory growth
- Reports top memory-consuming processes (Linux only)
- Creates ioBroker states with current metrics

#### States Created

All states are read-only and updated after each check:

- `system-health.0.memory.totalMB` — Total system memory in MB
- `system-health.0.memory.usedMB` — Used memory in MB
- `system-health.0.memory.freeMB` — Free memory in MB
- `system-health.0.memory.usedPercent` — Memory usage as percentage
- `system-health.0.memory.status` — Overall status (`ok`, `warning`, `critical`)
- `system-health.0.memory.leakDetected` — Boolean flag indicating potential memory leak
- `system-health.0.memory.warnings` — Semicolon-separated list of warnings

#### Memory Leak Detection

The adapter analyzes the last 10 memory samples and detects a potential leak when:
- Average memory growth exceeds 50 MB per sample
- More than 70% of samples show positive growth

This indicates a consistent upward trend rather than normal fluctuations.

### CPU Monitoring

When enabled, the adapter:
- Measures overall CPU usage and per-core utilization
- Detects sustained high CPU load (not just temporary spikes)
- Reports top CPU-consuming processes when thresholds are exceeded
- Configurable warning and critical thresholds

#### States Created

- `system-health.0.cpu.usage` — Average CPU usage (%)
- `system-health.0.cpu.usagePerCore` — JSON array with per-core usage
- `system-health.0.cpu.status` — Overall status (`ok`, `warning`, `critical`)
- `system-health.0.cpu.sustainedHighLoad` — Boolean flag for sustained high load
- `system-health.0.cpu.warnings` — Human-readable warnings
- `system-health.0.cpu.topProcesses` — JSON array of top CPU-consuming processes

#### Sustained Load Detection

The adapter monitors CPU usage over multiple samples (default: 5) and only triggers sustained-load alerts when **all recent samples** exceed the warning threshold. This prevents false alarms from temporary spikes.

### Disk Space Monitoring

When enabled, the adapter:
- Monitors free and used space for configured mount points
- Tracks disk usage trends (growth rate)
- Estimates time until disk full based on growth rate
- Configurable thresholds (both percentage and absolute free space)

#### States Created

- `system-health.0.disk.partitions` — JSON array with info for all monitored partitions
- `system-health.0.disk.status` — Overall status (`ok`, `warning`, `critical`)
- `system-health.0.disk.warnings` — Human-readable warnings with trend data
- `system-health.0.disk.trends` — JSON object with growth rates and ETAs per partition
- `system-health.0.disk.history` — Internal state for trend tracking (persisted)

#### Trend Analysis

The adapter maintains historical data for each monitored partition (last 10 samples) and calculates:
- **Growth rate** (MB per hour) — how fast disk usage is increasing
- **ETA** (estimated time until full) — projected date/time when disk will run out of space

If a partition is growing faster than 100 MB/hour and has an ETA, a trend warning is included in the alerts.

### Adapter Crash Detection

Once the adapter is running, it monitors all ioBroker adapters for crashes and provides detailed information through states:

**Per-Adapter States** (under `system-health.0.adapters.<adapter>.<instance>`):
- `lastCrash` - ISO timestamp of the most recent crash
- `lastCrashCategory` - Classification: adapter_error, config_error, device_error, or unknown
- `recommendation` - Human-readable action to resolve the issue
- `crashCount24h` - Number of crashes in the last 24 hours
- `crashCount7d` - Number of crashes in the last 7 days
- `crashCount30d` - Number of crashes in the last 30 days
- `stable` - Boolean indicating if the adapter is stable (≤3 crashes in 24h)

**System-Wide Reports** (under `system-health.0.report`):
- `crashReport` - JSON summary of all adapter crashes with statistics
- `hasProblems` - Boolean flag indicating if any adapter has excessive crashes

**Example**: Check crash status for zigbee adapter
```
system-health.0.adapters.zigbee.0.lastCrash          // "2026-02-18T09:15:32.123Z"
system-health.0.adapters.zigbee.0.lastCrashCategory  // "device_error"
system-health.0.adapters.zigbee.0.recommendation     // "The target device or service appears..."
system-health.0.adapters.zigbee.0.crashCount24h      // 5
system-health.0.adapters.zigbee.0.stable             // false
```

You can use these states in scripts, blockly, or notification adapters to get alerts when adapters become unstable.

### Daemon Mode

**Note**: Crash detection requires the adapter to run in `daemon` mode to continuously monitor alive states. The default `schedule` mode is suitable for periodic health checks but will not detect crashes in real-time. Enable crash detection in the adapter settings to automatically switch to daemon mode.

### Stale State Detection

The adapter can monitor configured states and alert when they haven't been updated within their expected intervals, indicating potential device or adapter failures.

**Features:**
- Watch specific states with configurable expected update intervals
- Grace period before alerting (prevents false alarms)
- Distinguish between legitimately unchanging states and actual failures
- Per-state configuration (interval + grace period)
- Real-time detection via state subscriptions

#### States Created

- `system-health.0.staleStates.list` — JSON array of currently stale states with details
- `system-health.0.staleStates.count` — Number of stale states
- `system-health.0.staleStates.hasStale` — Boolean alarm indicator

#### Configuration

Stale state detection requires configuration via adapter settings. For each watched state, specify:
- **State ID** — The full ioBroker state ID to monitor (e.g., `zigbee.0.living-room-sensor.temperature`)
- **Expected interval** (seconds) — How often the state should update under normal conditions
- **Grace period** (seconds) — Additional time before alerting (default: 60s)

**Example:**
```json
{
  "watchedStates": [
    {
      "id": "zigbee.0.living-room-sensor.temperature",
      "intervalSeconds": 300,
      "gracePeriodSeconds": 60
    },
    {
      "id": "modbus.0.power-meter.consumption",
      "intervalSeconds": 60,
      "gracePeriodSeconds": 30
    }
  ]
}
```

In this example:
- The temperature sensor is expected to update every 5 minutes (300s). If it doesn't update for 6 minutes (300s + 60s grace), it's flagged as stale.
- The power meter should update every minute. If it misses an update by more than 30 seconds, it's flagged.

#### Staleness Logic

A state is considered **stale** when:
1. It hasn't been updated within `intervalSeconds + gracePeriodSeconds`, OR
2. It has never been updated since monitoring started

The grace period prevents false alarms due to minor timing variations or temporary network hiccups.

### Orphaned State Detection

The State Inspector identifies orphaned states — states without a running adapter or that are not referenced anywhere in your system.

**Features:**
- Detect states from removed adapters
- Detect states from disabled adapters
- Identify unreferenced states (not used in scripts, vis, automations)
- Categorize orphans by type (adapter removed, disabled, unreferenced)
- Group orphans by adapter for easy cleanup
- Configurable ignore list (e.g., skip system states)
- Report-only mode: no automatic deletion

#### States Created

- `system-health.0.inspector.orphanedStates.report` — Full JSON report with all orphaned states
- `system-health.0.inspector.orphanedStates.count` — Total number of orphaned states
- `system-health.0.inspector.orphanedStates.hasOrphans` — Boolean indicator
- `system-health.0.inspector.orphanedStates.byCategory` — Breakdown by category (JSON)

#### Orphan Categories

**adapter_removed**  
States whose adapter has been uninstalled. These are usually safe to delete.

**adapter_disabled**  
States from adapters that are installed but disabled. Review before deleting — the adapter might be re-enabled later.

**unreferenced**  
States from running adapters that aren't referenced in any scripts, visualizations, or automations. Review carefully — they might be used in ways the inspector can't detect.

#### Configuration

Configure an ignore list to exclude certain state patterns from detection:

```json
{
  "ignoreList": [
    "system.*",
    "admin.*",
    "*.info.*"
  ]
}
```

Supports simple wildcard patterns (`*` matches any text).

#### Cleanup Suggestions

The inspector provides cleanup suggestions based on orphan category:

- **Safe to delete:** States from removed adapters
- **Review required:** States from disabled adapters or unreferenced states
- **Keep for now:** States matching ignore patterns

**Important:** The adapter never deletes states automatically. Use the report to make informed cleanup decisions in the ioBroker admin UI.

### Stale State Inspector

The State Inspector identifies **writable states** that haven't been updated for a configured time threshold, helping you find states that may no longer be actively maintained or updated.

**Key Features:**
- Scans all states in your ioBroker system for staleness
- **Filters out read-only states** (`common.write === false`) to reduce false positives
- **Filters out states from inactive adapters** (disabled or removed) to focus on relevant states
- Configurable time threshold (default: 24 hours)
- Ignores system states (`system.*`, `admin.*`, etc.) and custom ignore patterns

#### Outdated State Detection Criteria

A state is considered **outdated/stale** when **all** of the following conditions are met:

1. **Writable:** The state has `common.write === true` (can be written to)
2. **Not Read-Only:** The state is NOT read-only (`common.read === true && common.write === false`)
3. **Active Adapter:** The state belongs to an **enabled** adapter (adapter instance with `common.enabled === true`)
4. **Old Timestamp:** The state hasn't been updated for longer than the configured threshold (default: 24 hours)
5. **Not Ignored:** The state doesn't match any ignore patterns

**Why these criteria?**

- **Read-only states** (e.g., config values, metadata) are **expected** to remain unchanged
- **States from disabled adapters** are **expected** to be stale (adapter isn't running)
- **Writable states** from active adapters should be updated regularly

This approach significantly reduces false positives compared to a simple "time since last update" check.

#### States Created

- `system-health.0.inspector.staleStates.report` — Full JSON report with all stale states
- `system-health.0.inspector.staleStates.count` — Total number of stale states
- `system-health.0.inspector.staleStates.hasStale` — Boolean indicator
- `system-health.0.inspector.staleStates.byAdapter` — Breakdown by adapter (JSON)
- `system-health.0.inspector.staleStates.lastScan` — Timestamp of last scan

#### Configuration

Configure the stale threshold and ignore patterns:

```json
{
  "enableStaleDetection": true,
  "staleThresholdHours": 24,
  "stateInspectorIgnorePatterns": [
    "system.*",
    "admin.*",
    "*.info.*"
  ]
}
```

**Parameters:**
- `enableStaleDetection` — Enable/disable stale state inspection (default: true)
- `staleThresholdHours` — Hours after which a state is considered stale (default: 24)
- `stateInspectorIgnorePatterns` — Array of wildcard patterns to ignore (e.g., `system.*`, `mydevice.*`)

#### Report Structure

```json
{
  "timestamp": "2026-02-25T12:00:00.000Z",
  "thresholdHours": 24,
  "totalStale": 15,
  "truncated": false,
  "staleStates": [
    {
      "id": "mqtt.0.device.temperature",
      "adapter": "mqtt.0",
      "lastUpdate": "2026-02-24T10:30:00.000Z",
      "ageHours": 25
    }
  ],
  "summary": {
    "byAdapter": {
      "mqtt.0": 8,
      "zigbee.0": 5,
      "modbus.0": 2
    }
  }
}
```

**Important:** This inspector is **report-only** and does not delete states automatically. Use the report to investigate and clean up stale states manually.

### Duplicate State Detection

The State Inspector identifies duplicate data points — states with identical values or similar naming patterns that may indicate redundant sensors or adapters monitoring the same entity.

**Features:**
- Detect states with identical values across different adapters (value-based duplicates)
- Identify naming pattern duplicates using Levenshtein similarity (e.g., `hm-rpc.0.device.temperature` and `hm-rpc.0.device.temperatur`)
- Report includes staleness information to identify outdated duplicates
- Configurable similarity threshold for naming detection (0-1, default: 0.9)
- Automatic confidence scoring (high/medium) based on update frequency
- Merge and deduplicate results to avoid overlap between detection methods
- System and admin states are automatically excluded

**Configuration:**
- `enableDuplicateDetection` — Enable/disable duplicate detection (default: true)
- `duplicateSimilarityThreshold` — Similarity threshold for naming pattern detection (0-1, default: 0.9)

#### States Created

- `system-health.0.inspector.duplicates.report` — Full JSON report with duplicate groups
- `system-health.0.inspector.duplicates.count` — Number of duplicate groups found
- `system-health.0.inspector.duplicates.lastScan` — Timestamp of last scan

#### Duplicate Types

**Value Duplicates**  
States with identical values, type, and unit. Example: Two temperature sensors from different adapters reporting the exact same value (21.5°C) could indicate they're monitoring the same physical location.

**Naming Duplicates**  
States with similar names and properties. Example: `zigbee.0.room.temperature` and `hm-rpc.0.room.temp` might be the same sensor integrated via two different protocols.

#### Report Structure

```json
{
  "timestamp": 1709194800000,
  "duplicateGroups": 2,
  "totalDuplicateStates": 5,
  "duplicates": [
    {
      "type": "value",
      "reason": "Identical value across multiple states",
      "value": 21.5,
      "dataType": "number",
      "unit": "°C",
      "confidence": "high",
      "states": [
        {
          "id": "hm-rpc.0.livingroom.temperature",
          "name": "Living Room Temperature",
          "lastChanged": 1709194200000,
          "isStale": false
        },
        {
          "id": "zigbee.0.livingroom.temp",
          "name": "Living Room Temp",
          "lastChanged": 1709194150000,
          "isStale": false
        }
      ]
    },
    {
      "type": "naming",
      "reason": "Similar naming pattern detected",
      "pattern": "hm-rpc.0.device123.*",
      "confidence": "medium",
      "states": [...]
    }
  ]
}
```

#### Use Cases

- **Consolidation:** Identify redundant integrations of the same device
- **Cleanup:** Find duplicate sensors that should be removed
- **Troubleshooting:** Detect misconfigured adapters creating duplicate data points
- **Optimization:** Reduce storage and processing overhead from redundant states

**Important:** Duplicates are not automatically removed. Review the report to determine which states to keep and which to remove.

## How This Project Works

This adapter is developed by AI agents from the ioBroker community. Here's how:

- **Humans** create Issues (bugs, feature requests) using the provided templates
- **AI agents** (running on [OpenClaw](https://openclaw.ai)) pick up issues and submit Pull Requests
- **A maintainer bot** reviews and merges PRs

Want to contribute with your own OpenClaw bot? See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT License - see [LICENSE](LICENSE)
