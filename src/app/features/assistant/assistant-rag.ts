import type { Column, Row, SheetWithRows } from '@core/models';
import { formatFormulaValue, isFormulaError } from '@shared/formula/evaluate-formula';
import { WorkbookFormulas } from '@shared/formula/sheet-formulas';
import { formatDate, isIsoDate, todayIso } from '@shared/sheet/columns';
import { addDays, buildRecords, daysAsked, parseDates } from './assistant-context';

/**
 * Retrieval for the local assistant. A small model can't search or add up a farm's tables, so the app does: it works out from the
 * question which table it is about and what is being asked (a count, a total, the most, a list, what happened, what doesn't fit),
 * runs those queries on the tables, and hands the model the exact results with a few matching records. The model only puts them into
 * words. Each query is kept with its result so the person can see what was run.
 */

export interface Query {
  title: string;
  /** The query, written as plain steps: "Zones: count Plot, grouped by Zone". */
  sql: string;
  /** The result, one line each. */
  lines: string[];
  /** How many records it came to. */
  rows: number;
  warn?: boolean;
}

/** What a follow-up question may take from the one before it. */
export interface Carry {
  sheet: string | null;
  filters: string[];
  kinds: string[];
}

export interface Rag {
  /** What the app understood the question to ask, in short sentences. */
  understood: string[];
  queries: Query[];
  /** What the assistant reads: the query results, then matching records. */
  context: string;
  /** What the app noticed does not fit in the records it found. */
  notes: string[];
  /** Records handed over (not counting query results). */
  records: number;
  /** Something was found. When false, the app answers itself. */
  found: boolean;
  /** The answer when no model is needed (nothing found, or a plain check). */
  direct: string | null;
  carry: Carry;
}

type Kind = 'count' | 'sum' | 'average' | 'max' | 'min' | 'list' | 'happened' | 'problems' | 'empty' | 'search';

const STOP = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with', 'and', 'or', 'me', 'my', 'it', 'its',
  'this', 'that', 'those', 'these', 'there', 'have', 'has', 'had', 'what', 'which', 'who', 'how', 'many', 'much', 'number', 'count', 'total', 'sum', 'average', 'mean', 'avg',
  'most', 'least', 'highest', 'lowest', 'largest', 'smallest', 'biggest', 'best', 'worst', 'top', 'list', 'show', 'tell', 'give', 'all', 'each', 'every', 'per', 'any', 'can', 'you',
  'please', 'about', 'than', 'then', 'also', 'happen', 'happened', 'record', 'row', 'data', 'table', 'farm', 'day', 'date', 'so', 'far', 'now', 'get',
]);

const NOT_MEASURE = new Set(['id', 'row', 'column', 'day number', 'zone number', 'order', 'no']);

const stem = (word: string): string => {
  if (word.length > 4 && /(ches|shes|xes|sses)$/.test(word)) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  if (word.length > 6 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 5 && word.endsWith('ed')) return word.slice(0, -2);
  return word;
};

const words = (text: string): string[] => text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean);
const tokens = (text: string): string[] => words(text).map(stem);
const meaningful = (list: string[]): string[] => list.filter((word) => !STOP.has(word) && word.length > 1);
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const number = (value: number): string => (Number.isInteger(value) ? value.toLocaleString('en-US') : value.toLocaleString('en-US', { maximumFractionDigits: 2 }));

// ------------------------------------------------------------------ the tables, as the queries see them

interface Col {
  column: Column;
  name: string;
  /** The name's words, stemmed. */
  words: string[];
  kind: 'entity' | 'measure' | 'date' | 'other';
}

interface Table {
  sheet: SheetWithRows;
  cols: Col[];
  plot: Col | null;
  date: Col | null;
  value: (row: Row, col: Col) => string;
  titleWords: string[];
  allWords: Set<string>;
}

const PLOT_NAMES = ['zone plot', 'plot', 'zone'];

function tableOf(sheet: SheetWithRows, formulas: WorkbookFormulas): Table {
  const cols: Col[] = sheet.columns.map((column) => {
    const name = column.name.trim();
    const lower = name.toLowerCase();
    const numeric = column.type === 'number' || column.type === 'percentage' || column.type === 'formula';
    let kind: Col['kind'] = 'other';
    if (column.type === 'date') kind = 'date';
    else if (numeric && !NOT_MEASURE.has(lower)) kind = 'measure';
    else if (column.type === 'text' || column.type === 'link' || column.type === 'choice' || column.type === 'yesno' || NOT_MEASURE.has(lower)) kind = lower === 'id' || lower === 'row' || lower === 'column' || lower === 'day number' ? 'other' : 'entity';
    return { column, name, words: tokens(name), kind };
  });
  const value = (row: Row, col: Col): string => {
    if (col.column.type === 'formula') {
      const result = formulas.value(sheet, row, col.column);
      if (isFormulaError(result)) return '';
      return typeof result === 'number' ? String(result) : formatFormulaValue(result);
    }
    return String(row.data[col.column.key] ?? '').trim();
  };
  let plot: Col | null = null;
  for (const name of PLOT_NAMES) {
    plot = cols.find((col) => col.name.toLowerCase() === name && col.kind !== 'other') ?? null;
    if (plot) break;
  }
  const date = cols.find((col) => col.kind === 'date') ?? null;
  const titleWords = tokens(sheet.title);
  return { sheet, cols, plot, date, value, titleWords, allWords: new Set([...titleWords, ...cols.flatMap((col) => col.words)]) };
}

// ------------------------------------------------------------------ understanding the question

function intentsOf(text: string): Kind[] {
  const kinds: Kind[] = [];
  if (/\b(missing|empty|blank|not filled|unfilled|lack|lacks|no input)\b/.test(text)) kinds.push('empty');
  if (/\b(not fit|doesn'?t fit|does anything|anything wrong|anything odd|problem|problems|error|errors|mistake|mistakes|inconsisten\w*|suspicious|odd|strange|outlier|outliers|wrong)\b/.test(text)) kinds.push('problems');
  if (/\b(how many|number of|count of|count)\b/.test(text)) kinds.push('count');
  if (/\b(average|avg|mean)\b/.test(text)) kinds.push('average');
  if (/\b(total|sum|altogether|how much|in all|overall)\b/.test(text)) kinds.push('sum');
  if (/\b(most|highest|largest|biggest|maximum|max|best|top|greatest|longest)\b/.test(text)) kinds.push('max');
  if (/\b(least|lowest|smallest|minimum|min|worst|fewest|shortest)\b/.test(text)) kinds.push('min');
  if (/\b(list|which|show|name|what are|who)\b/.test(text)) kinds.push('list');
  if (/\b(what happened|what was done|what did|activity|activities|timeline|history|going on)\b/.test(text)) kinds.push('happened');
  return kinds;
}

/** A period of days the question names without a day: "in November", "this month", "last 7 days". */
function periodsOf(text: string, today: string): { from: string; to: string; label: string }[] {
  const out: { from: string; to: string; label: string }[] = [];
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const span = (y: number, m: number) => {
    const from = `${y}-${String(m).padStart(2, '0')}-01`;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from, to: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}` };
  };
  if (/\bthis month\b/.test(text)) out.push({ ...span(year, month), label: 'this month' });
  if (/\blast month\b/.test(text)) out.push({ ...(month === 1 ? span(year - 1, 12) : span(year, month - 1)), label: 'last month' });
  if (/\bthis year\b/.test(text)) out.push({ from: `${year}-01-01`, to: `${year}-12-31`, label: 'this year' });
  const week = /\b(?:last|past)\s+(\d{1,3})\s+days\b/.exec(text);
  if (week) out.push({ from: addDays(today, 1 - Number(week[1])), to: today, label: `the last ${week[1]} days` });
  if (/\bthis week\b/.test(text)) out.push({ from: addDays(today, -6), to: today, label: 'the last 7 days' });
  const names = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  for (const match of text.matchAll(/\b(?:in|during|for|of)\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?\b(?!\s+\d)/g)) {
    out.push({ ...span(match[2] ? Number(match[2]) : year, names.indexOf(match[1]) + 1), label: match[1][0].toUpperCase() + match[1].slice(1) });
  }
  return out;
}

interface Filter {
  /** The column the value is in, and the table that column is in. */
  table: Table;
  col: Col;
  value: string;
}

/** The values of `col` the question names: "Ripe", "A25", "zone A" (a one-letter value only after its column's name). */
function filtersIn(table: Table, question: string, skip: Set<Col>): Filter[] {
  const text = ` ${words(question).join(' ')} `;
  const found: Filter[] = [];
  for (const col of table.cols) {
    if (col.kind !== 'entity' || skip.has(col)) continue;
    const seen = new Set<string>();
    for (const row of table.sheet.rows) {
      const value = table.value(row, col);
      if (value) seen.add(value);
      if (seen.size > 600) break;
    }
    if (seen.size > 600) continue;
    const head = col.name.toLowerCase();
    for (const value of seen) {
      const lower = value.toLowerCase();
      if (lower.length >= 2 && STOP.has(lower)) continue;
      const hit =
        lower.length >= 2
          ? text.includes(` ${words(value).join(' ')} `)
          : new RegExp(`\\b(?:${escapeRegex(head)}|${col.words.map(escapeRegex).join('|')})s?\\s+${escapeRegex(lower)}\\b`).test(question.toLowerCase());
      if (hit) found.push({ table, col, value });
    }
  }
  return found;
}

// ------------------------------------------------------------------ running the queries

interface Ctx {
  tables: Table[];
  zones: Table | null;
  today: string;
}

/** The rows of `table` that pass every filter, a day range, and the filters that come from another table through the plot. */
function select(table: Table, ctx: Ctx, filters: Filter[], spans: { from: string; to: string }[]): Row[] {
  const direct = filters.filter((filter) => filter.table === table);
  const foreign = filters.filter((filter) => filter.table !== table);
  // A filter on another table (the zone, from Zones) becomes the plots that have it.
  const plotSets = foreign.map((filter) => {
    const set = new Set<string>();
    if (filter.table.plot) for (const row of filter.table.sheet.rows) if (filter.table.value(row, filter.col).toLowerCase() === filter.value.toLowerCase()) set.add(filter.table.value(row, filter.table.plot).toLowerCase());
    return set;
  });
  const usable = (index: number) => !!table.plot && !!foreign[index].table.plot;
  return table.sheet.rows.filter((row) => {
    for (const filter of direct) if (table.value(row, filter.col).toLowerCase() !== filter.value.toLowerCase()) return false;
    for (let index = 0; index < foreign.length; index++) {
      if (!usable(index)) continue;
      if (!plotSets[index].has(table.value(row, table.plot!).toLowerCase())) return false;
    }
    if (spans.length && table.date) {
      const day = String(row.data[table.date.column.key] ?? '').slice(0, 10);
      if (!isIsoDate(day) || !spans.some((span) => day >= span.from && day <= span.to)) return false;
    }
    return true;
  });
}

/** What groups a row for `col`, which may be a column of the plot's own table (Zone, in Zones) reached through the plot. */
function groupOf(table: Table, ctx: Ctx, col: Col, owner: Table): ((row: Row) => string) | null {
  if (owner === table) return (row) => table.value(row, col) || '(none)';
  if (!table.plot || !owner.plot) return null;
  const byPlot = new Map<string, string>();
  for (const row of owner.sheet.rows) byPlot.set(owner.value(row, owner.plot).toLowerCase(), owner.value(row, col));
  return (row) => byPlot.get(table.value(row, table.plot!).toLowerCase()) || '(none)';
}

const asNumber = (text: string): number | null => {
  const value = Number(text.replace(/,/g, '').replace(/%$/, ''));
  return text.trim() !== '' && Number.isFinite(value) ? value : null;
};

function breakdown(map: Map<string, number>, limit: number): string[] {
  const entries = [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { numeric: true }));
  return entries.slice(0, limit).map(([name, value]) => `${name}: ${number(value)}`);
}

interface Plan {
  table: Table | null;
  kinds: Kind[];
  filters: Filter[];
  spans: { from: string; to: string; label: string }[];
}

// ------------------------------------------------------------------ the whole thing

export function runRag(question: string, sheets: readonly SheetWithRows[], today = todayIso(), before: Carry | null = null): Rag {
  const text = question.toLowerCase();
  const formulas = new WorkbookFormulas([...sheets], today);
  const tables = sheets.map((sheet) => tableOf(sheet, formulas));
  const zones = tables.find((table) => table.sheet.templateKey === 'zones') ?? null;
  const ctx: Ctx = { tables, zones, today };
  const understood: string[] = [];
  const queries: Query[] = [];
  let kinds = intentsOf(text);

  // Which table the question is about: the one whose name and columns share the most words with it.
  const q = meaningful(tokens(question));
  const scored = tables
    .map((table) => ({ table, score: q.reduce((sum, word) => sum + (table.titleWords.includes(word) ? 3 : 0) + (table.allWords.has(word) ? 1 : 0), 0) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  let table: Table | null = scored[0]?.table ?? null;
  const dates = parseDates(question, today);
  const spans: { from: string; to: string; label: string }[] = [
    ...daysAsked(question, dates).map((span) => ({ ...span, label: span.from === span.to ? formatDate(span.from) : `${formatDate(span.from)} to ${formatDate(span.to)}` })),
    ...periodsOf(text, today),
  ];

  // The values the question names, in the table asked about (and in Zones, whose zones and plots other tables follow).
  const nounSkip = new Set<Col>();
  let filters: Filter[] = [];
  const candidates = table ? [table, ...(zones && zones !== table ? [zones] : [])] : zones ? [zones] : [];
  for (const candidate of candidates) filters.push(...filtersIn(candidate, question, nounSkip));
  // A plot that is named wins over the zone it is in, and "Zone number" repeats "Zone": keep the most specific of each table.
  filters = filters.filter((filter, index) => filters.findIndex((other) => other.table === filter.table && other.col === filter.col) === index);

  // A follow-up ("and in zone B?", "what about that for November") carries the table, and what was asked, from the question before.
  const connector = /^(and|what about|how about|same for|only|also|then)\b/.test(text) || /\b(that|those|them)\b/.test(text);
  const namesOtherTable = scored.some((item) => item.table.titleWords.some((word) => q.includes(word) && word !== 'zone' && word !== 'plot'));
  if (before?.sheet && ((connector && !namesOtherTable) || (!table && !filters.length && !spans.length && connector))) {
    const earlier = tables.find((item) => item.sheet.title === before.sheet) ?? null;
    if (earlier) {
      if (earlier !== table) {
        table = earlier;
        // The filters are looked for again in the table carried over.
        filters = [];
        for (const candidate of [earlier, ...(zones && zones !== earlier ? [zones] : [])]) filters.push(...filtersIn(candidate, question, nounSkip));
      }
      if (!kinds.length) kinds = before.kinds as Kind[];
      understood.push(`Carried over from the question before: ${earlier.sheet.title}${before.kinds.length ? ` (${before.kinds.join(', ')})` : ''}`);
    }
  }

  const plan: Plan = { table, kinds, filters, spans };
  if (table) understood.push(`Table: ${table.sheet.title}`);
  if (filters.length) understood.push(`Only: ${filters.map((filter) => `${filter.col.name} ${filter.value}`).join(', ')}`);
  if (spans.length) understood.push(`Days: ${spans.map((span) => span.label).join(', ')}`);
  const wanted = kinds.filter((kind) => kind !== 'list' || kinds.length === 1);
  if (wanted.length) understood.push(`Asking: ${wanted.join(', ')}`);

  const notes: string[] = [];
  let records = 0;
  let recordsText = '';

  if (kinds.includes('problems')) {
    const found = checkEverything(tables, today);
    queries.push({
      title: 'Checked every table for records that do not fit',
      sql: 'Each record: is it dated before its plot was planted, has no plot, is dated in the future, or has a number far from the rest of its column?',
      lines: found.length ? found : ["Nothing that doesn't fit."],
      rows: found.length,
      warn: found.length > 0,
    });
    notes.push(...found);
  }

  if (kinds.includes('empty') && table) {
    const empty = table.cols
      .filter((col) => col.kind !== 'other' || col.name.toLowerCase() !== 'id')
      .map((col) => ({ col, count: table!.sheet.rows.filter((row) => table!.value(row, col) === '').length }))
      .filter((item) => item.count > 0 && table!.sheet.rows.length > 0)
      .sort((a, b) => b.count - a.count);
    queries.push({
      title: `Looked for empty cells in ${table.sheet.title}`,
      sql: `${table.sheet.title}: for each column, how many of its ${number(table.sheet.rows.length)} records have nothing entered`,
      lines: empty.length ? empty.slice(0, 12).map((item) => `${item.col.name}: ${number(item.count)} of ${number(table!.sheet.rows.length)} empty`) : ['Every cell is filled in.'],
      rows: empty.length,
    });
  }

  const asks = kinds.filter((kind) => ['count', 'sum', 'average', 'max', 'min', 'list'].includes(kind));
  if (table && asks.length) {
    const measureQuery = runMeasure(table, ctx, question, text, kinds, plan, understood);
    if (measureQuery) queries.push(measureQuery);
  }

  // What happened on a day or to a plot: every table's records of it, by plot.
  const wantsRecords = kinds.includes('happened') || (!asks.length && !kinds.includes('problems') && !kinds.includes('empty') && (spans.length > 0 || plotNamed(question, tables)));
  if (wantsRecords && (spans.length > 0 || plotNamed(question, tables))) {
    const lookup = buildRecords(question, sheets, today);
    if (lookup.found) {
      records = lookup.records;
      recordsText = lookup.text;
      notes.push(...lookup.notes);
      queries.push({
        title: 'Searched every table for the day or plot',
        sql: `Every table: records ${lookup.looked.join(' and ')}, by plot`,
        lines: lookup.records ? lookup.text.split('\n').filter((line) => line.trim() !== '') : ['No record in any table matches.'],
        rows: lookup.records,
      });
    }
  }

  // A table named and nothing asked of it: what is in it.
  if (!queries.length && table) {
    const rows = select(table, ctx, plan.filters, plan.spans);
    const lines = [`${number(rows.length)} record${rows.length === 1 ? '' : 's'}${plan.filters.length || plan.spans.length ? ' for this selection' : ''}`];
    if (table.date) {
      const days = rows.map((row) => String(row.data[table.date!.column.key] ?? '').slice(0, 10)).filter(isIsoDate).sort();
      if (days.length) lines.push(`${table.date.name}: ${formatDate(days[0])} to ${formatDate(days[days.length - 1])}`);
    }
    for (const col of table.cols.filter((item) => item.kind === 'measure').slice(0, 6)) {
      const values = rows.map((row) => asNumber(table.value(row, col))).filter((value): value is number => value !== null);
      if (values.length) lines.push(`${col.name}: total ${number(values.reduce((a, b) => a + b, 0))}, average ${number(values.reduce((a, b) => a + b, 0) / values.length)} (${number(values.length)} records)`);
    }
    queries.push({ title: `Summary of ${table.sheet.title}`, sql: `${table.sheet.title}: how many records, the days they cover, each number column's total and average`, lines, rows: rows.length });
  }

  // Nothing above fits: look for the records that share the most words with the question.
  if (!queries.length) {
    const hits = searchRecords(question, tables, 10);
    if (hits.length) {
      records = hits.length;
      recordsText = hits.map((hit) => `- ${hit}`).join('\n');
      queries.push({ title: 'Searched the records for the words of the question', sql: 'Every table: the records that share the most words with the question', lines: hits, rows: hits.length });
    } else {
      queries.push({
        title: 'Listed the tables',
        sql: 'Every table: how many records, and the days they cover',
        lines: tables.map((item) => `${item.sheet.title}: ${number(item.sheet.rows.length)} record${item.sheet.rows.length === 1 ? '' : 's'}`),
        rows: 0,
      });
    }
  }

  const found = queries.some((query) => query.rows > 0 || query.lines.length > 0) && !(queries.length === 1 && queries[0].title === 'Listed the tables');
  const results = queries.filter((query) => query.title !== 'Listed the tables' && !query.title.startsWith('Searched'));
  const parts: string[] = [];
  if (results.length) parts.push('QUERY RESULTS (exact, computed by the app):', ...results.map((query, index) => `${index + 1}. ${query.title}${query.lines.length ? `\n   ${query.lines.join('\n   ')}` : ''}`));
  if (recordsText) parts.push('', 'RECORDS:', recordsText);
  if (!parts.length) parts.push('No query found anything for this question.');
  // Nothing to put into words: the app answers itself.
  let direct: string | null = null;
  if (!found) direct = `I couldn't find anything for that in the tables. Try naming a table, a plot, a day or a column, for example “how many plots in zone A?” or “total harvest yield in November”.`;
  else if (kinds.includes('problems') && queries.length === 1) {
    // What does not fit is worked out by the app, so it is told as it is: the model would only blur it.
    direct = notes.length
      ? `I checked every table and found ${notes.length} thing${notes.length === 1 ? '' : 's'} that ${notes.length === 1 ? "doesn't" : "don't"} fit:\n${notes.map((note) => `• ${note}`).join('\n')}`
      : "I checked every table and found nothing that doesn't fit: no record before its plot was planted, none without a plot, none in the future, and no number far from the rest of its column.";
  }
  else if (queries.length === 1 && queries[0].rows === 0 && queries[0].lines.length === 1 && /^(No record|Every cell)/.test(queries[0].lines[0])) direct = queries[0].lines[0];
  return {
    understood,
    queries,
    context: parts.join('\n'),
    notes: [...new Set(notes)],
    records,
    found,
    direct,
    carry: { sheet: table?.sheet.title ?? before?.sheet ?? null, filters: filters.map((filter) => `${filter.col.name} ${filter.value}`), kinds },
  };
}

function plotNamed(question: string, tables: Table[]): boolean {
  const text = ` ${words(question).join(' ')} `;
  for (const table of tables) {
    if (!table.plot) continue;
    const seen = new Set<string>();
    for (const row of table.sheet.rows) {
      const value = table.value(row, table.plot).toLowerCase();
      if (value.length >= 2 && !seen.has(value)) {
        seen.add(value);
        if (text.includes(` ${words(value).join(' ')} `)) return true;
      }
    }
  }
  return false;
}

/** A count, a total, an average, the most or least, or a list: from one table, with the filters, optionally grouped. */
function runMeasure(table: Table, ctx: Ctx, question: string, text: string, kinds: Kind[], plan: Plan, understood: string[]): Query | null {
  const rows = select(table, ctx, plan.filters, plan.spans);
  const q = meaningful(tokens(question));
  const named = (col: Col) => col.words.filter((word) => q.includes(word)).length;
  const exact = (col: Col) => col.words.length > 0 && named(col) === col.words.length;
  const where = [...plan.filters.map((filter) => `${filter.col.name} = ${filter.value}`), ...plan.spans.map((span) => `${table.date?.name ?? 'date'} ${span.label}`)];
  const whereText = where.length ? ` where ${where.join(' and ')}` : '';

  // The column to group by: one the question names with "per", "by", "each" or "in the" (the zone), other than what is counted or added up.
  const noun = /(?:how many|number of|count of|list|which|show|name|what are)\s+(?:the\s+)?([\p{L}\p{N}\s-]+?)(?:\s+(?:in|on|at|are|is|do|does|did|have|has|were|was|per|by|for|of|from|across|each|there)\b|$|\?)/u.exec(text)?.[1] ?? '';
  const nounWords = tokens(noun).filter((word) => !STOP.has(word));
  // The column counted or listed: the longest name made of the noun's words, the later in the noun the better ("zone plot" is about plots).
  const counted = nounWords.length
    ? [...table.cols]
        .filter((col) => col.kind === 'entity' && col.words.length > 0 && col.words.every((word) => nounWords.includes(word)))
        .sort((a, b) => b.words.length - a.words.length || Math.max(...b.words.map((w) => nounWords.lastIndexOf(w))) - Math.max(...a.words.map((w) => nounWords.lastIndexOf(w))))[0] ?? null
    : null;
  const wantsMeasure = kinds.some((kind) => kind === 'sum' || kind === 'average' || kind === 'max' || kind === 'min');
  const measure = table.cols.filter((col) => col.kind === 'measure').map((col) => ({ col, hit: named(col) })).sort((a, b) => b.hit - a.hit || a.col.words.length - b.col.words.length)[0];
  // "how many plants are dead" asks for a column that holds a count ("Dead plant"): add it up, rather than count the records.
  const countsAColumn = !wantsMeasure && !counted && !!measure && measure.hit > 0 && measure.hit === measure.col.words.length;
  const useMeasure = measure && (wantsMeasure ? true : countsAColumn) && (measure.hit > 0 || wantsMeasure) ? measure.col : null;

  const groupWanted = /\b(per|by|each|every|in the|in a|across|which|break ?down|split)\b/.test(text) || kinds.includes('max') || kinds.includes('min');
  const entityCols: { col: Col; owner: Table }[] = [...table.cols.filter((col) => col.kind === 'entity').map((col) => ({ col, owner: table })), ...(ctx.zones && ctx.zones !== table ? ctx.zones.cols.filter((col) => col.kind === 'entity').map((col) => ({ col, owner: ctx.zones! })) : [])];
  const groupCandidates = entityCols
    .filter((item) => item.col !== counted && item.col !== useMeasure && named(item.col) > 0 && !plan.filters.some((filter) => filter.col === item.col))
    // A column whose whole name is in the question beats one that only shares a word ("zone" is Zones' Zone, not Harvest's Zone plot); then the table's own.
    .sort((a, b) => Number(exact(b.col)) - Number(exact(a.col)) || named(b.col) - named(a.col) || Number(b.owner === table) - Number(a.owner === table) || a.col.words.length - b.col.words.length);
  const group = groupWanted ? groupCandidates[0] ?? null : null;
  const grouper = group ? groupOf(table, ctx, group.col, group.owner) : null;

  if (useMeasure) {
    const verb = !wantsMeasure ? 'total' : kinds.includes('average') ? 'average' : kinds.includes('max') && !group && !kinds.includes('sum') ? 'highest' : kinds.includes('min') && !group && !kinds.includes('sum') ? 'lowest' : 'total';
    const values = rows.map((row) => ({ row, value: asNumber(table.value(row, useMeasure)) })).filter((item): item is { row: Row; value: number } => item.value !== null);
    const sql = `${table.sheet.title}: ${verb} of ${useMeasure.name}${whereText}${group ? `, grouped by ${group.col.name}` : ''}`;
    if (!values.length) return { title: `${cap(verb)} of ${useMeasure.name}`, sql, lines: [`No ${useMeasure.name} entered${whereText ? ` for this selection` : ''}.`], rows: 0 };
    understood.push(`Measure: ${useMeasure.name}`);
    if (grouper) {
      understood.push(`Grouped by ${group!.col.name}`);
      const sums = new Map<string, number>();
      const counts = new Map<string, number>();
      for (const item of values) {
        const key = grouper(item.row);
        sums.set(key, (sums.get(key) ?? 0) + item.value);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const final = new Map<string, number>([...sums].map(([key, sum]) => [key, verb === 'average' ? sum / (counts.get(key) ?? 1) : sum]));
      const order = kinds.includes('min') ? 1 : -1;
      const entries = [...final].sort((a, b) => order * (a[1] - b[1]) || a[0].localeCompare(b[0], undefined, { numeric: true }));
      const top = kinds.includes('max') || kinds.includes('min') ? 5 : 20;
      const lines = entries.slice(0, top).map(([key, value]) => `${key}: ${number(value)}`);
      if (entries.length > top) lines.push(`(+${entries.length - top} more groups)`);
      const grand = verb === 'average' ? values.reduce((sum, item) => sum + item.value, 0) / values.length : values.reduce((sum, item) => sum + item.value, 0);
      lines.push(`${verb === 'average' ? 'Average over all' : 'All together'}: ${number(grand)}`);
      return { title: `${cap(verb)} of ${useMeasure.name} by ${group!.col.name}`, sql, lines, rows: values.length };
    }
    if (kinds.includes('max') || kinds.includes('min')) {
      const order = kinds.includes('min') ? 1 : -1;
      const label = (row: Row) => [table.plot ? table.value(row, table.plot) : '', table.date ? formatDate(String(row.data[table.date.column.key] ?? '').slice(0, 10)) : ''].filter(Boolean).join(' · ') || `row ${row.rowId}`;
      const top = [...values].sort((a, b) => order * (a.value - b.value)).slice(0, 5);
      return { title: `${kinds.includes('min') ? 'Lowest' : 'Highest'} ${useMeasure.name}`, sql: `${sql}, five records`, lines: top.map((item) => `${label(item.row)}: ${number(item.value)}`), rows: values.length };
    }
    const result = verb === 'average' ? values.reduce((sum, item) => sum + item.value, 0) / values.length : values.reduce((sum, item) => sum + item.value, 0);
    return { title: `${cap(verb)} of ${useMeasure.name}`, sql, lines: [`${number(result)} (from ${number(values.length)} record${values.length === 1 ? '' : 's'})`], rows: values.length };
  }

  // A count: the records, or the different values of the column that is counted ("plots"), by group when asked.
  const countCol = counted;
  const distinct = (list: Row[]) => (countCol ? new Set(list.map((row) => table.value(row, countCol)).filter(Boolean)).size : list.length);
  const noun1 = countCol ? countCol.name : 'records';
  understood.push(`Counting ${noun1}${countCol ? ' (different values)' : ''}`);
  const sql = `${table.sheet.title}: count ${countCol ? `different ${countCol.name}` : 'records'}${whereText}${group ? `, grouped by ${group.col.name}` : ''}`;
  const total = distinct(rows);
  const nounText = countCol ? (/s$/i.test(noun1) || total === 1 ? noun1.toLowerCase() : `${noun1.toLowerCase()}s`) : total === 1 ? 'record' : 'records';
  const lines = [`${number(total)} ${nounText} in total`];
  if (grouper) {
    understood.push(`Grouped by ${group!.col.name}`);
    const parts = new Map<string, Row[]>();
    for (const row of rows) parts.set(grouper(row), [...(parts.get(grouper(row)) ?? []), row]);
    const counts = new Map<string, number>([...parts].map(([key, list]) => [key, distinct(list)]));
    lines.push(...breakdown(counts, 30).map((line) => `By ${group!.col.name} — ${line}`));
    if (counts.size > 30) lines.push(`(+${counts.size - 30} more groups)`);
  }
  if (kinds.includes('list') && countCol) {
    const values = [...new Set(rows.map((row) => table.value(row, countCol)).filter(Boolean))];
    lines.push(`${countCol.name}: ${values.slice(0, 40).join(', ')}${values.length > 40 ? ` (+${values.length - 40} more)` : ''}`);
  }
  return { title: `Count of ${noun1} in ${table.sheet.title}`, sql, lines, rows: rows.length };
}

const cap = (text: string) => text[0].toUpperCase() + text.slice(1);

/** The records that share the most words with the question (words that are names or values count most). */
function searchRecords(question: string, tables: Table[], limit: number): string[] {
  const q = new Set(meaningful(tokens(question)));
  if (!q.size) return [];
  const scored: { score: number; line: string }[] = [];
  for (const table of tables) {
    for (const row of table.sheet.rows) {
      const parts = table.cols.map((col) => ({ col, value: table.value(row, col) })).filter((item) => item.value !== '');
      const rowWords = new Set(parts.flatMap((item) => tokens(item.value)));
      let score = 0;
      for (const word of q) if (rowWords.has(word)) score += 2;
      if (!score) continue;
      for (const word of q) if (table.titleWords.includes(word)) score += 1;
      const facts = parts.slice(0, 8).map((item) => `${item.col.name}: ${item.col.kind === 'date' && isIsoDate(item.value.slice(0, 10)) ? formatDate(item.value.slice(0, 10)) : item.value.slice(0, 40)}`);
      scored.push({ score, line: `${table.sheet.title} — ${facts.join('; ')}` });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((item) => item.line);
}

/** Records that do not fit: before their plot was planted, with no plot, dated in the future, a number far from the rest of its column. */
function checkEverything(tables: Table[], today: string): string[] {
  const out: string[] = [];
  const planted = new Map<string, string>();
  for (const table of tables) {
    if (!table.plot || !table.date) continue;
    if (table.sheet.templateKey !== 'planting-date' && table.sheet.templateKey !== 'zone-records') continue;
    for (const row of table.sheet.rows) {
      const plot = table.value(row, table.plot).toLowerCase();
      const day = String(row.data[table.date.column.key] ?? '').slice(0, 10);
      if (!plot || !isIsoDate(day)) continue;
      if (table.sheet.templateKey === 'planting-date' || !planted.has(plot)) {
        if (!planted.has(plot) || day < planted.get(plot)!) planted.set(plot, day);
      }
    }
  }
  for (const table of tables) {
    const title = table.sheet.title;
    const early: string[] = [];
    let noPlot = 0;
    const future: string[] = [];
    for (const row of table.sheet.rows) {
      const plot = table.plot ? table.value(row, table.plot) : '';
      for (const col of table.cols.filter((item) => item.kind === 'date')) {
        const day = String(row.data[col.column.key] ?? '').slice(0, 10);
        if (!isIsoDate(day)) continue;
        if (day > today) future.push(`${plot || 'no plot'} ${formatDate(day)}`);
        const start = plot ? planted.get(plot.toLowerCase()) : undefined;
        if (start && day < start && table.sheet.templateKey !== 'planting-date' && table.sheet.templateKey !== 'zone-records') early.push(`${plot} ${formatDate(day)} (planted ${formatDate(start)})`);
      }
      if (table.plot && !plot && table.sheet.templateKey !== 'zones' && Object.values(row.data).some((value) => String(value ?? '').trim() !== '')) noPlot++;
    }
    if (early.length) out.push(`${title}: ${early.length} record${early.length === 1 ? ' is' : 's are'} dated before the plot was planted, e.g. ${early.slice(0, 3).join(', ')}`);
    if (noPlot) out.push(`${title}: ${noPlot} record${noPlot === 1 ? ' has' : 's have'} no plot`);
    if (future.length) out.push(`${title}: ${future.length} record${future.length === 1 ? ' is' : 's are'} dated in the future, e.g. ${future.slice(0, 3).join(', ')}`);
    for (const col of table.cols.filter((item) => item.kind === 'measure')) {
      const pairs = table.sheet.rows.map((row) => ({ row, value: asNumber(table.value(row, col)) })).filter((item): item is { row: Row; value: number } => item.value !== null);
      const min = col.column.min;
      const max = col.column.max;
      const outside = pairs.filter((item) => (min !== undefined && item.value < min) || (max !== undefined && item.value > max));
      if (outside.length) out.push(`${title}: ${outside.length} ${col.name} value${outside.length === 1 ? ' is' : 's are'} outside ${min ?? '…'} to ${max ?? '…'}, e.g. ${outside.slice(0, 3).map((item) => `${table.plot ? table.value(item.row, table.plot) + ' ' : ''}${number(item.value)}`).join(', ')}`);
      if (pairs.length >= 20) {
        const sorted = pairs.map((item) => item.value).sort((a, b) => a - b);
        const q1 = sorted[Math.floor(sorted.length * 0.25)];
        const q3 = sorted[Math.floor(sorted.length * 0.75)];
        const spread = q3 - q1;
        if (spread > 0) {
          const far = pairs.filter((item) => item.value > q3 + 3 * spread || item.value < q1 - 3 * spread);
          if (far.length && far.length <= pairs.length * 0.05) out.push(`${title}: ${far.length} ${col.name} value${far.length === 1 ? ' is' : 's are'} far from the rest (most are ${number(q1)} to ${number(q3)}), e.g. ${far.slice(0, 3).map((item) => `${table.plot ? table.value(item.row, table.plot) + ' ' : ''}${number(item.value)}`).join(', ')}`);
        }
      }
    }
  }
  return out.slice(0, 14);
}
