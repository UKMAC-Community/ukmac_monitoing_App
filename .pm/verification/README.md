# PM-only persistence reproductions

`store-failure-repro.ts` imports the real current WorkbookStore, creates an isolated Angular injector, and replaces Api and Toasts with in-memory stubs. It does not call Tauri or access the user's SQLite file.

Run from the project root:

```sh
node --input-type=module - <<'JS'
import { build } from 'esbuild';
await build({entryPoints:['.pm/verification/store-failure-repro.ts'],outfile:'.pm/verification/store-failure-repro.mjs',bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'warning'});
JS
node .pm/verification/store-failure-repro.mjs
```

Rebuild the generated .mjs after any source change. No dependency was installed; esbuild is already available through this project's toolchain.

The script asserts and prints **bad baseline behaviour**. Exit code 0 means that the specified defect was reproduced; it does not mean that persistence is correct. These assertions will need updating/removing after a fix. Put meaningful lasting regression tests in the regular test suite.

Baseline results, 2026-11-07:

```json
{"scenario":"failed cell save","promiseRejected":false,"pendingCount":0,"displayedValue":"first-original","errorToastCount":1}
{"scenario":"failed row reorder","promiseRejected":true,"pendingCount":0,"displayedOrder":[2,1],"persistedFixtureOrder":[1,2],"storeErrorToastCount":0}
{"scenario":"overlapping saves, first fails after second succeeds","pendingCount":0,"displayedSecondRow":"second-original","persistedFixtureSecondRow":"second-saved"}
```

These are source-level fixtures. They establish the state-handling defects but do not verify a new native binary, live persistence, end-to-end recovery, or visual feedback.
