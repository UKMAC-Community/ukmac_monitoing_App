import type { Cells, Column } from '@core/models';
import { makeSheet } from '@shared/testing/test-helpers';
import { formOf, formProblem, newPlotCells, newPlotForm, newPlotProblem, newShapeForm, nearestCell, outlineChanges, startOutline, suggestPlotCode, placeTakenBy, plotChanges, ReshapeHistory, statusNameOf } from './zone-edit';
import { buildZoneLayout, formatOutline, moveOutline, parseOutline } from '@shared/map/zone-layout';

const columns: Column[] = ['Zone', 'Plot', 'Plant capacity', 'Note', 'Zone number', 'Row', 'Column', 'Plot status', 'Status name', 'Outline'].map((name, index) => ({
  key: `c${index + 1}`,
  name,
  type: 'text' as const,
}));
// A real plot of Pursat: eight corners.
const RING = '10.1377071,100.0955417;10.1377251,100.0955232;10.1377238,100.0951356;10.1376694,100.0950806;10.1368873,100.0950833;10.1368332,100.0951386;10.1368344,100.0955262;10.1368526,100.0955445';
const rows: Cells[] = [
  { c1: 'A', c2: 'A61', c4: 'Dai Neang chili zone', c5: '9', c6: '1', c7: '1', c8: 'Active', c10: RING },
  { c1: 'A', c2: 'A62', c5: '9', c6: '1', c7: '2', c8: 'Active' },
  { c1: 'B', c2: 'Pond', c5: '', c6: '1', c7: '1', c8: 'Water', c9: 'Pond' },
];
const sheet = makeSheet(1, 'Zones', columns, rows, 'zones');
const layout = buildZoneLayout(sheet, null);
const first = layout.cells[0];

describe('the outline as the Zones table keeps it', () => {
  it('reads and writes a real eight-corner plot back to the same text', () => {
    expect(parseOutline(RING).length).toBe(8);
    expect(formatOutline(parseOutline(RING))).toBe(RING);
  });
  it('moves a plot whole', () => {
    const moved = moveOutline(parseOutline(RING), 0.0001, -0.0002);
    expect(moved[0][0]).toBeCloseTo(10.1378071, 7);
    expect(moved[0][1]).toBeCloseTo(100.0953417, 7);
    expect(moved.length).toBe(8);
  });
});

describe('editing a plot', () => {
  it('writes only what changed, to the columns by name', () => {
    const form = { ...formOf(first, statusNameOf(sheet, Number(first.id))), note: 'Moved', capacity: '300' };
    expect(plotChanges(sheet, Number(first.id), form)).toEqual([
      { rowId: Number(first.id), key: 'c3', value: '300' },
      { rowId: Number(first.id), key: 'c4', value: 'Moved' },
    ]);
  });
  it('writes the words the table already uses for a plot\'s use, and clears the name of one in use', () => {
    const base = formOf(first, '');
    const changes = plotChanges(sheet, Number(first.id), { ...base, usage: 'unused', statusName: 'Forest' });
    expect(changes).toContainEqual({ rowId: Number(first.id), key: 'c8', value: 'Unused' });
    expect(changes).toContainEqual({ rowId: Number(first.id), key: 'c9', value: 'Forest' });
    const back = plotChanges(sheet, Number(layout.cells[2].id), { ...formOf(layout.cells[2], 'Pond'), usage: 'normal' });
    expect(back).toContainEqual({ rowId: Number(layout.cells[2].id), key: 'c8', value: 'Active' });
    expect(back).toContainEqual({ rowId: Number(layout.cells[2].id), key: 'c9', value: null });
  });
  it('turns a cleared box into an empty cell', () => {
    expect(plotChanges(sheet, Number(first.id), { ...formOf(first, ''), note: '' })).toEqual([{ rowId: Number(first.id), key: 'c4', value: null }]);
  });
  it('says what is wrong before saving', () => {
    const ok = formOf(first, '');
    expect(formProblem(ok)).toBeNull();
    expect(formProblem({ ...ok, row: '0' })).toContain('Row');
    expect(formProblem({ ...ok, column: 'x' })).toContain('Column');
    expect(formProblem({ ...ok, zone: ' ' })).toContain('zone');
  });
  it('names the plot already at a place', () => {
    expect(placeTakenBy(layout.cells, first, { ...formOf(first, ''), column: '2' })).toBe('A62');
    expect(placeTakenBy(layout.cells, first, { ...formOf(first, ''), column: '9' })).toBeNull();
    expect(placeTakenBy(layout.cells, first, formOf(first, ''))).toBeNull(); // its own place
  });
});

describe('reshaping several plots, then saving', () => {
  it('keeps every plot\'s newest outline and only the changed ones are written', () => {
    const history = new ReshapeHistory();
    const moved = moveOutline(parseOutline(RING), 0.0001, 0);
    history.push(first.id, moved);
    history.push(first.id, parseOutline(RING)); // dragged back to where it was
    expect(outlineChanges(sheet, history.now)).toEqual([]);
    history.push(first.id, moved);
    expect(outlineChanges(sheet, history.now)).toEqual([{ rowId: Number(first.id), key: 'c10', value: formatOutline(moved) }]);
  });
  it('undoes and redoes', () => {
    const history = new ReshapeHistory();
    expect(history.canUndo || history.canRedo || history.changed).toBe(false);
    history.push('1', [[1, 2]]);
    history.push('2', [[3, 4]]);
    history.undo();
    expect(Object.keys(history.now)).toEqual(['1']);
    expect(history.canRedo).toBe(true);
    history.push('3', [[5, 6]]); // a new change drops the redo
    expect(history.canRedo).toBe(false);
    expect(Object.keys(history.now)).toEqual(['1', '3']);
    history.undo();
    history.undo();
    expect(history.changed).toBe(false);
  });
});

describe('a new plot drawn on the map', () => {
  const corners: [number, number][] = [[10.1, 100.1], [10.1, 100.2], [10.2, 100.2]];

  it('suggests the next code of the zone, by the letters its plots use', () => {
    expect(suggestPlotCode(layout.cells, 'A')).toBe('A63');
    expect(suggestPlotCode(layout.cells, 'Z')).toBe('');
  });
  it('starts beside the picked plot: its zone, its zone number, the next column of its row', () => {
    const form = newPlotForm(layout.cells, first);
    expect(form).toMatchObject({ plot: 'A63', zone: 'A', section: '9', row: '1', column: '3', usage: 'normal' });
  });
  it('wants a code that is not a plot already', () => {
    const form = newPlotForm(layout.cells, first);
    expect(newPlotProblem(form, layout.cells)).toBeNull();
    expect(newPlotProblem({ ...form, plot: 'a61' }, layout.cells)).toContain('already a plot');
    expect(newPlotProblem({ ...form, plot: '' }, layout.cells)).toContain('code');
  });
  it('makes the Zones row by column name, with the corners in Outline', () => {
    const form = { ...newPlotForm(layout.cells, first), capacity: '120' };
    const row = newPlotCells(sheet, form, corners)!;
    expect(row['c1']).toBe('A');
    expect(row['c2']).toBe('A63');
    expect(row['c3']).toBe('120');
    expect(row['c8']).toBe('Active');
    expect(row['c10']).toBe('10.1000000,100.1000000;10.1000000,100.2000000;10.2000000,100.2000000');
    expect(row['c9']).toBeUndefined();
  });
});

describe('a plot, a greenhouse or another area dragged onto the map', () => {
  const at: [number, number] = [10.137, 100.0953];

  it('starts as a rectangle on the ground, centred where it was dropped, as big as each kind usually is', () => {
    const size = (kind: 'plot' | 'greenhouse' | 'other') => {
      const ring = startOutline(kind, at, []);
      const k = Math.cos((at[0] * Math.PI) / 180);
      const sides = ring.map((point, i) => {
        const next = ring[(i + 1) % 4];
        return Math.hypot((next[1] - point[1]) * k * 111_320, (next[0] - point[0]) * 110_574);
      });
      return { ring, sides: sides.map((side) => Math.round(side)) };
    };
    expect(size('plot').sides).toEqual([50, 20, 50, 20]);
    expect(size('greenhouse').sides).toEqual([30, 12, 30, 12]);
    expect(size('other').sides).toEqual([20, 20, 20, 20]);
    const mid = size('plot').ring.reduce((sum, p) => [sum[0] + p[0] / 4, sum[1] + p[1] / 4], [0, 0]);
    expect(mid[0]).toBeCloseTo(at[0], 6);
    expect(mid[1]).toBeCloseTo(at[1], 6);
  });

  it('lies the way the nearest plot lies, so it sits square with the farm', () => {
    const ring = startOutline('plot', [10.1373, 100.0953], layout.cells);
    // The plot there runs north to south (its long edges), so the new one's long side does too.
    const [a, b] = [ring[0], ring[1]];
    expect(Math.abs(b[0] - a[0])).toBeGreaterThan(Math.abs(b[1] - a[1]));
  });

  it('follows on from the nearest plot for a plot, and is named in its own zone for a greenhouse or another area', () => {
    expect(nearestCell([10.1373, 100.0953], layout.cells)?.plot).toBe('A61');
    expect(newShapeForm('plot', [10.1373, 100.0953], layout.cells).zone).toBe('A');
    const greenhouse = newShapeForm('greenhouse', at, layout.cells);
    // As the farm's own are kept: zone Greenhouse, plot "Greenhouse 1", status Unused.
    expect([greenhouse.usage, greenhouse.zone, greenhouse.statusName, greenhouse.plot]).toEqual(['unused', 'Greenhouse', 'Greenhouse', 'Greenhouse 1']);
    const other = newShapeForm('other', at, layout.cells);
    expect([other.usage, other.zone, other.statusName]).toEqual(['unused', 'Other', '']);
  });

  it('needs a plot and a greenhouse a code, and another area a name', () => {
    // A plot's code is suggested; without one, it can't be saved.
    expect(newPlotProblem(newShapeForm('plot', at, layout.cells), layout.cells)).toBeNull();
    expect(newPlotProblem({ ...newShapeForm('plot', at, layout.cells), plot: '' }, layout.cells)).toContain('code');
    expect(newPlotProblem(newShapeForm('other', at, layout.cells), layout.cells)).toContain('name');
    expect(newPlotProblem(newShapeForm('greenhouse', at, layout.cells), layout.cells)).toBeNull();
    expect(newPlotProblem({ ...newShapeForm('greenhouse', at, layout.cells), plot: '' }, layout.cells)).toContain('code');
  });

  it('saves a greenhouse into the Zones table as the farm keeps them, with its shape, and reads it back as a greenhouse', () => {
    const form = newShapeForm('greenhouse', at, layout.cells);
    const cells = newPlotCells(sheet, form, startOutline('greenhouse', at, layout.cells))!;
    expect(cells['c8']).toBe('Unused');
    expect(cells['c2']).toBe('Greenhouse 1');
    expect(cells['c1']).toBe('Greenhouse');
    expect(String(cells['c10']).split(';').length).toBe(4);
    const drawn = buildZoneLayout(makeSheet(2, 'Zones', columns, [cells], 'zones'), null).cells[0];
    expect([drawn.usage, drawn.label]).toEqual(['greenhouse', 'Greenhouse 1']);
    // The next greenhouse is numbered on from those there.
    const next = newShapeForm('greenhouse', at, [drawn, ...layout.cells]);
    expect([next.plot, next.column]).toEqual(['Greenhouse 2', '2']);
  });
});
