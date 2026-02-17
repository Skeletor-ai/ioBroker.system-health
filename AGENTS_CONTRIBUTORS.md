# Agent Instructions — ioBroker.health

You are an AI agent contributing to ioBroker.health, a system health monitoring and state inspection adapter for ioBroker.

## Your Mission

Pick up open GitHub issues and implement them via Pull Requests.

## Workflow

### 1. Find Work
```bash
gh issue list --repo Skeletor-ai/ioBroker.health --label ready --assignee "" --state open
```

If no unassigned `ready` issues exist, you're done. Check back later.

### 2. Claim an Issue
Pick the **oldest** unassigned `ready` issue:
```bash
gh issue edit <NUMBER> --repo Skeletor-ai/ioBroker.health --add-assignee @me
```

### 3. Understand the Issue
Read the full issue description:
```bash
gh issue view <NUMBER> --repo Skeletor-ai/ioBroker.health
```

### 4. Create a Branch & Work
```bash
git checkout main && git pull
git checkout -b issue-<NUMBER>-short-description
```

Implement the change. Follow these rules:
- JavaScript (ES2020+), no TypeScript
- Follow existing code patterns
- Add JSDoc comments to public functions
- Write tests for new functionality
- Update README.md if user-facing behavior changes
- Run `npm test` before submitting

### 5. Submit a Pull Request
```bash
git push -u origin issue-<NUMBER>-short-description
gh pr create --repo Skeletor-ai/ioBroker.health \
  --title "Fix #<NUMBER>: <short description>" \
  --body "Closes #<NUMBER>\n\n<description of changes>"
```

### 6. Handle Review Feedback
Check if your PR has review comments:
```bash
gh pr view <PR-NUMBER> --repo Skeletor-ai/ioBroker.health --comments
```
Address any requested changes, push updates, and comment when done.

### 7. Move On
Once your PR is merged (or while waiting for review), you may pick up the next issue.
Only work on **one issue at a time**.

## Project Structure

```
ioBroker.health/
├── lib/                  # Core modules
│   ├── health-checks/    # System health check implementations
│   └── state-inspector/  # State inspection implementations
├── test/                 # Tests
├── admin/                # Admin UI
├── docs/                 # Documentation
├── main.js               # Adapter entry point
├── io-package.json       # ioBroker package manifest
└── package.json
```

## What NOT to Do
- Do NOT modify this file (AGENTS_CONTRIBUTORS.md)
- Do NOT modify .github/ directory or CI configuration
- Do NOT push directly to main
- Do NOT add npm dependencies without an approved issue
- Do NOT work on issues that are already assigned to another agent
- Do NOT create issues — that's for humans

## Communication
All communication happens through GitHub:
- **Issues** for requirements and bugs
- **PR comments** for code review
- **PR description** for explaining your changes

Keep comments concise and technical.
