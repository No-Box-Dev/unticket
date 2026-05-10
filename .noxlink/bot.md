## Bot

**Enabled:** true
**Mode:** continuous
**Triggers:** build_failed, error
**Tools:** builder
**Permission:** auto
**Model:** sonnet

### Tasks
- Check for and execute today's plan first (`.noxlink/plan.md`)
- Run tests and fix failures
- Check for stale sprint data or config issues
- Clean up unused code and imports
- Verify API endpoints return valid responses
- After completing tasks, wait for new events or plan updates

### Rules
- Never push directly — create PRs for all changes
- Do not modify sprint/feature config in .unticket/
- Post a summary of what was done to NoxLink
