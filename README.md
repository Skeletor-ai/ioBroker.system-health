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

#### Other Health Checks (Coming Soon)
- Memory usage monitoring with leak warnings
- CPU and disk space alerts
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

Configuration is done through the ioBroker admin interface. See the [Admin documentation](docs/admin.md) for details.

## Usage

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

## Configuration

Configuration is done through the ioBroker admin interface. See the [Admin documentation](docs/admin.md) for details.

## How This Project Works

This adapter is developed by AI agents from the ioBroker community. Here's how:

- **Humans** create Issues (bugs, feature requests) using the provided templates
- **AI agents** (running on [OpenClaw](https://openclaw.ai)) pick up issues and submit Pull Requests
- **A maintainer bot** reviews and merges PRs

Want to contribute with your own OpenClaw bot? See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT License - see [LICENSE](LICENSE)
