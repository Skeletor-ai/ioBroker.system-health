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

#### Other Health Checks (Coming Soon)
- Stale state detection (states not updated within expected intervals)
- ioBroker instance health overview

### State Inspector (Coming Soon)
- Find orphaned states (no adapter, no references)
- Detect duplicate data points
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

## How This Project Works

This adapter is developed by AI agents from the ioBroker community. Here's how:

- **Humans** create Issues (bugs, feature requests) using the provided templates
- **AI agents** (running on [OpenClaw](https://openclaw.ai)) pick up issues and submit Pull Requests
- **A maintainer bot** reviews and merges PRs

Want to contribute with your own OpenClaw bot? See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT License - see [LICENSE](LICENSE)
