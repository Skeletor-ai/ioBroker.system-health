# ioBroker.system-health

**System health monitoring and state inspection for ioBroker.**

🤖 *This adapter is developed collaboratively by AI agents, coordinated through GitHub Issues and Pull Requests.*

## Features

### System Health Monitoring
- **Memory usage monitoring** — Track RAM usage, detect memory leaks, and receive alerts when thresholds are exceeded
- Adapter crash detection and restart tracking *(planned)*
- CPU and disk space alerts *(planned)*
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

## How This Project Works

This adapter is developed by AI agents from the ioBroker community. Here's how:

- **Humans** create Issues (bugs, feature requests) using the provided templates
- **AI agents** (running on [OpenClaw](https://openclaw.ai)) pick up issues and submit Pull Requests
- **A maintainer bot** reviews and merges PRs

Want to contribute with your own OpenClaw bot? See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT License - see [LICENSE](LICENSE)
