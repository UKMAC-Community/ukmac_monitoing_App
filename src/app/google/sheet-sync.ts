import type { Cells, Column } from '../core/models';
import { guessType, type ExcelSheetData } from '../excel/sheet-from-excel';
import { checkCell, columnLabel, excelHeaders, headerAliases, isEntryColumn, normalizeHeader } from '../sheet/columns';

/**
 * Reading a Google Sheet's tab into a table that was made from it before.
 *
 * Each header of the tab goes to the table column it filled last time (the link remembers that, so
 * a column renamed here still gets its data), else to the column that goes by that name. A header
 * the table has no column for becomes a new column, unless the link remembers it was left out on purpose
 * (its entry is an empty key). A table's formula columns are worked out by the app, so the tab's cells
 * under their names are left out.
 */

export interface HeaderMatch {
  /** The tab's column (its position among the headers) → the table column it fills. */
  matched: Map<number, Column>;
  /** The tab's columns the table has none for: to be added. */
  fresh: number[];
}

/** A link's remembered names, normalised the way names are now (one saved before may differ, as with a trailing "*"). */
function renormalized(map: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(map).map(([name, key]) => [normalizeHeader(name), key]));
}

export function matchHeaders(columns: Column[], headers: string[], remembered: Record<string, string>): HeaderMatch {
  remembered = renormalized(remembered);
  const entry = columns.filter(isEntryColumn);
  const names = excelHeaders(columns);
  // Each name a column answers to → its column (a name two columns share doesn't count).
  const byName = new Map<string, Column | null>();
  for (const column of entry) {
    for (const alias of headerAliases(column, names.get(column.key)!)) {
      byName.set(alias, byName.has(alias) && byName.get(alias)?.key !== column.key ? null : column);
    }
  }
  for (const column of entry) byName.set(normalizeHeader(names.get(column.key)!), column);
  const workedOut = new Set(
    columns
      .filter((column) => column.type === 'formula')
      .flatMap((column) => [column.name, columnLabel(column), ...(column.aliases ?? [])])
      .map(normalizeHeader),
  );

  const matched = new Map<number, Column>();
  const fresh: number[] = [];
  const filled = new Set<string>();
  headers.forEach((header, index) => {
    const name = normalizeHeader(header);
    // Left out on purpose when the table was connected: not filled, and not added as a column.
    if (remembered[name] === '') return;
    const kept = remembered[name];
    const column = (kept ? entry.find((item) => item.key === kept) : undefined) ?? byName.get(name) ?? undefined;
    if (column) {
      // Two headers for one column: the first fills it, the other is left out.
      if (!filled.has(column.key)) {
        filled.add(column.key);
        matched.set(index, column);
      }
    } else if (!workedOut.has(name)) {
      fresh.push(index);
    }
  });
  return { matched, fresh };
}

/**
 * What the link has matched, as the import's matches are kept: each table column's key → the worksheet column
 * (1-based) that fills it. Lets the import be done again with the matches the table already has.
 */
export function mappingFromLink(
  columns: Column[],
  headers: string[],
  positions: number[],
  remembered: Record<string, string>,
): Record<string, number> {
  const { matched } = matchHeaders(columns, headers, remembered);
  const mapping: Record<string, number> = {};
  for (const [index, column] of matched) mapping[column.key] = positions[index];
  return mapping;
}

/** The columns for the tab's headers a table doesn't have yet (no key: the table gives one). */
export function newColumns(data: ExcelSheetData, indexes: number[]): Column[] {
  return indexes.map((index) => ({
    key: '',
    name: data.headers[index],
    type: guessType(
      data.rows.map((row) => row[index] ?? ''),
      data.dateLike[index],
    ),
  }));
}

/** The tab's rows as the table keeps them: each value checked against its column, as typed values are. */
export function cellsFor(
  matched: Map<number, Column>,
  data: ExcelSheetData,
  linkOptions: (column: Column) => readonly string[],
): { rows: Cells[]; problems: number } {
  const options = new Map<string, readonly string[]>();
  for (const column of matched.values()) if (column.type === 'link') options.set(column.key, linkOptions(column));
  let problems = 0;
  const rows = data.rows.map((row) => {
    const cells: Cells = {};
    for (const [index, column] of matched) {
      const raw = (row[index] ?? '').trim();
      if (!raw) continue;
      const checked = checkCell(column, raw, options.get(column.key));
      cells[column.key] = checked.value;
      if (checked.error) problems += 1;
    }
    return cells;
  });
  return { rows, problems };
}

/**
 * What the link remembers: each header of the tab → the key of the column it filled. `leftOut` also
 * keeps (as an empty key) the headers that fill nothing and were left out on purpose: those named in
 * `previous` stay so, and with `all` every header that fills nothing is.
 */
export function headerMapOf(
  headers: string[],
  matched: Map<number, Column>,
  previous: Record<string, string> = {},
  all = false,
): Record<string, string> {
  const map: Record<string, string> = {};
  previous = renormalized(previous);
  headers.forEach((header, index) => {
    const name = normalizeHeader(header);
    const column = matched.get(index);
    if (column) map[name] = column.key;
    else if (all || previous[name] === '') map[name] = '';
  });
  return map;
}
