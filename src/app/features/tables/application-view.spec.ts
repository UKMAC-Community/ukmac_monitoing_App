import type { Cells, Column } from '@core/models';
import { makeSheet } from '@shared/testing/test-helpers';
import { applicationLayout, applicationPivot, gapsOf, isGap, withGaps, withoutColumns } from './application-view';

const columns: Column[] = [
  { key: 'c4', name: 'ID', type: 'number', auto: true },
  { key: 'c2', name: 'Zone', type: 'link', aliases: ['Zone plot', 'zone_plot'] },
  { key: 'c5', name: 'Application', type: 'text', aliases: ['Application round', 'application_round'] },
  { key: 'c6', name: 'Disease', type: 'text' },
  { key: 'c1', name: 'Date', type: 'date' },
  { key: 'c7', name: 'Chemical', type: 'text' },
  { key: 'c8', name: 'Dose', type: 'text' },
];
const row = (id: string, zone: string, application: string, disease = '', date = '', chemical = '', dose = ''): Cells => ({ c4: id, c2: zone, c5: application, c6: disease, c1: date, c7: chemical, c8: dose });
const sheet = makeSheet(18, 'Fungicide', columns, [
  row('1', 'A1', '1st Application', 'Anthracnose', '2026-06-22', 'Mancozeb', '2 g/L'),
  row('2', 'A1', '10th Application', 'Anthracnose', '2026-09-20', 'Azoxystrobin', '1 ml/L'),
  row('3', 'A1', '2nd Application', 'Powdery Mildew', '2026-07-03', 'Copper hydroxide', '1.8 g/L'),
  row('4', 'A2', '1st Application'),
  row('5', 'A2', '2nd Application', 'Anthracnose', '2026-06-24', 'Mancozeb', '2 g/L'),
], 'pesticides');

describe('the by-application view', () => {
  it('is for a table with a plot and an application column, telling what was done under each (not the ID)', () => {
    const layout = applicationLayout(sheet)!;
    expect(layout.plot.name).toBe('Zone');
    expect(layout.application.name).toBe('Application');
    expect(layout.fields.map((field) => field.name)).toEqual(['Disease', 'Date', 'Chemical', 'Dose']);
    expect(applicationLayout(makeSheet(1, 'Pruning', [columns[1], columns[4]], [], 'pruning'))).toBeNull();
  });

  it('is on a table whose application column has the sheet\'s own name', () => {
    const own = makeSheet(2, 'Fertilizer', [{ key: 'c1', name: 'Zone', type: 'link' }, { key: 'c2', name: 'application_round', type: 'text' }, { key: 'c3', name: 'quantity', type: 'number' }], [], 'fertigation');
    expect(applicationLayout(own)?.application.name).toBe('application_round');
  });

  it('is on Pruning, its rounds (Round name) as the applications, the round number left out', () => {
    const pruning = makeSheet(8, 'Pruning', [
      { key: 'c4', name: 'ID', type: 'number', auto: true },
      { key: 'c5', name: 'Plan', type: 'number' },
      { key: 'c2', name: 'Zone', type: 'link', aliases: ['Zone plot', 'zone_plot'] },
      { key: 'c6', name: 'Round', type: 'number', aliases: ['Pruning round', 'pruning_round', 'pruning_round_type_id'] },
      { key: 'c7', name: 'Round name', type: 'text', aliases: ['round_name'] },
      { key: 'c8', name: 'Plants', type: 'number' },
      { key: 'c11', name: 'Date', type: 'date' },
    ], [
      { c4: '1', c5: '1', c2: 'A1', c6: '2', c7: '2nd Pruning', c8: '1587', c11: '2026-08-06' },
      { c4: '2', c5: '1', c2: 'A1', c6: '1', c7: '1st Pruning', c8: '1555', c11: '2026-07-08' },
    ], 'pruning');
    const layout = applicationLayout(pruning)!;
    expect(layout.application.name).toBe('Round name');
    expect(layout.fields.map((field) => field.name)).toEqual(['Plan', 'Plants', 'Date']);
    expect(applicationPivot(pruning, pruning.rows)!.rounds).toEqual(['1st Pruning', '2nd Pruning']);
  });

  it('makes a line for each plot and a column for each application, 1st, 2nd … 10th in order', () => {
    const pivot = applicationPivot(sheet, sheet.rows)!;
    expect(pivot.rounds).toEqual(['1st Application', '2nd Application', '10th Application']);
    expect(pivot.lines.map((line) => line.plot)).toEqual(['A1', 'A2']);
    const first = pivot.lines[0].done.get('1st Application')!;
    expect(first).toEqual({ c6: 'Anthracnose', c1: '22/06/2026', c7: 'Mancozeb', c8: '2 g/L' });
    // A2's 1st application was never done: its fields are blank, but it is there.
    expect(pivot.lines[1].done.get('1st Application')).toEqual({ c6: '', c1: '', c7: '', c8: '' });
    // And a plot with no 10th has nothing under it.
    expect(pivot.lines[1].done.has('10th Application')).toBe(false);
  });

  it('shows only the rows it is given (a search keeps some plots)', () => {
    const pivot = applicationPivot(sheet, sheet.rows.filter((r) => r.data['c2'] === 'A2'))!;
    expect(pivot.lines.map((line) => line.plot)).toEqual(['A2']);
    expect(pivot.rounds).toEqual(['1st Application', '2nd Application']);
  });

  it('with Missing data on, keeps only the plots missing something, each with all its applications', () => {
    const rows = [
      ...sheet.rows,
      { ...sheet.rows[0], rowId: 99, data: row('6', 'A3', '1st Application', 'Anthracnose', '2026-06-22', 'Mancozeb', '2 g/L') },
    ];
    // The columns the Data Check finds a gap in (the ID is never one).
    const gaps = new Map([['c6', 1], ['c1', 1], ['c7', 1], ['c8', 1]]);
    const pivot = applicationPivot(sheet, rows)!;
    const missing = withGaps(pivot, gaps);
    // A2's 1st application has nothing entered: A2 is kept, with its 2nd (all filled) beside it; A1 and A3 are complete.
    expect(missing.lines.map((line) => line.plot)).toEqual(['A2']);
    expect([...missing.lines[0].done.keys()]).toEqual(['1st Application', '2nd Application']);
    // The applications along the top stay as they were.
    expect(missing.rounds).toEqual(pivot.rounds);
    const a2 = missing.lines[0];
    expect(isGap(a2, '1st Application', 'c1', gaps)).toBe(true);
    expect(isGap(a2, '2nd Application', 'c1', gaps)).toBe(false);
    // No row for A2's 10th application: nothing to fill in, so not a gap.
    expect(isGap(a2, '10th Application', 'c1', gaps)).toBe(false);
    expect(gapsOf(pivot, a2, '1st Application', gaps).map((field) => field.name)).toEqual(['Disease', 'Date', 'Chemical', 'Dose']);
  });

  it('marks only the columns with a gap, and calls a 0 entered', () => {
    const fert = makeSheet(7, 'Fertigation', [
      { key: 'c2', name: 'Zone', type: 'link' },
      { key: 'c5', name: 'Application', type: 'text' },
      { key: 'c1', name: 'Date', type: 'date' },
      { key: 'c6', name: 'Fertilizer', type: 'text' },
      { key: 'c7', name: 'Quantity', type: 'number' },
    ], [
      { c2: 'A4', c5: '1st Application', c1: '2026-06-15', c6: 'Compost', c7: '136.83' },
      { c2: 'A4', c5: '2nd Application', c1: '', c6: ' ', c7: '0' },
    ], 'fertigation');
    const gaps = new Map([['c1', 1], ['c6', 1]]);
    const line = applicationPivot(fert, fert.rows)!.lines[0];
    expect(isGap(line, '2nd Application', 'c1', gaps)).toBe(true);
    expect(isGap(line, '2nd Application', 'c6', gaps)).toBe(true);
    expect(isGap(line, '2nd Application', 'c7', gaps)).toBe(false);
    expect(isGap(line, '1st Application', 'c1', gaps)).toBe(false);
  });

  it('leaves out the columns the page leaves out (nothing entered in any row), so a folded application keeps a date that has one', () => {
    // As the Fertilizer table is: a Date and a Note nobody fills in, the date in "applied".
    const fert = makeSheet(17, 'Fertilizer', [
      { key: 'c2', name: 'Zone', type: 'link' },
      { key: 'c1', name: 'Date', type: 'date' },
      { key: 'c3', name: 'Note', type: 'text' },
      { key: 'c5', name: 'application_round', type: 'text' },
      { key: 'c6', name: 'applied', type: 'date' },
      { key: 'c7', name: 'fertilizer_type', type: 'text' },
    ], [
      { c2: 'A1', c5: '1st Application', c6: '2026-06-15', c7: 'Compost' },
      { c2: 'A1', c5: '2nd Application', c6: '2026-06-29', c7: 'NPK 15-15-15' },
    ], 'fertigation');
    const pivot = applicationPivot(fert, fert.rows)!;
    expect(pivot.layout.fields.map((field) => field.name)).toEqual(['Date', 'Note', 'applied', 'fertilizer_type']);
    const shown = withoutColumns(pivot, new Set(['c1', 'c3']));
    expect(shown.layout.fields.map((field) => field.name)).toEqual(['applied', 'fertilizer_type']);
    // The first date left is the one a folded application keeps.
    expect(shown.layout.fields.find((field) => field.type === 'date')!.name).toBe('applied');
    expect(shown.lines).toBe(pivot.lines);
    // Nothing to leave out, or everything: the view as it is.
    expect(withoutColumns(pivot, new Set())).toBe(pivot);
    expect(withoutColumns(pivot, new Set(['c1', 'c3', 'c6', 'c7']))).toBe(pivot);
  });
});
