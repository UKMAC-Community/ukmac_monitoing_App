import type { CellChange, Cells, Column, Row } from '../core/models';
import { FormulaError, type FormulaScalar } from '../formula/evaluate-formula';
import { checkCell, columnLabel, defaultWidth, isIsoDate, PATH_SEPARATOR } from '../sheet/columns';

/**
 * A table as the full spreadsheet lays it out (Univer, as the system's sheet
 * view has it — Staff_Attention_UI's UniverSheetClient): its boxes and groups
 * merged over their columns' names, a grey row under them with each column's
 * type or formula, the records under that, room under them for new ones, and
 * each record's row ID in a hidden column at the far right, so a row is still
 * its record after a sort or a move. Pure: no Univer here (it loads with the
 * sheet only), its numbers kept as plain values.
 */

/** The table's own tab. */
export const DATA_SHEET_ID = 'data';
/** Empty rows under the records to type new ones in; kept at least `MIN_SPARE_ROWS`. */
export const SPARE_ROWS = 100;
export const MIN_SPARE_ROWS = 40;
/** Empty columns right of the table's: an empty one's header adds a column. */
export const SPARE_COLUMNS = 6;
/** Always two header rows at least, as the system's sheet: a group's name over its columns'. */
const MIN_HEADER_ROWS = 2;

/** Univer's CellValueType, HorizontalAlign, VerticalAlign, WrapStrategy, BooleanNumber, BorderStyleTypes. */
export const CELL_TEXT = 1;
export const CELL_NUMBER = 2;
const ALIGN_LEFT = 1;
const ALIGN_CENTER = 2;
const MIDDLE = 2;
const CLIP = 2;
const BORDER_THIN = 1;

export const STYLE = {
  cell: 'cell',
  group: 'header-group',
  leaf: 'header-leaf',
  label: 'formula-label',
  formulaRow: 'formula-row',
  computed: 'computed',
  computedDate: 'computed-date',
  computedError: 'computed-error',
  rowId: 'row-id',
} as const;

/** Every cell's text: a size down from Univer's 11pt, near-black as the app's text (the system's). */
const CELL_FONT_SIZE = 10;
const CELL_TEXT_COLOR = '#1D1D1F';
export const HEADER_LABEL_COLOR = '#6D766F';
export const HEADER_LABEL_SIZE = 11;
/** A formula column's cells: the app's formula look (--formula-bg, the accent's text). */
const COMPUTED_BACKGROUND = '#F1F5FB';
const COMPUTED_TEXT = '#0D4585';
export const ERROR_TEXT = '#B42318';
export const INVALID_BACKGROUND = '#FDECEC';
/** The formula row: light grey, each cell still lined as the grid (the system's TYPE_ROW_LOOK). */
const TYPE_ROW_FILL = '#F3F4F5';
const TYPE_ROW_EDGE = { cl: { rgb: '#D9DBDE' }, s: BORDER_THIN };

const HEADER_ROW_HEIGHT = 30;
const ROW_HEIGHT = 26;
const SPARE_COLUMN_WIDTH = 110;

export interface GridCell {
  v?: string | number | boolean | null;
  t?: number | null;
  s?: string | Record<string, unknown> | null;
  f?: string | null;
  si?: string | null;
  p?: unknown;
}

export interface CellRange {
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
}

// ------------------------------------------------------------------ layout

export interface GridPlan {
  columns: readonly Column[];
  headerRows: number;
  /** The grey row under the header: each column's type or formula. */
  formulaRow: number;
  /** The first record's row. */
  recordsFrom: number;
  /** The first spare column, right of the table's. */
  spareFrom: number;
  /** The hidden column holding each record's row ID. */
  idColumn: number;
  columnCount: number;
}

/** A column's boxes over its name, outermost first. */
export function groupPath(column: Column): string[] {
  return [column.box, column.group].map((part) => (part ?? '').trim()).filter(Boolean);
}

export function headerRowCount(columns: readonly Column[]) {
  return Math.max(
    MIN_HEADER_ROWS,
    1 + columns.reduce((depth, column) => Math.max(depth, groupPath(column).length), 0),
  );
}

export function gridPlan(columns: readonly Column[]): GridPlan {
  const headerRows = headerRowCount(columns);
  return {
    columns,
    headerRows,
    formulaRow: headerRows,
    recordsFrom: headerRows + 1,
    spareFrom: columns.length,
    idColumn: columns.length + SPARE_COLUMNS,
    columnCount: columns.length + SPARE_COLUMNS + 1,
  };
}

export interface HeaderCell {
  row: number;
  column: number;
  kind: 'group' | 'leaf';
  text: string;
}

/** A column's name as the header shows it: with its unit, and a * when it needs a value. */
export function headerText(column: Column) {
  return `${columnLabel(column)}${column.required ? ' *' : ''}`;
}

/**
 * The header block, laid out as the system's sheet (sheetLayout.ts): each
 * group level one cell per run of neighbouring columns sharing it, merged
 * across them; each column's name under its groups, merged down to the last
 * header row.
 */
export function headerLayout(columns: readonly Column[]): {
  cells: HeaderCell[];
  merges: CellRange[];
  rows: number;
} {
  const rows = headerRowCount(columns);
  const cells: HeaderCell[] = [];
  const merges: CellRange[] = [];
  const paths = columns.map(groupPath);
  const prefix = (index: number, level: number) =>
    paths[index].slice(0, level + 1).join(PATH_SEPARATOR);
  for (let level = 0; level < rows - 1; level += 1) {
    for (let start = 0; start < columns.length;) {
      if (paths[start].length <= level) {
        start += 1;
        continue;
      }
      let end = start;
      while (
        end + 1 < columns.length &&
        paths[end + 1].length > level &&
        prefix(end + 1, level) === prefix(start, level)
      ) {
        end += 1;
      }
      cells.push({ row: level, column: start, kind: 'group', text: paths[start][level] });
      if (end > start)
        merges.push({ startRow: level, endRow: level, startColumn: start, endColumn: end });
      start = end + 1;
    }
  }
  columns.forEach((column, index) => {
    const row = paths[index].length;
    cells.push({ row, column: index, kind: 'leaf', text: headerText(column) });
    if (row < rows - 1)
      merges.push({ startRow: row, endRow: rows - 1, startColumn: index, endColumn: index });
  });
  return { cells, merges, rows };
}

const TYPE_WORDS: Record<string, string> = {
  text: 'Text',
  number: 'Number',
  percentage: 'Percent',
  date: 'Date',
  choice: 'Choice',
  yesno: 'Yes / No',
};

/**
 * A column's rule as the formula row writes it, as the system's row 3 does:
 * its type and rules ("Date, Required", "Number, unit kg"), a link's
 * =LINK('Zones'[Plot]), a formula column's formula.
 */
export function formulaRowLabel(column: Column): string {
  if (column.type === 'formula') return column.formula?.trim() || '=';
  if (column.type === 'link')
    return `=LINK(${column.source ?? ''}${column.required ? ', require' : ''})`;
  const unit = column.unit?.trim();
  return [
    TYPE_WORDS[column.type] ?? column.type,
    column.required ? 'Required' : '',
    unit ? `unit ${unit}` : '',
  ]
    .filter(Boolean)
    .join(', ');
}

/** The number format a column's cells show with. */
export function numberFormat(column: Column): string {
  switch (column.type) {
    case 'number':
    case 'formula':
      return 'General';
    case 'percentage':
      return '0.0%';
    case 'date':
      return 'dd/mm/yyyy';
    default:
      return '@';
  }
}

export function columnStyleId(column: Column) {
  return `col-${column.type}`;
}

// ------------------------------------------------------------------ values

const DAY_MS = 86_400_000;
/** Sheets count days from 30 Dec 1899 (Excel's, and Univer's). */
const SERIAL_EPOCH = Date.UTC(1899, 11, 30);
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/** YYYY-MM-DD as a sheet's day number (null: not a date). */
export function isoToSerial(iso: string): number | null {
  if (!isIsoDate(iso)) return null;
  const [year, month, day] = iso.split('-').map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - SERIAL_EPOCH) / DAY_MS);
}

/** A sheet's day number as YYYY-MM-DD (the time of day dropped). */
export function serialToIso(serial: number): string | null {
  if (!Number.isFinite(serial)) return null;
  const date = new Date(SERIAL_EPOCH + Math.floor(serial) * DAY_MS);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

/** Without float noise: 0.864 × 100 is 86.4, not 86.39999999999999. */
const tidy = (value: number) => Number(value.toPrecision(15));

/**
 * A kept value (the app keeps text: "12.5", "2026-06-16", "true") as the
 * grid holds it: numbers as numbers, a percent as its fraction (under a %
 * format, as Excel), a date as its day number (under dd/mm/yyyy), Yes/No as
 * words. One that doesn't fit its column stays the text it is.
 */
export function toGridCell(column: Column, raw: string | undefined | null): GridCell | null {
  if (raw === undefined || raw === null || raw === '') return null;
  switch (column.type) {
    case 'number':
      return NUMBER.test(raw) && Number.isFinite(Number(raw))
        ? { v: Number(raw), t: CELL_NUMBER }
        : { v: raw, t: CELL_TEXT };
    case 'percentage':
      return NUMBER.test(raw) && Number.isFinite(Number(raw))
        ? { v: tidy(Number(raw) / 100), t: CELL_NUMBER }
        : { v: raw, t: CELL_TEXT };
    case 'date': {
      const serial = isoToSerial(raw);
      return serial === null ? { v: raw, t: CELL_TEXT } : { v: serial, t: CELL_NUMBER };
    }
    case 'yesno':
      return { v: raw === 'true' ? 'Yes' : raw === 'false' ? 'No' : raw, t: CELL_TEXT };
    default:
      return { v: raw, t: CELL_TEXT };
  }
}

/**
 * What a grid cell holds, as the app keeps it — the same rules as typing it
 * in the app's table (`checkCell`): a day number back to its date, a percent's
 * fraction back to its number out of 100, text through the column's check.
 */
export function fromGridCell(
  column: Column,
  cell: GridCell | null | undefined,
  linkOptions: readonly string[] = [],
): { value: string; error?: string } {
  const v = cell?.v;
  if (v === null || v === undefined || (typeof v === 'string' && !v.trim())) {
    return { value: '', error: column.required ? 'This column needs a value' : undefined };
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    switch (column.type) {
      case 'number':
        return { value: String(tidy(v)) };
      case 'percentage':
        return { value: String(tidy(v * 100)) };
      case 'date': {
        const iso = serialToIso(v);
        return iso
          ? { value: iso }
          : { value: String(v), error: 'Use a date: 16/06/2026 or 2026-06-16' };
      }
    }
  }
  const text = typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v);
  return checkCell(column, text, linkOptions);
}

/** Whether a kept value and a grid cell say the same, as the app keeps values. */
export function sameValue(
  column: Column,
  kept: string | undefined,
  cell: GridCell | null | undefined,
  linkOptions: readonly string[] = [],
) {
  return (
    fromGridCell(column, toGridCell(column, kept), linkOptions).value ===
    fromGridCell(column, cell, linkOptions).value
  );
}

/** Whether a grid cell holds anything (blank text is nothing). */
export function hasValue(cell: GridCell | null | undefined) {
  const v = cell?.v;
  return v !== null && v !== undefined && (typeof v !== 'string' || v.trim() !== '');
}

/** The same value and kind, exactly as held (no reading of the text): the quick check. */
function sameRaw(a: GridCell | null | undefined, b: GridCell | null | undefined) {
  if (b?.f) return false;
  if (!hasValue(a) || !hasValue(b)) return !hasValue(a) && !hasValue(b);
  return a!.v === b!.v && (a!.t ?? CELL_TEXT) === (b!.t ?? CELL_TEXT);
}

/** Whether two grid cells hold the same value and kind (styles aside). */
export function sameCell(a: GridCell | null | undefined, b: GridCell | null | undefined) {
  const value = (cell: GridCell | null | undefined) =>
    cell?.v === undefined || cell?.v === null || cell?.v === '' ? null : cell.v;
  return (
    value(a) === value(b) &&
    (value(a) === null || (a?.t ?? CELL_TEXT) === (b?.t ?? CELL_TEXT)) &&
    !a?.f === !b?.f
  );
}

/** A formula column's worked-out value as its cell shows it (the app's table rounds to 3 places). */
export function computedCell(value: FormulaScalar): GridCell | null {
  if (value instanceof FormulaError) return { v: value.code, t: CELL_TEXT, s: STYLE.computedError };
  if (value === null || value === '') return { s: STYLE.computed };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { v: '#NUM!', t: CELL_TEXT, s: STYLE.computedError };
    return {
      v: Number.isInteger(value) ? value : Number(value.toFixed(3)),
      t: CELL_NUMBER,
      s: STYLE.computed,
    };
  }
  if (typeof value === 'boolean')
    return { v: value ? 'Yes' : 'No', t: CELL_TEXT, s: STYLE.computed };
  const serial = isoToSerial(value);
  return serial === null
    ? { v: value, t: CELL_TEXT, s: STYLE.computed }
    : { v: serial, t: CELL_NUMBER, s: STYLE.computedDate };
}

// --------------------------------------------------------------- workbook

export interface WorkbookInput {
  unitId: string;
  title: string;
  columns: readonly Column[];
  rows: readonly Row[];
  /** A formula column's value on a row. */
  computed: (row: Row, column: Column) => FormulaScalar;
  /** A link column's values to pick from. */
  linkOptions: (column: Column) => string[];
  fontFamily: string;
  frozenColumns: number;
  /** The saved colour rules (the conditional formatting plugin's, for this tab). */
  conditionalFormats?: unknown[];
}

/** The styles every grid uses, by id. */
export function gridStyles(
  columns: readonly Column[],
  fontFamily: string,
): Record<string, Record<string, unknown>> {
  const font = fontFamily ? { ff: fontFamily } : {};
  const styles: Record<string, Record<string, unknown>> = {
    [STYLE.cell]: { cl: { rgb: CELL_TEXT_COLOR }, fs: CELL_FONT_SIZE, ...font },
    [STYLE.group]: { bl: 0, cl: { rgb: '#1D2B24' }, ht: ALIGN_CENTER, vt: MIDDLE, tb: 3 },
    [STYLE.leaf]: { bl: 0, cl: { rgb: '#5B6762' }, ht: ALIGN_CENTER, vt: MIDDLE, tb: 3 },
    [STYLE.label]: {
      bl: 0,
      cl: { rgb: '#5B6B63' },
      fs: CELL_FONT_SIZE,
      ht: ALIGN_LEFT,
      it: 1,
      tb: CLIP,
      vt: MIDDLE,
      ...font,
    },
    [STYLE.formulaRow]: {
      bd: { b: TYPE_ROW_EDGE, l: TYPE_ROW_EDGE, r: TYPE_ROW_EDGE, t: TYPE_ROW_EDGE },
      bg: { rgb: TYPE_ROW_FILL },
    },
    [STYLE.computed]: {
      bg: { rgb: COMPUTED_BACKGROUND },
      cl: { rgb: COMPUTED_TEXT },
      n: { pattern: 'General' },
    },
    [STYLE.computedDate]: {
      bg: { rgb: COMPUTED_BACKGROUND },
      cl: { rgb: COMPUTED_TEXT },
      n: { pattern: 'dd/mm/yyyy' },
    },
    [STYLE.computedError]: {
      bg: { rgb: COMPUTED_BACKGROUND },
      cl: { rgb: ERROR_TEXT },
      n: { pattern: 'General' },
    },
    [STYLE.rowId]: { n: { pattern: '@' } },
  };
  for (const column of columns) {
    if (column.type === 'formula') continue;
    styles[columnStyleId(column)] = { n: { pattern: numberFormat(column) } };
  }
  return styles;
}

/** A record row's cells: its values, each with its column's look, and its row ID. */
export function recordCells(
  plan: GridPlan,
  row: Row | null,
  input: Pick<WorkbookInput, 'computed'>,
  id: string | number | null = row?.rowId ?? null,
): Record<number, GridCell> {
  const cells: Record<number, GridCell> = {};
  plan.columns.forEach((column, index) => {
    if (column.type === 'formula') {
      cells[index] = row
        ? (computedCell(input.computed(row, column)) ?? { s: STYLE.computed })
        : { s: STYLE.computed };
      return;
    }
    const value = row ? toGridCell(column, row.data[column.key]) : null;
    cells[index] = { ...(value ?? {}), s: columnStyleId(column) };
  });
  if (id !== null) cells[plan.idColumn] = { v: String(id), t: CELL_TEXT, s: STYLE.rowId };
  return cells;
}

/** The header's and the formula row's cells, as they should read. */
export function headerCells(plan: GridPlan): Record<number, Record<number, GridCell>> {
  const layout = headerLayout(plan.columns);
  const cells: Record<number, Record<number, GridCell>> = {};
  for (const cell of layout.cells) {
    (cells[cell.row] ??= {})[cell.column] = {
      v: cell.text,
      t: CELL_TEXT,
      s: cell.kind === 'group' ? STYLE.group : STYLE.leaf,
    };
  }
  cells[plan.formulaRow] = Object.fromEntries(
    plan.columns.map((column, index) => [
      index,
      { v: formulaRowLabel(column), t: CELL_TEXT, s: STYLE.label },
    ]),
  );
  return cells;
}

/** The list each choice, Yes/No and link column picks from (Univer's data validation, warning only). */
export function validationRules(
  plan: GridPlan,
  linkOptions: (column: Column) => string[],
  lastRow: number,
) {
  const rules: Record<string, unknown>[] = [];
  plan.columns.forEach((column, index) => {
    const options =
      column.type === 'choice'
        ? (column.options ?? [])
        : column.type === 'yesno'
          ? ['Yes', 'No']
          : column.type === 'link'
            ? linkOptions(column)
            : [];
    const list = [...new Set(options.map((option) => option.trim()).filter(Boolean))];
    if (!list.length) return;
    rules.push({
      uid: `ukmac-${column.key}`,
      type: 'list',
      formula1: JSON.stringify(list),
      ranges: [
        { startRow: plan.recordsFrom, endRow: lastRow, startColumn: index, endColumn: index },
      ],
      allowBlank: true,
      showDropDown: true,
      showErrorMessage: false,
      // Kept as typed, marked (the app keeps a value that doesn't fit, with why).
      errorStyle: 2,
      renderMode: 1,
    });
  });
  return rules;
}

/** The whole workbook as Univer opens it: the table's tab, its look, its lists and saved colour rules. */
export function buildWorkbookData(input: WorkbookInput) {
  const plan = gridPlan(input.columns);
  const layout = headerLayout(input.columns);
  const rowCount = plan.recordsFrom + input.rows.length + SPARE_ROWS;
  const cellData: Record<number, Record<number, GridCell>> = headerCells(plan);
  input.rows.forEach((row, index) => {
    cellData[plan.recordsFrom + index] = recordCells(plan, row, input);
  });
  for (let r = plan.recordsFrom + input.rows.length; r < rowCount; r += 1) {
    cellData[r] = recordCells(plan, null, input, null);
  }
  const columnData: Record<number, { w: number; hd?: number }> = {};
  input.columns.forEach((column, index) => {
    columnData[index] = { w: defaultWidth(column) };
  });
  for (let c = plan.spareFrom; c < plan.idColumn; c += 1) columnData[c] = { w: SPARE_COLUMN_WIDTH };
  columnData[plan.idColumn] = { w: 80, hd: 1 };
  const rowData: Record<number, { h: number; s?: string }> = {};
  for (let r = 0; r < plan.headerRows; r += 1) rowData[r] = { h: HEADER_ROW_HEIGHT };
  rowData[plan.formulaRow] = { h: ROW_HEIGHT, s: STYLE.formulaRow };
  const frozen = Math.max(0, Math.min(input.frozenColumns, input.columns.length));
  return {
    plan,
    data: {
      id: input.unitId,
      name: input.title,
      sheetOrder: [DATA_SHEET_ID],
      styles: gridStyles(input.columns, input.fontFamily),
      resources: [
        {
          name: 'SHEET_DATA_VALIDATION_PLUGIN',
          data: JSON.stringify({
            [DATA_SHEET_ID]: validationRules(plan, input.linkOptions, rowCount - 1),
          }),
        },
        {
          name: 'SHEET_CONDITIONAL_FORMATTING_PLUGIN',
          data: JSON.stringify({ [DATA_SHEET_ID]: input.conditionalFormats ?? [] }),
        },
      ],
      sheets: {
        [DATA_SHEET_ID]: {
          id: DATA_SHEET_ID,
          name: input.title,
          cellData,
          rowCount,
          columnCount: plan.columnCount,
          columnData,
          rowData,
          defaultRowHeight: ROW_HEIGHT,
          defaultColumnWidth: SPARE_COLUMN_WIDTH,
          defaultStyle: STYLE.cell,
          mergeData: layout.merges,
          freeze: {
            startRow: plan.recordsFrom,
            ySplit: plan.recordsFrom,
            startColumn: frozen,
            xSplit: frozen,
          },
        },
      },
    },
  };
}

// -------------------------------------------------------------------- diff

/** A row of the grid under the header, as read back. */
export interface GridRecord {
  /** Its row in the grid. */
  row: number;
  /** What its hidden ID cell holds ('' for nothing). */
  idText: string;
  /** Its typed-in columns' cells, by column key. */
  cells: Record<string, GridCell | null>;
}

export interface GridDiff {
  /** Cells of records that changed, as the app keeps them. */
  changes: CellChange[];
  /** Rows typed without a record (or a copy of one): each a new record, its filled values. */
  additions: { row: number; values: Cells }[];
  /** Records whose row is gone from the grid. */
  deletions: number[];
  /** Rows whose ID cell names no record (an empty row, a record deleted): their ID cleared. */
  staleIds: number[];
  /** The records in the grid's order. */
  order: number[];
}

/** What the grid says now against what the app keeps: what to save. */
export function diffRecords(
  records: readonly GridRecord[],
  rows: readonly Row[],
  columns: readonly Column[],
  linkOptions: (column: Column) => readonly string[] = () => [],
): GridDiff {
  const entry = columns.filter((column) => column.type !== 'formula');
  const options = new Map(entry.map((column) => [column.key, linkOptions(column)]));
  const byId = new Map(rows.map((row) => [row.rowId, row]));
  const seen = new Set<number>();
  const diff: GridDiff = { changes: [], additions: [], deletions: [], staleIds: [], order: [] };
  for (const record of records) {
    const id = /^\d+$/.test(record.idText) ? Number(record.idText) : NaN;
    const row = byId.get(id);
    const filled = entry.some((column) => hasValue(record.cells[column.key]));
    if (
      row &&
      !seen.has(id) &&
      !filled &&
      entry.some((column) => (row.data[column.key] ?? '') !== '')
    ) {
      // A record's every cell emptied (Delete over its row, or its typing
      // undone): the record goes, as an empty row is nothing in a sheet.
      // One that was empty already stays as it is.
      diff.staleIds.push(record.row);
      continue;
    }
    if (row && !seen.has(id)) {
      seen.add(id);
      diff.order.push(id);
      for (const column of entry) {
        const cell = record.cells[column.key];
        const kept = row.data[column.key];
        // Most cells hold just what was loaded: compared as they are, before any reading.
        if (sameRaw(toGridCell(column, kept), cell)) continue;
        const list = options.get(column.key);
        if (sameValue(column, kept, cell, list)) continue;
        const value = fromGridCell(column, cell, list).value;
        diff.changes.push({ rowId: id, key: column.key, value: value || null });
      }
      continue;
    }
    if (filled) {
      const values: Cells = {};
      for (const column of entry) {
        const value = fromGridCell(column, record.cells[column.key], options.get(column.key)).value;
        if (value) values[column.key] = value;
      }
      diff.additions.push({ row: record.row, values });
    } else if (record.idText) {
      diff.staleIds.push(record.row);
    }
  }
  for (const row of rows) if (row.rowId > 0 && !seen.has(row.rowId)) diff.deletions.push(row.rowId);
  return diff;
}

/** Whether the records stand in the grid in another order than the app keeps them. */
export function orderChanged(order: readonly number[], rows: readonly Row[]) {
  const inGrid = new Set(order);
  const kept = rows.map((row) => row.rowId).filter((id) => inGrid.has(id));
  return kept.length !== order.length || kept.some((id, index) => id !== order[index]);
}
