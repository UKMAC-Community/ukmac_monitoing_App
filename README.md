# UKMAC Monitoring

A Mac app for the chili farms (MACs), with no server: everything is kept in one
SQLite file on this computer
(`~/Library/Application Support/com.ukmac.monitoring/ukmac.db`).

- **MACs**: make a farm (name, code, location, coordinates, dates). A new
  chili MAC starts with the chili tables: Zones, Chili Varieties, Nursery
  Batches, Zone Records, Soil Preparation, Irrigation, Fertigation, Pruning,
  Pesticides, Harvest, QA/QC Management (the 10-stage QC form, 72 columns,
  23 formulas), Planting Date, Inventory Management, Finance & Accounting.
- **Tables like a sheet**: none are fixed. Add, rename, move, resize or delete
  columns at any time (text, number, percent, date, choice, Yes/No, pick from
  another table, formula), group them under boxes and groups, type in cells,
  copy and paste with Excel and Google Sheets. Formulas work like Excel's:
  `=IF([Live plant]="","",20-[Live plant])`, `=LOOKUP('Zones'[Plant capacity], 'Zones'[Plot], [Zone])`.
- **Open in sheet**: the table as a full spreadsheet, the system's sheet view
  (Univer 1.0.2, its toolbar and fixes): formula bar, fonts and colours,
  borders, filter, sort, conditional formatting, Count / Sum, zoom, freeze,
  a list to pick from in choice, Yes/No and link columns, the MAC's tables as
  tabs. The boxes and groups head the columns; the grey row under them shows
  each column's type or formula. Every change is saved as it's made — typed,
  pasted from Excel, filled, undone, rows inserted, deleted, moved or sorted
  (the order is kept). Each row carries its record's ID in a hidden column at
  the far right, so a sort never mixes records up. Formula columns are worked
  out by the app (as on the table's page and in Power BI), not typed in;
  columns are added, changed, moved and deleted through the column dialog (a
  column's name double-clicked, an empty header cell, or the column menus).
  Values that don't fit their column are kept and drawn red. Colour rules and
  frozen columns are kept per table; other cell formatting lasts the session.
- **Excel in**: a table's **Template** is the server's Excel template (a
  "Data" sheet, the same headers), so a file filled for the server imports
  as it is. **Import** checks every row first (wrong dates, numbers, zones not
  in Zones, missing columns), can add missing zones in one click, and every
  import can be undone. **New table → From Excel** makes a table from any sheet.
- **Google Sheets in**: Connections & backup → sign in with Google, then a
  MAC's page → **Import from Google Sheets**: pick one of your sheets (or paste
  its link), tick the tabs, and each becomes a table (headers → columns, types
  guessed, dates as dates), with its Dashboard like any other. A table made
  this way has a **Sync** button: it reads the tab again, replaces the rows,
  adds columns the tab has gained, and keeps filling a column you renamed here.
  Read-only: nothing is ever changed in Google. See "Google sign-in" below.
- **Dashboards**: every table has a Table | Dashboard switch, the system's
  KPI board: Power BI-style KPI cards (sum, average, count, distinct, min,
  max — against a goal, green ▲ / red ▼), charts (column, bar, line, pie,
  donut, by a column or by month / year) and summary tables (rows grouped by
  Zone, Plant type, month… with totals; to Excel). The chili tables start
  with suggested ones; changing any saves the table's own. The MAC page shows
  each table's KPIs together.
- **Power BI**: Connections & backup → save the Power BI file: every MAC's tables
  in one workbook, each an Excel table with typed values and the formulas
  worked out, the same table of every MAC together (a MAC column). Turn on
  "Keep it up to date" and Power BI's Refresh reads the latest.

The look is the UKMAC system's (`Staff_Attention_UI/src/styles`, copied into
`src/styles/ukmac/` unchanged).

Keep `"dangerousDisableAssetCspModification": ["style-src"]` in
`tauri.conf.json`. Without it Tauri adds a nonce to `style-src` (for the
critical CSS inlined in `index.html`), and a nonce makes the webview ignore
`'unsafe-inline'`. That blocks every Angular component style, so the window
opens with the sidebar only and the page pushed off-screen.

## Google sign-in

Google needs an OAuth client of your own, made once (the app can't make it):
in Google Cloud Console make a project, enable the **Google Drive API**, set up
the OAuth consent screen (External, your Google account as a test user; or
Internal for Google Workspace; "In production" avoids the 7-day expiry of a
test-mode sign-in), then Create client → **Desktop app**. Paste its Client ID
and secret in Settings (Connections & backup → Google account). The steps are
shown there too.

- Signing in is OAuth 2.0 with PKCE over a loopback address: the browser
  opens Google's page, Google sends it back to a port the app listens on for
  a moment (`src-tauri/src/google.rs`). Everything with Google is in Rust; the
  page never holds a token. Scope: `drive.readonly` (and `openid email profile`).
- A sheet is read the way the web system reads one: downloaded as an Excel
  workbook (Google's export address, then Drive's own export), then read with
  the same code as an Excel file you pick (`readExcelSheets`, 15 MB and 5000
  rows a tab at most).
- The Client ID, secret and tokens are in `google.json` beside the database
  (owner-only), not in `ukmac.db`: "Save a backup" copies the database.
- Which table is read from which tab is in the database (`google_links`, with
  which header went to which column, so a renamed column stays filled).
  `src/app/google/sheet-sync.ts` matches a tab's headers to a table's columns.
- Sync is manual (a table's page, or Settings): rows are replaced, so edits
  made here to what came from Google are overwritten by the next Sync.

## Stack

- Tauri 2 (Rust): `src-tauri/` — `commands.rs` (the local backend), `db.rs`
  (schema + migrations), `template.rs` (the chili template), `model.rs`,
  `google.rs` (sign-in with Google, Drive and the sheet download), `links.rs`
  (which table is read from which tab).
- Angular 22 (standalone, zoneless, signals): `src/app/` — `core/` (API,
  store), `formula/` (the formula engine, from the system's UI), `excel/`
  (template, import, Power BI export, with exceljs), `univer/` (the full
  sheet: `univer-layout.ts` lays a table out and reads it back,
  `univer-engine.ts` is Univer, loaded only with the sheet,
  `univer-sheet.ts` saves each change, `fixes/` the system's own fixes to
  Univer), `pages/`.

Univer is pinned at 1.0.2, as the system has it: `npm install` runs
`scripts/patch-univer.mjs` (the system's two fixes to it). Keep every
`@univerjs/*` package at one version. Its CSS is copied to `vendor/univer/`
by the build and loaded with the first sheet.

## Run

```bash
npm install
npm run dev        # the app, with hot reload (Angular on port 1420)
npm test           # Angular unit tests
cd src-tauri && cargo test
npm run app        # build UKMAC Monitoring.app and the .dmg
```

The built app is in `src-tauri/target/release/bundle/macos/`.
