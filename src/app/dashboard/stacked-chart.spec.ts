import { TestBed } from '@angular/core/testing';

import type { Cells, Column, Kpi } from '../core/models';
import progress from '../sheet/fixtures/nursery-columns.json';
import { makeSheet } from '../test-helpers';
import { WorkbookFormulas } from '../formula/sheet-formulas';
import { chartPoints, chartSeries, suggestedDashboard } from './dashboard-model';
import { KpiChart } from './kpi-chart';
import { boardOf, visualsOf } from './studio-model';

const columns = progress as Column[];
const key = (name: string) => columns.find((column) => column.name === name)!.key;

function rows(): Cells[] {
  const row = (batch: string, start: string, total: number, healthy: number, [stem, leaf, smaller, disease, damage]: number[]): Cells => ({
    [key('Batch number')]: batch,
    [key('Supply date start')]: start,
    [key('Total number')]: String(total),
    [key('Healthy number')]: String(healthy),
    [key('Stem rot')]: String(stem),
    [key('Leaf rot')]: String(leaf),
    [key('Smaller')]: String(smaller),
    [key('Disease')]: String(disease),
    [key('Physical damage')]: String(damage),
  });
  return [
    row('B1', '2026-07-05', 100, 80, [10, 2, 3, 4, 1]),
    row('B2', '2026-07-20', 50, 40, [5, 1, 0, 2, 2]),
    row('B3', '2026-08-02', 200, 124, [50, 5, 6, 7, 8]),
  ];
}

const PROBLEMS = ['Stem rot', 'Leaf rot', 'Smaller', 'Disease', 'Physical damage'];

describe('Nursery Progress: the charts by batch, switching to month', () => {
  const sheet = makeSheet(3, 'Nursery Progress', columns, rows(), 'nursery-batches');
  const formulas = new WorkbookFormulas([sheet], '2026-11-10');
  const card = (title: string) => suggestedDashboard(sheet).kpis.find((kpi) => kpi.title === title)!;
  /** The chart as one of its views groups it. */
  const viewed = (kpi: Kpi, index: number): Kpi => ({ ...kpi, groupBy: kpi.views![index].groupBy, groupPart: kpi.views![index].groupPart });

  it('shows only the unhealthy seedlings, each batch stacked by every problem', () => {
    const kpi = card('Unhealthy seedlings by batch');
    expect(kpi.visual).toBe('stacked');
    const series = chartSeries(formulas, sheet, kpi);
    // No healthy ones in it: just what was wrong.
    expect(series.map((item) => item.label)).toEqual(PROBLEMS);
    expect(series.map((item) => item.points.map((point) => [point.label, point.value]))).toEqual([
      [['B1', 10], ['B2', 5], ['B3', 50]],
      [['B1', 2], ['B2', 1], ['B3', 5]],
      [['B1', 3], ['B2', 0], ['B3', 6]],
      [['B1', 4], ['B2', 2], ['B3', 7]],
      [['B1', 1], ['B2', 2], ['B3', 8]],
    ]);
  });

  it('has a switch to month for the same chart, which adds each month\'s batches together', () => {
    const kpi = card('Unhealthy seedlings by batch');
    expect(kpi.views!.map((view) => [view.label, view.title])).toEqual([['Batch', 'Unhealthy seedlings by batch'], ['Month', 'Unhealthy seedlings by month']]);
    const series = chartSeries(formulas, sheet, viewed(kpi, 1));
    expect(series.map((item) => item.label)).toEqual(PROBLEMS);
    expect(series.map((item) => item.points.map((point) => [point.label, point.value]))).toEqual([
      [['Jul 2026', 15], ['Aug 2026', 50]],
      [['Jul 2026', 3], ['Aug 2026', 5]],
      [['Jul 2026', 3], ['Aug 2026', 6]],
      [['Jul 2026', 6], ['Aug 2026', 7]],
      [['Jul 2026', 3], ['Aug 2026', 8]],
    ]);
  });

  it('gives the seedlings chart the same switch: the total of each batch, or of each month', () => {
    const kpi = card('Seedlings by batch');
    expect(kpi.visual).toBe('column');
    expect(chartPoints(formulas, sheet, kpi).map((point) => [point.label, point.value])).toEqual([['B1', 100], ['B2', 50], ['B3', 200]]);
    expect(kpi.views!.map((view) => view.label)).toEqual(['Batch', 'Month']);
    expect(chartPoints(formulas, sheet, viewed(kpi, 1)).map((point) => [point.label, point.value])).toEqual([['Jul 2026', 150], ['Aug 2026', 200]]);
  });

  it('has no unhealthy chart for a table with none of the problem columns, and the seedlings chart by month alone for one with no batch', () => {
    const bare = makeSheet(4, 'Nursery Progress', columns.filter((column) => !PROBLEMS.includes(column.name) && column.name !== 'Batch number'), [], 'nursery-batches');
    const charts = suggestedDashboard(bare).kpis.filter((kpi) => kpi.visual !== 'card');
    expect(charts.map((kpi) => [kpi.title, kpi.visual, kpi.views])).toEqual([['Seedlings by month', 'column', undefined]]);
  });

  it('is kept through the dashboard editor with its switch, until the chart is grouped another way', () => {
    const kpi = card('Unhealthy seedlings by batch');
    const visual = visualsOf({ kpis: [kpi], summaries: [] })[0];
    expect(visual.values.length).toBe(5);
    const back = boardOf([visual]).kpis[0];
    expect(back.more).toEqual(kpi.more);
    expect(back.views).toEqual(kpi.views);
    // Grouped by hand by something else, the switch goes: it would no longer say what the chart is.
    expect(boardOf([{ ...visual, axis: key('Supply date start'), part: 'month' }]).kpis[0].views).toBeUndefined();
  });
});

describe('KpiChart: stacked columns', () => {
  beforeAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };
  });

  it('draws a rectangle per value of each group and names the values', () => {
    const fixture = TestBed.createComponent(KpiChart);
    const points = [{ label: 'Jul 2026', value: 135 }, { label: 'Aug 2026', value: 150 }];
    fixture.componentRef.setInput('points', points);
    fixture.componentRef.setInput('visual', 'stacked');
    fixture.componentRef.setInput('series', [
      { label: 'Healthy', points },
      { label: 'Unhealthy', points: [{ label: 'Jul 2026', value: 15 }, { label: 'Aug 2026', value: 50 }] },
    ]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('svg rect').length).toBe(4);
    expect(el.querySelector('.series-legend')?.textContent).toContain('Unhealthy');
  });
});
