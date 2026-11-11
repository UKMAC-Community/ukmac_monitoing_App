import type {
  Column,
  Dashboard,
  GroupPart,
  Kpi,
  KpiAggregate,
  KpiView,
  KpiVisual,
  SheetWithRows,
  SummaryMeasure,
  SummaryTable,
} from '../core/models';
import { isFormulaError, type FormulaScalar } from '../formula/evaluate-formula';
import type { WorkbookFormulas } from '../formula/sheet-formulas';
import { columnLabel, formatDate, isIsoDate, PATH_SEPARATOR } from '../sheet/columns';

/**
 * A table's dashboard, as the system's KPI board has it: Power BI-style
 * cards over the table's columns (a column worked out as a sum, an
 * average, a count…, against a goal), charts of a column per group, and
 * summaries — the rows grouped by a column (Zone, month…) with a measure
 * per column and totals. Pure: the components draw what these work out.
 */

export const KPI_AGGREGATES: { value: KpiAggregate; label: string }[] = [
  { value: 'count', label: 'Count of rows' },
  { value: 'count_values', label: 'Count (not blank)' },
  { value: 'distinct', label: 'Count (distinct)' },
  { value: 'sum', label: 'Sum' },
  { value: 'average', label: 'Average' },
  { value: 'min', label: 'Minimum' },
  { value: 'max', label: 'Maximum' },
];

export const KPI_VISUALS: { value: KpiVisual; label: string }[] = [
  { value: 'card', label: 'Card' },
  { value: 'column', label: 'Column chart' },
  { value: 'stacked', label: 'Stacked column chart' },
  { value: 'bar', label: 'Bar chart' },
  { value: 'line', label: 'Line chart' },
  { value: 'area', label: 'Area chart' },
  { value: 'waterfall', label: 'Waterfall chart' },
  { value: 'pie', label: 'Pie chart' },
  { value: 'donut', label: 'Donut chart' },
  { value: 'treemap', label: 'Treemap' },
  { value: 'funnel', label: 'Funnel' },
  { value: 'radar', label: 'Radar chart' },
  { value: 'gauge', label: 'Gauge' },
  { value: 'lollipop', label: 'Lollipop chart' },
  { value: 'dot', label: 'Dot plot' },
  { value: 'pareto', label: 'Pareto chart' },
  { value: 'polar', label: 'Polar area chart' },
];

/** A card and a gauge show one number: they have no groups on an axis, as the charts and the table do. */
export const hasAxis = (type: KpiVisual | 'table') => type !== 'card' && type !== 'gauge';

/** Power BI's default theme colours, in its order (the system's KPI_PALETTE). */
export const KPI_PALETTE = [
  '#118DFF',
  '#12239E',
  '#E66C37',
  '#6B007B',
  '#E044A7',
  '#744EC2',
  '#D9B300',
  '#D64550',
  '#197278',
  '#1AAB40',
];

/** A chili's own colours: a ripe one is red, an unripe one green (a series called so is drawn so). */
export const RIPE_COLOR = '#D32F2F';
export const UNRIPE_COLOR = '#43A047';

/** A stacked series' colour: its fruit's colour when it is the ripe or the unripe one, else the palette's by its place. */
export function seriesColour(label: string, index: number): string {
  if (/\bunripe\b/i.test(label)) return UNRIPE_COLOR;
  if (/\bripe\b/i.test(label)) return RIPE_COLOR;
  return KPI_PALETTE[index % KPI_PALETTE.length];
}

export const GOOD_COLOR = '#1A7F37';
export const BAD_COLOR = '#C4314B';

export function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function aggregateLabel(aggregate: KpiAggregate) {
  return KPI_AGGREGATES.find((item) => item.value === aggregate)?.label ?? aggregate;
}

/** A column as a dashboard names it: its box in front where the table has several. */
export function dashboardColumnName(columns: readonly Column[], column: Column) {
  const shared = columns.filter((other) => other.name === column.name).length > 1;
  return shared && column.box ? `${column.box}${PATH_SEPARATOR}${columnLabel(column)}` : columnLabel(column);
}

function numberOf(value: FormulaScalar): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value !== 'string' || !value.trim()) return null;
  const number = Number(value.replace(/,/g, '').replace(/%\s*$/, ''));
  return Number.isFinite(number) ? number : null;
}

const blank = (value: FormulaScalar) => value === null || value === '' || isFormulaError(value);

/** Values reduced as Power BI's card does: the rows' count, the filled ones', the distinct ones', or the numbers' sum, average, smallest or largest. */
export function reduceValues(values: readonly FormulaScalar[], aggregate: KpiAggregate): number | null {
  if (aggregate === 'count') return values.length;
  if (aggregate === 'list') return null;
  const filled = values.filter((value) => !blank(value));
  if (aggregate === 'count_values') return filled.length;
  if (aggregate === 'distinct') {
    return new Set(filled.map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : String(value)))).size;
  }
  const numbers = filled.map(numberOf).filter((value): value is number => value !== null);
  if (!numbers.length) return aggregate === 'sum' ? 0 : null;
  if (aggregate === 'sum') return numbers.reduce((total, n) => total + n, 0);
  if (aggregate === 'average') return numbers.reduce((total, n) => total + n, 0) / numbers.length;
  return aggregate === 'min' ? Math.min(...numbers) : Math.max(...numbers);
}

/** The distinct values written out, in order (A-01, A-02…): a summary's `list`. */
export function listValues(values: readonly FormulaScalar[]): string {
  const seen = new Map<string, string>();
  for (const value of values) {
    if (blank(value)) continue;
    const text = String(value).trim();
    if (text && !seen.has(text.toLowerCase())) seen.set(text.toLowerCase(), text);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(', ');
}

/** A column's value on every row (formula columns worked out); a missing column: null. */
export function columnValues(formulas: WorkbookFormulas, sheet: SheetWithRows, key: string): FormulaScalar[] | null {
  if (!key) return sheet.rows.map(() => null);
  const column = sheet.columns.find((item) => item.key === key);
  if (!column) return null;
  return sheet.rows.map((row) => formulas.cell(sheet, row, column));
}

/** A KPI card's value now; null: its column is gone or holds no numbers. */
export function kpiValue(formulas: WorkbookFormulas, sheet: SheetWithRows, kpi: Kpi): number | null {
  const values = columnValues(formulas, sheet, kpi.column);
  if (!values) return null;
  if (kpi.perGroup) return perGroupValue(formulas, sheet, kpi, values);
  const own = reduceValues(values, kpi.aggregate);
  if (!kpi.plus?.length || kpi.aggregate !== 'sum') return own;
  const more = sumOfColumns(formulas, sheet, kpi.plus);
  return more === null ? own : (own ?? 0) + more;
}

/** The columns (keys) each added up over the rows, then together; null when one is gone. */
export function sumOfColumns(formulas: WorkbookFormulas, sheet: SheetWithRows, keys: readonly string[]): number | null {
  let total = 0;
  for (const key of keys) {
    const values = columnValues(formulas, sheet, key);
    if (!values) return null;
    total += reduceValues(values, 'sum') ?? 0;
  }
  return total;
}

/** A card's value as a percent of other columns' sum (the dead plants of the plants used); null with nothing to divide by. */
export function kpiPercent(formulas: WorkbookFormulas, sheet: SheetWithRows, kpi: Kpi, value: number | null): number | null {
  if (!kpi.percentOf?.length || value === null) return null;
  const whole = sumOfColumns(formulas, sheet, kpi.percentOf);
  return whole ? (value / whole) * 100 : null;
}

/** The column added up in each group (a day), the groups with nothing in them (and the blank group) left out, then averaged / min / max'd. */
function perGroupValue(formulas: WorkbookFormulas, sheet: SheetWithRows, kpi: Kpi, values: FormulaScalar[]): number | null {
  const groups = groupRows(formulas, sheet, kpi.perGroup!.groupBy, kpi.perGroup!.groupPart);
  if (!groups) return null;
  const totals = groups
    .filter((group) => group.key !== '\uffff')
    .map((group) => reduceValues(group.rows.map((index) => values[index]), 'sum') ?? 0)
    .filter((total) => total > 0);
  return reduceValues(totals, kpi.aggregate);
}

export function kpiColumnGone(sheet: SheetWithRows, kpi: Kpi) {
  const gone = (key: string) => !!key && !sheet.columns.some((column) => column.key === key);
  return gone(kpi.column) || (hasAxis(kpi.visual) && gone(kpi.groupBy)) || (kpi.more ?? []).some((measure) => gone(measure.column));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A group's key (sorts in order) and label, for a value and how it's grouped. */
function groupOf(value: FormulaScalar, part: GroupPart): { key: string; label: string } | null {
  if (blank(value)) return null;
  const text = String(value).trim();
  if (part !== 'value' || isIsoDate(text.slice(0, 10))) {
    const iso = text.slice(0, 10);
    if (isIsoDate(iso)) {
      if (part === 'year') return { key: iso.slice(0, 4), label: iso.slice(0, 4) };
      if (part === 'month') return { key: iso.slice(0, 7), label: `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` };
      return { key: iso, label: formatDate(iso) };
    }
    if (part !== 'value') return null;
  }
  return { key: text.toLowerCase(), label: typeof value === 'boolean' ? (value ? 'Yes' : 'No') : text };
}

export interface Group {
  key: string;
  label: string;
  rows: number[];
}

/** The rows' indexes grouped by a column (or its dates' months / years), in order: dates by date, numbers by number, text A → Z. */
export function groupRows(formulas: WorkbookFormulas, sheet: SheetWithRows, key: string, part: GroupPart): Group[] | null {
  const values = columnValues(formulas, sheet, key);
  if (!values) return null;
  return groupIndexes(values, values.map((_, index) => index), part);
}

/** Some rows (their indexes) grouped by a column's values, in order; a row with no value is the last group, "(blank)". */
function groupIndexes(values: readonly FormulaScalar[], indexes: readonly number[], part: GroupPart): Group[] {
  const groups = new Map<string, Group>();
  for (const index of indexes) {
    const group = groupOf(values[index], part) ?? { key: '\uffff', label: '(blank)' };
    const known = groups.get(group.key) ?? { ...group, rows: [] };
    known.rows.push(index);
    groups.set(group.key, known);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === '\uffff') return 1;
    if (b.key === '\uffff') return -1;
    const na = Number(a.key);
    const nb = Number(b.key);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.key.localeCompare(b.key, 'en', { numeric: true });
  });
}

export interface ChartPoint {
  label: string;
  value: number;
  /** The group it is (what a click on it filters the other visuals by); none: not one group (Other, a total). */
  key?: string;
  /** A day of a timeline with no rows: drawn as a gap. */
  empty?: boolean;
}

/** A stacked column chart's one value across the groups (the groups are the same in every series). */
export interface ChartSeries {
  label: string;
  points: ChartPoint[];
}

/** A stacked chart's series: the chart's own value, then each of its `more`, per group. */
export function chartSeries(formulas: WorkbookFormulas, sheet: SheetWithRows, kpi: Kpi): ChartSeries[] {
  const groups = groupRows(formulas, sheet, kpi.groupBy, kpi.groupPart);
  if (!groups) return [];
  const measures: SummaryMeasure[] = [{ column: kpi.column, aggregate: kpi.aggregate }, ...(kpi.more ?? [])];
  return measures.flatMap((measure) => {
    const values = columnValues(formulas, sheet, measure.column);
    if (!values) return [];
    return [
      {
        label: measureLabel(sheet, measure),
        points: groups.map((group) => ({
          key: group.key,
          label: group.label,
          value: reduceValues(group.rows.map((index) => values[index]), measure.aggregate) ?? 0,
        })),
      },
    ];
  });
}

/** A chart's points: its column worked out per group. */
export function chartPoints(formulas: WorkbookFormulas, sheet: SheetWithRows, kpi: Kpi): ChartPoint[] {
  const values = columnValues(formulas, sheet, kpi.column);
  const groups = groupRows(formulas, sheet, kpi.groupBy, kpi.groupPart);
  if (!values || !groups) return [];
  const points: ChartPoint[] = groups.map((group) => ({
    key: group.key,
    label: group.label,
    value: reduceValues(
      group.rows.map((index) => values[index]),
      kpi.aggregate,
    ) ?? 0,
  }));
  return kpi.timeline && kpi.visual === 'column' && kpi.groupPart === 'value' ? everyDay(points) : points;
}

/** The days of a chart as a timeline: every day from the first to the last, a day with no rows an empty point (the blank group stays last). */
function everyDay(points: ChartPoint[]): ChartPoint[] {
  const days = points.filter((point) => point.key && isIsoDate(point.key));
  if (!days.length || days.length !== points.filter((point) => point.label !== '(blank)').length) return points;
  const byDay = new Map(days.map((point) => [point.key!, point]));
  const filled: ChartPoint[] = [];
  const end = Date.UTC(+days[days.length - 1].key!.slice(0, 4), +days[days.length - 1].key!.slice(5, 7) - 1, +days[days.length - 1].key!.slice(8, 10));
  for (let t = Date.UTC(+days[0].key!.slice(0, 4), +days[0].key!.slice(5, 7) - 1, +days[0].key!.slice(8, 10)); t <= end; t += 86_400_000) {
    const iso = new Date(t).toISOString().slice(0, 10);
    filled.push(byDay.get(iso) ?? { key: iso, label: formatDate(iso), value: 0, empty: true });
  }
  return [...filled, ...points.filter((point) => point.label === '(blank)')];
}

export interface SummaryResult {
  header: string;
  /** A table grouped twice (a day, then each zone number in it): what the second column is called. */
  header2?: string;
  columns: string[];
  /** `key` and `label` are the first column's group; `label2` is the second's (none: a table grouped once). */
  rows: { key: string; label: string; label2?: string; values: (number | string | null)[] }[];
  /** A `list` column's total is blank: the whole list would be as long as the table. */
  totals: (number | string | null)[];
}

/** A summary worked out: a line per group, a value per measure, and the whole table's under them. */
export function summaryResult(formulas: WorkbookFormulas, sheet: SheetWithRows, summary: SummaryTable): SummaryResult | null {
  const groupColumn = sheet.columns.find((column) => column.key === summary.groupBy);
  const groups = groupRows(formulas, sheet, summary.groupBy, summary.groupPart);
  if (!groupColumn || !groups) return null;
  const thenColumn = summary.thenBy ? sheet.columns.find((column) => column.key === summary.thenBy) : undefined;
  const thenValues = thenColumn ? columnValues(formulas, sheet, thenColumn.key) : null;
  const thenPart = summary.thenPart ?? 'value';
  const measures = summary.measures.map((measure) => ({
    measure,
    values: columnValues(formulas, sheet, measure.column),
  }));
  const partOf = (part: GroupPart) => (part === 'month' ? ' (month)' : part === 'year' ? ' (year)' : '');
  const valuesOf = (indexes: readonly number[]) =>
    measures.map(({ measure, values }) =>
      !values ? null : measure.aggregate === 'list' ? listValues(indexes.map((index) => values[index])) : reduceValues(indexes.map((index) => values[index]), measure.aggregate),
    );
  return {
    header: dashboardColumnName(sheet.columns, groupColumn) + partOf(summary.groupPart),
    ...(thenColumn && thenValues ? { header2: dashboardColumnName(sheet.columns, thenColumn) + partOf(thenPart) } : {}),
    columns: measures.map(({ measure }) => measureLabel(sheet, measure)),
    rows: groups.flatMap((group) =>
      thenColumn && thenValues
        ? // Inside each group, a line for each of the second column's (the first group's key stays, so a click still keeps its rows).
          groupIndexes(thenValues, group.rows, thenPart).map((inner) => ({ key: group.key, label: group.label, label2: inner.label, values: valuesOf(inner.rows) }))
        : [{ key: group.key, label: group.label, values: valuesOf(group.rows) }],
    ),
    totals: measures.map(({ measure, values }) => (!values ? null : measure.aggregate === 'list' ? '' : reduceValues(values, measure.aggregate))),
  };
}

/**
 * What a click on a group of a visual keeps in the others, as in Power BI: the rows of the group(s)
 * clicked, the column they were grouped by and how. The visual clicked still shows every group
 * (the clicked ones lit, the rest dimmed).
 */
export interface CrossFilter {
  sheetId: number;
  /** The visual it was clicked in (a chart's or a summary's id). */
  source: string;
  column: string;
  part: GroupPart;
  /** The groups kept (their keys), and what to call them. */
  keys: string[];
  labels: string[];
  /** What the column is called, for the chip: "Zone number". */
  name: string;
}

/** The rows `filter` keeps (the sheet itself when there is none, it is of another table, or its column is gone). */
export function filteredSheet(formulas: WorkbookFormulas, sheet: SheetWithRows, filter: CrossFilter | null): SheetWithRows {
  if (!filter || filter.sheetId !== sheet.sheetId) return sheet;
  const groups = groupRows(formulas, sheet, filter.column, filter.part);
  if (!groups) return sheet;
  const kept = new Set(groups.filter((group) => filter.keys.includes(group.key)).flatMap((group) => group.rows));
  return { ...sheet, rows: sheet.rows.filter((_, index) => kept.has(index)) };
}

export function measureLabel(sheet: SheetWithRows, measure: SummaryMeasure) {
  if (measure.label) return measure.label;
  if (measure.aggregate === 'count' || !measure.column) return 'Rows';
  const column = sheet.columns.find((item) => item.key === measure.column);
  if (!column) return '(column gone)';
  const name = dashboardColumnName(sheet.columns, column);
  return measure.aggregate === 'sum' ? name : `${aggregateLabel(measure.aggregate)} · ${name}`;
}

export function formatNumber(value: number | null, decimals: number | null = null) {
  if (value === null) return '—';
  return value.toLocaleString('en-US', {
    maximumFractionDigits: decimals ?? 2,
    minimumFractionDigits: decimals ?? 0,
  });
}

/** Whether a column's values are dates (a date column, or a formula working out dates). */
export function isDateColumn(formulas: WorkbookFormulas, sheet: SheetWithRows, column: Column) {
  if (column.type === 'date') return true;
  if (column.type !== 'formula') return false;
  const values = (columnValues(formulas, sheet, column.key) ?? []).filter((value) => !blank(value));
  return values.length > 0 && values.every((value) => isIsoDate(String(value).slice(0, 10)));
}

// -------------------------------------------------------------- suggested

type Pick = (name: string, box?: string) => Column | undefined;

function picker(sheet: SheetWithRows): Pick {
  const clean = (text: string | undefined) => (text ?? '').trim().toLowerCase();
  // box '' : a column of no box (the row's own Date); 'n ·' : that stage's.
  return (name, box) =>
    sheet.columns.find(
      (column) =>
        clean(column.name) === clean(name) &&
        (box === undefined ? true : box === '' ? !column.box : clean(column.box).startsWith(clean(box))),
    );
}

function card(title: string, column: Column | undefined | '', aggregate: KpiAggregate, extra: Partial<Kpi> = {}): Kpi | null {
  if (column === undefined) return null;
  return {
    id: newId(),
    title,
    column: column === '' ? '' : column.key,
    aggregate,
    visual: 'card',
    groupBy: '',
    groupPart: 'value',
    goal: null,
    higherIsBetter: true,
    decimals: null,
    ...extra,
  };
}

function chart(
  title: string,
  visual: KpiVisual,
  column: Column | undefined | '',
  aggregate: KpiAggregate,
  groupBy: Column | undefined,
  groupPart: GroupPart = 'value',
  extra: Partial<Kpi> = {},
): Kpi | null {
  if (column === undefined || !groupBy) return null;
  return { ...card(title, column, aggregate)!, visual, groupBy: groupBy.key, groupPart, ...extra };
}

function stackedChart(
  title: string,
  column: Column,
  aggregate: KpiAggregate,
  groupBy: Column,
  groupPart: GroupPart,
  more: SummaryMeasure[],
): Kpi {
  return { ...card(title, column, aggregate)!, visual: 'stacked', groupBy: groupBy.key, groupPart, more };
}

function summary(
  title: string,
  groupBy: Column | undefined,
  groupPart: GroupPart,
  measures: (SummaryMeasure | null)[],
  then?: Column,
): SummaryTable | null {
  if (!groupBy) return null;
  return {
    id: newId(),
    title,
    groupBy: groupBy.key,
    groupPart,
    ...(then ? { thenBy: then.key, thenPart: 'value' as const } : {}),
    measures: measures.filter((m): m is SummaryMeasure => !!m),
  };
}

function measure(column: Column | undefined | '', aggregate: KpiAggregate, label?: string): SummaryMeasure | null {
  if (column === undefined) return null;
  return { column: column === '' ? '' : column.key, aggregate, label };
}

/** The dashboard a table starts with: the chili template's own for its tables, else one from its columns. */
export function suggestedDashboard(sheet: SheetWithRows): Dashboard {
  const pick = picker(sheet);
  let kpis: (Kpi | null)[] = [];
  let summaries: (SummaryTable | null)[] = [];
  switch (sheet.templateKey) {
    case 'qa-qc-management': {
      const live = pick('Live plant', '2 ·');
      const dead = pick('Dead plant', '2 ·');
      const marketable = pick('Marketable', '8 ·');
      // The sheet's own total of the harvest (the first Total of the Harvest stage, over the Marketable fruit).
      const harvested = pick('Total', '8 ·');
      const zone = pick('Zone');
      const date = pick('Date', '');
      kpis = [
        card('QC records', '', 'count'),
        card('Zones checked', zone, 'distinct'),
        card('Live plants (of 20)', live, 'average', { goal: 18, decimals: 1 }),
        card('Dead plants', dead, 'sum', { higherIsBetter: false }),
        card('Marketable fruit (kg)', marketable, 'sum', { decimals: 1 }),
        card('Harvest total (kg)', harvested, 'sum', { decimals: 1 }),
        chart('Live plants by zone', 'column', live, 'average', zone),
        chart('Marketable fruit by month (kg)', 'line', marketable, 'sum', date, 'month'),
      ];
      // No By zone table: the charts and cards say it, and the rows are under them.
      break;
    }
    case 'nursery-batches': {
      const total = pick('Total number');
      // The names Nursery Progress has now, or the ones an older table still has.
      const healthy = pick('Healthy number') ?? pick('Healthy');
      const percent = pick('Healthy %');
      const batch = pick('Batch number') ?? pick('Batch #');
      const supply = pick('Supply date start') ?? pick('Supply date');
      // The charts open on each batch and switch to each month: Batch | Month (a table with no batch or no date has the one it can).
      const switchOf = (what: string): KpiView[] | undefined =>
        batch && supply
          ? [
              { label: 'Batch', groupBy: batch.key, groupPart: 'value', title: `${what} by batch` },
              { label: 'Month', groupBy: supply.key, groupPart: 'month', title: `${what} by month` },
            ]
          : undefined;
      const withSwitch = (kpi: Kpi | null, what: string): Kpi | null => {
        const views = switchOf(what);
        return kpi && views ? { ...kpi, views } : kpi;
      };
      const seedlings = withSwitch(
        chart(`Seedlings by ${batch ? 'batch' : 'month'}`, 'column', total, 'sum', batch ?? supply, batch ? 'value' : 'month'),
        'Seedlings',
      );
      // The unhealthy seedlings only, stacked by what was wrong with them: every problem the table counts
      // (a table with none of these columns has no such chart: the seedlings chart already has each month).
      const problems = ['Stem rot', 'Leaf rot', 'Smaller', 'Disease', 'Physical damage'].map((name) => pick(name)).filter((column): column is Column => !!column);
      const group = batch ?? supply;
      const unhealthy =
        problems.length && group
          ? withSwitch(
              stackedChart(`Unhealthy seedlings by ${batch ? 'batch' : 'month'}`, problems[0], 'sum', group, batch ? 'value' : 'month', problems.slice(1).map((column) => ({ column: column.key, aggregate: 'sum' as const }))),
              'Unhealthy seedlings',
            )
          : null;
      kpis = [
        card('Batches', '', 'count'),
        card('Seedlings', total, 'sum'),
        card('Healthy seedlings', healthy, 'sum'),
        card('Healthy %', percent, 'average', { decimals: 1 }),
        seedlings,
        unhealthy,
      ];
      break;
    }
    case 'batches': {
      // How many batches there are and which varieties they are of (the names an older table may still have: Plant type).
      const batch = pick('Batch number') ?? pick('Batch #');
      const variety = pick('Variety name') ?? pick('Plant type');
      kpis = [
        card('Batches', batch ?? '', batch ? 'distinct' : 'count'),
        card('Varieties', variety, 'distinct'),
        chart('Batches by variety', 'bar', '', 'count', variety),
      ];
      summaries = [summary('By variety', variety, 'value', [measure('', 'count', 'Batches')])];
      break;
    }
    case 'zone-records': {
      const plot = pick('Zone plot');
      // The plots are added up by the zone number they belong to (a table without that column keeps adding them up by plot).
      const zoneNumber = pick('Zone number');
      const plants = pick('Plant count');
      const replant = pick('Replant count');
      const dead = pick('Dead plant');
      const date = pick('Record date');
      const day = pick('Day number');
      // A day is a day number (the date when the table has none).
      const dayColumn = day ?? date;
      const perDay = dayColumn ? { groupBy: dayColumn.key, groupPart: 'value' as const } : undefined;
      const byDay = day ? chart('Plant count by day number', 'line', plants, 'sum', day) : chart('Dead plants by month', 'line', dead, 'sum', date, 'month');
      const planted: Kpi | null =
        day && date && byDay
          ? {
              ...byDay,
              views: [
                { label: 'Day', groupBy: day.key, groupPart: 'value', title: 'Plant count by day number' },
                { label: 'Month', groupBy: date.key, groupPart: 'month', title: 'Plant count by month' },
              ],
            }
          : byDay;
      // By zone number the plants open as a pie (each zone in its colour, with its share) and switch to columns: Pie | Column.
      const byZone = chart(zoneNumber ? 'Plants by zone number' : 'Plants by zone plot', zoneNumber ? 'pie' : 'column', plants, 'sum', zoneNumber ?? plot, 'value', zoneNumber ? { zoneColours: true } : {});
      const plantsChart: Kpi | null =
        byZone && zoneNumber
          ? {
              ...byZone,
              views: [
                { label: 'Pie', groupBy: zoneNumber.key, groupPart: 'value', visual: 'pie' },
                { label: 'Column', groupBy: zoneNumber.key, groupPart: 'value', visual: 'column' },
              ],
            }
          : byZone;
      kpis = [
        // The farm sheet's KPI row, worked out from the records: the plants used (planted + replanted), planted, replanted, dead (and its percent of the plants used),
        // then the plants a day (average, smallest, largest) over the days the table has records of.
        card('Total Chili Plant Used', plants, 'sum', { plus: replant ? [replant.key] : [] }),
        card('Total Chili Plants Planted', plants, 'sum'),
        card('Total Chili Replant', replant, 'sum'),
        card('Total Plant Dead After Planting', dead, 'sum', {
          higherIsBetter: false,
          decimals: 0,
          percentOf: [plants, replant].flatMap((column) => (column ? [column.key] : [])),
          percentLabel: 'plants used',
        }),
        card('Average Plant a Day', plants, 'average', { decimals: 2, perGroup: perDay }),
        card('Minimum Plants a Day', plants, 'min', { perGroup: perDay }),
        card('Maximum Plants a Day', plants, 'max', { perGroup: perDay }),
        plantsChart,
        // The plant count of each day number, day by day (a table without a Day number column keeps the dead plants by month).
        // It opens on the day number and switches to each month of the record date: Day | Month.
        planted,
      ];
      summaries = [
        summary(zoneNumber ? 'By zone number' : 'By zone plot', zoneNumber ?? plot, 'value', [
          measure('', 'count', 'Records'),
          measure(plants, 'sum', 'Plants'),
          measure(replant, 'sum', 'Replanted'),
          measure(dead, 'sum', 'Dead'),
        ]),
      ];
      break;
    }
    case 'zone-measurement': {
      const plot = pick('Zone plot');
      // The plots are added up by the zone number they belong to (a table without that column keeps adding them up by plot).
      const zoneNumber = pick('Zone number');
      const area = pick('Area in plan');
      const width = pick('Actual width');
      const length = pick('Actual length');
      const by = zoneNumber ?? plot;
      kpis = [
        card('Rows', '', 'count'),
        area ? card(columnLabel(area), area, 'sum') : null,
        width ? card(columnLabel(width), width, 'sum') : null,
        length ? card(columnLabel(length), length, 'sum') : null,
        area && by ? chart(`${columnLabel(area)} by ${zoneNumber ? 'zone number' : 'zone plot'}`, 'bar', area, 'sum', by, 'value', zoneNumber ? { zoneColours: true } : {}) : null,
      ];
      summaries = by
        ? [
            summary(zoneNumber ? 'By zone number' : 'By zone plot', by, 'value', [
              measure('', 'count', 'Rows'),
              ...[area, width, length].filter((column): column is Column => !!column).map((column) => measure(column, 'sum')),
            ]),
          ]
        : [];
      break;
    }
    case 'harvest': {
      // The farm's harvests added up: each day (every plot of that day together), and each zone number (over all the days);
      // the ripe and the unripe kilos apart (the table's own Ripe yield / Unripe yield).
      const plot = pick('Zone plot');
      const zoneNumber = pick('Zone number');
      const harvestDate = pick('Date harvest');
      const total = pick('Harvest yield');
      const ripe = pick('Ripe yield');
      const unripe = pick('Unripe yield');
      kpis = [
        card('Harvests', '', 'count'),
        card('Harvest yield (kg)', total, 'sum', { decimals: 1 }),
        card('Ripe (kg)', ripe, 'sum', { decimals: 1 }),
        card('Unripe (kg)', unripe, 'sum', { decimals: 1 }),
        // Every day on the way, the days nothing was harvested left empty: a line of its own that scrolls sideways.
        (() => {
          const byDay = chart('Harvest yield by day', 'column', total, 'sum', harvestDate);
          // It opens on every day and switches to only the days with a harvest, as it was: Every day | Harvest days.
          const views: KpiView[] | undefined = harvestDate
            ? [
                { label: 'Every day', groupBy: harvestDate.key, groupPart: 'value', title: 'Harvest yield by day', timeline: true },
                { label: 'Harvest days', groupBy: harvestDate.key, groupPart: 'value', title: 'Harvest yield by day', timeline: false },
              ]
            : undefined;
          return byDay ? { ...byDay, timeline: true, wide: true, ...(views ? { views } : {}) } : null;
        })(),
        // How much each zone number gave over all the days, a line of its own with the total of the chart in a box beside it
        // (a table with no Zone number column has no such chart).
        (() => {
          // The ripe and the unripe kilos stacked in each zone number; the total of the two is written above each stack and is a chart of its own beside it (no line over the stacks).
          // The unripe kilos at the bottom and the ripe on top of them, each written in its part, as the farm's own chart draws them.
          const stacked = ripe && unripe ? { visual: 'stacked' as const, more: [{ column: ripe.key, aggregate: 'sum' as const }] } : {};
          const byZone = chart('Harvest yield by zone number (kg)', 'column', ripe && unripe ? unripe : total, 'sum', zoneNumber, 'value', { decimals: 1, ...stacked });
          return byZone ? { ...byZone, wide: true, total: 'Total yield (kg)' } : null;
        })(),
      ];
      // What the farm asks of them: on a day, how much and from which plots; in a zone number, how much and from which plots.
      const measures = [measure(plot, 'list', 'Zone plots'), measure(total, 'sum', 'Total yield (kg)'), measure(ripe, 'sum', 'Ripe (kg)'), measure(unripe, 'sum', 'Unripe (kg)')];
      // A zone number also lists every day it was harvested (all its dates, once each, oldest first).
      const zoneMeasures = [measure(plot, 'list', 'Zone plots'), measure(harvestDate, 'list', 'Harvest dates'), ...measures.slice(1)];
      summaries = [summary('By date', harvestDate, 'value', measures), summary('By zone number', zoneNumber, 'value', zoneMeasures)];
      break;
    }
    case 'zones': {
      const zone = pick('Zone');
      const capacity = pick('Plant capacity');
      kpis = [
        card('Zones', zone, 'distinct'),
        card('Plots', pick('Plot'), 'count_values'),
        card('Plant capacity', capacity, 'sum'),
        chart('Plant capacity by zone', 'column', capacity, 'sum', zone),
      ];
      summaries = [summary('By zone', zone, 'value', [measure('', 'count', 'Plots'), measure(capacity, 'sum', 'Plant capacity')])];
      break;
    }
    case 'chili-varieties': {
      const type = pick('Plant type');
      const origin = pick('Origin');
      kpis = [
        card('Varieties', '', 'count'),
        card('Plant types', type, 'distinct'),
        card('Origins', origin, 'distinct'),
        chart('Varieties by origin', 'donut', '', 'count', origin),
        chart('Varieties by plant type', 'column', '', 'count', type),
      ];
      break;
    }
    case 'planting-date': {
      const zone = pick('Zone');
      kpis = [card('Zones planted', zone, 'distinct'), chart('Plantings by month', 'column', '', 'count', pick('Planting date'), 'month')];
      break;
    }
    case 'inventory': {
      const item = pick('Item');
      const stockIn = pick('Stock in');
      const stockOut = pick('Stock out');
      kpis = [
        card('Items', item, 'distinct'),
        card('Stock in', stockIn, 'sum'),
        card('Stock out', stockOut, 'sum'),
        chart('Stock in by item', 'bar', stockIn, 'sum', item),
      ];
      summaries = [summary('By item', item, 'value', [measure(stockIn, 'sum', 'Stock in'), measure(stockOut, 'sum', 'Stock out')])];
      break;
    }
    case 'finance': {
      const income = pick('Income');
      const cost = pick('Cost');
      const date = pick('Date');
      kpis = [
        card('Income', income, 'sum'),
        card('Cost', cost, 'sum', { higherIsBetter: false }),
        chart('Income by month', 'column', income, 'sum', date, 'month'),
        chart('Cost by month', 'column', cost, 'sum', date, 'month'),
      ];
      summaries = [summary('By category', pick('Category'), 'value', [measure(income, 'sum', 'Income'), measure(cost, 'sum', 'Cost')])];
      break;
    }
    default:
      return genericDashboard(sheet);
  }
  const out = { kpis: kpis.filter((k): k is Kpi => !!k), summaries: summaries.filter((s): s is SummaryTable => !!s) };
  return out.kpis.length ? out : genericDashboard(sheet);
}

/** From a table's columns: its rows counted, its numbers added up, by its first date's months and its first pick-list. */
function genericDashboard(sheet: SheetWithRows): Dashboard {
  // (An ID the app numbers is not a measure.)
  const numbers = sheet.columns.filter((column) => !column.auto && (column.type === 'number' || column.type === 'percentage'));
  const date = sheet.columns.find((column) => column.type === 'date');
  const category = sheet.columns.find((column) => column.type === 'link' || column.type === 'choice' || column.type === 'yesno');
  const first = numbers[0];
  const what = first ? columnLabel(first) : 'Rows';
  const kpis: (Kpi | null)[] = [
    card('Rows', '', 'count'),
    ...numbers.slice(0, 3).map((column) =>
      card(columnLabel(column), column, column.type === 'percentage' ? 'average' : 'sum', { decimals: column.type === 'percentage' ? 1 : null }),
    ),
    date ? chart(`${what} by month`, 'column', first ?? '', first ? 'sum' : 'count', date, 'month') : null,
    category ? chart(`${what} by ${category.name}`, 'bar', first ?? '', first ? 'sum' : 'count', category) : null,
  ];
  const groupBy = category ?? date;
  const summaries: (SummaryTable | null)[] = groupBy
    ? [
        summary(`By ${groupBy.name}${groupBy === date ? ' (month)' : ''}`, groupBy, groupBy === date ? 'month' : 'value', [
          measure('', 'count', 'Rows'),
          ...numbers.slice(0, 4).map((column) => measure(column, column.type === 'percentage' ? 'average' : 'sum')),
        ]),
      ]
    : [];
  return { kpis: kpis.filter((k): k is Kpi => !!k), summaries: summaries.filter((s): s is SummaryTable => !!s) };
}

/** Ids that stay the same each time a suggestion is worked out (it's made again on every change). */
function steadyIds(dashboard: Dashboard): Dashboard {
  return {
    kpis: dashboard.kpis.map((kpi, index) => ({ ...kpi, id: `suggested-kpi-${index}` })),
    summaries: dashboard.summaries.map((item, index) => ({ ...item, id: `suggested-summary-${index}` })),
  };
}

/** The table's dashboard: as saved, else the suggested one. */
export function dashboardOf(sheet: SheetWithRows): { dashboard: Dashboard; suggested: boolean } {
  return sheet.dashboard
    ? { dashboard: sheet.dashboard, suggested: false }
    : { dashboard: steadyIds(suggestedDashboard(sheet)), suggested: true };
}
