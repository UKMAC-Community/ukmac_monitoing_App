import type { Column, KpiAggregate, SheetWithRows } from '../core/models';
import type { WorkbookFormulas } from '../formula/sheet-formulas';
import { isIsoDate } from '../sheet/columns';
import { columnValues, reduceValues, type ChartPoint } from './dashboard-model';

/**
 * The chili dashboard's KPIs as a list a person edits, as the web's "Edit
 * dashboard" does (its report is saved once and every chili MAC shows it).
 * A KPI names its table by template key (a table made by hand: by title) and
 * its columns by name and box, never by column key, so one saved list reads
 * the same in every MAC. One whose table or column isn't in a MAC is left
 * out of that MAC's page, not removed from the list.
 */

/** How a KPI is drawn: a tile over its trend, or a chart of its years. */
export type KpiShow = 'card' | 'column' | 'line';

export const KPI_SHOWS: { value: KpiShow; label: string }[] = [
  { value: 'card', label: 'Card' },
  { value: 'column', label: 'Column chart' },
  { value: 'line', label: 'Line chart' },
];

export interface ChiliKpi {
  id: string;
  title: string;
  show: KpiShow;
  /** A table's template key ('nursery-batches'), or the title of one made by hand. */
  table: string;
  /** The column worked out, by name; '' with `count`: the rows. */
  column: string;
  /** Its box, where several columns share the name: undefined any, '' none, else the box it starts with. */
  box?: string;
  aggregate: KpiAggregate;
  /** The date column the years come from, by name; '' none (the KPI is one number). */
  year: string;
  yearBox?: string;
  /** Digits after the point; null: as it comes. */
  decimals: number | null;
}

const NURSERY = 'nursery-batches';
const RECORDS = 'zone-records';
const QC = 'qa-qc-management';

type Starter = Omit<ChiliKpi, 'id' | 'show' | 'decimals'> & { decimals?: number };

const CARDS: Starter[] = [
  { title: 'Seedlings', table: NURSERY, column: 'Total number', aggregate: 'sum', year: 'Supply date start' },
  { title: 'Healthy %', table: NURSERY, column: 'Healthy %', aggregate: 'average', year: 'Supply date start', decimals: 1 },
  { title: 'Batches', table: NURSERY, column: '', aggregate: 'count', year: 'Supply date start' },
  { title: 'Healthy seedlings', table: NURSERY, column: 'Healthy number', aggregate: 'sum', year: 'Supply date start' },
  { title: 'Not healthy', table: NURSERY, column: 'Total unhealthy', aggregate: 'sum', year: 'Supply date start' },
  { title: 'Stem rot', table: NURSERY, column: 'Stem rot', aggregate: 'sum', year: 'Supply date start' },
  { title: 'Plants planted', table: RECORDS, column: 'Plant count', aggregate: 'sum', year: 'Record date' },
  { title: 'Dead after planting', table: RECORDS, column: 'Dead plant', aggregate: 'sum', year: 'Record date' },
  { title: 'Harvest (kg)', table: QC, column: 'Total', box: '8 ·', aggregate: 'sum', year: 'Date', yearBox: '', decimals: 1 },
  { title: 'QC records', table: QC, column: '', aggregate: 'count', year: 'Date', yearBox: '' },
  { title: 'Live plants (avg of 20)', table: QC, column: 'Live plant', box: '2 ·', aggregate: 'average', year: 'Date', yearBox: '', decimals: 1 },
  { title: 'Marketable fruit (kg)', table: QC, column: 'Marketable', box: '8 ·', aggregate: 'sum', year: 'Date', yearBox: '', decimals: 1 },
];

/** The starter, as the system's Chili page draws it: the cards, then the seedlings, healthy % and plants planted by year. */
export function starterKpis(): ChiliKpi[] {
  const make = (spec: Starter, id: string, show: KpiShow, title = spec.title): ChiliKpi => ({ ...spec, id, title, show, decimals: spec.decimals ?? 0 });
  return [
    ...CARDS.map((spec, index) => make(spec, `card-${index + 1}`, 'card')),
    make(CARDS[0], 'chart-1', 'column', 'Seedlings by year'),
    make(CARDS[1], 'chart-2', 'line', 'Healthy % by year'),
    make(CARDS.find((spec) => spec.title === 'Plants planted')!, 'chart-3', 'column', 'Plants planted by year'),
  ];
}

export function blankKpi(id: string, sheet: SheetWithRows | undefined): ChiliKpi {
  return { id, title: 'New KPI', show: 'card', table: sheet ? tableRef(sheet) : '', column: '', aggregate: 'count', year: '', decimals: null };
}

// ---------------------------------------------------------------- saved

/** The most KPIs a dashboard (and a saved version of it) holds. */
export const MAX_KPIS = 60;
const SHOWS = new Set<string>(KPI_SHOWS.map((item) => item.value));
const AGGREGATES = new Set<string>(['count', 'count_values', 'distinct', 'sum', 'average', 'min', 'max']);
const text = (value: unknown, max: number) => (typeof value === 'string' && value.length <= max ? value : null);

/**
 * The saved list, or null when there is none or it can't be read (the
 * starter shows). A list a person emptied is [] — kept, not the starter.
 * Anything unreadable in an item drops that item, never the rest.
 */
export function parseKpis(saved: string | null): ChiliKpi[] | null {
  if (!saved) return null;
  let payload: unknown;
  try { payload = JSON.parse(saved); } catch { return null; }
  const list = (payload as { kpis?: unknown } | null)?.kpis;
  if (!Array.isArray(list)) return null;
  const seen = new Set<string>();
  const kpis: ChiliKpi[] = [];
  for (const item of list.slice(0, MAX_KPIS) as Record<string, unknown>[]) {
    if (!item || typeof item !== 'object') continue;
    const title = text(item['title'], 120), table = text(item['table'], 160), column = text(item['column'], 160), year = text(item['year'], 160);
    const id = text(item['id'], 40), box = item['box'] === undefined ? undefined : text(item['box'], 160), yearBox = item['yearBox'] === undefined ? undefined : text(item['yearBox'], 160);
    const { show, aggregate, decimals } = item;
    if (title === null || !table || column === null || year === null || box === null || yearBox === null) continue;
    if (typeof show !== 'string' || !SHOWS.has(show) || typeof aggregate !== 'string' || !AGGREGATES.has(aggregate)) continue;
    if ((aggregate === 'count') !== (column === '')) continue;
    if (decimals !== null && !(typeof decimals === 'number' && Number.isInteger(decimals) && decimals >= 0 && decimals <= 6)) continue;
    const unique = id && !seen.has(id) ? id : `kpi-${kpis.length + 1}-${seen.size}`;
    seen.add(unique);
    kpis.push({ id: unique, title, show: show as KpiShow, table, column, ...(box === undefined ? {} : { box }), aggregate: aggregate as KpiAggregate, year, ...(yearBox === undefined ? {} : { yearBox }), decimals: decimals as number | null });
  }
  return kpis.length || list.length === 0 ? kpis : null;
}

export function stringifyKpis(kpis: readonly ChiliKpi[]) {
  return JSON.stringify({ kpis });
}

// --------------------------------------------------------------- reading

const clean = (value: string | undefined | null) => (value ?? '').trim().toLowerCase();

/** What a KPI calls a table: its template key, else (made by hand) its title. */
export function tableRef(sheet: SheetWithRows) {
  return sheet.templateKey ?? sheet.title;
}

export function sheetOf(sheets: readonly SheetWithRows[], table: string) {
  return sheets.find((sheet) => sheet.templateKey === table) ?? sheets.find((sheet) => !sheet.templateKey && sheet.title === table);
}

/** What the nursery's columns were called before Nursery Progress followed the farm's note: a MAC still on them keeps its KPIs. */
const OLD_NAMES: Record<string, string> = { 'healthy number': 'healthy', 'total unhealthy': 'not healthy', 'supply date start': 'supply date' };

export function findColumn(sheet: SheetWithRows, name: string, box?: string): Column | undefined {
  const inBox = (column: Column) => (box === undefined ? true : box === '' ? !column.box : clean(column.box).startsWith(clean(box)));
  // By its name, or a name the template also gives it (a KPI saved with the old name still finds the new column).
  const named = (wanted: string) => sheet.columns.find((column) => (clean(column.name) === wanted || (column.aliases ?? []).some((alias) => clean(alias) === wanted)) && inBox(column));
  const old = OLD_NAMES[clean(name)];
  return named(clean(name)) ?? (old ? named(old) : undefined);
}

/** What picking a column stores: its name, and its box where the name alone would be ambiguous. */
export function columnRef(sheet: SheetWithRows, column: Column): { column: string; box?: string } {
  const shared = sheet.columns.filter((other) => clean(other.name) === clean(column.name)).length > 1;
  return shared ? { column: column.name, box: column.box ?? '' } : { column: column.name };
}

/** A KPI's value per year (its trend, oldest first), or null: its table or column isn't in this MAC. */
export function yearSeries(kpi: ChiliKpi, sheets: readonly SheetWithRows[], formulas: WorkbookFormulas): { trend: ChartPoint[]; whole: number | null } | null {
  const sheet = sheetOf(sheets, kpi.table);
  if (!sheet) return null;
  const column = kpi.column ? findColumn(sheet, kpi.column, kpi.box) : null;
  if (kpi.column && !column) return null;
  // No date column (none named, or not in this table): the one number, with no years to show.
  const year = kpi.year ? findColumn(sheet, kpi.year, kpi.yearBox) : null;
  const values = columnValues(formulas, sheet, column?.key ?? '');
  if (!values) return null;
  const whole = reduceValues(values, kpi.aggregate);
  if (!year) return { trend: [], whole };
  const dates = columnValues(formulas, sheet, year.key) ?? [];
  const groups = new Map<string, typeof values>();
  dates.forEach((date, index) => {
    const iso = typeof date === 'string' ? date.slice(0, 10) : '';
    if (!isIsoDate(iso)) return;
    const key = iso.slice(0, 4);
    groups.set(key, [...(groups.get(key) ?? []), values[index]]);
  });
  // A year with nothing to average (or min / max) isn't a point; a sum's is 0.
  const trend = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, items]) => ({ label, value: reduceValues(items, kpi.aggregate) }))
    .filter((point): point is ChartPoint => point.value !== null);
  return { trend, whole };
}

/** Whether this MAC has what the KPI reads (the editor flags the ones it doesn't). */
export function kpiAvailable(kpi: ChiliKpi, sheets: readonly SheetWithRows[], formulas: WorkbookFormulas) {
  return yearSeries(kpi, sheets, formulas) !== null;
}
