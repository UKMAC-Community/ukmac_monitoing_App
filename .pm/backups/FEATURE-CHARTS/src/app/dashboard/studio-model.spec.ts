import type { Dashboard, KpiVisual } from '../core/models';
import { hasAxis, KPI_VISUALS } from './dashboard-model';
import { boardOf, STUDIO_TYPES, visualsOf, wellNames, type StudioType } from './studio-model';
import { VISUAL_PREVIEWS } from './viz-preview';

describe('the studio\'s visual types', () => {
  it('has every type the dashboard can draw, and the table, each with its words for the hover preview', () => {
    const studio = STUDIO_TYPES.map((item) => item.type);
    for (const visual of KPI_VISUALS) expect(studio).toContain(visual.value);
    expect(studio).toContain('table');
    expect(new Set(studio).size).toBe(studio.length);
    for (const type of studio) expect(VISUAL_PREVIEWS[type as StudioType]).toBeTruthy();
    for (const item of STUDIO_TYPES) expect(item.icon).toBeTruthy();
  });

  it('names the wells of each new type as its own words', () => {
    expect(wellNames('treemap')).toEqual({ axis: 'Group', values: 'Values' });
    expect(wellNames('funnel')).toEqual({ axis: 'Stage', values: 'Values' });
    expect(wellNames('radar')).toEqual({ axis: 'Category', values: 'Y-axis' });
    expect(wellNames('gauge')).toEqual({ axis: null, values: 'Value' });
    expect(wellNames('area')).toEqual({ axis: 'X-axis', values: 'Y-axis' });
  });

  it('gives a card and a gauge no axis, and every other chart one', () => {
    for (const type of ['card', 'gauge'] as const) expect(hasAxis(type)).toBe(false);
    for (const type of ['column', 'bar', 'line', 'area', 'waterfall', 'pie', 'donut', 'treemap', 'funnel', 'radar', 'table'] as const) {
      expect(hasAxis(type)).toBe(true);
    }
  });

  it('keeps a gauge, and the other new charts, as they were made when the board is saved and read back', () => {
    const kinds: KpiVisual[] = ['area', 'waterfall', 'treemap', 'funnel', 'radar', 'gauge'];
    const board: Dashboard = {
      kpis: kinds.map((visual, index) => ({
        id: `k${index}`,
        title: '',
        column: 'c2',
        aggregate: 'sum',
        visual,
        groupBy: visual === 'gauge' ? '' : 'c1',
        groupPart: 'value',
        goal: visual === 'gauge' ? 500 : null,
        higherIsBetter: true,
        decimals: null,
      })),
      summaries: [],
    };
    const visuals = visualsOf(board);
    expect(visuals.map((visual) => visual.type)).toEqual(kinds);
    expect(visuals.find((visual) => visual.type === 'gauge')).toMatchObject({ axis: '', goal: 500 });
    expect(boardOf(visuals)).toEqual(board);
  });
});
