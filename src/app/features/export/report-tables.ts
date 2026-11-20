import type { Column, Row, SheetWithRows, SummaryTable } from '@core/models';
import { formatNumber, summaryResult } from '@features/dashboard/dashboard-model';
import { emptyColumnKeys } from '@features/tables/empty-columns';
import { formatFormulaValue, isFormulaError } from '@shared/formula/evaluate-formula';
import type { WorkbookFormulas } from '@shared/formula/sheet-formulas';
import { displayCell, formatDate, isIsoDate } from '@shared/sheet/columns';

/** A table as an A4 page prints it: its column names, each column's share of the width, its rows as text, its totals. */
export interface ReportTable {
  headers: string[];
  /** A column of numbers: written to the right. */
  numeric: boolean[];
  /** Each column's share of the width (%), from how much it holds: the same on every page the table runs on to. */
  widths: number[];
  rows: string[][];
  /** The line of totals under the last row (a summary's). */
  totals: string[] | null;
  /** Under the table: how many records. */
  count: string;
}

/** A number as the table writes it: "1,250.5", "-3", "12%". */
const NUMBER = /^-?[\d,]+(\.\d+)?%?$/;

const plural = (n: number, one: string) => `${n.toLocaleString('en-US')} ${one}${n === 1 ? '' : 's'}`;

/** A cell longer than this is cut, with "…" (a plot's outline, thousands of figures, says nothing on paper). */
export const LONGEST_CELL = 120;

/** Each column's share of the width: by the longest word of its name (written in capitals, so wider) and its cells, none too thin or too wide. */
export function columnWidths(headers: readonly string[], rows: readonly (readonly string[])[]): number[] {
  const weights = headers.map((header, index) => {
    const name = Math.max(...header.split(/\s+/).map((word) => word.length)) * 1.35;
    const longest = Math.max(name, ...rows.slice(0, 400).map((row) => Math.min((row[index] ?? '').length, 40)));
    return Math.min(Math.max(longest, 5), 30);
  });
  const sum = weights.reduce((total, weight) => total + weight, 0) || 1;
  return weights.map((weight) => (weight / sum) * 100);
}

/** A cell as the table shows it: a formula worked out, a date as a date, a choice or a link as its text. */
export function cellText(formulas: WorkbookFormulas, sheet: SheetWithRows, row: Row, column: Column): string {
  if (column.type === 'formula') {
    const value = formulas.value(sheet, row, column);
    if (isFormulaError(value)) return '';
    if (typeof value === 'number') return formatNumber(Number(value.toFixed(3)));
    const text = formatFormulaValue(value);
    return isIsoDate(text) ? formatDate(text) : text;
  }
  return displayCell(column, String(row.data[column.key] ?? ''));
}

/** The table's rows, every column with something in it (as the table's page leaves the empty ones out). */
export function dataTable(formulas: WorkbookFormulas, sheet: SheetWithRows): ReportTable {
  const empty = emptyColumnKeys(sheet);
  const columns = sheet.columns.filter((column) => !empty.has(column.key));
  const headers = columns.map((column) => (column.unit ? `${column.name} (${column.unit})` : column.name));
  const cut = (text: string) => (text.length > LONGEST_CELL ? `${text.slice(0, LONGEST_CELL - 1)}…` : text);
  const rows = sheet.rows.map((row) => columns.map((column) => cut(cellText(formulas, sheet, row, column))));
  return {
    headers,
    // A formula's column is one of numbers when every cell it worked out is one.
    numeric: columns.map(
      (column, index) =>
        column.type === 'number' || column.type === 'percentage' || (column.type === 'formula' && rows.some((row) => row[index]) && rows.every((row) => !row[index] || NUMBER.test(row[index]))),
    ),
    widths: columnWidths(headers, rows),
    rows,
    totals: null,
    count: plural(sheet.rows.length, 'record'),
  };
}

/** A summary as the dashboard works it out: a line per group, a column per measure, the totals under. */
export function summaryTable(formulas: WorkbookFormulas, sheet: SheetWithRows, summary: SummaryTable): ReportTable | null {
  const result = summary.groupBy ? summaryResult(formulas, sheet, summary) : null;
  if (!result) return null;
  const second = result.header2 !== undefined;
  const text = (value: number | string | null) => (typeof value === 'string' ? value : formatNumber(value));
  const headers = [result.header, ...(second ? [result.header2 ?? ''] : []), ...result.columns];
  const rows = result.rows.map((row) => [row.label, ...(second ? [row.label2 ?? ''] : []), ...row.values.map(text)]);
  const labels = second ? 2 : 1;
  return {
    headers,
    numeric: headers.map((_, index) => index >= labels && result.rows.some((row) => typeof row.values[index - labels] === 'number')),
    widths: columnWidths(headers, rows),
    rows,
    totals: ['Total', ...(second ? [''] : []), ...result.totals.map(text)],
    count: plural(result.rows.length, 'line'),
  };
}
