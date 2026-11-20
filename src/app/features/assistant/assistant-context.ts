import type { Column, SheetWithRows } from '@core/models';
import { formatFormulaValue, isFormulaError } from '@shared/formula/evaluate-formula';
import { WorkbookFormulas } from '@shared/formula/sheet-formulas';
import { displayCell, formatDate, isIsoDate, todayIso } from '@shared/sheet/columns';

/**
 * What the local assistant is given to read for a question. A small model can't work through the tables or see how they hang together,
 * so the app does that part: it finds the dates and the plots the question names, takes every record that belongs to them from every
 * table, works out the relations (when the plot was planted, whether a record comes before that) and hands over only that, as short lines.
 * The model then puts it into words.
 */

export interface Lookup {
  /** What the assistant reads. */
  text: string;
  /** What was looked for, in words, for the person to see. */
  looked: string[];
  /** How many records are in `text`, and how many more matched but were left out to keep it short. */
  records: number;
  left: number;
  /** Whether the question named a date or a plot at all. */
  found: boolean;
  /** What the app itself noticed does not fit (shown beside the answer, not left to the assistant). */
  notes: string[];
  /** The tables the records came from, and how many from each. */
  tables: { name: string; count: number }[];
}

/** The most record lines handed over; the rest are counted, not shown. */
export const MAX_LINES = 70;
const MAX_FACTS = 9;
const MAX_VALUE = 48;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_WORD = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const PLOT_NAMES = ['zone plot', 'plot', 'zone'];
const LEFT_OUT = new Set(['id', 'zone', 'zone plot', 'plot', 'zone number']);

const two = (n: number) => String(n).padStart(2, '0');
const iso = (year: number, month: number, day: number) => {
  const text = `${year}-${two(month)}-${two(day)}`;
  return isIsoDate(text) ? text : null;
};

/** The dates a question names, as ISO days, in the order written: 2026-11-12, 12/11/2026 (day first, as the app shows them), 12 Nov, Nov 12, today, yesterday. */
export function parseDates(question: string, today = todayIso()): string[] {
  const found: { at: number; date: string }[] = [];
  const text = question.toLowerCase();
  const year = Number(today.slice(0, 4));
  const take = (pattern: RegExp, make: (match: RegExpExecArray) => string | null) => {
    for (const match of text.matchAll(pattern)) {
      const date = make(match as RegExpExecArray);
      if (date && !found.some((item) => item.at === match.index)) found.push({ at: match.index ?? 0, date });
    }
  };
  take(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (m) => iso(+m[1], +m[2], +m[3]));
  take(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g, (m) => iso(+m[3], +m[2], +m[1]));
  const month = `(${MONTH_WORD})`;
  take(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${month}\\.?(?:,?\\s+(\\d{4}))?\\b`, 'g'), (m) => iso(m[3] ? +m[3] : year, MONTHS.indexOf(m[2].slice(0, 3)) + 1, +m[1]));
  take(new RegExp(`\\b${month}\\.?\\s+(\\d{1,2})(?!\\d)(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'g'), (m) => iso(m[3] ? +m[3] : year, MONTHS.indexOf(m[1].slice(0, 3)) + 1, +m[2]));
  take(/\btoday\b/g, () => today);
  take(/\byesterday\b/g, () => addDays(today, -1));
  const unique: string[] = [];
  for (const item of found.sort((a, b) => a.at - b.at)) if (!unique.includes(item.date)) unique.push(item.date);
  return unique;
}

export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}

/** The days a question asks about: "between 1 Nov and 10 Nov" is a range; any other dates are each a day. */
export function daysAsked(question: string, dates: string[]): { from: string; to: string }[] {
  if (dates.length === 2 && /\b(between|from|till|until|through|to)\b|\s-\s/i.test(question)) {
    const [a, b] = [...dates].sort();
    return [{ from: a, to: b }];
  }
  return dates.map((date) => ({ from: date, to: date }));
}

const columnNamed = (sheet: SheetWithRows, names: string[]): Column | undefined => {
  for (const name of names) {
    const found = sheet.columns.find((column) => column.name.trim().toLowerCase() === name);
    if (found) return found;
  }
  return undefined;
};

const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, ' ').split(/\s+/).filter((word) => word.length >= 2);

interface Plots {
  /** Plot names exactly as the tables write them, by lower case. */
  names: Map<string, string>;
  /** The first day a plot was planted, or else its first record. */
  planted: Map<string, string>;
}

/** Each plot named in a table of the MAC, and the day each was planted. */
function plotsOf(sheets: readonly SheetWithRows[]): Plots {
  const names = new Map<string, string>();
  const planted = new Map<string, string>();
  const first = new Map<string, string>();
  for (const sheet of sheets) {
    const column = columnNamed(sheet, PLOT_NAMES);
    if (!column) continue;
    const dateColumn = sheet.columns.find((item) => item.type === 'date');
    for (const row of sheet.rows) {
      const name = String(row.data[column.key] ?? '').trim();
      if (!name) continue;
      names.set(name.toLowerCase(), name);
      const day = dateColumn ? String(row.data[dateColumn.key] ?? '').slice(0, 10) : '';
      if (!isIsoDate(day)) continue;
      const map = sheet.templateKey === 'planting-date' ? planted : sheet.templateKey === 'zone-records' ? first : null;
      if (!map) continue;
      const key = name.toLowerCase();
      if (!map.has(key) || day < map.get(key)!) map.set(key, day);
    }
  }
  for (const [key, day] of first) if (!planted.has(key)) planted.set(key, day);
  return { names, planted };
}

/** The plots the question names: a plot is named when its whole name is among the question's words (or in it, for names with spaces). */
export function plotsNamed(question: string, plots: Plots): string[] {
  const text = ` ${words(question).join(' ')} `;
  const named: string[] = [];
  for (const [key, name] of plots.names) {
    if (key.length < 2) continue;
    if (text.includes(` ${words(name).join(' ')} `)) named.push(name);
  }
  return named;
}

interface Line {
  /** Sort key: the day, then the table's place in the MAC. */
  day: string;
  table: number;
  plot: string;
  /** The table's name, and what the record says. */
  title: string;
  facts: string;
  /** What the app noticed about the record (a relation that doesn't hold). */
  notes: string[];
}

function cell(formulas: WorkbookFormulas, sheet: SheetWithRows, rowIndex: number, column: Column): string {
  const row = sheet.rows[rowIndex];
  let value: string;
  if (column.type === 'formula') {
    const result = formulas.value(sheet, row, column);
    if (isFormulaError(result)) return '';
    value = typeof result === 'number' ? String(Number(result.toFixed(3))) : formatFormulaValue(result);
    if (isIsoDate(value)) value = formatDate(value);
  } else {
    value = displayCell(column, String(row.data[column.key] ?? ''));
  }
  value = value.replace(/\s+/g, ' ').trim();
  return value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE - 1)}…` : value;
}

/** The records that belong to the days and plots a question names, from every table, with the relations worked out. */
export function buildRecords(question: string, sheets: readonly SheetWithRows[], today = todayIso()): Lookup {
  const dates = parseDates(question, today);
  const spans = daysAsked(question, dates);
  const plots = plotsOf(sheets);
  const named = plotsNamed(question, plots);
  const looked: string[] = [];
  for (const span of spans) looked.push(span.from === span.to ? `the day ${formatDate(span.from)}` : `the days ${formatDate(span.from)} to ${formatDate(span.to)}`);
  for (const plot of named) looked.push(`plot ${plot}`);
  if (!spans.length && !named.length) return overview(sheets, today);

  const formulas = new WorkbookFormulas([...sheets], today);
  const lines: Line[] = [];
  sheets.forEach((sheet, table) => {
    const dateColumns = sheet.columns.filter((column) => column.type === 'date');
    const plotColumn = columnNamed(sheet, PLOT_NAMES);
    sheet.rows.forEach((row, index) => {
      const plot = plotColumn ? String(row.data[plotColumn.key] ?? '').trim() : '';
      const days = dateColumns.map((column) => ({ column, day: String(row.data[column.key] ?? '').slice(0, 10) })).filter((item) => isIsoDate(item.day));
      const onDay = days.find((item) => spans.some((span) => item.day >= span.from && item.day <= span.to));
      const ofPlot = plot !== '' && named.some((name) => name.toLowerCase() === plot.toLowerCase());
      // With a plot and a day both named, a record has to be of that plot on that day; with only one named, either is enough.
      if (spans.length && named.length ? !(onDay && ofPlot) : !(onDay || ofPlot)) return;
      const day = (onDay ?? days[0])?.day ?? '';
      const facts: string[] = [];
      for (const item of days) if (item.day !== day) facts.push(`${item.column.name}: ${formatDate(item.day)}`);
      for (const column of sheet.columns) {
        if (facts.length >= MAX_FACTS) break;
        if (column.type === 'date' || column === plotColumn || LEFT_OUT.has(column.name.trim().toLowerCase())) continue;
        const value = cell(formulas, sheet, index, column);
        if (value) facts.push(`${column.name}: ${value}`);
      }
      const notes: string[] = [];
      if (plot) {
        const planted = plots.planted.get(plot.toLowerCase());
        if (planted && day) {
          const gap = daysBetween(planted, day);
          if (gap < 0 && sheet.templateKey !== 'planting-date') notes.push(`${sheet.title} of plot ${plot} is dated ${-gap} day${gap === -1 ? '' : 's'} BEFORE the plot was planted (${formatDate(planted)})`);
        } else if (!planted && sheet.templateKey !== 'planting-date') {
          notes.push(`no planting date found for plot ${plot}`);
        }
      } else if (columnNamed(sheet, PLOT_NAMES)) {
        notes.push(`a ${sheet.title} record has no plot${day ? ` (${formatDate(day)})` : ''}`);
      }
      if (day > today) notes.push(`${sheet.title} is dated ${formatDate(day)}, in the future`);
      lines.push({ day, table, plot, title: sheet.title, facts: facts.join('; '), notes });
    });
  });
  lines.sort((a, b) => a.day.localeCompare(b.day) || a.table - b.table);
  const shown = lines.slice(0, MAX_LINES);
  const noticed = [...new Set(shown.flatMap((line) => line.notes))];
  const parts: string[] = [`LOOKED FOR: ${looked.join('; ')}.`];
  if (!lines.length) parts.push('No record in any table matches.');
  else {
    parts.push(`${lines.length} record${lines.length === 1 ? '' : 's'} found${lines.length > shown.length ? ` (the first ${shown.length} are listed)` : ''}, by plot:`);
    // One block for each plot, with what it was planted and each of its records dated; records with no plot last.
    const byPlot = new Map<string, Line[]>();
    for (const line of shown) byPlot.set(line.plot.toLowerCase(), [...(byPlot.get(line.plot.toLowerCase()) ?? []), line]);
    const keys = [...byPlot.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
    for (const key of keys) {
      const group = byPlot.get(key)!;
      const planted = plots.planted.get(key);
      parts.push('', key === '' ? 'RECORDS WITH NO PLOT:' : `PLOT ${group[0].plot}${planted ? ` (planted ${formatDate(planted)})` : ''}:`);
      for (const line of group) parts.push(`- ${line.day ? `${formatDate(line.day)} ` : ''}${line.title}${line.facts ? ` — ${line.facts}` : ''}`);
    }
  }
  const counts = new Map<string, number>();
  for (const line of shown) counts.set(line.title, (counts.get(line.title) ?? 0) + 1);
  const tables = [...counts].map(([name, count]) => ({ name, count }));
  return { text: parts.join('\n'), looked, records: shown.length, left: lines.length - shown.length, found: true, notes: noticed, tables };
}

/** For a question that names no day and no plot: which tables there are, how full, and the latest day each has. */
function overview(sheets: readonly SheetWithRows[], today: string): Lookup {
  const lines = sheets.map((sheet) => {
    const column = sheet.columns.find((item) => item.type === 'date');
    const days = column ? sheet.rows.map((row) => String(row.data[column.key] ?? '').slice(0, 10)).filter(isIsoDate).sort() : [];
    const range = days.length ? `, dated ${formatDate(days[0])} to ${formatDate(days[days.length - 1])}` : '';
    return `- ${sheet.title}: ${sheet.rows.length} record${sheet.rows.length === 1 ? '' : 's'}${range}`;
  });
  return {
    text: `Today is ${formatDate(today)}. The question names no day and no plot, so only the tables are listed:\n${lines.join('\n')}`,
    looked: ['the list of tables (name a day, like 12 Nov, or a plot to see its records)'],
    records: 0,
    left: 0,
    found: false,
    notes: [],
    tables: [],
  };
}
