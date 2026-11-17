import type { Column } from '@core/models';
import { makeSheet } from '@shared/testing/test-helpers';
import { isRemarkColumn } from '@shared/sheet/columns';
import { gapsFirst, hasGap, missingData } from './missing-data';

const columns = [
  { key: 'c1', name: 'ID', type: 'text', auto: true },
  { key: 'c2', name: 'Batch number', type: 'text' },
  { key: 'c3', name: 'Variety name', type: 'text' },
  { key: 'c4', name: 'Origin', type: 'text' },
  { key: 'c5', name: 'Double', type: 'formula', formula: '=[Batch number]' },
] as Column[];

describe('missingData', () => {
  it('counts the typed-in cells as the Data Check does, a blank or spaces as missing, and not the worked-out columns', () => {
    const sheet = makeSheet(1, 'Batch', columns, [
      { c1: '1', c2: 'NB-1', c3: 'Mali', c4: '  ' },
      { c1: '2', c2: 'NB-2', c3: '' },
    ]);
    const data = missingData(sheet);
    expect(data).toMatchObject({ cells: 6, filled: 3, missing: 3, tone: 'warning' });
    expect([...data.columns]).toEqual([['c4', 2], ['c3', 1]]);
  });

  it('reads all filled as success, and nothing entered as danger', () => {
    expect(missingData(makeSheet(1, 'Batch', columns, [{ c2: 'NB-1', c3: 'Mali', c4: 'ok' }]))).toMatchObject({ missing: 0, tone: 'success' });
    expect(missingData(makeSheet(1, 'Batch', columns, [{ c1: '1' }]))).toMatchObject({ filled: 0, tone: 'danger' });
  });

  it('finds a record with a gap', () => {
    const sheet = makeSheet(1, 'Batch', columns, [
      { c2: 'NB-1', c3: 'Mali' },
      { c2: 'NB-2', c3: '' },
    ]);
    const gaps = missingData(sheet).columns;
    const [first, second] = sheet.rows;
    const filled = makeSheet(1, 'Batch', columns, [{ c2: 'NB-3', c3: 'Mali', c4: 'ok' }]).rows[0];
    expect(hasGap(first, gaps)).toBe(true);
    expect(hasGap(second, gaps)).toBe(true);
    expect(hasGap(filled, gaps)).toBe(false);
  });

  it('puts the rows missing a column on top, each part kept in its order', () => {
    const sheet = makeSheet(1, 'Batch', columns, [{ c2: 'NB-1', c3: 'Mali' }, { c2: 'NB-2' }, { c2: 'NB-3', c3: 'Mali' }, { c2: 'NB-4', c3: ' ' }]);
    expect(gapsFirst(sheet.rows, 'c3').map((row) => row.data['c2'])).toEqual(['NB-2', 'NB-4', 'NB-1', 'NB-3']);
    // None or all missing: the order as it was.
    expect(gapsFirst(sheet.rows, 'c2')).toBe(sheet.rows);
    expect(gapsFirst(sheet.rows, 'c4')).toBe(sheet.rows);
  });
});

describe('isRemarkColumn', () => {
  it('knows a note, a remark, a comment and a file link from the data', () => {
    const text = (name: string) => isRemarkColumn({ name, type: 'text' });
    expect(['Note', 'Notes', 'Remarks', 'Comment', 'Main file link:', 'Photo'].map(text)).toEqual([true, true, true, true, true, true]);
    expect(['Notebook', 'Number of notes', 'Status name', 'Outline', 'Variety name'].map(text)).toEqual([false, false, false, false, false]);
    expect(isRemarkColumn({ name: 'Note', type: 'number' })).toBe(false);
  });
});
