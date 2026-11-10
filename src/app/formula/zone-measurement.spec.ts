import type { Column } from '../core/models';
import columns from '../sheet/fixtures/zone-measurement-columns.json';
import { makeSheet } from '../test-helpers';
import { formatFormulaValue } from './evaluate-formula';
import { WorkbookFormulas } from './sheet-formulas';

// The Zone Measurement columns exactly as the template makes them (a Rust test fails if this copy drifts).
const measurement = columns as Column[];
const key = (name: string) => measurement.find((column) => column.name === name)!.key;

// The Zones table the plots come from: a plot, and the zone name and zone number it is grouped by.
const zonesColumns: Column[] = [
  { key: 'c1', name: 'Zone', type: 'text' },
  { key: 'c2', name: 'Plot', type: 'text' },
  { key: 'c5', name: 'Zone number', type: 'number' },
];
const zones = makeSheet(1, 'Zones', zonesColumns, [
  { c1: 'Zone A', c2: 'A-1-01', c5: '1' },
  { c1: 'Zone B', c2: 'B-3-02', c5: '3' },
  { c1: 'Zone B', c2: 'B-NO-NUM' },
]);

/** One measurement row from what is typed, by the columns' names; what each worked-out column shows. */
function measure(typed: Record<string, string>) {
  const row = Object.fromEntries(Object.entries(typed).map(([name, value]) => [key(name), value]));
  const sheet = makeSheet(2, 'Zone Measurement', measurement, [row]);
  const book = new WorkbookFormulas([zones, sheet], '2026-11-10');
  const read = (name: string) => formatFormulaValue(book.value(sheet, sheet.rows[0], measurement.find((item) => item.name === name)!));
  return { area: read('Actual area'), error: read('Measure error'), percent: read('Error %'), zone: read('Zone'), number: read('Zone number') };
}

describe('Zone Measurement: the area, the error and the plot\'s group', () => {
  it('works the actual area out as width times length', () => {
    expect(measure({ 'Actual width': '12.5', 'Actual length': '8' }).area).toBe('100');
  });

  it('rounds to 2 places, as the design keeps it', () => {
    expect(measure({ 'Actual width': '3.333', 'Actual length': '3' }).area).toBe('10');
    expect(measure({ 'Actual width': '2.55', 'Actual length': '3.3' }).area).toBe('8.42');
  });

  it('stays blank until both the width and the length are measured', () => {
    expect(measure({ 'Actual width': '12.5' }).area).toBe('');
    expect(measure({ 'Actual length': '8' }).area).toBe('');
    expect(measure({}).area).toBe('');
  });

  it('gives the error as actual area minus the plan, and as a percentage of the plan', () => {
    const over = measure({ 'Area in plan': '90', 'Actual width': '12.5', 'Actual length': '8' });
    expect([over.error, over.percent]).toEqual(['10', '11.11']);
    const short = measure({ 'Area in plan': '120', 'Actual width': '12.5', 'Actual length': '8' });
    expect([short.error, short.percent]).toEqual(['-20', '-16.67']);
    const exact = measure({ 'Area in plan': '100', 'Actual width': '12.5', 'Actual length': '8' });
    expect([exact.error, exact.percent]).toEqual(['0', '0']);
  });

  it('has no error until the plan and both measures are there', () => {
    expect(measure({ 'Actual width': '12.5', 'Actual length': '8' })).toMatchObject({ error: '', percent: '' });
    expect(measure({ 'Area in plan': '90', 'Actual width': '12.5' })).toMatchObject({ error: '', percent: '' });
  });

  it('counts a plan of 0 as entered, but has no percentage of nothing', () => {
    const row = measure({ 'Area in plan': '0', 'Actual width': '2', 'Actual length': '3' });
    expect([row.error, row.percent]).toEqual(['6', '']);
  });

  it('reads the zone name and zone number from the plot, never typed', () => {
    expect(measure({ 'Zone plot': 'A-1-01' })).toMatchObject({ zone: 'Zone A', number: '1' });
    expect(measure({ 'Zone plot': 'B-3-02' })).toMatchObject({ zone: 'Zone B', number: '3' });
  });

  it('shows a plot with no zone number as having none, and nothing for a plot that is not in Zones', () => {
    expect(measure({ 'Zone plot': 'B-NO-NUM' })).toMatchObject({ zone: 'Zone B', number: '' });
    expect(measure({ 'Zone plot': 'Z-9-99' })).toMatchObject({ zone: '', number: '' });
  });

  it('shows no group while no plot is picked, rather than the first plot\'s', () => {
    expect(measure({})).toMatchObject({ zone: '', number: '' });
  });
});
