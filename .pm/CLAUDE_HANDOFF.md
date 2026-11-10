# Claude implementation handoff

## Objective and ownership

Improve the usability and professional finish of this Angular 22 / Tauri 2 desktop app. Keep the existing UKMAC design language, farm terminology, SQLite data, spreadsheet behaviour, formulas, Google read-only integration, and maps intact. Make small, evidence-backed changes to real problems.

The user explicitly requested Claude workers and Codex management. You may use available Claude review subagents. This is a shared checkout without Git: **one implementation writer at a time**. Give parallel reviewers read-only tasks. Do not create multiple independent writers in overlapping source files. Check for unfinished work by other sessions and preserve it; an entry in STATUS.md is coordination, not an operating-system lock.

Codex is responsible for independent code review and UI acceptance when its task is active. Claude may mark a task `READY_FOR_REVIEW`, never `ACCEPTED`. A successful unit test or build alone is not proof that the native UI works.

## Working loop

1. Read STATUS.md, PM_REVIEW.md, the relevant backlog item, README.md, and applicable repository instructions. Codex owns PM_REVIEW.md; Claude owns task reports and its progress entries in STATUS.md.
2. Select the first `READY` task. Tasks marked `TRIAGE` need reproduction first. Change a triage item to `READY` only when a concrete defect or demonstrable usability obstacle is recorded. If existing behaviour is adequate, mark it `NO_CHANGE_NEEDED` with evidence.
3. Record `IN_PROGRESS`, session/worker name, owned files, and start time in STATUS.md. Confirm another session is not writing those files. Do not overwrite concurrent changes.
4. Before editing, copy each owned file into `.pm/backups/<task-id>/` preserving its relative path. Backups and source-manifest.json serve different purposes. Never copy credentials, OAuth files, the user's database, or account/session tokens into .pm.
5. Implement the smallest complete improvement. Use existing components, CSS tokens and Angular signal patterns. Do not replace the design system, spreadsheet engine, map engine, or framework. Do not expand schemas or invent data-entry fields from descriptive copy.
6. Run focused checks for the behaviour. Add regression tests for meaningful logic, validation, state transitions, or accessibility contracts; do not add tests that merely mirror cosmetic markup. Run `npm test -- --watch=false` and `npm run build` once per coherent batch, rerunning after failures or subsequent changes that warrant it. Run Rust checks only for Rust changes or final release validation.
7. Exercise the real user flow in the native app if your allowed tools support it. Record the app binary/build you tested. Browser mocks are useful diagnostics but do not verify Tauri IPC, SQLite persistence, or native file dialogs. If visual capture or native access fails, record `UI_VERIFICATION_BLOCKED`; do not claim visual acceptance.
8. Write `.pm/reports/<task-id>.md` using TASK_TEMPLATE.md. Record changed files, behaviour before/after, check results, UI evidence, limitations and follow-up work.
9. Set `READY_FOR_REVIEW` and proceed to the next independent ready item. Keep dependent work waiting for its prerequisite. Check STATUS.md for Codex `CHANGES_REQUESTED` entries before starting a new task; resolve those first. Do not mark unfinished or blocked work complete.

## Scope boundaries

- Work locally. Preserve live farm records; use stubs or explicitly disposable fixtures for fault injection and write-path tests. Do not delete or replace user data to exercise error states.
- Do not read or change login tokens, OAuth credentials, Claude/Codex permissions, system security settings or subscription/account configuration. Do not use permission-bypass flags. Report authentication or permission blockers.
- Do not purchase API credits, change providers/models, install plugins, upgrade dependencies, or incur a new paid service as part of the queue.
- Preserve current authorised feature work in the other sessions. The supplied screenshot mentions map/animation work, but it is not evidence of its current implementation state. Re-read current files before editing.
- Do not rebuild/relaunch the installed native app while another session is testing it. Only the designated release owner may publish a new local binary; retain the preceding build until the new one is verified.
- No overnight deployment, external publishing, database migration, permanent deletion, or broad redesign is included in this handoff.
- Prefer useful, bounded work. Stop after the queue is done, when all remaining tasks depend on missing access/evidence, or when the account reports a usage limit. Do not loop just to consume tokens.

## Independent review lanes

If review subagents are available, give them disjoint **read-only** lanes:

1. Navigation, discovery, keyboard and focus: UX-01, UX-02, UX-08, UX-09.
2. Forms, loading and persistence feedback: UX-03 through UX-07, UX-10.
3. Tables, maps and layout: UX-11 through UX-17.

Each reviewer reports file references, a reproduction or code path, severity, and proposed acceptance checks. The implementation coordinator remains the only source writer. UX-18 is the final integration gate.

## When blocked

Record the exact blocked action and tool output without secrets. Continue independent tasks that remain possible. Do not weaken security controls, impersonate a successful login, or report that Codex is monitoring after its task has stopped. These markdown files provide durable handoff, not an autonomous scheduler.
