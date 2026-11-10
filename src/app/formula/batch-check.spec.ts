import type { Column } from '../core/models';
import columns from '../sheet/fixtures/batches-columns.json';
import { makeSheet } from '../test-helpers';
import { formatFormulaValue } from './evaluate-formula';
import { WorkbookFormulas } from './sheet-formulas';

// The Batch table's columns exactly as the template makes them (a Rust test fails if this copy drifts).
const batches = columns as Column[];
const key = (name: string) => batches.find((column) => column.name === name)!.key;

/** What "Batch check" says for each batch number, the numbers all being in one Batch table. */
function checks(numbers: string[]) {
  const sheet = makeSheet(2, 'Batch', batches, numbers.map((number) => ({ [key('Batch number')]: number, [key('Variety name')]: 'Mali' })));
  const book = new WorkbookFormulas([sheet], '2026-11-10');
  const column = batches.find((item) => item.name === 'Batch check')!;
  return sheet.rows.map((row) => formatFormulaValue(book.value(sheet, row, column)));
}

describe('the Batch table: a batch number is B and a number, used once', () => {
  it('says OK for B followed by a number', () => {
    expect(checks(['B1', 'B2', 'B10', 'B120'])).toEqual(['OK', 'OK', 'OK', 'OK']);
  });

  it('says what is wrong when it is not B and a number', () => {
    expect(checks(['1', 'B', 'BX1', 'b', 'Batch1', 'A3'])).toEqual(Array(6).fill('Use B and a number'));
  });

  it('flags every row that has a number another batch has', () => {
    expect(checks(['B1', 'B2', 'B1', 'B3'])).toEqual(['Repeated', 'OK', 'Repeated', 'OK']);
  });

  it('stays blank until a number is typed', () => {
    expect(checks([''])).toEqual(['']);
  });
});
