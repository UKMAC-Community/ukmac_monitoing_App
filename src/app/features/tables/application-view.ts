import type { Column, Row, SheetWithRows } from '@core/models';
import { displayCell } from '@shared/sheet/columns';
import { isBlank } from './missing-data';

/**
 * A table of applications (Fungicide: a row for each plot's 1st, 2nd… application) seen the other way round: a row for each plot,
 * the applications along the top (1st Application, 2nd Application…) and under each what was done (disease, date, chemical, dose).
 * Only a way to look at the rows: nothing is changed or saved.
 */

const clean = (text: string | undefined) => (text ?? '').trim().toLowerCase().replace(/[_\s]+/g, ' ');

/** A column of the table by any of its names (its own, or one it answers to). */
function find(sheet: Pick<SheetWithRows, 'columns'>, ...names: string[]): Column | undefined {
  const wanted = names.map(clean);
  return sheet.columns.find((column) => [column.name, ...(column.aliases ?? [])].some((name) => wanted.includes(clean(name))));
}

export interface ApplicationLayout {
  plot: Column;
  application: Column;
  /** What is told of each application, in the table's order: every column but the plot, the application and the ID. */
  fields: Column[];
}

/** The columns the view needs: the plot, the application, and what's told of it. None: the table isn't of applications. */
export function applicationLayout(sheet: Pick<SheetWithRows, 'columns'>): ApplicationLayout | null {
  // Pruning names its rounds the same way (1st Pruning, 2nd Pruning…): its Round name is its application.
  const application = find(sheet, 'Application', 'Application round', 'application_round') ?? find(sheet, 'Round name', 'round_name');
  const plot = find(sheet, 'Zone', 'Zone plot', 'zone_plot', 'Plot');
  if (!application || !plot || application.key === plot.key) return null;
  // A round's number beside its name (Pruning's Round: 1 for the 1st Pruning) says nothing its heading doesn't.
  const roundNumber = find(sheet, 'Round', 'Pruning round', 'pruning_round', 'pruning_round_type_id');
  const fields = sheet.columns.filter((column) => column.key !== plot.key && column.key !== application.key && column.key !== roundNumber?.key && !column.auto);
  return fields.length ? { application, fields, plot } : null;
}

export interface ApplicationLine {
  plot: string;
  /** What was done in each application (by its name): each field's text. */
  done: Map<string, Record<string, string>>;
  /** Each application's fields with nothing entered in its row (by key). */
  empty: Map<string, ReadonlySet<string>>;
}

export interface ApplicationPivot {
  layout: ApplicationLayout;
  /** The applications along the top: 1st, 2nd, … (by their number, else as named). */
  rounds: string[];
  lines: ApplicationLine[];
}

const numberOf = (round: string) => {
  const match = /\d+/.exec(round);
  return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
};

/** The rows as a line for each plot (in the order the plots first appear) and an application for each column. */
export function applicationPivot(sheet: Pick<SheetWithRows, 'columns'>, rows: readonly Row[]): ApplicationPivot | null {
  const layout = applicationLayout(sheet);
  if (!layout) return null;
  const rounds = new Set<string>();
  const lines = new Map<string, ApplicationLine>();
  for (const row of rows) {
    const round = (row.data[layout.application.key] ?? '').trim();
    const plot = (row.data[layout.plot.key] ?? '').trim();
    if (!round && !plot) continue;
    const name = round || 'No application';
    rounds.add(name);
    const line = lines.get(plot) ?? { done: new Map(), empty: new Map(), plot };
    lines.set(plot, line);
    line.done.set(name, Object.fromEntries(layout.fields.map((field) => [field.key, displayCell(field, row.data[field.key])])));
    line.empty.set(name, new Set(layout.fields.filter((field) => isBlank(row.data[field.key])).map((field) => field.key)));
  }
  return {
    layout,
    lines: [...lines.values()],
    rounds: [...rounds].sort((a, b) => numberOf(a) - numberOf(b) || a.localeCompare(b, 'en', { numeric: true })),
  };
}

/**
 * A field of a plot's application missing, as the Data Check counts it: its row is there and has nothing in a column a person
 * fills in (`gaps`: the columns with a gap, as the Missing data button gives them). An application with no row at all for the
 * plot is not a gap: there is no record to fill in.
 */
export function isGap(line: ApplicationLine, round: string, key: string, gaps: ReadonlyMap<string, number>): boolean {
  return gaps.has(key) && !!line.empty.get(round)?.has(key);
}

/** The fields of a plot's application that are missing (by key, in the table's order). */
export function gapsOf(pivot: ApplicationPivot, line: ApplicationLine, round: string, gaps: ReadonlyMap<string, number>): Column[] {
  return pivot.layout.fields.filter((field) => isGap(line, round, field.key, gaps));
}

/**
 * Only the plots missing something, each with all its applications (so a gap is seen beside what was done), the applications
 * along the top as they were.
 */
export function withGaps(pivot: ApplicationPivot, gaps: ReadonlyMap<string, number>): ApplicationPivot {
  const missing = (line: ApplicationLine) => [...line.empty.values()].some((keys) => [...keys].some((key) => gaps.has(key)));
  return { ...pivot, lines: pivot.lines.filter(missing) };
}

/**
 * The view without some of its columns: those the page leaves out (nothing entered in any row, as the table seen row by row
 * leaves them out). A folded application then keeps the date that has something in it. Were every column left out, all stay.
 */
export function withoutColumns(pivot: ApplicationPivot, keys: ReadonlySet<string>): ApplicationPivot {
  const fields = pivot.layout.fields.filter((field) => !keys.has(field.key));
  return fields.length && fields.length < pivot.layout.fields.length ? { ...pivot, layout: { ...pivot.layout, fields } } : pivot;
}
