import type { Column } from '../core/models';
import nursery from '../sheet/fixtures/nursery-columns.json';
import batches from '../sheet/fixtures/batches-columns.json';
import { matchHeaders } from './sheet-sync';

const progress = nursery as Column[];
const batch = batches as Column[];
const named = (matched: Map<number, Column>) => [...matched].map(([index, column]) => [index, column.name]);

describe('a Google Sheet tab for the nursery tables', () => {
  it('fills Nursery Progress from the new headers, as the note names them', () => {
    const headers = ['Batch number', 'Total number', 'Healthy number', 'Stem rot', 'Leaf rot', 'Smaller', 'Disease', 'Physical damage', 'Supply date start', 'Supply date end'];
    const { matched, fresh } = matchHeaders(progress, headers, {});
    expect(fresh).toEqual([]);
    expect(named(matched)).toEqual(headers.map((header, index) => [index, header]));
  });

  it('still fills it from the names an older sheet has, and adds no column for its worked-out ones', () => {
    const headers = ['Batch #', 'Total number', 'Healthy', 'Not healthy', 'Healthy %', 'Supply date'];
    const { matched, fresh } = matchHeaders(progress, headers, {});
    expect(named(matched)).toEqual([[0, 'Batch number'], [1, 'Total number'], [2, 'Healthy number'], [5, 'Supply date start']]);
    // "Not healthy" and "Healthy %" are worked out here, so they are neither filled nor added.
    expect(fresh).toEqual([]);
  });

  it('fills Batch from a tab of batch number and variety, old or new', () => {
    expect(named(matchHeaders(batch, ['Batch', 'Variety'], {}).matched)).toEqual([[0, 'Batch number'], [1, 'Variety name']]);
    expect(named(matchHeaders(batch, ['Batch #', 'Plant type'], {}).matched)).toEqual([[0, 'Batch number'], [1, 'Variety name']]);
  });
});
