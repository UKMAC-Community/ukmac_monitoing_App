import type { Column, Row, SheetWithRows } from '@core/models';
import { formatDate, isIsoDate } from '@shared/sheet/columns';

/**
 * What the Zone Map can colour its plots by, one at a time (the user, 2026-11-18: "show one by one … in that zones what batch or
 * variety is using … give the color … show with other like plant progress … tracking them what is the latest one and what have no
 * data there"): the variety and the nursery batch planted on each plot, its latest Plant Progress status, and for each table of
 * the plots' work (fertigation, pruning, harvest…) the latest round each plot has reached, or its latest date; a plot in use with
 * nothing is grey and listed. As the web's 3D map shows the farm's tables on its plots (`FarmSatellite/tableShows.ts`), one table
 * picked at a time.
 */

/** How a view colours: a colour for each value, a shade for each round (darker further on), or a shade by how recent. */
export type PlotViewKind = 'values' | 'rounds' | 'dates';

/** What a view says of one plot. */
export interface PlotSay {
  /** In full: "Mali", "7th Application", "05/02/2027". */
  text: string;
  /** For the plot's tag on the map: "Mali", "7th", "05/02". */
  short: string;
  colour: string;
  /** More, for its card and hover: "on 22/07/2026", "18 harvests". */
  more: string;
  /** More lines for its card and hover: "Ripe 1,500 kg · Unripe 260 kg". */
  details?: string[];
}

export interface PlotView {
  key: string;
  label: string;
  icon: string;
  kind: PlotViewKind;
  /** Each plot it has something for, by its code (lower case). */
  plots: Map<string, PlotSay>;
  /** Its colours and how many plots are at each, in order (a round the first to the last; a value the most plots first). */
  legend: { label: string; colour: string; count: number; /** Said beside the label, quieter (a batch's variety). */ note?: string }[];
  /** A few words under its name in the list: "2 varieties", "up to 10th Application", "latest 05/02/2027". */
  summary: string;
  /** A table that weighs or counts what it records (Harvest's yield): each plot's total, to add up by zone. */
  amount?: { label: string; unit: string; byPlot: Map<string, number> };
}

/** A plot in use with nothing in the view: an empty grey. */
export const NO_DATA = '#c9cec9';

/**
 * The crop's stages in the order a plot goes through them, as the farm's QA/QC sheet orders its stages (transplant, establishment,
 * vegetative, flowering, fruit set, harvest), then done: each a colour of what is on the plot, young green to chili red, brown when
 * the cycle is over. A status matching none comes after them.
 */
const STAGES: readonly { match: RegExp; colour: string }[] = [
  { match: /transplant|planted|planting/i, colour: '#d9f99d' },
  { match: /establish/i, colour: '#86efac' },
  { match: /vegetat|growing/i, colour: '#22c55e' },
  { match: /flower/i, colour: '#facc15' },
  { match: /fruit/i, colour: '#f97316' },
  { match: /harvest/i, colour: '#dc2626' },
  { match: /complete|finish|done|ended/i, colour: '#7c5a3a' },
];

/** A status's place in the crop's cycle (one matching no stage: after them all). */
export function stageIndex(status: string): number {
  const at = STAGES.findIndex((stage) => stage.match.test(status));
  return at < 0 ? STAGES.length : at;
}

/** The values' colours, the most plots first (as the web's: blue, green, amber, pink, violet, cyan, then more). */
const VALUE_COLOURS = ['#2563eb', '#16a34a', '#f59e0b', '#db2777', '#7c3aed', '#0891b2', '#ea580c', '#0d9488', '#4f46e5', '#65a30d', '#e11d48', '#9333ea'];
const OTHER = '#94a3b8';

/** Each table's own colour, its shades from light (early, old) to dark (late, recent). */
const TABLE_COLOURS: Record<string, string> = {
  fertigation: '#0891b2',
  fertilizer: '#16a34a',
  pesticides: '#ea580c',
  fungicide: '#7c3aed',
  pruning: '#65a30d',
  harvest: '#dc2626',
  irrigation: '#2563eb',
  'soil-preparation': '#a16207',
  'planting-date': '#9333ea',
};
const TABLE_ICONS: Record<string, string> = {
  fertigation: 'flask',
  fertilizer: 'leaf',
  pesticides: 'spray',
  fungicide: 'droplet',
  pruning: 'scissors',
  harvest: 'wheat',
  irrigation: 'droplets',
  'soil-preparation': 'shovel',
  'planting-date': 'calendar',
};

/** The tables the Show list leaves out: the plots themselves, the QA/QC (its own map), the nursery and its batches, and Fertigation, Pruning and Pesticides (still tables, and in each plot's journey). */
const NOT_WORK = new Set(['zones', 'qa-qc-management', 'zone-records', 'nursery-batches', 'batches', 'chili-varieties', 'inventory', 'finance', 'zone-measurement', 'fertigation', 'pruning', 'pesticides']);

const clean = (text: string | undefined | null) => (text ?? '').trim().toLowerCase().replace(/[_\s]+/g, ' ');

/** A column by any of its names (its own, or one it answers to), the first name that matches. */
function find(sheet: SheetWithRows, ...names: string[]): Column | undefined {
  for (const name of names) {
    const found = sheet.columns.find((column) => [column.name, ...(column.aliases ?? [])].some((other) => clean(other) === clean(name)));
    if (found) return found;
  }
  return undefined;
}

const PLOT_NAMES = ['Zone plot', 'Zone', 'Plot'];
const ROUND_NAMES = ['Application', 'Application round', 'Round name'];
/** The date a row was done: its own Date (not its planned one). */
const DATE_NAMES = ['Date', 'Date applied', 'Actual date', 'Date harvest', 'Record date', 'Planting date'];

function dateOf(row: Row, column: Column | undefined): string {
  const value = column ? String(row.data[column.key] ?? '').slice(0, 10) : '';
  return isIsoDate(value) ? value : '';
}

/** A round's number ("7th Application" is 7): none, after every numbered one. */
function roundNumber(round: string): number {
  const match = /\d+/.exec(round);
  return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
}

/** "7th Application" is "7th" on a plot's tag; a round with no number keeps its name. */
function shortRound(round: string): string {
  const match = /^\s*(\d+\s*(?:st|nd|rd|th)?)\b/i.exec(round);
  return match ? match[1].replace(/\s+/g, '') : round;
}

/** "2027-02-05" is "05/02" on a tag. */
function shortDate(iso: string): string {
  return formatDate(iso).slice(0, 5);
}

/** 1234.5 as "1,234.5" (at most one decimal). */
export function formatAmount(value: number): string {
  return value.toLocaleString('en', { maximumFractionDigits: 1 });
}

/** A colour between two (0: `a`, 1: `b`). */
function mix(a: string, b: string, at: number): string {
  const channel = (hex: string, index: number) => parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  const out = [0, 1, 2].map((index) => Math.round(channel(a, index) + (channel(b, index) - channel(a, index)) * at));
  return `#${out.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

/** A shade of a table's colour: light at 0 (the first round, the oldest date), dark at 1. */
export function shadeOf(colour: string, at: number): string {
  const step = Math.min(1, Math.max(0, at));
  return step < 0.5 ? mix('#ffffff', colour, 0.3 + step * 1.4) : mix(colour, '#000000', (step - 0.5) * 0.6);
}

/** Each plot's rows of a table (by its plot code, lower case), in the table's order. */
function rowsByPlot(sheet: SheetWithRows, plot: Column): Map<string, Row[]> {
  const byPlot = new Map<string, Row[]>();
  for (const row of sheet.rows) {
    const code = clean(String(row.data[plot.key] ?? ''));
    if (!code) continue;
    const list = byPlot.get(code) ?? [];
    list.push(row);
    byPlot.set(code, list);
  }
  return byPlot;
}

/** A row with something done in it: its date when the table dates its rows, else anything besides the plot, the round and the ID. */
function isDone(row: Row, sheet: SheetWithRows, date: Column | undefined, skip: ReadonlySet<string>): boolean {
  if (date) return !!dateOf(row, date);
  return sheet.columns.some((column) => !skip.has(column.key) && !column.auto && String(row.data[column.key] ?? '').trim() !== '');
}

/** A colour for each value, the most plots first (the rest "Other"). */
function valuesView(key: string, label: string, icon: string, said: Map<string, { text: string; more: string }>, noun: [string, string], noted = false): PlotView {
  const counts = new Map<string, number>();
  for (const { text } of said.values()) counts.set(text, (counts.get(text) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en', { numeric: true }));
  const colourOf = new Map(ranked.slice(0, VALUE_COLOURS.length).map(([text], index) => [text, VALUE_COLOURS[index]]));
  const plots = new Map<string, PlotSay>();
  for (const [code, { text, more }] of said) plots.set(code, { text, short: text, colour: colourOf.get(text) ?? OTHER, more });
  // With `noted`, what its plots say besides (a batch's variety) is written beside it: the one most of them say.
  const noteOf = (text: string) => {
    if (!noted) return undefined;
    const tally = new Map<string, number>();
    for (const item of said.values()) if (item.text === text && item.more) tally.set(item.more, (tally.get(item.more) ?? 0) + 1);
    return [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'))[0]?.[0];
  };
  const legend: PlotView['legend'] = ranked.slice(0, VALUE_COLOURS.length).map(([text, count]) => ({ label: text, colour: colourOf.get(text)!, count, note: noteOf(text) }));
  const rest = ranked.slice(VALUE_COLOURS.length).reduce((sum, [, count]) => sum + count, 0);
  if (rest) legend.push({ label: 'Other', colour: OTHER, count: rest });
  return { key, label, icon, kind: 'values', plots, legend, summary: ranked.length ? `${ranked.length} ${noun[ranked.length === 1 ? 0 : 1]}` : 'nothing yet' };
}

/** The plots' stages: in the crop's order (not by how many plots), each its stage's colour. */
function stagesView(key: string, label: string, icon: string, said: Map<string, { text: string; more: string }>): PlotView {
  const counts = new Map<string, number>();
  for (const { text } of said.values()) counts.set(text, (counts.get(text) ?? 0) + 1);
  const ordered = [...counts.keys()].sort((a, b) => stageIndex(a) - stageIndex(b) || a.localeCompare(b, 'en', { numeric: true }));
  let other = 0;
  const colourOf = new Map(ordered.map((text) => [text, STAGES[stageIndex(text)]?.colour ?? VALUE_COLOURS[other++ % VALUE_COLOURS.length]]));
  const plots = new Map<string, PlotSay>();
  for (const [code, { text, more }] of said) plots.set(code, { text, short: text, colour: colourOf.get(text)!, more });
  const legend = ordered.map((text) => ({ label: text, colour: colourOf.get(text)!, count: counts.get(text)! }));
  return { key, label, icon, kind: 'values', plots, legend, summary: ordered.length ? `${ordered.length} stage${ordered.length === 1 ? '' : 's'}` : 'nothing yet' };
}

/**
 * The variety, the nursery batch and the latest status of each plot, from its latest Plant Progress record (a record with no
 * variety of its own takes its batch's, from the Batch or Nursery Progress table).
 */
function progressViews(sheets: readonly SheetWithRows[]): PlotView[] {
  const sheet = sheets.find((item) => item.templateKey === 'zone-records');
  const plot = sheet && find(sheet, ...PLOT_NAMES);
  if (!sheet || !plot) return [];
  const date = find(sheet, 'Record date', 'Date');
  const variety = find(sheet, 'Plant type', 'Variety', 'Variety name', 'Chili type');
  const batch = find(sheet, 'Nursery batch', 'Batch', 'Batch number');
  const status = find(sheet, 'Status');
  // A batch's variety, from the tables that name each batch.
  const batchVariety = new Map<string, string>();
  for (const other of sheets) {
    const number = find(other, 'Batch number');
    const name = find(other, 'Variety name', 'Variety');
    if (!number || !name || other === sheet) continue;
    for (const row of other.rows) {
      const code = clean(String(row.data[number.key] ?? ''));
      const value = String(row.data[name.key] ?? '').trim();
      if (code && value && !batchVariety.has(code)) batchVariety.set(code, value);
    }
  }
  const varieties = new Map<string, { text: string; more: string }>();
  const batches = new Map<string, { text: string; more: string }>();
  const statuses = new Map<string, { text: string; more: string }>();
  for (const [code, rows] of rowsByPlot(sheet, plot)) {
    // The latest record: by its date, a later row on the same day after an earlier one.
    const latest = rows.reduce((best, row) => (dateOf(row, date) >= dateOf(best, date) ? row : best));
    const batchText = batch ? String(latest.data[batch.key] ?? '').trim() : '';
    const varietyText = (variety ? String(latest.data[variety.key] ?? '').trim() : '') || batchVariety.get(clean(batchText)) || '';
    if (varietyText) varieties.set(code, { text: varietyText, more: batchText ? `batch ${batchText}` : '' });
    if (batchText) batches.set(code, { text: batchText, more: varietyText });
    const statusText = status ? String(latest.data[status.key] ?? '').trim() : '';
    if (statusText) statuses.set(code, { text: statusText, more: [varietyText, batchText].filter(Boolean).join(' · ') });
  }
  return [
    variety || batchVariety.size ? valuesView('variety', 'Variety', 'sprout', varieties, ['variety', 'varieties']) : null,
    batch ? valuesView('batch', 'Nursery batch', 'package', batches, ['batch', 'batches'], true) : null,
    status ? stagesView(`table:${sheet.sheetId}`, sheet.title, 'seedling', statuses) : null,
  ].filter((view): view is PlotView => !!view);
}

/**
 * A table of the plots' work as each plot stands in it: the latest round it has reached (rounds named 1st, 2nd…: Fertigation,
 * Pruning…), each round a shade of the table's colour, darker further on; a table with no rounds by its latest date (Harvest),
 * darker more recent. A round counts as reached when its row is done (dated), as the farm's sheets list every round up front.
 */
function workView(sheet: SheetWithRows): PlotView | null {
  const plot = find(sheet, ...PLOT_NAMES);
  if (!plot) return null;
  const round = find(sheet, ...ROUND_NAMES);
  const date = find(sheet, ...DATE_NAMES);
  const colour = TABLE_COLOURS[sheet.templateKey ?? ''] ?? VALUE_COLOURS[sheet.sheetId % VALUE_COLOURS.length];
  const icon = TABLE_ICONS[sheet.templateKey ?? ''] ?? 'table';
  const key = `table:${sheet.sheetId}`;
  const skip = new Set([plot.key, round?.key ?? '', date?.key ?? '']);
  const plots = new Map<string, PlotSay>();

  if (round) {
    // Every round the table names, in order: their shades.
    const names = [...new Set(sheet.rows.map((row) => String(row.data[round.key] ?? '').trim()).filter(Boolean))].sort(
      (a, b) => roundNumber(a) - roundNumber(b) || a.localeCompare(b, 'en', { numeric: true }),
    );
    const at = new Map(names.map((name, index) => [name, names.length > 1 ? index / (names.length - 1) : 1]));
    const counts = new Map<string, number>();
    for (const [code, rows] of rowsByPlot(sheet, plot)) {
      const done = rows.filter((row) => String(row.data[round.key] ?? '').trim() && isDone(row, sheet, date, skip));
      if (!done.length) continue;
      const last = done.reduce((best, row) => {
        const a = String(best.data[round.key]).trim();
        const b = String(row.data[round.key]).trim();
        return (at.get(b) ?? 0) >= (at.get(a) ?? 0) ? row : best;
      });
      const name = String(last.data[round.key]).trim();
      const when = dateOf(last, date);
      plots.set(code, { text: name, short: shortRound(name), colour: shadeOf(colour, at.get(name) ?? 1), more: [when && `on ${formatDate(when)}`, `${done.length} of ${rows.length} done`].filter(Boolean).join(' · ') });
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const reached = names.filter((name) => counts.has(name));
    const legend = reached.map((name) => ({ label: name, colour: shadeOf(colour, at.get(name) ?? 1), count: counts.get(name)! }));
    return { key, label: sheet.title, icon, kind: 'rounds', plots, legend, summary: reached.length ? `up to ${reached.at(-1)}` : 'nothing done yet' };
  }

  if (!date) return null;
  // No rounds: each plot by its latest date, and how many it has.
  const latest = new Map<string, { when: string; count: number }>();
  for (const [code, rows] of rowsByPlot(sheet, plot)) {
    const dates = rows.map((row) => dateOf(row, date)).filter(Boolean).sort();
    if (dates.length) latest.set(code, { when: dates.at(-1)!, count: dates.length });
  }
  const all = [...latest.values()].map((item) => item.when).sort();
  const first = all[0];
  const last = all.at(-1);
  const span = first && last ? Date.parse(last) - Date.parse(first) : 0;
  const atOf = (when: string) => (span > 0 ? (Date.parse(when) - Date.parse(first!)) / span : 1);
  const noun = sheet.templateKey === 'harvest' ? 'harvest' : 'record';
  // What the table weighs (Harvest's yield): each plot's total.
  const yieldColumn = sheet.templateKey === 'harvest' ? find(sheet, 'Harvest yield', 'Yield') : undefined;
  const byPlot = new Map<string, number>();
  if (yieldColumn) {
    for (const [code, rows] of rowsByPlot(sheet, plot)) {
      const sum = rows.reduce((total, row) => total + (Number(String(row.data[yieldColumn.key] ?? '').replace(/,/g, '')) || 0), 0);
      if (sum) byPlot.set(code, sum);
    }
  }
  const amount = yieldColumn ? { label: yieldColumn.name, unit: yieldColumn.unit ?? '', byPlot } : undefined;
  const unit = amount?.unit ? ` ${amount.unit}` : '';

  if (amount && byPlot.size) {
    // What is weighed: each plot one colour by its total, the Harvest red darker the more kg; ripe and unripe are told on hover.
    const totals = [...byPlot.values()];
    const low = Math.min(...totals);
    const high = Math.max(...totals);
    const range = high - low;
    const atTotal = (value: number) => (range > 0 ? (value - low) / range : 1);
    const kind = find(sheet, 'Chili type');
    const rowsOf = rowsByPlot(sheet, plot);
    const kindOf = (rows: Row[], name: string) =>
      rows.filter((row) => clean(String(row.data[kind?.key ?? ''] ?? '')) === name).reduce((sum, row) => sum + (Number(String(row.data[yieldColumn!.key] ?? '').replace(/,/g, '')) || 0), 0);
    for (const [code, total] of byPlot) {
      const { when, count } = latest.get(code) ?? { when: '', count: 0 };
      const rows = rowsOf.get(code) ?? [];
      const ripe = kind ? kindOf(rows, 'ripe') : 0;
      const unripe = kind ? kindOf(rows, 'unripe') : 0;
      plots.set(code, {
        text: `${formatAmount(total)}${unit}`,
        short: formatAmount(Math.round(total)),
        colour: shadeOf(colour, atTotal(total)),
        more: [count ? `${count} ${noun}${count === 1 ? '' : 's'}` : '', when && `latest ${formatDate(when)}`].filter(Boolean).join(' · '),
        details: ripe || unripe ? [`Ripe ${formatAmount(Math.round(ripe))}${unit} · Unripe ${formatAmount(Math.round(unripe))}${unit}`] : undefined,
      });
    }
    const steps = range > 0 ? 5 : 1;
    const legend: PlotView['legend'] = [];
    for (let step = 0; step < steps; step += 1) {
      const from = low + (range * step) / steps;
      const to = step === steps - 1 ? Number.POSITIVE_INFINITY : low + (range * (step + 1)) / steps;
      const count = totals.filter((value) => value >= from && value < to).length;
      legend.push({ label: `from ${formatAmount(Math.round(from))}${unit}`, colour: shadeOf(colour, steps > 1 ? step / (steps - 1) : 1), count });
    }
    return { key, label: sheet.title, icon, kind: 'dates', plots, legend, summary: `up to ${formatAmount(Math.round(high))}${unit} a plot`, amount };
  }

  for (const [code, { when, count }] of latest) {
    plots.set(code, { text: formatDate(when), short: shortDate(when), colour: shadeOf(colour, atOf(when)), more: `${count} ${noun}${count === 1 ? '' : 's'}` });
  }
  // The dates in five steps, oldest to newest, each with how many plots' latest falls in it.
  const legend: PlotView['legend'] = [];
  if (first && last) {
    const steps = span > 0 ? 5 : 1;
    for (let step = 0; step < steps; step += 1) {
      const from = Date.parse(first) + (span * step) / steps;
      const to = step === steps - 1 ? Number.POSITIVE_INFINITY : Date.parse(first) + (span * (step + 1)) / steps;
      const count = [...latest.values()].filter((item) => Date.parse(item.when) >= from && Date.parse(item.when) < to).length;
      legend.push({ label: `from ${formatDate(new Date(from).toISOString().slice(0, 10))}`, colour: shadeOf(colour, steps > 1 ? step / (steps - 1) : 1), count });
    }
  }
  return { key, label: sheet.title, icon, kind: 'dates', plots, legend, summary: last ? `latest ${formatDate(last)}` : 'nothing dated yet', amount };
}

/** Everything the Zone Map can show its plots by: variety, batch, Plant Progress, then each table of the plots' work, in the MAC's order. */
export function plotViews(sheets: readonly SheetWithRows[]): PlotView[] {
  // A table with no rows yet is listed too: every plot has no data in it.
  const work = sheets.filter((sheet) => !NOT_WORK.has(sheet.templateKey ?? '') && !!find(sheet, ...PLOT_NAMES)).map(workView);
  return [...progressViews(sheets), ...work.filter((view): view is PlotView => !!view)];
}

/** The plots in use that a view has nothing for (their codes, in the map's order). */
export function missingPlots(view: PlotView, plots: readonly string[]): string[] {
  return plots.filter((code) => !view.plots.has(clean(code)));
}

/** What a view says of a plot (by its code as the map names it). */
export function sayOf(view: PlotView, code: string): PlotSay | undefined {
  return view.plots.get(clean(code));
}

/** What a view adds up for a plot (its yield): none when it has none. */
export function amountOf(view: PlotView, code: string): number {
  return view.amount?.byPlot.get(clean(code)) ?? 0;
}
