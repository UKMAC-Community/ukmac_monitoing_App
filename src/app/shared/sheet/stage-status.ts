import type { Column, Row, SheetWithRows } from '@core/models';
import { buildZoneLayout } from '@shared/map/zone-layout';
import { formatDate, isEntryColumn, isIsoDate, isPlotColumn } from './columns';

/**
 * How far a stage of the farm has come, read from what people have entered in its table (the sidebar shows it):
 *
 * - nothing entered: **Not started**;
 * - a table of planned rounds (each plot's rounds listed up front, a round's day filled in once it is done, or its Applied
 *   ticked where the farm's tab says only whether it was given, as Fertilizer's TRUE / FALSE):
 *   the share of the rounds that are done, a blank round counting as skipped when a later round of its plot was done,
 *   a round marked not applicable left out; **Done** once no round is left to do. 0 done is still Not started;
 * - a stage each plot goes through once (Plant Progress, Planting Date): the share of the active plots
 *   (as the Zone Map counts them) with a record; **Done** once every one has;
 * - any other log (Harvest, the nursery, QA/QC…): **In progress** while it has records, there being no plan to measure it against.
 */
export type StageState = 'not-started' | 'in-progress' | 'done';

export interface StageStatus {
  state: StageState;
  /** How far through its plan, 0–99 (null: nothing to measure it against). Done is shown as Done, never as 100%. */
  percent: number | null;
  /** Rounds whose planned day has passed with nothing entered. */
  late: number;
  /** What the status is made of, in words: the sidebar's tooltip. */
  detail: string;
}

/** A stage each plot goes through once: done when every active plot has its record. */
const ONCE_PER_PLOT = new Set(['zone-records', 'planting-date']);

/** A date column that holds a plan, not the day the work was done. */
const PLAN = /\b(plan|planned|due)\b/i;

/** The names a table of rounds gives each round (1st Application, 2nd Pruning…). */
const ROUND = new Set(['application', 'application round', 'round name']);

const clean = (text: string | null | undefined) => (text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const filled = (value: string | undefined) => value !== undefined && value.trim() !== '';
const count = (n: number) => n.toLocaleString('en-US');
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

/** The column that dates a row as done: of the table's own date columns (a plan's left out), the one most filled in. */
export function doneDateColumn(sheet: SheetWithRows): Column | null {
  const dates = sheet.columns.filter((column) => column.type === 'date' && !PLAN.test(column.name));
  let best: Column | null = dates[0] ?? null;
  let most = 0;
  for (const column of dates) {
    const n = sheet.rows.filter((row) => filled(row.data[column.key])).length;
    if (n > most) [best, most] = [column, n];
  }
  return best;
}

/** The active plots (lower-cased), as the Zone Map counts them: every plot of the Zones table in normal use. */
export function activePlots(zones: SheetWithRows | null | undefined): Set<string> {
  const plots = new Set<string>();
  for (const cell of buildZoneLayout(zones ?? null, null).cells) {
    if (cell.usage === 'normal' && cell.plot) plots.add(clean(cell.plot));
  }
  return plots;
}

/** Every table's stage status (by its id), the active plots read from the MAC's Zones table. */
export function stageStatuses(sheets: readonly SheetWithRows[], today: string): Map<number, StageStatus> {
  const zones = sheets.find((sheet) => sheet.templateKey === 'zones') ?? sheets.find((sheet) => clean(sheet.title) === 'zones');
  const active = activePlots(zones);
  return new Map(sheets.map((sheet) => [sheet.sheetId, stageStatus(sheet, active, today)]));
}

/** One table's stage status. */
export function stageStatus(sheet: SheetWithRows, active: ReadonlySet<string>, today: string): StageStatus {
  const entries = sheet.columns.filter(isEntryColumn);
  // A round marked not applicable (Pruning's Applicable = No) is not part of the plan.
  const applicable = sheet.columns.find((column) => column.type === 'yesno' && clean(column.name) === 'applicable');
  const rows = sheet.rows.filter(
    (row) => entries.some((column) => filled(row.data[column.key])) && !(applicable && row.data[applicable.key] === 'false'),
  );
  if (!rows.length) return { state: 'not-started', percent: null, late: 0, detail: 'Nothing entered yet' };

  const date = doneDateColumn(sheet);
  // A round the tab says was given (Fertilizer's applied: TRUE / FALSE, no day) is done too.
  const given = sheet.columns.find((column) => column.type === 'yesno' && clean(column.name) === 'applied');
  const plot = sheet.columns.find(isPlotColumn);
  const plotOf = (row: Row) => (plot ? clean(row.data[plot.key]) : '');
  const done = (row: Row) => (!!date && filled(row.data[date.key])) || (!!given && row.data[given.key] === 'true');
  // A table that names its rounds is a plan of rounds even with every one done: it is then Done.
  const ofRounds = sheet.columns.some((column) => isEntryColumn(column) && ROUND.has(clean(column.name)));

  if (plot && ONCE_PER_PLOT.has(sheet.templateKey ?? '') && active.size) return coverage(rows, plotOf, active);
  if (plot && (date || given) && (ofRounds || rows.some((row) => !done(row)))) return rounds(sheet, rows, plotOf, done, today);

  // The last day so far; a record dated after today is said apart (a plan, or a day typed wrong).
  const days = date ? rows.map((row) => row.data[date.key]?.trim() ?? '').filter(isIsoDate).sort() : [];
  const last = days.filter((day) => day <= today).at(-1);
  const ahead = days.filter((day) => day > today).length;
  const detail = [plural(rows.length, 'record'), ...(last ? [`last ${formatDate(last)}`] : []), ...(ahead ? [`${count(ahead)} dated after today`] : [])];
  return { state: 'in-progress', percent: null, late: 0, detail: detail.join(' · ') };
}

/** A stage each plot goes through once: how many of the active plots have a record. */
function coverage(rows: readonly Row[], plotOf: (row: Row) => string, active: ReadonlySet<string>): StageStatus {
  const covered = new Set(rows.map(plotOf).filter((plot) => active.has(plot)));
  if (covered.size >= active.size) return { state: 'done', percent: null, late: 0, detail: `Every active plot (${count(active.size)}) has a record` };
  const left = active.size - covered.size;
  return {
    state: covered.size ? 'in-progress' : 'not-started',
    percent: Math.min(99, Math.floor((covered.size / active.size) * 100)),
    late: 0,
    detail: `${count(covered.size)} of ${count(active.size)} active plots have a record · ${plural(left, 'plot')} without one`,
  };
}

/** A table of planned rounds: how many are done, skipped (a later round of the plot was done), left to do and late. */
function rounds(sheet: SheetWithRows, rows: readonly Row[], plotOf: (row: Row) => string, done: (row: Row) => boolean, today: string): StageStatus {
  const planned = sheet.columns.find((column) => column.type === 'date' && PLAN.test(column.name));
  // Each plot's last round done: a blank round before it was skipped.
  const lastDone = new Map<string, number>();
  rows.forEach((row, index) => {
    if (done(row) && plotOf(row)) lastDone.set(plotOf(row), index);
  });
  let doneCount = 0;
  let skipped = 0;
  let late = 0;
  rows.forEach((row, index) => {
    if (done(row)) doneCount++;
    else if ((lastDone.get(plotOf(row)) ?? -1) > index) skipped++;
    else {
      const due = planned ? (row.data[planned.key] ?? '').trim() : '';
      if (isIsoDate(due) && due < today) late++;
    }
  });
  const left = rows.length - doneCount - skipped;
  const lateText = late ? ` · ${count(late)} late` : '';
  if (!doneCount) return { state: 'not-started', percent: 0, late, detail: `${plural(rows.length, 'round')} planned, none done yet${lateText}` };
  const parts = [`${count(doneCount)} of ${plural(rows.length, 'round')} done`, ...(skipped ? [`${count(skipped)} skipped`] : [])];
  if (!left) return { state: 'done', percent: null, late: 0, detail: parts.join(' · ') };
  return {
    state: 'in-progress',
    percent: Math.min(99, Math.floor(((doneCount + skipped) / rows.length) * 100)),
    late,
    detail: [...parts, `${count(left)} to do`].join(' · ') + lateText,
  };
}
