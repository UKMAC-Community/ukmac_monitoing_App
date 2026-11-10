# Prioritised UI/UX queue

Initial state: 7 READY, 10 TRIAGE, 1 WAITING. No item is implemented or accepted by this document.

`READY`: enough evidence to implement a bounded fix. `TRIAGE`: inspect/reproduce before changing anything. `WAITING`: prerequisites outstanding. Track transitions in STATUS.md and leave this initial evidence intact.

## UX-01 · P1 · READY · Menu search must find Zone Map

**Evidence:** Codex opened Pursat in the native app and entered `zone map` in Search menu. All farm navigation links disappeared, including Zone Map, and no no-results explanation appeared. In `app.ts`, shownMacs depends on matching the MAC text or shownHeadings, while the separately computed showZoneMap match is omitted. `app.html` also suppresses its empty result inside a MAC.

**Scope:** `src/app/app.ts`, `src/app/app.html`, relevant local styles/tests.

**Acceptance:** `zone map` finds and opens Zone Map; a table query finds the expected table; an unknown query shows a clear no-results message and Clear search action; clearing search restores the existing group state. No edits to farm records.

## UX-02 · P1 · READY · Home search needs an empty result and recovery

**Evidence:** Codex searched `no-such-mac-ux-review` in the native home page. The farm list disappeared and the accessibility tree contained only the header, search and creation/import actions. `home-page.ts` handles zero stored MACs but not a nonempty MAC list with zero filtered groups.

**Scope:** `src/app/pages/home-page.ts`.

**Acceptance:** show an explanatory no-results message that includes the search term and a Clear search action; clearing restores Pursat; a genuinely empty database still shows first-MAC onboarding; whitespace search behaves like no query. Announce the result count accessibly without excessive live announcements.

## UX-03 · P1 · READY · Distinguish failed farm loading from an empty database

**Evidence:** `core/mac-list.ts` sets loaded to true even when listMacs rejects, stores no error state, and the home page then presents first-MAC onboarding against an empty array. A toast disappears and offers no persistent retry.

**Scope:** `src/app/core/mac-list.ts`, home page, affected consumers/tests.

**Acceptance:** initial load failure shows persistent, useful feedback and Retry; a rejected refresh with prior data retains it and explains that refresh failed; successful retry clears the error; actual zero results retain onboarding. Test with a stubbed Api; do not damage the user's SQLite file to induce failure.

## UX-04 · P1 · TRIAGE · Distinguish unavailable, loading and missing workbooks/tables

**Evidence to inspect:** `WorkbookStore.load` clears the workbook on an IPC rejection; `sheet-page.html` has a missing-table fallback. Review `mac-layout.ts` to establish exactly which states reach that message.

**Acceptance if confirmed:** loading never flashes a deleted-table claim; IPC failure offers Retry and safe navigation; genuinely absent MAC/table gets an accurate message. Exercise all three with fixtures. Keep this independent of UX-03's farm-list state.

## UX-05 · P1 · READY · Explicit accessible naming for shared dialogs

**Evidence:** `components/modal.ts` renders its title/subtitle but has no explicit aria-labelledby/aria-describedby association. Native accessibility currently derives a container name, which does not establish a durable naming contract across hosts.

**Scope:** shared Modal only, plus necessary focused tests.

**Acceptance:** every open dialog has a unique title association; optional subtitle association exists only when present; two mounted instances do not share IDs; native focus trapping, Escape, close and return-to-trigger behaviour still work. Retain the existing dialog visual design.

## UX-06 · P1 · READY · Field-level farm validation

**Evidence:** `mac-dialog.ts` labels Name/Code required but lacks required/invalid semantics and associated field errors. Coordinate parsing checks only finite numeric input on the client; inspect Rust validation before choosing consistent limits. Date ordering and required names currently depend on the eventual save path.

**Acceptance:** trimmed empty name/code, latitude outside -90..90, longitude outside -180..180, and end-before-start produce useful inline feedback before a write; blank optional coordinates remain valid; first invalid field receives focus; errors are associated with their fields; server-side validation remains authoritative. Test valid and invalid inputs using a stubbed API.

## UX-07 · P1 · READY · Clear submission progress and duplicate-submit protection

**Evidence:** `mac-dialog.ts` and `table-dialog.ts` disable the submit button while busy but leave its label unchanged; their save methods have no initial busy guard. Inspect all call paths before adjusting related controls.

**Acceptance:** Create/Save changes to Creating…/Saving… and an accessible busy status; repeated submit events during one pending operation cause one write; success/error restores the right state; form data survives failure. Define sensible dismissal behaviour during in-flight saves; do not freeze the whole app.

## UX-08 · P1 · TRIAGE · Keyboard-operable action menus

**Evidence to inspect:** home, MAC and sheet pages use floating menu panels and scrims with plain buttons. Verify keyboard opening, Escape dismissal, tab movement, focus return and viewport containment.

**Acceptance if confirmed:** menus can be opened and closed without a mouse; Escape restores focus to the opener; no invisible focus behind the overlay; long labels and menus near the window bottom remain reachable. Use an appropriate native popover/dialog or proven CDK pattern consistent with the app, with no framework replacement.

## UX-09 · P2 · TRIAGE · Navigation orientation and focus

**Evidence to inspect:** source uses routerLinkActive classes and title attributes; inspect the rendered active-link semantics, collapsed rail and focus after route changes. Initial document accessibility description remained MACs on the MAC dashboard; check actual document titles before deciding a fix.

**Acceptance if confirmed:** current navigation is announced; icon-only controls retain meaningful names; route changes provide an intelligible page title and sensible keyboard focus; focus stays visible in expanded and collapsed navigation. Preserve the user's saved expansion state.

## UX-10 · P1 · TRIAGE · Saving status must reflect failed persistence

**Evidence to inspect:** app.html shows Saved on this Mac whenever saving() is zero; WorkbookStore.run decrements the counter in finally. Determine how failed optimistic edits are retained/rolled back and whether existing errors remain discoverable after the toast disappears.

**Acceptance if confirmed:** pending, saved and unsaved/failed work are distinguishable; the UI never reports persisted success for a failed write; retry/rollback is understandable; opening another page does not silently discard retained edits. Use failure injection against fixtures, verify stored values and UI values agree, and preserve row identity/undo behaviour.

## UX-11 · P2 · TRIAGE · Empty tables should offer a next action

**Evidence to inspect:** sheet-table.ts shows explanatory text when empty; assess whether Import and Open in sheet are discoverable in the surrounding page, especially below a dashboard.

**Acceptance if an obstacle is confirmed:** zero rows and zero search matches have different messages; first-entry flow offers appropriate existing actions; importing and manual entry remain equivalent supported paths; no invented farm fields or automatic data creation. Avoid duplicating the toolbar if its actions are already clear.

## UX-12 · P2 · TRIAGE · Invalid cells need feedback beyond colour

**Evidence to inspect:** README documents red invalid cells, sheet-page shows an aggregate problem count, and import preview uses cell titles. Check actual keyboard/screen-reader discoverability and error text.

**Acceptance if confirmed:** keyboard users can discover which value is invalid and how to fix it; error information does not depend only on red; formula columns remain read-only; bad imports remain reviewable with existing include/skip choices; large sheets remain responsive. Do not silently coerce or discard user values.

## UX-13 · P2 · TRIAGE · QA/QC table hierarchy and primary actions

**Evidence:** initial native accessibility tree shows the same title and Export action in the page header and data-card header, plus dashboard, search, jump controls and the 72-column table. This is evidence of structure, **not proof that the layout is bad**.

**Acceptance if visual review finds a real problem:** a clear entry point for editing records; the dashboard can be collapsed; grouped stage navigation and important controls stay usable; no accidental horizontal scrolling of the page shell; all existing export locations that users rely on remain available or have a clear replacement. Assess at 1400×900 and the supported 960×600 minimum with real screenshots before deciding what to change.

## UX-14 · P2 · TRIAGE · Map loading, missing-data and offline feedback

**Evidence to inspect:** map components and zone-map-page.ts; native app has working map controls in the accessibility tree, but imagery and overlays were not visually verified. Coordinate with current map work before claiming these files.

**Acceptance if confirmed:** loading has intelligible feedback; missing coordinates and missing plot layout have distinct actionable explanations; tile/network failure does not masquerade as an empty farm; retry works; satellite credit remains visible; Top/3D, Tour, zoom, Fit and expanded mode work. Preserve current authorised defaults and animation work. Do not fake satellite imagery or remove attribution.

## UX-15 · P2 · TRIAGE · Supported desktop window sizes and long content

**Evidence to inspect:** Tauri supports a 960×600 minimum and defaults to 1400×900. Test real content, long farm/table names, Khmer labels, dialogs, sidebar, sheet toolbar and map controls at both sizes.

**Acceptance if confirmed:** primary actions and dialog footer remain reachable; wrapping is intentional; long text truncates only with an accessible full label; horizontal scrolling belongs to wide data rather than the entire app; no clipped popover or overlapping footer. Use existing design tokens and page-scoped overrides; preserve copied system CSS.

## UX-16 · P2 · READY · Use one name for connection settings

**Evidence:** the native home link says Power BI & backup; app navigation and breadcrumbs call the destination Connections & backup. The settings page also contains Google Sheets, so the home label hides a supported use case.

**Scope:** home link label and directly related accessible copy/help only.

**Acceptance:** the same settings destination is named Connections & backup from home and farm navigation; Google Sheets remains easy to discover; labels are concise and fit the supported window; no credential or sign-in flow changes.

## UX-17 · P2 · TRIAGE · Preserve intentional edits when dialogs close

**Evidence to inspect:** shared Modal closes on Escape/scrim; farm dialog resets state when opened. Determine whether dirty form dismissal causes accidental work loss, including while an operation is pending.

**Acceptance if confirmed:** untouched dialogs close immediately; meaningful unsaved changes have a recoverable draft or a proportionate discard decision; successful saves clear dirty state; in-flight writes cannot cause confusing duplicate dialogs or silently dropped input. Avoid confirmation prompts for trivial or unchanged forms. Coordinate with UX-05/06/07 rather than editing the same files concurrently.

## UX-18 · P1 · WAITING · Independent regression and native release gate

**Prerequisites:** implementation batches complete, changed-file backups available, build/tests passing, runtime capture gap resolved or accurately reported.

**Acceptance:** record exact source/binary identity; review all diffs against file backups; run npm test and production build; run relevant Rust checks (and final Rust suite if available); verify home → farm → table → sheet → back plus menus, dialogs, failed load/save feedback and both supported window sizes. Write persistence tests only against disposable fixtures. If an existing release binary was used for initial review, do not claim it validates later source changes. Keep unverified native interactions and visual gaps explicitly blocked. Codex PM accepts/rejects each READY_FOR_REVIEW task independently, while its task is active. Produce a concise release report with accepted items, rejected items, blockers and rollback locations.
