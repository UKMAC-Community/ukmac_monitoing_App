import type { Cells, Column } from '../core/models';
import { makeSheet } from '../test-helpers';
import { formOf, formProblem, newPlotCells, newPlotForm, newPlotProblem, outlineChanges, suggestPlotCode, placeTakenBy, plotChanges, ReshapeHistory, statusNameOf } from './zone-edit';
import { buildZoneLayout, formatOutline, moveOutline, parseOutline } from './zone-layout';

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
