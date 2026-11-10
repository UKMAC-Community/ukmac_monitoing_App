import type {
  Column,
  Dashboard,
  GroupPart,
  Kpi,
  KpiAggregate,
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
  return values ? reduceValues(values, kpi.aggregate) : null;
}

export function kpiColumnGone(sheet: SheetWithRows, kpi: Kpi) {
  const gone = (key: string) => !!key && !sheet.columns.some((column) => column.key === key);
  return gone(kpi.column) || (hasAxis(kpi.visual) && gone(kpi.groupBy));
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
  const groups = new Map<string, Group>();
  values.forEach((value, index) => {
    const group = groupOf(value, part) ?? { key: '￿', label: '(blank)' };
    const known = groups.get(group.key) ?? { ...group, rows: [] };
    known.rows.push(index);
    groups.set(group.key, known);
  });
  return [...groups.values()].sort((a, b) => {
    if (a.key === '￿') return 1;
    if (b.key === '￿') return -1;
    const na = Number(a.key);
    const nb = Number(b.key);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.key.localeCompare(b.key, 'en', { numeric: true });
  });
}

export interface ChartPoint {
  label: string;
  value: number;
}

/** A chart's points: its column worked out per group. */
export function chartPoints(formulas: WorkbookFormulas, sheet: SheetWithRows, kpi: Kpi): ChartPoint[] {
  const values = columnValues(formulas, sheet, kpi.column);
  const groups = groupRows(formulas, sheet, kpi.groupBy, kpi.groupPart);
  if (!values || !groups) return [];
  return groups.map((group) => ({
    label: group.label,
    value: reduceValues(
      group.rows.map((index) => values[index]),
      kpi.aggregate,
    ) ?? 0,
  }));
}

export interface SummaryResult {
  header: string;
  columns: string[];
  rows: { label: string; values: (number | null)[] }[];
  totals: (number | null)[];
}

/** A summary worked out: a line per group, a value per measure, and the whole table's under them. */
export function summaryResult(formulas: WorkbookFormulas, sheet: SheetWithRows, summary: SummaryTable): SummaryResult | null {
  const groupColumn = sheet.columns.find((column) => column.key === summary.groupBy);
  const groups = groupRows(formulas, sheet, summary.groupBy, summary.groupPart);
  if (!groupColumn || !groups) return null;
  const measures = summary.measures.map((measure) => ({
    measure,
    values: columnValues(formulas, sheet, measure.column),
  }));
  const part = summary.groupPart === 'month' ? ' (month)' : summary.groupPart === 'year' ? ' (year)' : '';
  return {
    header: dashboardColumnName(sheet.columns, groupColumn) + part,
    columns: measures.map(({ measure }) => measureLabel(sheet, measure)),
    rows: groups.map((group) => ({
      label: group.label,
      values: measures.map(({ measure, values }) =>
        values ? reduceValues(group.rows.map((index) => values[index]), measure.aggregate) : null,
      ),
    })),
    totals: measures.map(({ measure, values }) => (values ? reduceValues(values, measure.aggregate) : null)),
  };
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
): Kpi | null {
  if (column === undefined || !groupBy) return null;
  return { ...card(title, column, aggregate)!, visual, groupBy: groupBy.key, groupPart };
}

function summary(title: string, groupBy: Column | undefined, groupPart: GroupPart, measures: (SummaryMeasure | null)[]): SummaryTable | null {
  if (!groupBy) return null;
  return { id: newId(), title, groupBy: groupBy.key, groupPart, measures: measures.filter((m): m is SummaryMeasure => !!m) };
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
      const harvested = pick('Harvested', '10 ·');
      const yieldPer = pick('Yield per plant', '10 ·');
      const zone = pick('Zone');
      const date = pick('Date', '');
      kpis = [
        card('QC records', '', 'count'),
        card('Zones checked', zone, 'distinct'),
        card('Live plants (of 20)', live, 'average', { goal: 18, decimals: 1 }),
        card('Dead plants', dead, 'sum', { higherIsBetter: false }),
        card('Marketable fruit (kg)', marketable, 'sum', { decimals: 1 }),
        card('Yield per plant (kg)', yieldPer, 'average', { decimals: 2 }),
        chart('Live plants by zone', 'column', live, 'average', zone),
        chart('Marketable fruit by month (kg)', 'line', marketable, 'sum', date, 'month'),
      ];
      summaries = [
        summary('By zone', zone, 'value', [
          measure('', 'count', 'QC records'),
          measure(live, 'average', 'Live plants (avg)'),
          measure(dead, 'sum', 'Dead plants'),
          measure(marketable, 'sum', 'Marketable (kg)'),
          measure(harvested, 'sum', 'Harvested (kg)'),
        ]),
      ];
      break;
    }
    case 'nursery-batches': {
      const total = pick('Total number');
      const healthy = pick('Healthy');
      const notHealthy = pick('Not healthy');
      const percent = pick('Healthy %');
      const type = pick('Plant type');
      const supply = pick('Supply date');
      kpis = [
        card('Batches', '', 'count'),
        card('Seedlings', total, 'sum'),
        card('Healthy seedlings', healthy, 'sum'),
        card('Healthy %', percent, 'average', { goal: 90, decimals: 1 }),
        chart('Seedlings by plant type', 'column', total, 'sum', type),
        chart('Seedlings by month', 'line', total, 'sum', supply, 'month'),
      ];
      break;
    }
    case 'zone-records': {
      const plot = pick('Zone plot');
      const plants = pick('Plant count');
      const replant = pick('Replant count');
      const dead = pick('Dead plant');
      const date = pick('Record date');
      kpis = [
        card('Records', '', 'count'),
        card('Plants', plants, 'sum'),
        card('Replanted', replant, 'sum'),
        card('Dead plants', dead, 'sum', { higherIsBetter: false }),
        chart('Plants by zone plot', 'column', plants, 'sum', plot),
        chart('Dead plants by month', 'line', dead, 'sum', date, 'month'),
      ];
      summaries = [
        summary('By zone plot', plot, 'value', [
          measure('', 'count', 'Records'),
          measure(plants, 'sum', 'Plants'),
          measure(replant, 'sum', 'Replanted'),
          measure(dead, 'sum', 'Dead'),
        ]),
      ];
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
  const numbers = sheet.columns.filter((column) => column.type === 'number' || column.type === 'percentage');
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
