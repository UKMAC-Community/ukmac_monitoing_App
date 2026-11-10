/** The local backend's shapes (src-tauri/src/model.rs), as the app uses them. */

export type ColumnType =
  | 'text'
  | 'number'
  | 'percentage'
  | 'date'
  | 'choice'
  | 'yesno'
  | 'link'
  | 'formula';

export interface Column {
  /** `c1`, `c2`, …: never reused, so a renamed or moved column keeps its cells. Blank: new. */
  key: string;
  name: string;
  type: ColumnType;
  unit?: string;
  group?: string;
  box?: string;
  /** A choice column's values. */
  options?: string[];
  /** A formula column's formula: `=[Live plant] * 2`. */
  formula?: string;
  /** A link column's source: another table's column, `'Zones'[Plot]`. */
  source?: string;
  required?: boolean;
  width?: number;
  note?: string;
}

export interface Mac {
  macId: number;
  macUuid: string;
  macName: string;
  macCode: string;
  macLocation: string | null;
  latitude: number | null;
  longitude: number | null;
  startDate: string | null;
  endDate: string | null;
  crop: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  sheetCount: number;
  rowCount: number;
}

export interface MacInput {
  macName: string;
  macCode: string;
  macLocation?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  crop?: string | null;
  note?: string | null;
  useTemplate?: boolean;
}

export type Cells = Record<string, string>;

export interface Row {
  rowId: number;
  sheetId: number;
  position: number;
  data: Cells;
  importId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Sheet {
  sheetId: number;
  macId: number;
  title: string;
  heading: string;
  icon: string | null;
  about: string;
  templateKey: string | null;
  columns: Column[];
  /** Its KPI cards, charts and summaries; null: the suggested ones. */
  dashboard: Dashboard | null;
  displayOrder: number;
  rowCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SheetWithRows extends Sheet {
  rows: Row[];
}

export interface Workbook {
  mac: Mac;
  sheets: SheetWithRows[];
}

export interface ImportRecord {
  importId: number;
  sheetId: number;
  fileName: string;
  mode: 'append' | 'replace';
  rowCount: number;
  rowsLeft: number;
  importedAt: string;
}

export interface CellChange {
  rowId: number;
  key: string;
  value: string | null;
}

/** What a saved MAC file holds, and whether this computer already has that MAC (src-tauri/src/macfile.rs). */
export interface MacFilePeek {
  macName: string;
  macCode: string;
  macLocation: string | null;
  /** UTC, `YYYY-MM-DD HH:MM:SS`. */
  exportedAt: string;
  sheets: number;
  rows: number;
  /** The MAC here that this file is a copy of (the same MAC, saved before). */
  sameMac: { macId: number; macName: string; macCode: string; sheetCount: number; rowCount: number; updatedAt: string } | null;
  /** Another MAC here has this file's code, so a copy gets a new one. */
  codeTaken: boolean;
}

export interface SavedMacFile {
  sheets: number;
  rows: number;
  bytes: number;
}

export interface ImportedMac {
  mac: Mac;
  sheets: number;
  rows: number;
  /** The file's code was another MAC's here, so this one got `mac.macCode`. */
  codeChanged: boolean;
  /** With replace: the MAC here that was taken out. */
  replacedMacId: number | null;
}

export interface DatabaseInfo {
  path: string;
  sizeBytes: number;
}

// ------------------------------------------------------------- Google Sheets

/** Where Google sign-in stands (src-tauri/src/google.rs). */
export interface GoogleStatus {
  /** A Google client is there (saved on this Mac, or built into the app), so signing in can start. */
  configured: boolean;
  /** The app has a client built in: it is used while none is saved on this Mac. */
  builtIn: boolean;
  signedIn: boolean;
  clientId: string;
  hasSecret: boolean;
  email: string | null;
  name: string | null;
}

/** A Google Sheet (or an Excel file kept in Drive) in the user's Drive. */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  owner: string | null;
}

/** A table kept in step with a tab of a Google Sheet. */
export interface GoogleLink {
  linkId: number;
  sheetId: number;
  macId: number;
  macName: string;
  tableTitle: string;
  spreadsheetId: string;
  spreadsheetTitle: string;
  tabTitle: string;
  /** The tab's headers (normalized) → the key of the table column each fills. */
  headerMap: Record<string, string>;
  /** UTC, `YYYY-MM-DD HH:MM:SS`; null: not read yet. */
  lastSyncedAt: string | null;
  lastRowCount: number;
}

export interface GoogleLinkInput {
  sheetId: number;
  spreadsheetId: string;
  spreadsheetTitle: string;
  tabTitle: string;
  headerMap: Record<string, string>;
  /** The rows the table was just filled with. */
  rowCount?: number;
}

// ------------------------------------------------------------- dashboards

/** How a KPI reduces its column, as Power BI's card does. */
export type KpiAggregate = 'count' | 'count_values' | 'distinct' | 'sum' | 'average' | 'min' | 'max';
export type KpiVisual = 'card' | 'column' | 'bar' | 'line' | 'area' | 'waterfall' | 'pie' | 'donut' | 'treemap' | 'funnel' | 'radar' | 'gauge';
/** A chart's or summary's groups: the group column's values, or its dates' months or years. */
export type GroupPart = 'value' | 'month' | 'year';

export interface Kpi {
  id: string;
  title: string;
  /** The column worked out (its key); '' with `count`: the rows. */
  column: string;
  aggregate: KpiAggregate;
  visual: KpiVisual;
  /** A chart's group column (its key). */
  groupBy: string;
  groupPart: GroupPart;
  goal: number | null;
  higherIsBetter: boolean;
  decimals: number | null;
}

export interface SummaryMeasure {
  column: string;
  aggregate: KpiAggregate;
  label?: string;
}

/** A table of the rows grouped: one line per Zone (or month…), a column per measure, totals under. */
export interface SummaryTable {
  id: string;
  title: string;
  groupBy: string;
  groupPart: GroupPart;
  measures: SummaryMeasure[];
}

export interface Dashboard {
  kpis: Kpi[];
  summaries: SummaryTable[];
}
