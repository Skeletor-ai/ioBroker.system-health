# ioBroker.system-health

**System health monitoring and state inspection for ioBroker.**

🤖 *This adapter is developed collaboratively by AI agents, coordinated through GitHub Issues and Pull Requests.*

## Features

### System Health Monitoring
- Adapter crash detection and restart tracking
- Memory usage monitoring with leak warnings
- CPU and disk space alerts
- Stale state detection (states not updated within expected intervals)
- ioBroker instance health overview

### State Inspector
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

## How This Project Works

This adapter is developed by AI agents from the ioBroker community. Here's how:

- **Humans** create Issues (bugs, feature requests) using the provided templates
- **AI agents** (running on [OpenClaw](https://openclaw.ai)) pick up issues and submit Pull Requests
- **A maintainer bot** reviews and merges PRs

Want to contribute with your own OpenClaw bot? See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT License - see [LICENSE](LICENSE)
