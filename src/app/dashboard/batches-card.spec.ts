import type { Column } from '../core/models';
import { WorkbookFormulas } from '../formula/sheet-formulas';
import columns from '../sheet/fixtures/batches-columns.json';
import { makeSheet } from '../test-helpers';
import { chartPoints, kpiValue, suggestedDashboard } from './dashboard-model';

const batches = columns as Column[];
const sheet = makeSheet(
  5,
  'Batches',
  batches,
  [
    { c1: 'B1', c2: 'RED SKY 88' },
    { c1: 'B2', c2: 'RED SKY 88' },
    { c1: 'B3', c2: 'Mali' },
    { c1: 'B3', c2: 'Mali' },
  ],
  'batches',
);
const book = new WorkbookFormulas([sheet], '2026-11-10');

describe('Batches: the dashboard', () => {
  const board = suggestedDashboard(sheet);

  it('counts the batches and the varieties instead of one "Rows" card', () => {
    const cards = board.kpis.filter((kpi) => kpi.visual === 'card');
    expect(cards.map((kpi) => kpi.title)).toEqual(['Batches', 'Varieties']);
    expect(cards.map((kpi) => kpiValue(book, sheet, kpi))).toEqual([3, 2]);
  });

  it('shows how many batches each variety has, by its name', () => {
    const chart = board.kpis.find((kpi) => kpi.visual !== 'card')!;
    expect(chartPoints(book, sheet, chart).map((point) => [point.label, point.value])).toEqual([
      ['Mali', 2],
      ['RED SKY 88', 2],
    ]);
    // The chart alone: no "By variety" table under it repeating the same counts.
    expect(board.summaries).toEqual([]);
  });
});
