import type { Cells, Column } from '../core/models';
import { makeSheet } from '../test-helpers';
import { buildZoneLayout, filterLayout, formatOutline, plotShapes, plotShowOptions, showsPlot } from './zone-layout';

const columns: Column[] = ['Zone', 'Plot', 'Zone number', 'Row', 'Column', 'Plot status', 'Status name', 'Outline'].map((name, index) => ({
  key: `c${index + 1}`,
  name,
  type: name === 'Zone number' || name === 'Row' || name === 'Column' ? 'number' : 'text',
}));
const outline = (lat: number) => formatOutline([[lat, 1], [lat, 2], [lat + 1, 2]]);
const row = (zone: string, plot: string, number: string, rowNo: number, column: number, status: string, name = '', lat = 0): Cells => ({
  c1: zone, c2: plot, c3: number, c4: String(rowNo), c5: String(column), c6: status, c7: name, c8: outline(lat),
});

const layout = buildZoneLayout(
  makeSheet(1, 'Zones', columns, [
    row('A', 'A1', '1', 1, 1, 'Active', '', 1),
    row('A', 'A2', '1', 1, 2, 'Active', '', 2),
    row('B', 'B1', '2', 1, 1, 'Active', '', 3),
    row('Old chili', 'O1', '', 1, 1, 'Active', '', 6),
    row('Forest', '', '', 1, 1, 'Unused', 'Forest', 4),
    row('Pond', '', '', 1, 1, 'Water', 'Pond', 5),
  ], 'zones'),
  null,
);
const plots = (cells: { plot: string; label: string }[]) => cells.map((cell) => cell.plot || cell.label);

describe('the Zone Map filter: All | Zones | Other', () => {
  it('shows every plot for All, and the same layout (nothing rebuilt)', () => {
    expect(filterLayout(layout, 'all')).toBe(layout);
    expect(layout.cells.length).toBe(6);
  });

  it('shows the zones, the plots in use that have a zone number, for Zones', () => {
    const zones = filterLayout(layout, 'zones');
    expect(plots(zones.cells)).toEqual(['A1', 'A2', 'B1']);
    expect(zones.areas.map((area) => area.zone)).toEqual(['A', 'B']);
    expect(zones.areas.flatMap((area) => area.sections.flatMap((section) => section.cells)).length).toBe(3);
  });

  it('shows what is not a zone: a plot with no zone number, water and not in use, for Other', () => {
    const other = filterLayout(layout, 'other');
    expect(plots(other.cells).sort()).toEqual(['Forest', 'O1', 'Pond']);
    expect(other.areas.map((area) => area.zone).sort()).toEqual(['Forest', 'Old chili', 'Pond']);
    expect(layout.cells.filter((cell) => showsPlot(cell, 'other')).length + layout.cells.filter((cell) => showsPlot(cell, 'zones')).length).toBe(layout.cells.length);
  });

  it('draws only the plots shown on the map, and leaves the plots where they were', () => {
    expect(plotShapes(filterLayout(layout, 'zones')).map((shape) => shape.label)).toEqual(['A1', 'A2', 'B1']);
    expect(plotShapes(filterLayout(layout, 'other')).map((shape) => shape.label).sort()).toEqual(['Forest', 'O1', 'Pond']);
    // Each kept plot keeps its own place on the map.
    const all = new Map(plotShapes(layout).map((shape) => [shape.id, shape.points]));
    for (const shape of plotShapes(filterLayout(layout, 'zones'))) expect(shape.points).toEqual(all.get(shape.id));
  });

  it('names the three choices with how many plots each shows, for a page\'s switch', () => {
    const options = plotShowOptions(layout);
    expect(options.map((option) => [option.value, option.label, option.count])).toEqual([['all', 'All', 6], ['zones', 'Zones', 3], ['other', 'Other', 3]]);
    // The counts are what the filter then shows.
    for (const option of options) expect(filterLayout(layout, option.value).cells.length).toBe(option.count);
  });
});
