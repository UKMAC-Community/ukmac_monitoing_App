import type { Column } from '../core/models';
import { WorkbookFormulas } from '../formula/sheet-formulas';
import columns from '../sheet/fixtures/zone-records-columns.json';
import { makeSheet } from '../test-helpers';
import { chartPoints, summaryResult, suggestedDashboard } from './dashboard-model';

// The Zone Records columns exactly as the template makes them (a Rust test fails if this copy drifts).
const records = columns as Column[];
const key = (name: string) => records.find((column) => column.name === name)!.key;

// The Zones table: each plot, and the zone number it belongs to.
const zones = makeSheet(1, 'Zones', [
  { key: 'c1', name: 'Zone', type: 'text' },
  { key: 'c2', name: 'Plot', type: 'text' },
  { key: 'c5', name: 'Zone number', type: 'number' },
], [
  { c1: 'A', c2: 'A1', c5: '1' },
  { c1: 'A', c2: 'A2', c5: '1' },
  { c1: 'B', c2: 'B1', c5: '2' },
  { c1: 'B', c2: 'B9', c5: '4' },
  { c1: 'Pond', c2: 'P1' },
]);

function row(plot: string, plants: string, replanted: string, dead: string) {
  return { [key('Zone plot')]: plot, [key('Record date')]: '2026-07-11', [key('Plant count')]: plants, [key('Replant count')]: replanted, [key('Dead plant')]: dead };
}

const sheet = makeSheet(4, 'Plant Progress', records, [row('A1', '1000', '10', '20'), row('A2', '500', '5', '1'), row('B1', '300', '3', '2'), row('B9', '200', '1', '0'), row('P1', '40', '', '')], 'zone-records');
const book = new WorkbookFormulas([zones, sheet], '2026-11-10');

describe('Plant Progress: the summary by zone number', () => {
  it('reads each record\'s zone number from its plot, never typed', () => {
    const number = records.find((column) => column.name === 'Zone number')!;
    expect(number.type).toBe('formula');
    expect([0, 1, 2, 3, 4].map((index) => String(book.value(sheet, sheet.rows[index], number) ?? ''))).toEqual(['1', '1', '2', '4', '']);
  });

  it('adds the records up by zone number, in number order, not by plot', () => {
    const [summary, ...more] = suggestedDashboard(sheet).summaries;
    expect(more).toEqual([]);
    expect(summary.title).toBe('By zone number');
    const result = summaryResult(book, sheet, summary)!;
    expect(result.header).toBe('Zone number');
    expect(result.columns).toEqual(['Records', 'Plants', 'Replanted', 'Dead']);
    expect(result.rows.map((line) => [line.label, ...line.values])).toEqual([
      ['1', 2, 1500, 15, 21],
      ['2', 1, 300, 3, 2],
      ['4', 1, 200, 1, 0],
      ['(blank)', 1, 40, 0, 0],
    ]);
    // Every record is in some group: the totals are the whole table's.
    expect(result.totals).toEqual([5, 2040, 19, 23]);
  });

  it('still adds an older table without the Zone number column up by plot', () => {
    const older = makeSheet(5, 'Plant Progress', records.filter((column) => column.name !== 'Zone number'), [row('A1', '1000', '10', '20')], 'zone-records');
    const [summary] = suggestedDashboard(older).summaries;
    expect(summary.title).toBe('By zone plot');
    expect(summaryResult(new WorkbookFormulas([zones, older], '2026-11-10'), older, summary)!.header).toBe('Zone plot');
  });
});

describe('Plant Progress: the Plants chart', () => {
  it('adds the plants up by zone number, like the summary', () => {
    const chart = suggestedDashboard(sheet).kpis.find((kpi) => kpi.title === 'Plants by zone number')!;
    expect(chart.groupBy).toBe(key('Zone number'));
    const points = chartPoints(book, sheet, chart);
    expect(points.map((point) => [point.label, point.value])).toEqual([['1', 1500], ['2', 300], ['4', 200], ['(blank)', 40]]);
  });
});

describe('Plant Progress: the Plants chart as a pie with a Pie | Column switch', () => {
  it('opens as a pie, in the zones\' colours, and switches to columns', () => {
    const chart = suggestedDashboard(sheet).kpis.find((kpi) => kpi.title === 'Plants by zone number')!;
    expect(chart.visual).toBe('pie');
    expect(chart.zoneColours).toBe(true);
    expect(chart.views?.map((view) => [view.label, view.visual])).toEqual([['Pie', 'pie'], ['Column', 'column']]);
    // Both show the same zone numbers.
    expect(new Set(chart.views!.map((view) => view.groupBy))).toEqual(new Set([key('Zone number')]));
  });

  it('keeps an older table without a Zone number column as columns by plot, with no switch', () => {
    const older = makeSheet(5, 'Plant Progress', records.filter((column) => column.name !== 'Zone number'), [row('A1', '1000', '10', '20')], 'zone-records');
    const chart = suggestedDashboard(older).kpis.find((kpi) => kpi.title === 'Plants by zone plot')!;
    expect(chart.visual).toBe('column');
    expect(chart.views).toBeUndefined();
  });
});
