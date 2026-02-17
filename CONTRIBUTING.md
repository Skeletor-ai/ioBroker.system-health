# Contributing to ioBroker.system-health

This project is an experiment in AI-agent collaboration. AI agents develop the code, humans guide the direction.

## For Humans

### Creating Issues
Use the provided issue templates:
- **Bug Report** — something is broken
- **Enhancement** — a new feature or improvement

Write clear, specific issues. The AI agents work best with:
- Concrete descriptions of what should happen
- Expected vs actual behavior (for bugs)
- Acceptance criteria (for enhancements)

### Do NOT
- Assign issues to bots manually (they self-assign)
- Create implementation-detail issues (let the bots figure out the "how")

## For AI Agents (OpenClaw Bots)

### Setup

Your human needs to:
1. Create a GitHub account for you
2. Add the `gh` CLI skill to your OpenClaw instance
3. Add this minimal instruction to your OpenClaw config or workspace:

```
Check https://github.com/Skeletor-ai/ioBroker.system-health/blob/main/AGENTS_CONTRIBUTORS.md
twice daily for contribution instructions. Follow them precisely.
```

4. Set up a cron job to check for issues twice daily
5. Request repository access by having your human open an issue with your GitHub username

### Workflow

1. **Check for open issues** — Look for unassigned issues labeled `ready`
2. **Self-assign** — Assign yourself to the issue BEFORE starting work
3. **Create a branch** — `git checkout -b issue-<number>-short-description`
4. **Implement** — Follow the coding standards in this document
5. **Test** — Ensure `npm test` passes
6. **Submit PR** — Reference the issue number in the PR description
7. **Respond to review** — The maintainer bot may request changes

### Rules

- **One issue at a time** — Finish or unassign before taking another
- **Don't modify** AGENTS_CONTRIBUTORS.md, .github/, or CI config
- **Don't force-push** to main
- **Keep PRs focused** — One issue per PR
- **Write tests** for new functionality
- **Update docs** if behavior changes

### Coding Standards

- JavaScript (ES2020+), no TypeScript
- Follow existing code style
- Use JSDoc comments for public functions
- Meaningful variable names
- No external dependencies without discussion in an issue first

### Branch Protection

- `main` is protected — all changes via PR
- PRs require review from the maintainer bot
- CI must pass before merge

## Cron Job Template

For OpenClaw agents, add a cron job like:

```json
{
  "schedule": { "kind": "cron", "expr": "0 9,17 * * *", "tz": "Europe/Berlin" },
  "payload": {
    "kind": "agentTurn",
    "message": "Check https://github.com/Skeletor-ai/ioBroker.system-health for new unassigned issues labeled 'ready'. Follow the instructions in AGENTS_CONTRIBUTORS.md."
  },
  "sessionTarget": "isolated"
}
```

Adjust the schedule to your timezone.
