import { PATH_SEPARATOR } from '../sheet/columns';
import type { ExcelJS } from './exceljs';

/**
 * Where a worksheet's column names and its raw data are: the rows that name the columns (one, or a few
 * when a group's name sits over the names under it), and the row the data starts at. All are worksheet
 * rows, counted from 1. A file's own guess is shown first; the person can set them by hand.
 */
export interface FileLayout {
  /** The first row that names columns. */
  headerFrom: number;
  /** The last row that names columns (the same row when the names take one). */
  headerTo: number;
  /** The first row of data. Rows between the names and this one (units, a note) are left out. */
  dataFrom: number;
}

/** How many rows can name one column (a group, a sub-group, the name). */
export const MAX_HEADER_ROWS = 4;
/** How far down a file is looked at, and how far across: the rows and columns shown to define the layout from. */
export const PEEK_ROWS = 60;
export const PEEK_COLUMNS = 60;

export const sameLayout = (a: FileLayout, b: FileLayout) =>
  a.headerFrom === b.headerFrom && a.headerTo === b.headerTo && a.dataFrom === b.dataFrom;

/** The layout the names under a header row at `row` take as it stands: that row names the columns, data begins under it. */
export const plainLayout = (row: number): FileLayout => ({ headerFrom: row, headerTo: row, dataFrom: row + 1 });

/**
 * A layout that can be used: whole numbers within `maxRow`, the names at most `MAX_HEADER_ROWS` rows
 * and at or after the first, the data after them. (What the person typed is made to fit, not refused.)
 */
export function fixLayout(layout: FileLayout, maxRow: number): FileLayout {
  const last = Math.max(1, Math.floor(maxRow));
  const whole = (value: number, fallback: number) => (Number.isFinite(value) ? Math.floor(value) : fallback);
  const headerFrom = Math.min(Math.max(1, whole(layout.headerFrom, 1)), last);
  const headerTo = Math.min(Math.max(headerFrom, whole(layout.headerTo, headerFrom)), headerFrom + MAX_HEADER_ROWS - 1, last);
  // The data can't start before the rows under the names; one past the end of the file is a table with no rows.
  const dataFrom = Math.min(Math.max(headerTo + 1, whole(layout.dataFrom, headerTo + 1)), Math.max(last + 1, headerTo + 1));
  return { headerFrom, headerTo, dataFrom };
}

/** The last column that holds anything (an export can report far more columns than are used). */
export function usedColumns(worksheet: ExcelJS.Worksheet): number {
  let last = 0;
  worksheet.eachRow((row) =>
    row.eachCell((_cell, column) => {
      if (column > last) last = column;
    }),
  );
  return last;
}

// ---------------------------------------------------------------- merged cells

export interface MergedRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

const columnNumber = (letters: string) => [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0);

/** The worksheet's merged ranges ("A1:C1"), as rows and columns. */
export function mergesOf(worksheet: ExcelJS.Worksheet): MergedRange[] {
  const ranges = (worksheet.model as { merges?: string[] }).merges ?? [];
  return ranges.flatMap((range) => {
    const found = /^\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/i.exec(range);
    if (!found) return [];
    const [, left, top, right, bottom] = found;
    return [{ top: Number(top), left: columnNumber(left.toUpperCase()), bottom: Number(bottom), right: columnNumber(right.toUpperCase()) }];
  });
}

/** Whether the cell is one of a merged range's other cells (the range's top-left holds the value). */
export function isCovered(merges: readonly MergedRange[], row: number, column: number) {
  return merges.some((range) => row >= range.top && row <= range.bottom && column >= range.left && column <= range.right && !(row === range.top && column === range.left));
}

/**
 * Whether the row `top` is a row of group names over the row under it: two or more names merged across
 * their columns (one merged across the whole width is a title), or a name merged down into the next row.
 */
export function hasGroupRow(merges: readonly MergedRange[], top: number, width: number) {
  const wholeWidth = (range: MergedRange) => range.left <= 1 && range.right >= width;
  const across = merges.filter((range) => range.top === top && range.bottom === top && range.right > range.left);
  const down = merges.some((range) => range.top === top && range.bottom === top + 1 && !wholeWidth(range));
  return down || (across.length >= 2 && across.some((range) => !wholeWidth(range)));
}

/**
 * The names' rows for a header row found at `row`: that row alone, or with the rows of group names above it (the row found was
 * the names under them) or under it (the row found was the groups), as many as are group rows over the next: a stage banner over
 * a group over a field is three rows.
 */
export function withGroupRow(merges: readonly MergedRange[], row: number, width: number): FileLayout {
  let from = row;
  while (from > 1 && row - from < MAX_HEADER_ROWS - 1 && hasGroupRow(merges, from - 1, width)) from -= 1;
  let to = row;
  while (to - from < MAX_HEADER_ROWS - 1 && hasGroupRow(merges, to, width)) to += 1;
  return { headerFrom: from, headerTo: to, dataFrom: to + 1 };
}

// ------------------------------------------------------------------ stages

/**
 * The stage each column of a file belongs to, found as a person reading it would: a column headed "Stage 3_" begins stage 3,
 * and the columns after it are stage 3's until the next such column ("Other" ends the stages). Columns before the first are the
 * row's own (0). All the rows above the data are read, whichever of them name the columns: the banner over a stage
 * is not always there (a stage may have none), but its first column always says which stage it is.
 */
export function stageOfColumns(read: (row: number, column: number) => string, lastRow: number, width: number): number[] {
  const stages: number[] = [];
  let current = 0;
  for (let column = 1; column <= width; column += 1) {
    for (let row = 1; row <= Math.max(1, lastRow); row += 1) {
      const text = read(row, column).trim();
      const marker = /^stage\s*(\d+)/i.exec(text);
      if (marker) {
        current = Number(marker[1]);
        break;
      }
      if (row === 1 && /^other\b/i.test(text)) {
        current = 0;
        break;
      }
    }
    stages[column] = current;
  }
  return stages;
}

// ----------------------------------------------------------------- the names

/**
 * The columns the names' rows name, each with the name the rows give it: the group, then the name under it
 * (`Group › Name`). A group's cell that is empty takes the group before it while the names under it run on
 * (a group written once over its columns). `read` gives a cell's text, '' when it has none.
 */
export function headerNames(read: (row: number, column: number) => string, layout: FileLayout, width: number): { position: number; name: string; parts: string[] }[] {
  const rows: number[] = [];
  for (let row = layout.headerFrom; row <= layout.headerTo; row += 1) rows.push(row);
  const own = (column: number) => read(layout.headerTo, column);

  /** Each column's text in one of the rows above the last: its own cell, else the group running on from the left. */
  const groups = rows.slice(0, -1).map((row) => {
    const out: string[] = [];
    let current = '';
    for (let column = 1; column <= width; column += 1) {
      const text = read(row, column);
      if (text) current = text;
      else if (!(own(column) && column > 1 && own(column - 1))) current = '';
      out[column] = text || current;
    }
    return out;
  });

  const names: { position: number; name: string; parts: string[] }[] = [];
  for (let column = 1; column <= width; column += 1) {
    const parts: string[] = [];
    for (const group of groups) pushPart(parts, group[column]);
    pushPart(parts, own(column));
    if (parts.length) names.push({ position: column, name: parts.join(PATH_SEPARATOR), parts: rows.map((row) => read(row, column).trim()) });
  }
  return names;
}

/** A part of a name, unless it's empty or the same as the one before (a name merged down both rows). */
function pushPart(parts: string[], text: string | undefined) {
  const part = (text ?? '').trim();
  if (part && part.toLowerCase() !== parts.at(-1)?.toLowerCase()) parts.push(part);
}

/** The last part of a joined name: what the column is called under its group. */
export function ownName(name: string) {
  const at = name.lastIndexOf(PATH_SEPARATOR);
  return at < 0 ? name : name.slice(at + PATH_SEPARATOR.length);
}

/** A cell's value as the text it shows (a date as its day, a formula as its result). */
export function plainText(value: ExcelJS.CellValue, date1904 = false): { text: string; date: boolean } {
  if (value === null || value === undefined) return { text: '', date: false };
  if (value instanceof Date) return { text: Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : '', date: true };
  if (typeof value === 'number') return { text: String(Number(value.toPrecision(15))), date: false };
  if (typeof value === 'boolean') return { text: value ? 'Yes' : 'No', date: false };
  if (typeof value === 'string') return { text: value.trim(), date: false };
  if (typeof value === 'object') {
    if ('richText' in value) return { text: value.richText.map((part) => part.text).join('').trim(), date: false };
    if ('error' in value) return { text: '', date: false };
    if ('result' in value) return plainText((value as { result?: ExcelJS.CellValue }).result ?? null, date1904);
    if ('text' in value) return { text: String((value as { text: unknown }).text ?? '').trim(), date: false };
  }
  return { text: String(value), date: false };
}

/**
 * The headers a Google tab is read by when it's kept in step (Sync): one per named column, as each is
 * called there (brackets and arrows taken out, a repeated name numbered), and the worksheet column each is in.
 * The import and Sync both ask here, so a table imported with a layout is read the same way every time.
 */
export function syncHeaders(worksheet: ExcelJS.Worksheet, layout: FileLayout, date1904 = false): { headers: string[]; positions: number[] } {
  const clean = (text: string) => text.replace(/[[\]›]/g, '').replace(/\s+/g, ' ').trim();
  const named: { position: number; name: string }[] = [];
  if (layout.headerFrom === layout.headerTo) {
    worksheet.getRow(layout.headerFrom).eachCell((cell, at) => {
      named.push({ position: at, name: clean(plainText(cell.value, date1904).text) || `Column ${at}` });
    });
  } else {
    named.push(...headerNames((row, column) => clean(plainText(worksheet.getCell(row, column).value, date1904).text), layout, usedColumns(worksheet)));
  }
  const seen = new Map<string, number>();
  const headers = named.map(({ name }) => {
    const count = (seen.get(name.toLowerCase()) ?? 0) + 1;
    seen.set(name.toLowerCase(), count);
    return count > 1 ? `${name} ${count}` : name;
  });
  return { headers, positions: named.map((item) => item.position) };
}

// ------------------------------------------------------------- what to show

/** The first rows of a worksheet as text, for the person to say where the names and the data are. */
export interface FilePeek {
  /** The first `PEEK_ROWS` rows, every one (an empty row too, so a row keeps its number). */
  rows: { row: number; cells: string[] }[];
  /** How many columns are shown, up to `PEEK_COLUMNS`. */
  columns: number;
  /** Rows the worksheet has (this is the most a layout can reach). */
  total: number;
}

export function peekOf(worksheet: ExcelJS.Worksheet, read: (row: number, column: number) => string, merges: readonly MergedRange[]): FilePeek {
  const total = worksheet.rowCount;
  const last = Math.min(total, PEEK_ROWS);
  let columns = 0;
  const rows: FilePeek['rows'] = [];
  for (let row = 1; row <= last; row += 1) {
    const cells: string[] = [];
    for (let column = 1; column <= PEEK_COLUMNS; column += 1) {
      // A merged range shows once, where it starts.
      const text = isCovered(merges, row, column) ? '' : read(row, column);
      cells[column - 1] = text;
      if (text) columns = Math.max(columns, column);
    }
    rows.push({ row, cells });
  }
  // The columns across the top of the file, trimmed to the last that holds anything.
  for (const item of rows) item.cells.length = columns;
  return { rows, columns, total };
}
