import type { Row, SheetWithRows } from '@core/models';
import { tableGaps } from '@features/dashboard/data-gaps';

/**
 * What a table is missing, as the Data Check counts it (the same columns, the same blanks, so its ring reads the same
 * here as there): every cell a person fills in, how many have something, and on each column how many don't.
 */
export interface MissingData {
  /** Records × the columns a person fills in (a formula or an automatic ID is left out: nobody types it). */
  cells: number;
  filled: number;
  missing: number;
  /** As the Data Check's ring colours it: nothing entered, some, or all. */
  tone: 'danger' | 'warning' | 'success';
  /** Each column with a gap: its key, and on how many records it has nothing. */
  columns: ReadonlyMap<string, number>;
}

export const isBlank = (value: string | undefined) => value === undefined || value.toString().trim() === '';

export function missingData(sheet: SheetWithRows): MissingData {
  const gaps = tableGaps(sheet);
  const cells = gaps.rows * gaps.columns.length;
  const filled = gaps.columns.reduce((sum, column) => sum + column.filled, 0);
  const tone = !gaps.rows || (gaps.columns.length > 0 && filled === 0) ? 'danger' : gaps.none + gaps.partly ? 'warning' : 'success';
  const columns = new Map(gaps.columns.filter((column) => column.missing > 0).map((column) => [column.key, column.missing]));
  return { cells, filled, missing: cells - filled, tone, columns };
}

/** The rows with nothing in one column put first, the rest after, each kept in its order (a click on the column's "9 missing"). */
export function gapsFirst(rows: Row[], key: string): Row[] {
  const missing = rows.filter((row) => isBlank(row.data[key]));
  return missing.length && missing.length < rows.length ? [...missing, ...rows.filter((row) => !isBlank(row.data[key]))] : rows;
}

/** Whether a record has nothing in one of the columns with a gap. */
export function hasGap(row: Row, columns: ReadonlyMap<string, number>): boolean {
  for (const key of columns.keys()) if (isBlank(row.data[key])) return true;
  return false;
}
