# Initial review evidence

Date: 2026-11-07. Reviewer: Codex.

## Project

Angular 22 standalone components and signals, Tauri 2 with Rust, local SQLite storage, Univer spreadsheet UI, map/3D components. The workspace is not a Git repository. The initial review did not change product source, farm records, credentials, settings or dependencies.

## Actual access checks

- tmux list-panes: denied with Operation not permitted.
- Terminal computer-use access: tool refuses the app for safety reasons.
- Claude CLI 2.1.319 is installed. A minimal no-tools print-mode probe returned Not logged in; claude auth status returned loggedIn false / authMethod none. No worker task ran. Authentication was not modified.
- Native UKMAC app accessibility interaction is available. Both a built project app and an installed app have the same bundle ID. The bundle-ID selector was ambiguous, so exact app paths were used. Final review actions were made through `/Applications/UKMAC Monitoring.app`.
- This is an existing binary; no claim is made that it matches the current source or verifies future source edits.

## Reproduced interactions

1. QA/QC Management initially exposed 663 rows and 72 columns, KPI cards, chart images, jump controls, pagination, Import, two Export entry points and Open in sheet through accessibility.
2. Navigated to home. Pursat was visible as one saved farm.
3. Entered no-such-mac-ux-review in Search MACs. All farm groups disappeared; no empty-result explanation or clear-search call to action appeared in the content. Cleared the query afterward. This supports UX-02.
4. Opened Create MAC and inspected its labelled fields, template checkbox, Cancel and Create MAC actions. Closed with Cancel without submitting or saving.
5. Opened Pursat and inspected dashboard/sidebar controls.
6. Entered zone map into Search menu. The farm navigation links disappeared, including Zone Map; no no-results message appeared. Source inspection explains the parent-filter mismatch. This supports UX-01. Cleared the query afterward and confirmed all navigation links were restored.

## Source-confirmed findings

- Home load error is not retained as a distinct state: MacList.refresh sets loaded true in finally, and home uses loaded + zero MACs as onboarding. UX-03.
- Shared Modal has no explicit aria-labelledby/aria-describedby association. UX-05.
- Farm form has no field-level required/invalid feedback; client coordinate parser only tests finite numbers. UX-06.
- Farm/table submit labels do not show pending progress and save methods lack an initial busy guard. UX-07.
- Home settings destination label differs from farm navigation and hides Google connection scope. UX-16.

Other backlog items are triage work, not declared defects.

## Visual verification gap

Native screenshot captures returned the app's background without the controls present in the accessibility tree, including after raising the window. The cause could be capture/runtime behaviour; the evidence does not establish that the real UI is blank. No claims about spacing, contrast, colour, clipping or polished appearance are accepted from these captures. Resolve the capture issue or use another allowed, reliable view of the actual running build before visual acceptance.

## Source baseline and checks

This initial phase adds coordination documents only. A SHA-256 manifest and local reference archive cover 121 source/build-configuration files, excluding account/OAuth configuration and the database. All inventoried files matched immediately before archiving.

The existing unit suite passed with `npm test`: 17 test files and 99 tests, local start time 21:47:48. This establishes a source test baseline; it does not validate an implementation or the native binary. Production builds and Rust tests have not been run in this phase. Claude and the release owner must record actual results when those steps occur.
