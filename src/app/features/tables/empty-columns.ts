import type { SheetWithRows } from '@core/models';
import { isEntryColumn } from '@shared/sheet/columns';

/**
 * The columns with nothing entered in any row (the "missing" ones): typed-in columns only, since a worked-out column
 * (a formula, an automatic ID) has its value without anyone entering it. A table with no rows has none to call missing.
 */
export function emptyColumnKeys(sheet: Pick<SheetWithRows, 'columns' | 'rows'>): Set<string> {
  const keys = new Set<string>();
  if (!sheet.rows.length) return keys;
  for (const column of sheet.columns) {
    if (isEntryColumn(column) && sheet.rows.every((row) => (row.data[column.key] ?? '').toString().trim() === '')) keys.add(column.key);
  }
  return keys;
}
