import { WorkbookFormulas } from '../formula/sheet-formulas';
import { makeSheet, qaQcColumns } from '../test-helpers';
import { chartPoints, dashboardOf, groupRows, kpiValue, reduceValues, summaryResult, suggestedDashboard } from './dashboard-model';

const zones = makeSheet(1, 'Zones', [
  { key: 'c1', name: 'Zone', type: 'text' },
  { key: 'c2', name: 'Plot', type: 'text' },
], [{ c1: 'A', c2: 'A1' }, { c1: 'A', c2: 'A2' }, { c1: 'B', c2: 'B1' }]);

const qc = makeSheet(
  2,
  'QA/QC Management',
  qaQcColumns(),
  [
    { c1: '2026-06-01', c2: 'A1', c9: '18' },
    { c1: '2026-06-20', c2: 'A2', c9: '20' },
    { c1: '2026-07-02', c2: 'A1', c9: '16' },
    { c2: 'B1' },
  ],
  'qa-qc-management',
);
const formulas = new WorkbookFormulas([zones, qc], '2026-11-03');

describe('reduceValues', () => {
  it('works a column out as Power BI cards do', () => {
    const values = [3, '4', '1,000', null, '', 'x'];
    expect(reduceValues(values, 'count')).toBe(6);
    expect(reduceValues(values, 'count_values')).toBe(4);
    expect(reduceValues(values, 'sum')).toBe(1007);
    expect(reduceValues(values, 'average')).toBeCloseTo(335.67, 2);
    expect(reduceValues(values, 'max')).toBe(1000);
    expect(reduceValues(['A', 'a ', 'B'], 'distinct')).toBe(2);
    expect(reduceValues([], 'average')).toBeNull();
  });
});

describe('the QA/QC suggested dashboard', () => {
  const board = suggestedDashboard(qc);

  it("finds the template's columns: live plants of stage 2, zones", () => {
    const live = board.kpis.find((kpi) => kpi.title.startsWith('Live plants (of 20)'))!;
    expect(live.column).toBe('c9');
    expect(live.goal).toBe(18);
    expect(kpiValue(formulas, qc, live)).toBe(18);
    const zonesChecked = board.kpis.find((kpi) => kpi.title === 'Zones checked')!;
    expect(kpiValue(formulas, qc, zonesChecked)).toBe(3);
    // Dead plant is a formula: 20 − live, summed.
    const dead = board.kpis.find((kpi) => kpi.title === 'Dead plants')!;
    expect(kpiValue(formulas, qc, dead)).toBe(6);
  });

  it('groups by zone with totals', () => {
    const result = summaryResult(formulas, qc, board.summaries[0])!;
    expect(result.rows.map((row) => row.label)).toEqual(['A1', 'A2', 'B1']);
    expect(result.rows[0].values.slice(0, 3)).toEqual([2, 17, 6]);
    expect(result.totals[0]).toBe(4);
  });

  it('keeps the same ids each time (it is made again on every change)', () => {
    expect(dashboardOf(qc).dashboard.kpis.map((kpi) => kpi.id)).toEqual(dashboardOf(qc).dashboard.kpis.map((kpi) => kpi.id));
  });
});

describe('charts', () => {
  it("groups a date column by month, in order, blanks last", () => {
    const groups = groupRows(formulas, qc, 'c1', 'month')!;
    expect(groups.map((group) => `${group.label}:${group.rows.length}`)).toEqual(['Jun 2026:2', 'Jul 2026:1', '(blank):1']);
    const points = chartPoints(formulas, qc, {
      id: 'x', title: '', column: 'c9', aggregate: 'sum', visual: 'line', groupBy: 'c1', groupPart: 'month',
      goal: null, higherIsBetter: true, decimals: null,
    });
    expect(points).toEqual([
      { label: 'Jun 2026', value: 38 },
      { label: 'Jul 2026', value: 16 },
      { label: '(blank)', value: 0 },
    ]);
  });

  it('suggests rows counted and numbers added up for a table of its own', () => {
    const own = makeSheet(3, 'Harvest log', [
      { key: 'c1', name: 'Date', type: 'date' },
      { key: 'c2', name: 'Picker', type: 'choice', options: ['Sok', 'Dara'] },
      { key: 'c3', name: 'Kg', type: 'number' },
    ], [{ c1: '2026-08-01', c2: 'Sok', c3: '12' }]);
    const board = suggestedDashboard(own);
    expect(board.kpis.map((kpi) => `${kpi.title}:${kpi.visual}`)).toEqual(['Rows:card', 'Kg:card', 'Kg by month:column', 'Kg by Picker:bar']);
    expect(board.summaries[0].title).toBe('By Picker');
  });
});
