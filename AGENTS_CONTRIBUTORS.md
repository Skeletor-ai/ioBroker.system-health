# Agent Instructions — ioBroker.system-health

You are an AI agent contributing to ioBroker.system-health.

## ⚠️ CRITICAL: Common Mistakes to Avoid

### 1. Don't Work on Multiple Issues Simultaneously
❌ Pick #35, then claim #21 while PR #35 is in review
✅ Finish one issue completely before claiming next

### 2. Don't Ignore Review Feedback
❌ PR open with review comments, you claim new issue
✅ Address ALL comments FIRST, then move to next

### 3. Don't Skip dev-server Testing
❌ Submit PR without `dev-server watch`
✅ Test on real ioBroker, document in PR

### 4. Don't Repeat Format Errors
- words.js format errors (PR #7, #24)
- Missing JSDoc comments
- Tests not updated
**FIX**: Always run `npm test`

---

## Your Mission
Pick up open GitHub issues and implement via Pull Requests.

## Workflow

### 1. Check Your Status FIRST
```bash
gh pr list --repo Skeletor-ai/ioBroker.system-health --state open --author @me
```

**Decision Tree:**
- Open PRs with review comments → Address them FIRST
- Open PRs without feedback → Wait for review
- No open PRs → Proceed to step 2

### 2. Find Work
```bash
gh issue list --repo Skeletor-ai/ioBroker.system-health --label ready --assignee "" --state open
```
**Priority**: `bug` > `enhancement`. Bugs take precedence.

### 3. Claim
```bash
gh issue edit <NUMBER> --repo Skeletor-ai/ioBroker.system-health --add-assignee @me
```

### 4. Understand
```bash
gh issue view <NUMBER> --repo Skeletor-ai/ioBroker.system-health
```

### 5. Evaluate
Before implementing, check if it's clear, reasonable, and fits existing patterns. If vague, comment on the issue instead.

### 6. Implement
- JavaScript (ES2020+), no TypeScript
- Follow existing patterns
- Add JSDoc to public functions
- Write tests
- Update README if user-facing
- **Run `npm test` before PR** ← MANDATORY

### 7. Test with dev-server (MANDATORY!)
```bash
npm install -g @iobroker/dev-server
dev-server setup
dev-server watch &
# Wait 30s, verify adapter starts, states created, no errors
kill %1
```
**PRs without dev-server testing will be REJECTED**

### 8. Submit PR
```bash
git push -u origin issue-<NUMBER>-short-desc
gh pr create --repo Skeletor-ai/ioBroker.system-health \
  --title "Fix #<NUMBER>: <desc>" \
  --body "Closes #<NUMBER>\n\n## Changes\n...\n\n## Testing\n- Tested with dev-server watch"
```

### 9. Handle Review Feedback
```bash
gh pr view <PR-NUMBER> --repo Skeletor-ai/ioBroker.system-health --comments
```
Address comments, push updates, **don't claim new issues while waiting**.

### 10. Move On
Once merged, pick next issue. **ONE at a time.**

---

## What NOT to Do
❌ Work on multiple issues simultaneously
❌ Ignore review feedback
❌ Skip dev-server testing
❌ Push directly to main
❌ Modify this file (AGENTS_CONTRIBUTORS.md)
❌ Add dependencies without approval
❌ Work on already-assigned issues

---

## Learnings (PR #47)
- Multiple issues block review pipeline
- Same mistakes repeat (format, testing)
- dev-server is mandatory for ioBroker adapters
- Review cycle > new work when feedback pending

See PR #47 for meta-improvements context.
