import type { Column } from '@core/models';
import { WorkbookFormulas } from '@shared/formula/sheet-formulas';
import { makeSheet } from '@shared/testing/test-helpers';
import { columnWidths, dataTable, summaryTable } from './report-tables';

const col = (key: string, name: string, extra: Partial<Column> = {}): Column => ({ key, name, type: 'text', ...extra });

const harvest = makeSheet(
  10,
  'Harvest',
  [
    col('a', 'ID', { type: 'number', auto: true }),
    col('b', 'Zone plot'),
    col('c', 'Date harvest', { type: 'date' }),
    col('d', 'Harvest yield', { type: 'number', unit: 'kg' }),
    col('e', 'Note'),
    col('f', 'Double', { type: 'formula', formula: '=[Harvest yield]*2' }),
  ],
  [
    { a: '1', b: 'A1', c: '2026-09-20', d: '120.5' },
    { a: '2', b: 'A2', c: '2026-09-21', d: '80' },
  ],
  'harvest',
);
const formulas = new WorkbookFormulas([harvest], '2026-11-19');

describe('a table printed on A4 pages', () => {
  it('has every column with something in it, its cells as the table shows them, formulas worked out', () => {
    const table = dataTable(formulas, harvest);
    expect(table.headers).toEqual(['ID', 'Zone plot', 'Date harvest', 'Harvest yield (kg)', 'Double']);
    expect(table.rows[0]).toEqual(['1', 'A1', '20/09/2026', '120.5', '241']);
    // The formula's column holds numbers: written to the right too.
    expect(table.numeric).toEqual([true, false, false, true, true]);
    expect(table.count).toBe('2 records');
    expect(table.totals).toBeNull();
  });

  it('cuts a cell too long to read on paper (a plot outline)', () => {
    const outline = makeSheet(1, 'Zones', [col('a', 'Plot'), col('b', 'Outline')], [{ a: 'River 2', b: '12.1280042,104.0831919;'.repeat(40) }]);
    const [row] = dataTable(new WorkbookFormulas([outline], '2026-11-19'), outline).rows;
    expect(row[1].length).toBe(120);
    expect(row[1].endsWith('…')).toBe(true);
  });

  it('gives each column a share of the width by what it holds, adding up to the whole', () => {
    const widths = columnWidths(['ID', 'A long column name'], [['1', 'x'], ['2', 'a much longer value than the name']]);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100, 6);
    expect(widths[1]).toBeGreaterThan(widths[0]);
  });

  it('prints a summary as the dashboard works it out, its totals under', () => {
    const table = summaryTable(formulas, harvest, { id: 's', title: 'By plot', groupBy: 'b', groupPart: 'value', measures: [{ column: 'd', aggregate: 'sum' }] });
    expect(table?.headers[0]).toBe('Zone plot');
    expect(table?.rows.map((row) => row[0])).toEqual(['A1', 'A2']);
    expect(table?.totals?.[0]).toBe('Total');
    expect(table?.count).toBe('2 lines');
  });

  it('has nothing for a summary not set up yet', () => {
    expect(summaryTable(formulas, harvest, { id: 's', title: '', groupBy: '', groupPart: 'value', measures: [] })).toBeNull();
  });
});
