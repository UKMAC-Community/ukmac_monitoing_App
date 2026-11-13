import type { Column } from '../core/models';
import { WorkbookFormulas } from '../formula/sheet-formulas';
import columns from '../sheet/fixtures/zone-measurement-columns.json';
import { makeSheet } from '../test-helpers';
import { chartPoints, summaryResult, suggestedDashboard } from './dashboard-model';

// The Zone Measurement columns exactly as the template makes them (a Rust test fails if this copy drifts).
const measured = columns as Column[];
const key = (name: string) => measured.find((column) => column.name === name)!.key;

// The Zones table: each plot, and the zone number it belongs to.
const zones = makeSheet(1, 'Zones', [
  { key: 'c1', name: 'Zone', type: 'text' },
  { key: 'c2', name: 'Plot', type: 'text' },
  { key: 'c5', name: 'Zone number', type: 'number' },
], [
  { c1: 'A', c2: 'A1', c5: '1' },
  { c1: 'A', c2: 'A2', c5: '1' },
  { c1: 'B', c2: 'B1', c5: '2' },
]);

const row = (plot: string, area: string) => ({ [key('Zone plot')]: plot, [key('Area in plan')]: area, [key('Actual width')]: '10', [key('Actual length')]: '100' });
const sheet = makeSheet(6, 'Zone Measurement', measured, [row('A1', '1000'), row('A2', '1200'), row('B1', '1000')], 'zone-measurement');
const book = new WorkbookFormulas([zones, sheet], '2026-11-10');

describe('Zone Measurement: the dashboard by zone number', () => {
  it('adds the area up by zone number, not by plot', () => {
    const chart = suggestedDashboard(sheet).kpis.find((kpi) => kpi.visual !== 'card')!;
    expect(chart.title).toBe('Area in plan (m²) by zone number');
    expect(chart.visual).toBe('column');
    expect(chart.groupBy).toBe(key('Zone number'));
    expect(chartPoints(book, sheet, chart).map((point) => [point.label, point.value])).toEqual([['1', 2200], ['2', 1000]]);
  });

  it('has the same cards, and a summary by zone number', () => {
    const dashboard = suggestedDashboard(sheet);
    expect(dashboard.kpis.filter((kpi) => kpi.visual === 'card')).toHaveLength(4);
    const [summary, ...more] = dashboard.summaries;
    expect(more).toEqual([]);
    expect(summary.title).toBe('By zone number');
    const result = summaryResult(book, sheet, summary)!;
    expect(result.header).toBe('Zone number');
    expect(result.rows.map((line) => [line.label, ...line.values])).toEqual([['1', 2, 2200, 20, 200], ['2', 1, 1000, 10, 100]]);
  });

  it('still adds an older table without the Zone number column up by plot', () => {
    const older = makeSheet(7, 'Zone Measurement', measured.filter((column) => column.name !== 'Zone number'), [row('A1', '1000')], 'zone-measurement');
    const chart = suggestedDashboard(older).kpis.find((kpi) => kpi.visual !== 'card')!;
    expect(chart.title).toBe('Area in plan (m²) by zone plot');
  });
});
