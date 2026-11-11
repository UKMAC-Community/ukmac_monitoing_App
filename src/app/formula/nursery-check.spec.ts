import type { Column } from '../core/models';
import batchColumns from '../sheet/fixtures/batches-columns.json';
import columns from '../sheet/fixtures/nursery-columns.json';
import { columnsToLimit, missingTemplateColumns, withTemplateColumns } from '../sheet/template-columns';
import { makeSheet } from '../test-helpers';
import { formatFormulaValue } from './evaluate-formula';
import { WorkbookFormulas } from './sheet-formulas';

// The Nursery Progress columns exactly as the template makes them (a Rust test fails if this copy drifts).
const nursery = columns as Column[];
const key = (name: string) => nursery.find((column) => column.name === name)!.key;

/** A batch row from the counts, by the columns' names. */
function batch(counts: Record<string, string>) {
  return Object.fromEntries(Object.entries(counts).map(([name, value]) => [key(name), value]));
}

function check(counts: Record<string, string>) {
  const sheet = makeSheet(3, 'Nursery Progress', nursery, [batch(counts)]);
  const book = new WorkbookFormulas([sheet], '2026-11-10');
  const read = (name: string) => {
    const column = nursery.find((item) => item.name === name)!;
    return formatFormulaValue(book.value(sheet, sheet.rows[0], column));
  };
  return { check: read('Count check'), unhealthy: read('Total unhealthy'), percent: read('Healthy %') };
}

const sorted = { 'Healthy number': '80', 'Stem rot': '5', 'Leaf rot': '5', Smaller: '5', Disease: '3', 'Physical damage': '2' };

describe('the nursery batch: healthy % and the count check', () => {
  it('works out the not healthy total and the healthy percentage by itself', () => {
    const row = check({ 'Total number': '100', ...sorted });
    expect(row.unhealthy).toBe('20');
    expect(row.percent).toBe('80');
  });

  it('says OK when the total is the healthy plus every not-healthy count', () => {
    expect(check({ 'Total number': '100', ...sorted }).check).toBe('OK');
  });

  it('says how many are missing when the counts fall short of the total', () => {
    expect(check({ 'Total number': '105', ...sorted }).check).toBe('5 missing');
    expect(check({ 'Total number': '100', 'Stem rot': '5', 'Leaf rot': '10' }).check).toBe('85 missing');
  });

  it('says how many are over when the counts are more than the total', () => {
    expect(check({ 'Total number': '95', ...sorted }).check).toBe('5 over');
    expect(check({ 'Total number': '100', ...sorted, 'Healthy number': '90' }).check).toBe('10 over');
  });

  it('stays blank until there is a total and at least one count to check', () => {
    expect(check({ 'Total number': '100' }).check).toBe('');
    expect(check({ ...sorted }).check).toBe('');
    expect(check({}).check).toBe('');
  });

  it('counts a zero as entered', () => {
    expect(check({ 'Total number': '0', 'Healthy number': '0', 'Stem rot': '0' }).check).toBe('OK');
  });
});

describe('the nursery batch: its variety, read from the Batch table', () => {
  const batchTable = (batchColumns as Column[]);
  const bkey = (name: string) => batchTable.find((column) => column.name === name)!.key;
  const batches = makeSheet(2, 'Batch', batchTable, [
    { [bkey('Batch number')]: 'B1', [bkey('Variety name')]: 'RED SKY 88' },
    { [bkey('Batch number')]: 'B2', [bkey('Variety name')]: 'Mali' },
  ]);
  const variety = (batchNumber: string) => {
    const sheet = makeSheet(3, 'Nursery Progress', nursery, [{ [key('Batch number')]: batchNumber, [key('Total number')]: '10' }]);
    const book = new WorkbookFormulas([batches, sheet], '2026-11-10');
    return formatFormulaValue(book.value(sheet, sheet.rows[0], nursery.find((column) => column.name === 'Variety name')!));
  };

  it('shows the variety of the batch picked', () => {
    expect(variety('B1')).toBe('RED SKY 88');
    expect(variety('B2')).toBe('Mali');
  });

  it('is blank for a batch with no number, or one the Batch table does not have', () => {
    expect(variety('')).toBe('');
    expect(variety('B9')).toBe('');
  });

  it('comes right after the batch number, also in a table made before it was in the template', () => {
    const before = nursery.filter((column) => column.name !== 'Variety name');
    const names = withTemplateColumns(before, nursery).map((column) => column.name);
    expect(names.slice(0, 3)).toEqual(['Batch number', 'Variety name', 'Total number']);
  });
});

describe('Nursery Progress: the header\'s two rows', () => {
  const template = nursery;

  it('puts a group heading over each run of columns', () => {
    const groups = template.map((column) => column.group ?? '');
    expect(new Set(groups.filter(Boolean))).toEqual(new Set(['Batch', 'Seedlings', 'Not healthy', 'Check', 'Supply']));
    expect(template.find((column) => column.name === 'Total unhealthy')!.group).toBe('Not healthy');
  });

  it('an older table with no groups takes them, and gets no second copy of any column', () => {
    const older = template.map((column) => ({ ...column, group: undefined }));
    expect(missingTemplateColumns(older, template)).toEqual([]);
    const updated = withTemplateColumns(older, template);
    expect(updated.length).toBe(older.length);
    expect(updated.map((column) => column.key)).toEqual(older.map((column) => column.key));
    expect(updated.find((column) => column.name === 'Stem rot')!.group).toBe('Not healthy');
    expect(columnsToLimit(older, template).length).toBe(template.filter((column) => column.group).length);
  });
});
