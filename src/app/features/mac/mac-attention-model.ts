import type { SheetWithRows } from '@core/models';
import { columnRecords, tableGaps } from '@features/dashboard/data-gaps';

/** One column of a table that is only partly filled: which records lack it (a few of them named). */
export interface PartlyColumn {
  key: string;
  name: string;
  missing: number;
  total: number;
  /** The first records lacking it, each as a person knows it (its plot, its batch…). */
  records: string[];
  /** How many more lack it than are named. */
  more: number;
}

/** A column most records lack: named alone, its records being most of the table. */
export interface MostlyColumn {
  name: string;
  missing: number;
  total: number;
}

/** A table with something still missing, as the MAC's dashboard says it. */
export interface Need {
  sheetId: number;
  title: string;
  icon: string | null;
  /** The columns with nothing entered anywhere: only the column is named, there is no record to list. */
  emptyColumns: string[];
  /** Empty columns beyond the ones named. */
  moreEmpty: number;
  /** The columns most records lack (more than `MOSTLY` of them): named, not their records. */
  mostly: MostlyColumn[];
  /** Mostly empty columns beyond the ones named. */
  moreMostly: number;
  /** The columns a few records lack (`MOSTLY` of them or fewer): the column, and which records. */
  partly: PartlyColumn[];
  /** Such columns not shown (the table has more than `COLUMNS` of them). */
  moreColumns: number;
  /** How much of what is typed in is filled in (%, rounded down: 99 while anything is missing). */
  filled: number;
  /** Changes when what is missing changes: a box taken away comes back then. */
  signature: string;
}

/** How many partly filled columns a box names, and how many records each. */
export const COLUMNS = 2;
export const RECORDS = 4;
/** How many empty (or mostly empty) columns a box names (the rest are counted). */
export const EMPTY_NAMED = 4;
/**
 * A column lacking in more than this share of the records is "mostly missing": the column is what's missing, not a few
 * records' cells (a plot or a batch number left out here and there), so the records aren't listed.
 */
export const MOSTLY = 0.5;

/** Every table with records that still lacks something, the one lacking the most first. */
export function needsYou(sheets: readonly SheetWithRows[]): Need[] {
  const out: (Need & { lacking: number })[] = [];
  for (const sheet of sheets) {
    if (!sheet.rows.length) continue;
    const gaps = tableGaps(sheet);
    const empty = gaps.columns.filter((column) => column.state === 'missing');
    const partly = gaps.columns.filter((column) => column.state === 'partly');
    if (!empty.length && !partly.length) continue;
    const most = partly.filter((column) => column.missing > gaps.rows * MOSTLY);
    const few = partly.filter((column) => column.missing <= gaps.rows * MOSTLY);
    const shown = few.slice(0, COLUMNS).map((column): PartlyColumn => {
      const lacking = columnRecords(sheet, column.key).missing;
      return {
        key: column.key,
        name: column.name,
        missing: column.missing,
        total: gaps.rows,
        records: lacking.slice(0, RECORDS).map((record) => record.label || `Row ${record.number}`),
        more: Math.max(0, lacking.length - RECORDS),
      };
    });
    const cells = gaps.rows * gaps.columns.length;
    const entered = gaps.columns.reduce((sum, column) => sum + column.filled, 0);
    out.push({
      sheetId: sheet.sheetId,
      filled: cells ? Math.floor((entered / cells) * 100) : 100,
      title: sheet.title,
      icon: sheet.icon,
      emptyColumns: empty.slice(0, EMPTY_NAMED).map((column) => column.name),
      moreEmpty: Math.max(0, empty.length - EMPTY_NAMED),
      mostly: most.slice(0, EMPTY_NAMED).map((column) => ({ name: column.name, missing: column.missing, total: gaps.rows })),
      moreMostly: Math.max(0, most.length - EMPTY_NAMED),
      partly: shown,
      moreColumns: few.length - shown.length,
      signature: [...empty.map((column) => `${column.key}`), ...partly.map((column) => `${column.key}:${column.missing}`)].join(','),
      lacking: empty.length * gaps.rows + partly.reduce((sum, column) => sum + column.missing, 0),
    });
  }
  return out.sort((a, b) => b.lacking - a.lacking).map(({ lacking: _lacking, ...need }) => need);
}

/**
 * The records lacking a column, in a line: "06/07/2026 · A13, A14, A15, A16" when they share all but their last part (said
 * once), else each in turn; and how many more.
 */
export function recordsLine(records: readonly string[], more: number): string {
  const parts = records.map((record) => record.split(' · '));
  const head = parts[0]?.slice(0, -1).join(' · ') ?? '';
  const shared = records.length > 1 && head !== '' && parts.every((part) => part.length > 1 && part.slice(0, -1).join(' · ') === head);
  const listed = shared ? `${head} · ${parts.map((part) => part.at(-1)).join(', ')}` : records.join(', ');
  return more ? `${listed} and ${more.toLocaleString('en-US')} more` : listed;
}
