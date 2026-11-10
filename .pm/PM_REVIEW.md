# Codex PM review inbox

Owner: Codex PM. Claude reads this file before starting each task and after producing each task report. Claude writes its own reports and STATUS.md; leave this review file to Codex to avoid concurrent edits.

## Session status · 2026-11-07

The user reports that the Claude coordinator has started. Codex is now actively checking shared files. At the first check after that message, STATUS.md still said NOT_STARTED and no source changes or task reports existed. This is a handshake pending, not evidence that the worker failed.

**Coordinator: next action:** claim your worker name and first task in STATUS.md, record owned files, then start the priority queue. Do not wait for Codex acceptance of each task before moving to an independent task; do resolve CHANGES_REQUESTED items first.

**Review protocol:** publish a task report when a coherent change is ready, with exact changed-file list and test results. Mark source review, automated verification and native visual verification separately. Codex will inspect source against `.pm/baseline/source-before.tar.gz` and per-task backups, then add its decision here. An old installed app binary cannot validate new source.

## Current acceptance decisions

None. Awaiting first worker claim/report.

## Priority adjustment · UX-10 is READY · Reproduced with isolated fixtures

Handle UX-10 in the first implementation batch, ahead of purely cosmetic triage. Codex executed the real WorkbookStore class with in-memory Api stubs; no Tauri invoke or live database write was used. Reproduction source: `.pm/verification/store-failure-repro.ts`; invocation and limitations are in `.pm/verification/README.md`.

Observed results:

1. Failed updateCells resolves its promise after rolling back and emitting one toast. An upstream caller cannot distinguish this failed persistence from success.
2. Failed reorderRows rejects, but the displayed order remains `[2,1]` while the fixture's persisted order remains `[1,2]`; pending count returns to zero.
3. Start edits to two different rows. Resolve the second save successfully, then reject the first. The first operation restores its whole-sheet snapshot and reverts the second row to its original value in memory, despite that second value having been persisted successfully by the stub. Pending count returns to zero.

**Required fix and review checks:** rollback/reconcile only the failed operation's own still-applicable edits; preserve later successful or newer edits, additions and row identity. Define an explicit outcome for failed cell saves that the spreadsheet caller honours. Roll back/reconcile failed optimistic row/table ordering. Add meaningful out-of-order failure/success regression tests using deferred promises. Review the Univer sync/dirty-state interaction before choosing exception propagation; a change that only adds an error badge does not resolve the stale-state problem. Test entirely with fixtures, then report remaining native validation separately.

The PM reproduction asserts the current bad behaviour to demonstrate it. It is **not** a regression suite and is expected to stop passing once the defects are fixed. Replace its assertions with proper regression tests in the project's suite for acceptance.

## New reproduction · UX-08 is READY · 21:57 local

On the installed app's Pursat dashboard, Codex opened More and observed Edit MAC, Export for Power BI and Delete MAC. In a single sequential UI test, opening the menu expanded it; pressing Escape left the accessibility tree unchanged with the menu still expanded and its three actions present. Focus remained on the HTML document. This confirms the keyboard-dismissal problem for the farm action menu. Implement the smallest consistent keyboard/focus correction, then check the equivalent home and table menus. Preserve outside-click dismissal and existing destructive-action confirmations.

A subsequent app observation reported noWindowsAvailable for that installed-app binding. Codex did not relaunch it. The already-running project-bundle app has an available home window and is now the baseline UI review target. No native rebuild or release change has been requested.

## Capture investigation

At 21:56 local time, Codex obtained a complete native screenshot of the installed app: sidebar, dashboard header, satellite map, legend, camera controls and KPI cards were all visible. The earlier background-only capture gap is no longer present in this observation. Do not change product CSS to compensate for that transient capture problem.

The installed binary is still the pre-change reference. Native review of new source will need a coordinated new build. Codex currently owns native UI navigation; source review agents should not simultaneously drive or relaunch that app.

### Visual triage evidence

- On the Pursat dashboard the long legend runs into the lower-right map-control region. Verify whether the clipped/occluded trailing legend items are keyboard/scroll reachable, then handle through UX-14/15 if confirmed. Keep imagery credit visible.
- Some zone chips are clipped at the left/right map edges; determine whether this is intended camera cropping before changing it. Do not treat camera framing alone as an app-wide layout defect.
- Existing design language is coherent. Focus on discovery, accessible state and reliable actions before cosmetic redesign.
