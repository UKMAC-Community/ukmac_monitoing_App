import type { Column, Dashboard, GroupPart, KpiAggregate, KpiVisual, SheetWithRows, SummaryMeasure } from '../core/models';
import { isFormulaError } from '../formula/evaluate-formula';
import type { WorkbookFormulas } from '../formula/sheet-formulas';
import { columnValues, dashboardColumnName, hasAxis, isDateColumn, newId } from './dashboard-model';

/**
 * Edit dashboard as Power BI does it (the system's report studio): a visual
 * picked by its type, its fields put in wells (X-axis, Y-axis, Legend,
 * Values, Rows), each value a chip that says what it works out ("Sum of
 * Total number"). Kept as the board's KPIs and summaries, so a dashboard
 * saved before reads the same.
 */

export type StudioType = KpiVisual | 'table';
export type FieldKind = 'number' | 'date' | 'text';

export interface StudioField {
  /** The column's key; '' is the rows themselves (Count of rows). */
  key: string;
  name: string;
  kind: FieldKind;
}

/** A visual as the studio edits it: a KPI card or chart, or (Table) a summary. */
export interface StudioVisual {
  id: string;
  type: StudioType;
  title: string;
  /** X-axis / Legend / Rows: the column it groups by ('' none), and how its dates group. */
  axis: string;
  part: GroupPart;
  /** Fields / Y-axis / Values. A card and a chart show the first. */
  values: SummaryMeasure[];
  goal: number | null;
  higherIsBetter: boolean;
  decimals: number | null;
}

export const STUDIO_TYPES: { type: StudioType; label: string; icon: string }[] = [
  { type: 'card', label: 'Card', icon: 'hash' },
  { type: 'column', label: 'Column chart', icon: 'chart-column' },
  { type: 'bar', label: 'Bar chart', icon: 'chart-bar' },
  { type: 'line', label: 'Line chart', icon: 'chart-line' },
  { type: 'area', label: 'Area chart', icon: 'chart-area' },
  { type: 'waterfall', label: 'Waterfall chart', icon: 'chart-waterfall' },
  { type: 'pie', label: 'Pie chart', icon: 'chart-pie' },
  { type: 'donut', label: 'Donut chart', icon: 'donut' },
  { type: 'treemap', label: 'Treemap', icon: 'treemap' },
  { type: 'funnel', label: 'Funnel', icon: 'funnel' },
  { type: 'radar', label: 'Radar chart', icon: 'radar' },
  { type: 'gauge', label: 'Gauge', icon: 'gauge' },
  { type: 'lollipop', label: 'Lollipop chart', icon: 'chart-lollipop' },
  { type: 'dot', label: 'Dot plot', icon: 'chart-dot' },
  { type: 'pareto', label: 'Pareto chart', icon: 'chart-pareto' },
  { type: 'polar', label: 'Polar area chart', icon: 'chart-polar' },
  { type: 'table', label: 'Table', icon: 'table' },
];

export const COUNT_OF_ROWS: StudioField = { key: '', name: 'Count of rows', kind: 'number' };

const AGGREGATE_WORDS: Record<KpiAggregate, string> = {
  count: 'Count of rows',
  count_values: 'Count',
  distinct: 'Count (distinct)',
  sum: 'Sum',
  average: 'Average',
  min: 'Min',
  max: 'Max',
};

/** What a value chip can work out: numbers every way, other fields counted. */
export function aggregatesFor(kind: FieldKind): { value: KpiAggregate; label: string }[] {
  const counts: KpiAggregate[] = ['count_values', 'distinct'];
  const all: KpiAggregate[] = kind === 'number' ? ['sum', 'average', 'min', 'max', ...counts] : counts;
  return all.map((value) => ({ value, label: AGGREGATE_WORDS[value] }));
}

/** A value chip's words, as Power BI's: "Sum of Total number". */
export function chipLabel(measure: SummaryMeasure, fields: readonly StudioField[]) {
  if (measure.aggregate === 'count' || !measure.column) return COUNT_OF_ROWS.name;
  const name = fields.find((field) => field.key === measure.column)?.name ?? '(column gone)';
  return `${AGGREGATE_WORDS[measure.aggregate]} of ${name}`;
}

/** The wells' names for a type, as Power BI's. */
export function wellNames(type: StudioType): { axis: string | null; values: string } {
  if (type === 'card') return { axis: null, values: 'Fields' };
  if (type === 'gauge') return { axis: null, values: 'Value' };
  if (type === 'pie' || type === 'donut' || type === 'polar') return { axis: 'Legend', values: 'Values' };
  if (type === 'treemap') return { axis: 'Group', values: 'Values' };
  if (type === 'funnel') return { axis: 'Stage', values: 'Values' };
  if (type === 'radar') return { axis: 'Category', values: 'Y-axis' };
  if (type === 'table') return { axis: 'Rows', values: 'Values' };
  if (type === 'bar' || type === 'lollipop' || type === 'dot') return { axis: 'Y-axis', values: 'X-axis' };
  return { axis: 'X-axis', values: 'Y-axis' };
}

/** Only a table shows more than one value. */
export function holdsManyValues(type: StudioType) {
  return type === 'table';
}

/** The table's columns as the Data pane lists them: numbers (Σ), dates, and the rest. */
export function studioFields(formulas: WorkbookFormulas, sheet: SheetWithRows): StudioField[] {
  return sheet.columns.map((column) => ({
    key: column.key,
    name: dashboardColumnName(sheet.columns, column),
    kind: fieldKind(formulas, sheet, column),
  }));
}

function fieldKind(formulas: WorkbookFormulas, sheet: SheetWithRows, column: Column): FieldKind {
  if (column.type === 'number' || column.type === 'percentage') return 'number';
  if (isDateColumn(formulas, sheet, column)) return 'date';
  if (column.type === 'formula') {
    const values = (columnValues(formulas, sheet, column.key) ?? []).filter((value) => value !== null && value !== '' && !isFormulaError(value));
    if (values.length && values.every((value) => typeof value === 'number')) return 'number';
  }
  return 'text';
}

/** The board's visuals in order: its cards and charts, then its tables. */
export function visualsOf(board: Dashboard): StudioVisual[] {
  return [
    ...board.kpis.map<StudioVisual>((kpi) => ({
      id: kpi.id,
      type: kpi.visual,
      title: kpi.title,
      axis: hasAxis(kpi.visual) ? kpi.groupBy : '',
      part: kpi.groupPart,
      values: kpi.column || kpi.aggregate === 'count' ? [{ column: kpi.column, aggregate: kpi.column ? kpi.aggregate : 'count' }] : [],
      goal: kpi.goal,
      higherIsBetter: kpi.higherIsBetter,
      decimals: kpi.decimals,
    })),
    ...board.summaries.map<StudioVisual>((summary) => ({
      id: summary.id,
      type: 'table',
      title: summary.title,
      axis: summary.groupBy,
      part: summary.groupPart,
      values: summary.measures,
      goal: null,
      higherIsBetter: true,
      decimals: null,
    })),
  ];
}

/** The visuals back as the board the app keeps. */
export function boardOf(visuals: readonly StudioVisual[]): Dashboard {
  return {
    kpis: visuals
      .filter((visual) => visual.type !== 'table')
      .map((visual) => {
        const value = visual.values[0];
        return {
          id: visual.id,
          title: visual.title,
          column: value?.column ?? '',
          aggregate: value ? (value.column ? value.aggregate : 'count') : 'sum',
          visual: visual.type as KpiVisual,
          groupBy: hasAxis(visual.type) ? visual.axis : '',
          groupPart: visual.part,
          goal: visual.goal,
          higherIsBetter: visual.higherIsBetter,
          decimals: visual.decimals,
        };
      }),
    summaries: visuals
      .filter((visual) => visual.type === 'table')
      .map((visual) => ({ id: visual.id, title: visual.title, groupBy: visual.axis, groupPart: visual.part, measures: visual.values })),
  };
}

export function blankVisual(type: StudioType): StudioVisual {
  return { id: newId(), type, title: '', axis: '', part: 'value', values: [], goal: null, higherIsBetter: true, decimals: null };
}

/** A title worked out from the fields, as Power BI names a visual: "Sum of Total number by Plant type". */
export function autoTitle(visual: StudioVisual, fields: readonly StudioField[]): string {
  const axis = fields.find((field) => field.key === visual.axis)?.name ?? '';
  const by = axis ? `${axis}${visual.part === 'month' ? ' (month)' : visual.part === 'year' ? ' (year)' : ''}` : '';
  const value = visual.values[0] ? chipLabel(visual.values[0], fields) : '';
  if (visual.type === 'card' || visual.type === 'gauge') return value || (visual.type === 'gauge' ? 'Gauge' : 'Card');
  if (visual.type === 'table') return by ? `By ${by}` : 'Table';
  if (value && by) return `${value} by ${by}`;
  return value || (by ? `By ${by}` : (STUDIO_TYPES.find((item) => item.type === visual.type)?.label ?? 'Chart'));
}

/** Whether the visual uses a field (any well). */
export function usesField(visual: StudioVisual, key: string) {
  if (!key) return visual.values.some((value) => value.aggregate === 'count' || !value.column);
  return visual.axis === key || visual.values.some((value) => value.column === key);
}

/** A field put in the visual where Power BI puts it: a number in the values (as a sum), text or a date on the axis. */
export function addField(visual: StudioVisual, field: StudioField, well?: 'axis' | 'values'): StudioVisual {
  const target = well ?? (hasAxis(visual.type) && field.kind !== 'number' ? 'axis' : 'values');
  if (target === 'axis' && hasAxis(visual.type) && field.key) {
    return { ...visual, axis: field.key, part: field.kind === 'date' ? 'month' : 'value' };
  }
  const value: SummaryMeasure = !field.key
    ? { column: '', aggregate: 'count' }
    : { column: field.key, aggregate: field.kind === 'number' ? 'sum' : !hasAxis(visual.type) ? 'distinct' : 'count_values' };
  return { ...visual, values: holdsManyValues(visual.type) ? [...visual.values, value] : [value] };
}

/** The field taken out of every well it's in. */
export function removeField(visual: StudioVisual, key: string): StudioVisual {
  return {
    ...visual,
    axis: key && visual.axis === key ? '' : visual.axis,
    values: visual.values.filter((value) => (key ? value.column !== key : !(value.aggregate === 'count' || !value.column))),
  };
}
