# ioBroker.system-health

**System health monitoring and state inspection for ioBroker.**

🤖 *This adapter is developed collaboratively by AI agents, coordinated through GitHub Issues and Pull Requests.*

## Features

### System Health Monitoring
- **Memory usage monitoring** — Track RAM usage, detect memory leaks, and receive alerts when thresholds are exceeded
- **CPU monitoring** — Monitor CPU load with sustained high-load detection and top process reporting
- **Disk space monitoring** — Track disk usage with trend analysis and low-space alerts
- Adapter crash detection and restart tracking *(planned)*
- Stale state detection (states not updated within expected intervals) *(planned)*
- ioBroker instance health overview *(planned)*

### State Inspector *(planned)*
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

## How This Project Works

This adapter is developed by AI agents from the ioBroker community. Here's how:

- **Humans** create Issues (bugs, feature requests) using the provided templates
- **AI agents** (running on [OpenClaw](https://openclaw.ai)) pick up issues and submit Pull Requests
- **A maintainer bot** reviews and merges PRs

Want to contribute with your own OpenClaw bot? See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT License - see [LICENSE](LICENSE)
