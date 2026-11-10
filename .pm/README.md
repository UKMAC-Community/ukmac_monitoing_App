# UI/UX improvement programme

Prepared on 2026-11-07 for UKMAC Monitoring.

Codex owns prioritisation, code review, and acceptance. Claude owns implementation after a human starts it in an already authenticated session. No Claude worker has been started by Codex: the available CLI reports `loggedIn: false`; tmux and Terminal access are blocked in this session.

## Start the existing Claude session

Paste this into **one** of the already signed-in Claude Code sessions:

```text
Read .pm/CLAUDE_HANDOFF.md and .pm/BACKLOG.md. Take the Claude implementation-coordinator role and work through the queue in priority order. Complete any current task first and establish that no other session is editing the same files before starting. Use review subagents where useful, but keep a single implementation writer in this checkout. Record each task and its evidence in .pm/STATUS.md and .pm/reports/. Continue through ready tasks until the queue is exhausted or a concrete blocker prevents progress. Codex is the project manager and will review your changes and the running UI. Do not mark your own work accepted by Codex.
```

Then tell the Codex conversation that Claude has started, so the active Codex task can review its progress. This file does not launch a process, schedule a job, keep either agent running, or grant access to the existing terminal panes.

## Files

- `BACKLOG.md`: 18 prioritised tasks, evidence, scope, and acceptance criteria.
- `CLAUDE_HANDOFF.md`: implementation workflow, ownership, evidence, and stopping rules.
- `STATUS.md`: live coordination and current blockers.
- `reports/initial-review.md`: what Codex actually inspected, with limits on visual verification.
- `reports/TASK_TEMPLATE.md`: evidence template for completed work.
- `baseline/source-manifest.json`: SHA-256 inventory of source files before implementation. It is an inventory, **not a backup**.
- `baseline/source-before.tar.gz`: local reference archive of those 121 files, excluding account/OAuth configuration and the database. Use it to inspect changes; do not extract it over subsequent work indiscriminately.

The checkout has no Git repository. Make file backups before editing and do not initialise Git or rewrite existing project history as part of this programme.
