import type { Column } from '@core/models';
import { makeSheet } from '@shared/testing/test-helpers';
import { emptyColumnKeys } from './empty-columns';

const columns = [
  { key: 'c1', name: 'ID', type: 'text', auto: true },
  { key: 'c2', name: 'Batch number', type: 'text' },
  { key: 'c3', name: 'Variety name', type: 'text' },
  { key: 'c4', name: 'Note', type: 'text' },
  { key: 'c5', name: 'Double', type: 'formula', formula: '=[Batch number]' },
] as Column[];

describe('emptyColumnKeys', () => {
  it('names the typed-in columns with nothing entered in any row, and not the worked-out ones', () => {
    const sheet = makeSheet(1, 'Batch', columns, [{ c2: 'NB-1', c3: '', c4: '  ' }, { c2: 'NB-2', c4: '' }]);
    expect([...emptyColumnKeys(sheet)]).toEqual(['c3', 'c4']);
  });

  it('calls a column filled once, in any row, entered', () => {
    const sheet = makeSheet(1, 'Batch', columns, [{ c2: 'NB-1' }, { c2: 'NB-2', c4: 'late' }]);
    expect([...emptyColumnKeys(sheet)]).toEqual(['c3']);
  });

  it('has none to name in a table with no rows yet', () => {
    expect(emptyColumnKeys(makeSheet(1, 'Batch', columns, [])).size).toBe(0);
  });
});
