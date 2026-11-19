import type { Column, Row, SheetWithRows } from '@core/models';
import { formatDate, isIsoDate, parseDateText } from '@shared/sheet/columns';

/**
 * QA/QC Check: each of the farm's tables (Plant Progress, Fertigation, Pruning, Pesticides, Harvest) checked with another
 * one (Plant Progress, QA/QC), with its own rounds or plan, or with today's date; each check says what is wrong in plain
 * words, and lists the plots. A problem is something to look at, not proof that something is wrong; nothing is changed.
 */

export interface Finding {
  plot: string;
  text: string;
  /** The values couldn't be compared (one isn't a number), as against a real difference. */
  unreadable?: boolean;
}

/** One check of a table: what it is checked with, and what it found. */
export interface CheckLine {
  id: string;
  /** What the table is checked with: another table's name, "its own rounds", "its planned dates", "today's date". */
  against: string;
  /** Said when nothing is wrong. */
  good: string;
  /** Said of what is wrong, its number first ("10 plots harvested but never planted"); blank when nothing is. */
  bad: string;
  /** How many were looked at, and what they are (plots, records, rounds, harvest days). */
  checked: number;
  unit: string;
  findings: Finding[];
  /** Why it can't be checked: a table or a column it needs isn't there. */
  cannot?: string;
  /** Every one compared was the same to the last digit: QA/QC may copy these numbers rather than count them itself. */
  same?: boolean;
}

/** A table of the farm and its checks. */
export interface TableCheck {
  sheetId: number;
  macId: number;
  title: string;
  icon: string | null;
  lines: CheckLine[];
  /** How many problems its checks found. */
  problems: number;
}

/** A harvest this soon after planting is too soon for chili (the first is about 75 days after). */
export const EARLIEST_HARVEST_DAYS = 60;
/** How far, in points, the dead plants reported may be from QA/QC's sample before it's worth a look (its sample is small). */
export const DEAD_GAP_POINTS = 15;
/** How far, in kg, a day's harvest may be from QA/QC's before it's worth a look. */
export const HARVEST_GAP_KG = 0.5;

const TODAY = "today's date";
const ROUNDS = 'its own rounds';
const PLAN = 'its planned dates';

const clean = (text: string | undefined) => (text ?? '').trim().toLowerCase().replace(/[_\s]+/g, ' ');
const plotKey = (plot: string) => plot.trim().toUpperCase();

/** A column of the table by any of its names (its own, or one it answers to): the first, as the table orders them. */
function find(sheet: Pick<SheetWithRows, 'columns'> | undefined, ...names: string[]): Column | undefined {
  if (!sheet) return undefined;
  const wanted = names.map(clean);
  return sheet.columns.find((column) => [column.name, ...(column.aliases ?? [])].some((name) => wanted.includes(clean(name))));
}

const text = (row: Row, column: Column | undefined) => (column ? (row.data[column.key] ?? '').trim() : '');

function numberOf(row: Row, column: Column | undefined): number | null {
  const value = text(row, column).replace(/,/g, '');
  return value && /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value) ? Number(value) : null;
}

function dateOf(row: Row, column: Column | undefined): string | null {
  const value = text(row, column);
  if (!value) return null;
  return isIsoDate(value.slice(0, 10)) ? value.slice(0, 10) : parseDateText(value);
}

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const kg = (n: number) => n.toLocaleString('en', { maximumFractionDigits: 1 });
const count = (n: number) => n.toLocaleString('en', { maximumFractionDigits: 0 });
const percent = (n: number) => `${n.toLocaleString('en', { maximumFractionDigits: 1 })}%`;
const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;
const ordinalNumber = (name: string) => {
  const match = /\d+/.exec(name);
  return match ? Number(match[0]) : null;
};
const byPlot = (a: Finding, b: Finding) => a.plot.localeCompare(b.plot, 'en', { numeric: true }) || a.text.localeCompare(b.text, 'en', { numeric: true });

const plotColumn = (sheet: SheetWithRows | undefined) => find(sheet, 'Zone plot', 'zone_plot', 'Zone', 'Plot');

/** Each plot's planting day, from Plant Progress (its Record date). */
function plantingDays(plants: SheetWithRows | undefined) {
  const out = new Map<string, string>();
  const plot = plotColumn(plants);
  const date = find(plants, 'Record date', 'Planting date');
  if (!plants || !plot || !date) return out;
  for (const row of plants.rows) {
    const where = text(row, plot);
    const day = dateOf(row, date);
    if (where && day && (!out.has(plotKey(where)) || day < out.get(plotKey(where))!)) out.set(plotKey(where), day);
  }
  return out;
}

/** A table's rows of work done, each with its plot, the day it was done, and what it is (its round, or the table's name). */
interface Done {
  row: Row;
  plot: string;
  day: string | null;
  /** Done: a day entered, or (a tab that gives none, as Fertilizer's TRUE / FALSE) its Applied ticked. */
  done: boolean;
  what: string;
  round: number | null;
  applicable: boolean;
  planned: string | null;
}

function workDone(sheet: SheetWithRows): Done[] {
  const plot = plotColumn(sheet);
  const day =
    sheet.templateKey === 'harvest' ? find(sheet, 'Date harvest', 'Date') : sheet.templateKey === 'zone-records' ? find(sheet, 'Record date') : find(sheet, 'Date', 'Date applied', 'Actual date');
  const applied = sheet.columns.find((column) => column.type === 'yesno' && column.name.trim().toLowerCase() === 'applied');
  if (!plot || (!day && !applied)) return [];
  const round = find(sheet, 'Application', 'Application round', 'Round name');
  const applicable = find(sheet, 'Applicable');
  const planned = find(sheet, 'Planned date');
  return sheet.rows
    .filter((row) => text(row, plot))
    .map((row) => {
      const name = text(row, round);
      return {
        row,
        plot: text(row, plot),
        day: dateOf(row, day),
        done: !!dateOf(row, day) || (!!applied && text(row, applied) === 'true'),
        what: name || sheet.title,
        round: name ? ordinalNumber(name) : null,
        applicable: !applicable || text(row, applicable) !== 'false',
        planned: dateOf(row, planned),
      };
    });
}

// ----------------------------------------------------------------------------- with its own records, or today's date

/** Work recorded as done on a day still to come: a harvest dated next month can't have been weighed. */
function futureDates(work: Done[], today: string): CheckLine {
  const ahead = new Map<string, { plot: string; n: number; latest: string }>();
  let checked = 0;
  for (const done of work) {
    if (!done.day) continue;
    checked++;
    if (done.day <= today) continue;
    const now = ahead.get(plotKey(done.plot)) ?? { plot: done.plot, n: 0, latest: done.day };
    now.n++;
    if (done.day > now.latest) now.latest = done.day;
    ahead.set(plotKey(done.plot), now);
  }
  const findings = [...ahead.values()].map((item) => ({
    plot: item.plot,
    text: item.n === 1 ? `Dated ${formatDate(item.latest)}, after today` : `${item.n} records dated after today, the last on ${formatDate(item.latest)}`,
  }));
  return {
    id: 'future',
    against: TODAY,
    good: 'No date after today',
    bad: `${plural(findings.length, 'plot has', 'plots have')} a date after today`,
    checked,
    unit: 'dated records',
    findings,
    cannot: checked ? undefined : 'No dates in it yet',
  };
}

/** A round with no date on a plot where a later round has one: skipped, or done and not written down. */
function skippedRounds(rounds: Done[]): CheckLine {
  const by = new Map<string, Done[]>();
  for (const done of rounds) {
    if (done.round === null || !done.applicable) continue;
    by.set(plotKey(done.plot), [...(by.get(plotKey(done.plot)) ?? []), done]);
  }
  const findings: Finding[] = [];
  let checked = 0;
  for (const list of by.values()) {
    checked += list.length;
    const last = Math.max(...list.filter((done) => done.done).map((done) => done.round!), -1);
    const skipped = list.filter((done) => !done.done && done.round! < last).sort((a, b) => a.round! - b.round!);
    if (!skipped.length) continue;
    const later = list.find((done) => done.round === last)!;
    findings.push({ plot: list[0].plot, text: `${skipped.map((done) => done.what).join(', ')} not done, but the ${later.what} is${later.day ? ` (${formatDate(later.day)})` : ''}` });
  }
  return {
    id: 'skipped',
    against: ROUNDS,
    good: 'No round skipped',
    bad: `${plural(findings.length, 'plot skipped', 'plots skipped')} a round (no date, but a later round is done)`,
    checked,
    unit: 'rounds',
    findings,
    cannot: by.size ? undefined : 'No rounds in it yet',
  };
}

/** A pruning round whose planned day has passed with no day done (and no later round done: that one is skipped). */
function pruningLate(pruning: Done[], today: string): CheckLine {
  const lastDone = new Map<string, number>();
  for (const done of pruning) if (done.day && done.round !== null) lastDone.set(plotKey(done.plot), Math.max(lastDone.get(plotKey(done.plot)) ?? -1, done.round));
  const due = pruning.filter((done) => done.applicable && done.planned && done.planned < today);
  const findings = due
    .filter((done) => !done.day && !(done.round !== null && (lastDone.get(plotKey(done.plot)) ?? -1) > done.round))
    .map((done) => ({ plot: done.plot, text: `${done.what} planned for ${formatDate(done.planned!)}, ${days(done.planned!, today)} days ago, not done` }));
  return {
    id: 'late',
    against: PLAN,
    good: 'Every round due is done',
    bad: `${plural(findings.length, 'round is', 'rounds are')} past the planned date and not done`,
    checked: due.length,
    unit: 'rounds due',
    findings,
    cannot: pruning.some((done) => done.planned) ? undefined : 'It has no planned dates',
  };
}

// ----------------------------------------------------------------------------- with Plant Progress

/** Work done on a plot before it was planted. */
function beforePlanting(work: Done[], planted: Map<string, string>, plantsTitle: string): CheckLine {
  const findings: Finding[] = [];
  let checked = 0;
  for (const done of work) {
    const day = planted.get(plotKey(done.plot));
    if (!done.day || !day) continue;
    checked++;
    if (done.day < day) findings.push({ plot: done.plot, text: `${done.what} on ${formatDate(done.day)}, but planted on ${formatDate(day)}` });
  }
  return {
    id: 'before-planting',
    against: plantsTitle,
    good: 'Nothing done before the plot was planted',
    bad: `${plural(findings.length, 'record is', 'records are')} dated before the plot was planted`,
    checked,
    unit: 'dated records',
    findings,
    cannot: planted.size ? undefined : `${plantsTitle} has no planting dates`,
  };
}

/** A plot with harvests but no planting, and a first harvest sooner after planting than chili can be. */
function harvestWithPlanting(harvest: Done[], plants: SheetWithRows, planted: Map<string, string>, weight: Column | undefined): CheckLine[] {
  const known = new Set(plants.rows.map((row) => plotKey(text(row, plotColumn(plants)))).filter(Boolean));
  const by = new Map<string, { plot: string; n: number; kg: number; first: string | null }>();
  for (const done of harvest) {
    const now = by.get(plotKey(done.plot)) ?? { plot: done.plot, n: 0, kg: 0, first: null };
    now.n++;
    now.kg += numberOf(done.row, weight) ?? 0;
    if (done.day && (!now.first || done.day < now.first)) now.first = done.day;
    by.set(plotKey(done.plot), now);
  }
  const unplanted = [...by.entries()]
    .filter(([key]) => !known.has(key))
    .map(([, item]) => ({ plot: item.plot, text: `${plural(item.n, 'harvest', 'harvests')} (${kg(item.kg)} kg), but no planting in ${plants.title}` }));
  const soon: Finding[] = [];
  let timed = 0;
  for (const [key, item] of by) {
    const day = planted.get(key);
    if (!day || !item.first) continue;
    timed++;
    const after = days(day, item.first);
    if (after < EARLIEST_HARVEST_DAYS) {
      soon.push({ plot: item.plot, text: after < 0 ? `First harvest ${formatDate(item.first)}, before planting (${formatDate(day)})` : `First harvest ${formatDate(item.first)}, only ${after} days after planting (${formatDate(day)})` });
    }
  }
  return [
    {
      id: 'no-planting',
      against: plants.title,
      good: 'Every harvested plot was planted',
      bad: `${plural(unplanted.length, 'plot', 'plots')} harvested but never planted`,
      checked: by.size,
      unit: 'harvested plots',
      findings: unplanted,
      cannot: by.size ? undefined : 'No harvests in it yet',
    },
    {
      id: 'too-soon',
      against: plants.title,
      good: `Every first harvest is ${EARLIEST_HARVEST_DAYS}+ days after planting`,
      bad: `${plural(soon.length, 'plot', 'plots')} harvested under ${EARLIEST_HARVEST_DAYS} days after planting`,
      checked: timed,
      unit: 'harvested plots',
      findings: soon,
      cannot: timed ? undefined : `${plants.title} has no planting dates for these plots`,
    },
  ];
}

// ----------------------------------------------------------------------------- with QA/QC

/** The plots Plant Progress and QA/QC Management each have: one that only one of them knows is a zone that doesn't match. */
function zonesWithQaqc(plants: SheetWithRows, qaqc: SheetWithRows): CheckLine {
  const base = { id: 'zones', against: qaqc.title, good: `Every plot is in both ${plants.title} and ${qaqc.title}`, unit: 'plots' };
  const plot = plotColumn(plants);
  const qaPlot = plotColumn(qaqc);
  if (!plot || !qaPlot) return { ...base, bad: '', checked: 0, findings: [], cannot: `Needs a Zone plot here and a Zone in ${qaqc.title}` };
  const names = (sheet: SheetWithRows, column: Column) => new Map(sheet.rows.map((row) => [plotKey(text(row, column)), text(row, column)] as const).filter(([key]) => key));
  const here = names(plants, plot);
  const there = names(qaqc, qaPlot);
  const findings: Finding[] = [
    ...[...here].filter(([key]) => !there.has(key)).map(([, name]) => ({ plot: name, text: `In ${plants.title}, but not in ${qaqc.title}` })),
    ...[...there].filter(([key]) => !here.has(key)).map(([, name]) => ({ plot: name, text: `In ${qaqc.title}, but not in ${plants.title}` })),
  ].sort(byPlot);
  return { ...base, bad: findings.length ? `${plural(findings.length, 'plot is', 'plots are')} not in both ${plants.title} and ${qaqc.title}` : '', checked: new Set([...here.keys(), ...there.keys()]).size, findings };
}

/** Plant Progress's plants left (planted − dead + replanted) against QA/QC's Total plant on the same plot. */
function plantsWithQaqc(plants: SheetWithRows, qaqc: SheetWithRows): CheckLine {
  const base = { id: 'plants', against: qaqc.title, good: `Plants left are the same as ${qaqc.title}'s Total plant`, unit: 'plots' };
  const plot = plotColumn(plants);
  const planted = find(plants, 'Plant count');
  const dead = find(plants, 'Dead plant');
  const replanted = find(plants, 'Replant count');
  const qaPlot = plotColumn(qaqc);
  const total = find(qaqc, 'Total plant');
  if (!plot || !planted || !qaPlot || !total) return { ...base, bad: '', checked: 0, findings: [], cannot: `Needs Plant count here and Total plant in ${qaqc.title}` };
  const rows = new Map(plants.rows.map((row) => [plotKey(text(row, plot)), row]));
  const findings: Finding[] = [];
  const unreadableIn = new Set<string>();
  let checked = 0;
  let same = 0;
  for (const qa of qaqc.rows) {
    const where = text(qa, qaPlot);
    const seen = numberOf(qa, total);
    const row = rows.get(plotKey(where));
    if (!where || seen === null || !row) continue;
    checked++;
    const n = numberOf(row, planted);
    const d = text(row, dead) ? numberOf(row, dead) : 0;
    const r = text(row, replanted) ? numberOf(row, replanted) : 0;
    if (n === null || d === null || r === null) {
      const bad = n === null ? planted : d === null ? dead! : replanted!;
      unreadableIn.add(bad.name);
      findings.push({ plot: where, unreadable: true, text: `Can't compare: ${bad.name} is "${text(row, bad)}", not a number` });
      continue;
    }
    const left = n - d + r;
    if (Math.abs(left - seen) < 0.5) same++;
    else findings.push({ plot: where, text: `${count(n)} planted − ${count(d)} dead + ${count(r)} replanted = ${count(left)}, but ${qaqc.title} says ${count(seen)}` });
  }
  const differ = findings.filter((finding) => !finding.unreadable).length;
  const unreadable = findings.length - differ;
  const bad = [
    differ ? `${plural(differ, 'plot differs', 'plots differ')} from ${qaqc.title}'s Total plant` : '',
    unreadable ? `${plural(unreadable, 'plot', 'plots')} can't be compared: ${[...unreadableIn].join(', ')} isn't a number` : '',
  ].filter(Boolean);
  return { ...base, bad: bad.join(' · '), checked, findings, same: checked > 0 && same === checked };
}

/** The dead plants Plant Progress reports (as a share of those planted) against the share dead in QA/QC's sample at 7 DAT. */
function deadWithQaqc(plants: SheetWithRows, qaqc: SheetWithRows): CheckLine {
  const base = { id: 'dead', against: qaqc.title, good: `Dead plants agree with ${qaqc.title}'s sample at 7 DAT`, unit: 'plots' };
  const plot = plotColumn(plants);
  const planted = find(plants, 'Plant count');
  const dead = find(plants, 'Dead plant');
  const qaPlot = plotColumn(qaqc);
  const live = find(qaqc, 'Live plant');
  const qaDead = find(qaqc, 'Dead plant');
  // With no dead counted at 7 DAT, the sample is the plants QA/QC looked at when planted (healthy, medium, wilt).
  const atPlanting = ['Healthy', 'Medium', 'Wilt'].map((name) => find(qaqc, name));
  if (!plot || !planted || !dead || !qaPlot || !live) return { ...base, bad: '', checked: 0, findings: [], cannot: `Needs Dead plant here and Live plant in ${qaqc.title}` };
  const rows = new Map(plants.rows.map((row) => [plotKey(text(row, plot)), row]));
  const findings: Finding[] = [];
  let checked = 0;
  for (const qa of qaqc.rows) {
    const where = text(qa, qaPlot);
    const row = rows.get(plotKey(where));
    const alive = numberOf(qa, live);
    if (!where || !row || alive === null) continue;
    const counted = numberOf(qa, qaDead);
    const sample = counted !== null ? alive + counted : atPlanting.every(Boolean) ? atPlanting.reduce((sum, column) => sum + (numberOf(qa, column) ?? 0), 0) : null;
    const n = numberOf(row, planted);
    const d = numberOf(row, dead);
    if (!sample || sample < alive || !n || d === null) continue;
    checked++;
    const reported = (d / n) * 100;
    const seen = ((sample - alive) / sample) * 100;
    if (Math.abs(reported - seen) >= DEAD_GAP_POINTS) {
      findings.push({ plot: where, text: `${percent(reported)} dead here (${count(d)} of ${count(n)}), but ${percent(seen)} in ${qaqc.title}'s sample (${count(sample - alive)} of ${count(sample)})` });
    }
  }
  return { ...base, bad: `${plural(findings.length, 'plot is', 'plots are')} far from ${qaqc.title}'s sample (${DEAD_GAP_POINTS}+ points)`, checked, findings };
}

/** QA/QC's 1st, 2nd … harvests (day and kg) against the Harvest table's kg for the plot that day. */
function harvestWithQaqc(harvest: Done[], qaqc: SheetWithRows, weight: Column | undefined): CheckLine {
  const base = { id: 'harvest', against: qaqc.title, good: `Same kg as ${qaqc.title} on every harvest day`, unit: 'harvest days' };
  const qaPlot = plotColumn(qaqc);
  const picks: { date: Column; kg: Column }[] = [];
  const seenNumbers = new Set<string>();
  for (const column of qaqc.columns) {
    const match = /^((\d+)(?:st|nd|rd|th)) date$/.exec(clean(column.name));
    if (!match || seenNumbers.has(match[2])) continue;
    const weightColumn = qaqc.columns.find((other) => clean(other.name) === `${match[1]} harvest`);
    if (weightColumn) {
      seenNumbers.add(match[2]);
      picks.push({ date: column, kg: weightColumn });
    }
  }
  if (!qaPlot || !picks.length || !weight) return { ...base, bad: '', checked: 0, findings: [], cannot: `Needs Harvest yield here and 1st Date, 1st Harvest … in ${qaqc.title}` };
  const day = new Map<string, number>();
  for (const done of harvest) if (done.day) day.set(`${plotKey(done.plot)}|${done.day}`, (day.get(`${plotKey(done.plot)}|${done.day}`) ?? 0) + (numberOf(done.row, weight) ?? 0));
  const findings: Finding[] = [];
  let checked = 0;
  let same = 0;
  for (const qa of qaqc.rows) {
    const where = text(qa, qaPlot);
    if (!where) continue;
    for (const pick of picks) {
      const on = dateOf(qa, pick.date);
      const seen = numberOf(qa, pick.kg);
      if (!on || seen === null) continue;
      checked++;
      const recorded = day.get(`${plotKey(where)}|${on}`);
      if (recorded === undefined) findings.push({ plot: where, text: `${formatDate(on)}: ${qaqc.title} has ${kg(seen)} kg, but no harvest here that day` });
      else if (Math.abs(recorded - seen) > HARVEST_GAP_KG) findings.push({ plot: where, text: `${formatDate(on)}: ${kg(recorded)} kg here, but ${kg(seen)} kg in ${qaqc.title}` });
      else if (Math.abs(recorded - seen) < 0.05) same++;
    }
  }
  return { ...base, bad: `${plural(findings.length, 'harvest day differs', 'harvest days differ')} from ${qaqc.title}`, checked, findings, same: checked > 0 && same === checked };
}

// ----------------------------------------------------------------------------- each table

/** Each table of the farm's work (as the menu orders them) with its checks: with other tables first, then its own rounds or plan, then today's date. */
export function qaqcChecks(sheets: readonly SheetWithRows[], today: string): TableCheck[] {
  const of = (key: string) => sheets.find((sheet) => sheet.templateKey === key);
  const plants = of('zone-records');
  const qaqc = of('qa-qc-management');
  const planted = plantingDays(plants);
  const out: TableCheck[] = [];
  for (const sheet of sheets) {
    const key = sheet.templateKey ?? '';
    const work = workDone(sheet);
    const lines: CheckLine[] = [];
    if (key === 'zone-records') {
      if (qaqc) lines.push(zonesWithQaqc(sheet, qaqc), plantsWithQaqc(sheet, qaqc), deadWithQaqc(sheet, qaqc));
      lines.push(futureDates(work, today));
    } else if (['fertigation', 'fertilizer', 'pesticides', 'fungicide', 'pruning'].includes(key)) {
      if (plants) lines.push(beforePlanting(work, planted, plants.title));
      lines.push(skippedRounds(work));
      if (key === 'pruning') lines.push(pruningLate(work, today));
      lines.push(futureDates(work, today));
    } else if (key === 'harvest') {
      const weight = find(sheet, 'Harvest yield', 'Yield', 'Quantity');
      if (plants) lines.push(...harvestWithPlanting(work, plants, planted, weight));
      if (qaqc) lines.push(harvestWithQaqc(work, qaqc, weight));
      lines.push(futureDates(work, today));
    } else {
      continue;
    }
    for (const line of lines) line.findings.sort(byPlot);
    out.push({
      sheetId: sheet.sheetId,
      macId: sheet.macId,
      title: sheet.title,
      icon: sheet.icon,
      lines,
      problems: lines.reduce((sum, line) => sum + (line.cannot ? 0 : line.findings.length), 0),
    });
  }
  return out;
}

// ----------------------------------------------------------------------------- each zone

/** How a zone stands between Plant Progress (the plan) and QA/QC Management. */
export type ZoneStatus = 'match' | 'differs' | 'only-plan' | 'only-qaqc' | 'unreadable' | 'no-count';

/** What each of the two tables says of one zone (a plot): the plan's plants and QA/QC's, and how they stand. */
export interface ZoneRow {
  plot: string;
  status: ZoneStatus;
  /** Said in a few words ("5 more in QA/QC", "Replant count isn't a number"); blank when they match. */
  note: string;
  /** From Plant Progress. */
  plantedOn: string | null;
  planted: number | null;
  dead: number | null;
  replanted: number | null;
  /** Planted − dead + replanted: the plants the plan says are left. */
  left: number | null;
  /** From QA/QC Management. */
  total: number | null;
  live: number | null;
  qaDead: number | null;
}

/** Every zone either table has, with the plants each says: the plan's (planted − dead + replanted) beside QA/QC's Total plant. */
export function zoneRows(sheets: readonly SheetWithRows[]): ZoneRow[] {
  const plants = sheets.find((sheet) => sheet.templateKey === 'zone-records');
  const qaqc = sheets.find((sheet) => sheet.templateKey === 'qa-qc-management');
  const plot = plotColumn(plants);
  const qaPlot = plotColumn(qaqc);
  const planted = find(plants, 'Plant count');
  const dead = find(plants, 'Dead plant');
  const replanted = find(plants, 'Replant count');
  const on = find(plants, 'Record date', 'Planting date');
  const total = find(qaqc, 'Total plant');
  const live = find(qaqc, 'Live plant');
  const qaDead = find(qaqc, 'Dead plant');
  const here = new Map<string, Row>();
  const there = new Map<string, Row>();
  if (plants && plot) for (const row of plants.rows) if (text(row, plot) && !here.has(plotKey(text(row, plot)))) here.set(plotKey(text(row, plot)), row);
  if (qaqc && qaPlot) for (const row of qaqc.rows) if (text(row, qaPlot) && !there.has(plotKey(text(row, qaPlot)))) there.set(plotKey(text(row, qaPlot)), row);

  const out: ZoneRow[] = [];
  for (const key of new Set([...here.keys(), ...there.keys()])) {
    const mine = here.get(key);
    const theirs = there.get(key);
    const name = (mine && text(mine, plot)) || (theirs && text(theirs, qaPlot)) || key;
    const n = mine ? numberOf(mine, planted) : null;
    const d = mine ? (text(mine, dead) ? numberOf(mine, dead) : 0) : null;
    const r = mine ? (text(mine, replanted) ? numberOf(mine, replanted) : 0) : null;
    const left = n !== null && d !== null && r !== null ? n - d + r : null;
    const seen = theirs ? numberOf(theirs, total) : null;
    let status: ZoneStatus = 'match';
    let note = '';
    if (!theirs) [status, note] = ['only-plan', `Not in ${qaqc?.title ?? 'QA/QC'}`];
    else if (!mine) [status, note] = ['only-qaqc', `Not in ${plants?.title ?? 'Plant Progress'}`];
    else if (left === null) {
      const bad = n === null ? planted : d === null ? dead : replanted;
      [status, note] = ['unreadable', bad ? `${bad.name} is "${text(mine, bad)}", not a number` : 'Plant count is missing'];
    } else if (seen === null) [status, note] = ['no-count', 'QA/QC has no Total plant'];
    else if (Math.abs(left - seen) >= 0.5) {
      status = 'differs';
      note = `${count(Math.abs(seen - left))} ${seen > left ? 'more' : 'fewer'} in QA/QC`;
    }
    out.push({
      plot: name,
      status,
      note,
      plantedOn: mine ? dateOf(mine, on) : null,
      planted: n,
      dead: d,
      replanted: r,
      left,
      total: seen,
      live: theirs ? numberOf(theirs, live) : null,
      qaDead: theirs ? numberOf(theirs, qaDead) : null,
    });
  }
  return out.sort((a, b) => a.plot.localeCompare(b.plot, 'en', { numeric: true }));
}
