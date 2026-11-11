import type { Column, SheetWithRows } from '../core/models';
import { columnLabel, displayCell, isEntryColumn } from '../sheet/columns';

/**
 * What a table still lacks: for each column a person fills in, on how many
 * of its records it has a value. A column with nothing anywhere is
 * "missing", one with some blanks is "partly" filled, the rest are "complete".
 * Worked-out (formula) and numbered (ID) columns are left out: nobody types them.
 */

export type GapState = 'missing' | 'partly' | 'complete';

export interface ColumnGap {
  key: string;
  /** The column's name with its unit. */
  name: string;
  /** The stage / group it sits in, where the table has several ("2 · Establishment (7 DAT)"). */
  where: string;
  required: boolean;
  filled: number;
  missing: number;
  state: GapState;
  /** How much of it is filled, 0–100. */
  percent: number;
}

export interface TableGaps {
  sheet: SheetWithRows;
  rows: number;
  /** The columns that need attention first (nothing entered, then partly filled, the emptiest first), the complete ones last. */
  columns: ColumnGap[];
  none: number;
  partly: number;
  complete: number;
}

const blank = (value: string | undefined) => value === undefined || value.trim() === '';

function gapOf(column: Column, rows: number, filled: number): ColumnGap {
  return {
    key: column.key,
    name: columnLabel(column),
    where: (column.box ?? column.group ?? '').trim(),
    required: !!column.required,
    filled,
    missing: rows - filled,
    state: filled === 0 ? 'missing' : filled < rows ? 'partly' : 'complete',
    percent: rows ? Math.round((filled / rows) * 100) : 0,
  };
}

const ORDER: Record<GapState, number> = { missing: 0, partly: 1, complete: 2 };

export function tableGaps(sheet: SheetWithRows): TableGaps {
  const rows = sheet.rows.length;
  const columns = sheet.columns
    .filter(isEntryColumn)
    .map((column) => gapOf(column, rows, sheet.rows.filter((row) => !blank(row.data[column.key])).length));
  // Stable: the table's own column order within each kind; a required one first, and the emptiest of the partly filled.
  const sorted = columns
    .map((column, index) => ({ column, index }))
    .sort((a, b) => {
      if (a.column.state !== b.column.state) return ORDER[a.column.state] - ORDER[b.column.state];
      if (a.column.state !== 'complete' && a.column.required !== b.column.required) return a.column.required ? -1 : 1;
      if (a.column.state === 'partly' && a.column.percent !== b.column.percent) return a.column.percent - b.column.percent;
      return a.index - b.index;
    })
    .map((item) => item.column);
  return {
    sheet,
    rows,
    columns: sorted,
    none: columns.filter((column) => column.state === 'missing').length,
    partly: columns.filter((column) => column.state === 'partly').length,
    complete: columns.filter((column) => column.state === 'complete').length,
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A table's state in plain words: what the person reading it should know first. */
export function gapSentence(gaps: TableGaps): string {
  const { sheet, rows, none, partly } = gaps;
  if (!gaps.columns.length) return `${sheet.title} has no columns to fill in.`;
  if (!rows) return `${sheet.title} has no records yet, so every column is still empty.`;
  if (!none && !partly) return `All good: every column of ${sheet.title} has a value on all ${plural(rows, 'record')}.`;
  const parts = [none ? `${plural(none, 'column')} with nothing entered` : '', partly ? `${plural(partly, 'column')} only partly filled` : ''].filter(Boolean);
  return `${sheet.title} has ${plural(rows, 'record')}, and ${parts.join(' and ')}.`;
}

/** One record of a table, as the Data Check names it. */
export interface RecordRef {
  rowId: number;
  /** Its place in the table (1 = the first row). */
  number: number;
  /** What to know it by: the first few things entered on it ("A · A14"); none: nothing but its number. */
  label: string;
  /** What was entered in the column asked about (blank: nothing). */
  value: string;
}

export interface ColumnRecords {
  /** The records with nothing entered in the column, and those with something. */
  missing: RecordRef[];
  filled: RecordRef[];
}

/** The columns a record is known by: the required ones first, then the table's own order (the column asked about left out). */
function identity(sheet: SheetWithRows, key: string): Column[] {
  const entry = sheet.columns.filter((column) => isEntryColumn(column) && column.key !== key && column.type !== 'yesno');
  return [...entry.filter((column) => column.required), ...entry.filter((column) => !column.required)];
}

/** Which records of a table have the column filled in and which don't, each named by what else is on it. */
export function columnRecords(sheet: SheetWithRows, key: string): ColumnRecords {
  const column = sheet.columns.find((item) => item.key === key);
  const known = identity(sheet, key);
  const out: ColumnRecords = { missing: [], filled: [] };
  if (!column) return out;
  sheet.rows.forEach((row, index) => {
    const label = known
      .map((other) => displayCell(other, row.data[other.key]).trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(' · ');
    const value = blank(row.data[key]) ? '' : displayCell(column, row.data[key]).trim();
    (value ? out.filled : out.missing).push({ rowId: row.rowId, number: index + 1, label, value });
  });
  return out;
}
