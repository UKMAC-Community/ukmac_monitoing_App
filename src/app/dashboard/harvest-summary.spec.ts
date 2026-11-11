import { TestBed } from '@angular/core/testing';

import type { Cells, Column } from '../core/models';
import { WorkbookFormulas } from '../formula/sheet-formulas';
import harvestColumns from '../sheet/fixtures/harvest-columns.json';
import { makeSheet } from '../test-helpers';
import { chartPoints, chartSeries, RIPE_COLOR, summaryResult, suggestedDashboard, UNRIPE_COLOR } from './dashboard-model';
import { SheetDashboard } from './sheet-dashboard';

// The Harvest columns exactly as the template makes them (a Rust test fails if this copy drifts), without the ID.
const harvest = harvestColumns as Column[];
const hKey = (name: string) => harvest.find((column) => column.name === name)!.key;
// The two Zones columns the Harvest table reads its zone number from.
const zones: Column[] = [
  { key: 'z1', name: 'Plot', type: 'text', required: false },
  { key: 'z2', name: 'Zone number', type: 'text', required: false },
];
const zKey = (name: string) => zones.find((column) => column.name === name)!.key;

const zoneRows: Cells[] = [
  { [zKey('Plot')]: 'A-01', [zKey('Zone number')]: '1' },
  { [zKey('Plot')]: 'A-02', [zKey('Zone number')]: '1' },
  { [zKey('Plot')]: 'B-01', [zKey('Zone number')]: '2' },
];

function pick(plot: string, type: string, date: string, kg: number): Cells {
  return { [hKey('Zone plot')]: plot, [hKey('Chili type')]: type, [hKey('Date harvest')]: date, [hKey('Harvest yield')]: String(kg) };
}

describe('Harvest: its tables by date, and by zone number', () => {
  const zoneSheet = makeSheet(1, 'Zones', zones, zoneRows, 'zones');
  const sheet = makeSheet(
    2,
    'Harvest',
    harvest,
    [
      pick('A-01', 'ripe', '2026-07-02', 10),
      pick('A-02', 'unripe', '2026-07-02', 2.5),
      pick('B-01', 'ripe', '2026-07-02', 4),
      pick('A-01', 'unripe', '2026-07-01', 1),
      pick('Z-99', 'ripe', '2026-07-01', 3), // a plot Zones does not have: no zone number
    ],
    'harvest',
  );
  const book = new WorkbookFormulas([zoneSheet, sheet], '2026-11-10');
  const dashboard = suggestedDashboard(sheet);
  const [byDate, byZone] = dashboard.summaries;

  it('opens with the two tables, in place of By Zone plot', () => {
    expect(dashboard.summaries.map((table) => table.title)).toEqual(['By date', 'By zone number']);
    expect(byDate.groupBy).toBe(hKey('Date harvest'));
    expect(byZone.groupBy).toBe(hKey('Zone number'));
    expect(byZone.thenBy).toBeUndefined();
  });

  it('charts the yield of each zone number beside the yield of each day', () => {
    expect(dashboard.kpis.filter((kpi) => kpi.visual !== 'card').map((kpi) => kpi.title)).toEqual(['Harvest yield by day', 'Harvest yield by zone number (kg)']);
    const zoneChart = dashboard.kpis.find((kpi) => kpi.title === 'Harvest yield by zone number (kg)')!;
    expect(zoneChart.groupBy).toBe(hKey('Zone number'));
    // The ripe and the unripe kilos stacked in each zone number (together the harvest yield), the total of them a line over the stacks.
    expect(zoneChart.visual).toBe('stacked');
    expect(zoneChart.totalLine).toBe(true);
    const series = chartSeries(book, sheet, zoneChart);
    expect(series.map((one) => [one.label, one.points.map((point) => point.value)])).toEqual([['Ripe yield (kg)', [10, 4, 3]], ['Unripe yield (kg)', [3.5, 0, 0]]]);
    expect(series[0].points.map((point) => point.label)).toEqual(['1', '2', '(blank)']);
  });

  it('gives each day its plots written out, and the yield, the ripe and the unripe of them together', () => {
    const result = summaryResult(book, sheet, byDate)!;
    expect(result.header2).toBeUndefined();
    expect(result.columns).toEqual(['Zone plots', 'Total yield (kg)', 'Ripe (kg)', 'Unripe (kg)']);
    expect(result.rows.map((row) => [row.label, ...row.values])).toEqual([
      ['01/07/2026', 'A-01, Z-99', 4, 3, 1],
      ['02/07/2026', 'A-01, A-02, B-01', 16.5, 14, 2.5],
    ]);
    expect(result.totals).toEqual(['', 20.5, 17, 3.5]);
  });

  it('gives each zone number its plots and what they yielded over all the days, a plot with no zone number last', () => {
    const result = summaryResult(book, sheet, byZone)!;
    expect(result.header).toBe('Zone number');
    expect(result.header2).toBeUndefined();
    expect(result.rows.map((row) => [row.label, ...row.values])).toEqual([
      ['1', 'A-01, A-02', 13.5, 10, 3.5],
      ['2', 'B-01', 4, 4, 0],
      ['(blank)', 'Z-99', 3, 3, 0],
    ]);
    expect(result.totals).toEqual(['', 20.5, 17, 3.5]);
  });

  it('shows the plots in the page, one table at a time', () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };
    const fixture = TestBed.createComponent(SheetDashboard);
    fixture.componentRef.setInput('sheet', sheet);
    fixture.componentRef.setInput('formulas', book);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const heads = () => [...root.querySelectorAll('article.summary thead th')].map((th) => th.textContent?.trim());
    // One tile, one table at a time, with a switch between them.
    expect(root.querySelectorAll('article.summary').length).toBe(1);
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('article.summary .segmented .segment')];
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['By date', 'By zone number']);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(heads()).toEqual(['Date harvest', 'Zone plots', 'Total yield (kg)', 'Ripe (kg)', 'Unripe (kg)']);
    expect(root.querySelector('article.summary tbody tr td:nth-child(2)')?.textContent?.trim()).toBe('A-01, Z-99');
    buttons[1].click();
    fixture.detectChanges();
    expect(heads()).toEqual(['Zone number', 'Zone plots', 'Total yield (kg)', 'Ripe (kg)', 'Unripe (kg)']);
    expect(root.querySelectorAll('article.summary tbody tr').length).toBe(3);
  });

  it('draws the harvest yield by day as a timeline: every day on the way, the days with none empty', () => {
    const chart = dashboard.kpis.find((kpi) => kpi.title === 'Harvest yield by day')!;
    expect(chart.timeline).toBe(true);
    expect(chart.wide).toBe(true);
    const points = chartPoints(book, sheet, chart);
    expect(points.map((point) => [point.key, point.value, !!point.empty])).toEqual([
      ['2026-07-01', 4, false],
      ['2026-07-02', 16.5, false],
    ]);
    // Days 1, 2 and 5 only: the days between are there, empty.
    const gap = makeSheet(3, 'Harvest', harvest, [pick('A-01', 'ripe', '2026-07-01', 5), pick('A-01', 'ripe', '2026-07-02', 6), pick('A-01', 'ripe', '2026-07-05', 7)], 'harvest');
    const days = chartPoints(new WorkbookFormulas([zoneSheet, gap], '2026-11-10'), gap, chart);
    expect(days.map((point) => [point.key, point.value, !!point.empty])).toEqual([
      ['2026-07-01', 5, false],
      ['2026-07-02', 6, false],
      ['2026-07-03', 0, true],
      ['2026-07-04', 0, true],
      ['2026-07-05', 7, false],
    ]);
    // Only a timeline fills the days (the same chart without it shows the days it has).
    expect(chartPoints(new WorkbookFormulas([zoneSheet, gap], '2026-11-10'), gap, { ...chart, timeline: false }).length).toBe(3);
  });

  it('gives the day chart a switch: every day (the timeline), or only the days with a harvest', () => {
    const chart = dashboard.kpis.find((kpi) => kpi.title === 'Harvest yield by day')!;
    expect(chart.views!.map((view) => [view.label, view.timeline])).toEqual([['Every day', true], ['Harvest days', false]]);
    const gap = makeSheet(3, 'Harvest', harvest, [pick('A-01', 'ripe', '2026-07-01', 5), pick('A-01', 'ripe', '2026-07-05', 7)], 'harvest');
    const gapBook = new WorkbookFormulas([zoneSheet, gap], '2026-11-10');
    const fixture = TestBed.createComponent(SheetDashboard);
    fixture.componentRef.setInput('sheet', gap);
    fixture.componentRef.setInput('formulas', gapBook);
    fixture.componentRef.setInput('part', 'top');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const tile = () => [...el.querySelectorAll('article.tile')].find((t) => t.querySelector('h3')?.textContent?.trim() === 'Harvest yield by day')!;
    expect(tile().querySelector('.timeline')).toBeTruthy();
    expect(tile().textContent).toContain('03/07');
    ([...tile().querySelectorAll('.segmented button')][1] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(tile().querySelector('.timeline')).toBeNull();
    expect(tile().textContent).not.toContain('03/07');
    expect(tile().textContent).toContain('05/07/2026');
  });

  it('gives the zone number chart a line of its own with a box of its total beside it', () => {
    const chart = dashboard.kpis.find((kpi) => kpi.title === 'Harvest yield by zone number (kg)')!;
    expect(chart.wide).toBe(true);
    expect(chart.total).toBe('Total yield (kg)');
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };
    const fixture = TestBed.createComponent(SheetDashboard);
    fixture.componentRef.setInput('sheet', sheet);
    fixture.componentRef.setInput('formulas', book);
    fixture.detectChanges();
    const tiles = [...(fixture.nativeElement as HTMLElement).querySelectorAll('article.tile')];
    const tile = tiles.find((item) => item.querySelector('h3')?.textContent?.trim() === 'Harvest yield by zone number (kg)')!;
    expect(tile.classList).toContain('wide');
    expect(tile.querySelector('.total-name')?.textContent?.trim()).toBe('Total yield (kg)');
    expect(tile.querySelector('.total-box .big')?.textContent?.trim()).toBe('20.5');
    // The total is a ring of its ripe and unripe parts (red and green) with the number in its middle.
    const parts = [...tile.querySelectorAll('.total-box circle.ring-part')];
    expect(parts.map((part) => part.getAttribute('stroke'))).toEqual([RIPE_COLOR, UNRIPE_COLOR]);
    expect(tile.querySelectorAll('.total-box .ring-legend li').length).toBe(2);
    expect(tile.querySelectorAll('rect[fill="' + RIPE_COLOR + '"]').length).toBeGreaterThan(0);
    expect(tile.querySelectorAll('polyline.total-line').length).toBe(1);
    expect(tile.querySelectorAll('circle.total-line').length).toBe(3);
    expect(tile.querySelector('.series-legend')?.textContent).toContain('Total');
    const byDay = tiles.find((item) => item.querySelector('h3')?.textContent?.trim() === 'Harvest yield by day')!;
    expect(byDay.classList).toContain('wide');
    expect(byDay.querySelector('.total-box')).toBeNull();
    expect(byDay.querySelector('.day-scroll')).toBeTruthy();
  });
});
