import type { Column } from '@core/models';
import { WorkbookFormulas } from '@shared/formula/sheet-formulas';
import { makeSheet } from '@shared/testing/test-helpers';
import { chartPoints, filteredSheet, summaryResult, suggestedDashboard } from './dashboard-model';

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

// A log of plots as the farm's Google Sheet fills it: its Zone picks a plot, nothing to add up. (Irrigation: the farm's
// Fertigation, Fertilizer, Pruning, Pesticides and Fungicide show their rows only, see the end.)
const fungicideColumns: Column[] = [
  { key: 'c4', name: 'ID', type: 'number', auto: true },
  { key: 'c2', name: 'Zone', type: 'link', source: "'Zones'[Plot]" },
  { key: 'c5', name: 'Application', type: 'text' },
  { key: 'c1', name: 'Date', type: 'date' },
];
const fungicide = makeSheet(18, 'Fungicide', fungicideColumns, [
  { c4: '1', c2: 'A1', c5: '1st', c1: '2026-06-22' },
  { c4: '2', c2: 'A2', c5: '1st', c1: '2026-06-22' },
  { c4: '3', c2: 'B1', c5: '1st', c1: '2026-06-23' },
  { c4: '4', c2: 'A1', c5: '2nd', c1: '2026-07-03' },
], 'irrigation');

// The same with a quantity.
const fertigation = makeSheet(7, 'Fertigation', [...fungicideColumns, { key: 'c7', name: 'Quantity', type: 'number' }], [
  { c2: 'A1', c7: '2' },
  { c2: 'B1', c7: '5' },
  { c2: 'A2', c7: '3' },
], 'irrigation');

const book = new WorkbookFormulas([zones, fungicide, fertigation], '2026-11-18');
const zoneChart = (sheet: typeof fungicide) => suggestedDashboard(sheet).kpis.find((kpi) => kpi.visual === 'bar')!;

describe('A log of plots: its dashboard by zone number, not plot by plot', () => {
  it('counts the rows of each zone number, each in its zone colour', () => {
    const chart = zoneChart(fungicide);
    expect(chart.title).toBe('Rows by zone number');
    expect(chart.groupPart).toBe('zone');
    expect(chart.zoneColours).toBe(true);
    expect(chartPoints(book, fungicide, chart).map((point) => [point.label, point.value])).toEqual([['1', 3], ['2', 1]]);
  });

  it('adds a quantity up by zone number', () => {
    const chart = zoneChart(fertigation);
    expect(chart.title).toBe('Quantity by zone number');
    expect(chartPoints(book, fertigation, chart).map((point) => [point.label, point.value])).toEqual([['1', 5], ['2', 5]]);
  });

  it('has a summary by zone number', () => {
    const [summary, ...more] = suggestedDashboard(fertigation).summaries;
    expect(more).toEqual([]);
    expect(summary.title).toBe('By zone number');
    const result = summaryResult(book, fertigation, summary)!;
    expect(result.header).toBe('Zone number');
    expect(result.rows.map((line) => [line.label, ...line.values])).toEqual([['1', 2, 5], ['2', 1, 5]]);
  });

  it('a click on a zone number keeps its plots in the other visuals', () => {
    const chart = zoneChart(fungicide);
    const kept = filteredSheet(book, fungicide, { sheetId: 18, source: chart.id, column: chart.groupBy, part: 'zone', keys: ['1'], labels: ['1'], name: 'Zone number' });
    expect(kept.rows.map((row) => row.data['c2'])).toEqual(['A1', 'A2', 'A1']);
  });

  it('leaves a plot Zones does not have blank', () => {
    const odd = makeSheet(19, 'Pesticides', fungicideColumns, [{ c2: 'A1' }, { c2: 'Z9' }], 'irrigation');
    const points = chartPoints(new WorkbookFormulas([zones, odd], '2026-11-18'), odd, zoneChart(odd));
    expect(points.map((point) => point.label)).toEqual(['1', '(blank)']);
  });

  it('uses the table’s own Zone number column when it has one', () => {
    const own = makeSheet(20, 'Pruning', [...fungicideColumns, { key: 'c9', name: 'Zone number', type: 'formula', formula: "=LOOKUP('Zones'[Zone number],'Zones'[Plot],[Zone],\"\")" }], [{ c2: 'B1' }], 'irrigation');
    const chart = zoneChart(own);
    expect(chart.groupBy).toBe('c9');
    expect(chart.groupPart).toBe('value');
  });

  it('keeps a table without plots by its own pick-list', () => {
    const items = makeSheet(21, 'Tools', [{ key: 'c1', name: 'Kind', type: 'choice', options: ['hoe', 'rake'] }], [{ c1: 'hoe' }]);
    const chart = zoneChart(items);
    expect(chart.title).toBe('Rows by Kind');
    expect(chart.groupPart).toBe('value');
  });
});

describe('The farm’s raw-data logs', () => {
  it('Fertigation (the sheet\'s Fertilizer tab), Pruning and Pesticides (its Fungicide tab) have no cards, charts or summaries: their rows only', () => {
    for (const template of ['fertigation', 'pruning', 'pesticides']) {
      const log = makeSheet(30, template, [...fungicideColumns, { key: 'c7', name: 'Quantity', type: 'number' }], [{ c2: 'A1', c7: '2' }], template);
      expect(suggestedDashboard(log), template).toEqual({ kpis: [], summaries: [] });
    }
  });
});
