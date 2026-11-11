import type { Column } from '../core/models';
import { WorkbookFormulas } from '../formula/sheet-formulas';
import columns from '../sheet/fixtures/zone-records-columns.json';
import { makeSheet } from '../test-helpers';
import { chartPoints, suggestedDashboard } from './dashboard-model';

// The Plant Progress columns exactly as the template makes them (a Rust test fails if this copy drifts).
const records = columns as Column[];
const key = (name: string) => records.find((column) => column.name === name)!.key;

function row(day: string, plants: string, dead = '') {
  return { [key('Day number')]: day, [key('Plant count')]: plants, [key('Dead plant')]: dead, [key('Record date')]: '2026-07-11' };
}

describe('Plant Progress: the chart of the plant count by day number', () => {
  const sheet = makeSheet(4, 'Plant Progress', records, [row('D10', '1909'), row('D2', '1600'), row('D1', '1814'), row('D2', '100')], 'zone-records');
  const book = new WorkbookFormulas([sheet], '2026-11-10');

  it('is a line chart of the plant count, one point for each day number, in day order', () => {
    const chart = suggestedDashboard(sheet).kpis.find((kpi) => kpi.title === 'Plant count by day number')!;
    expect(chart.visual).toBe('line');
    expect(chart.aggregate).toBe('sum');
    expect(chart.column).toBe(key('Plant count'));
    expect(chart.groupBy).toBe(key('Day number'));
    // D2 comes before D10, not after it, and a day with two records adds them up.
    expect(chartPoints(book, sheet, chart).map((point) => [point.label, point.value])).toEqual([
      ['D1', 1814],
      ['D2', 1700],
      ['D10', 1909],
    ]);
  });

  it('switches to the plant count by month of the record date', () => {
    const chart = suggestedDashboard(sheet).kpis.find((kpi) => kpi.title === 'Plant count by day number')!;
    expect(chart.views?.map((view) => view.label)).toEqual(['Day', 'Month']);
    const month = chart.views![1];
    expect(month.groupBy).toBe(key('Record date'));
    expect(month.groupPart).toBe('month');
    expect(month.title).toBe('Plant count by month');
    expect(chartPoints(book, sheet, { ...chart, groupBy: month.groupBy, groupPart: month.groupPart }).map((point) => point.value)).toEqual([1814 + 1700 + 1909]);
  });

  it('takes the place of the dead plants by month', () => {
    const titles = suggestedDashboard(sheet).kpis.map((kpi) => kpi.title);
    expect(titles).toContain('Plant count by day number');
    expect(titles).not.toContain('Dead plants by month');
  });

  it('keeps the dead plants by month for a table with no Day number column', () => {
    const older = makeSheet(5, 'Plant Progress', records.filter((column) => column.name !== 'Day number'), [row('', '10', '1')], 'zone-records');
    const titles = suggestedDashboard(older).kpis.map((kpi) => kpi.title);
    expect(titles).toContain('Dead plants by month');
    expect(titles).not.toContain('Plant count by day number');
  });
});
