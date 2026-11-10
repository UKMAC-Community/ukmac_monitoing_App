import type { Column } from '../core/models';
import { cellsFor, matchHeaders } from '../google/sheet-sync';
import { makeSheet, qaQcColumns } from '../test-helpers';
import { loadExcel } from './exceljs';
import { readExcelSheets } from './sheet-from-excel';
import { buildSyncWorkbook } from './sync-workbook';

const col = (key: string, name: string, type: Column['type'] = 'text'): Column => ({ key, name, type });

const ring = '10.1377071,100.0955417;10.1377251,100.0955232;10.1368873,100.0950833;10.1368344,100.0955262';
const zones = makeSheet(
  1,
  'Zones',
  [col('c1', 'Zone'), col('c2', 'Plot'), col('c3', 'Plant capacity', 'number'), col('c4', 'Note'), col('c5', 'Zone number', 'number'),
   col('c6', 'Row', 'number'), col('c7', 'Column', 'number'), col('c8', 'Plot status'), col('c9', 'Status name'), col('c10', 'Outline')],
  [
    { c1: 'A', c2: 'A1', c3: '340', c5: '1', c6: '2', c7: '1', c8: 'Active', c10: ring },
    { c1: 'B', c5: '4', c6: '2', c7: '1', c8: 'Water', c9: 'ស្រះទឹក១' },
    { c1: 'B', c2: 'B9', c4: 'Mali chili zone', c5: '4', c6: '2', c7: '3', c8: 'Active', c10: ring },
  ],
  'zones',
);

// QA/QC: 299 columns in boxes with repeated names, and formula columns the app works out.
const qaColumns = qaQcColumns();
const qa = makeSheet(11, 'QA/QC Management', qaColumns, [{ c1: '2026-06-01', c2: 'A1', c9: '18' }, { c2: 'A2' }]);

describe('the workbook a MAC file keeps its tables in', () => {
  it('has one tab per table, named as Excel allows, with the table\'s names in one header row', async () => {
    const { bytes, tabs } = await buildSyncWorkbook([zones, qa]);
    const Excel = await loadExcel();
    const book = new Excel.Workbook();
    await book.xlsx.load(bytes);
    // "QA/QC Management" has a slash, which a tab name can't.
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(['Zones', 'QA-QC Management']);
    expect(tabs.map((tab) => tab.tab)).toEqual(['Zones', 'QA-QC Management']);
    const header = book.worksheets[0].getRow(1).values as unknown[];
    expect(header.slice(1)).toEqual(['Zone', 'Plot', 'Plant capacity', 'Note', 'Zone number', 'Row', 'Column', 'Plot status', 'Status name', 'Outline']);
    // No formula column is written: Sync would add each one as a column of its own.
    const formulas = qaColumns.filter((column) => column.type === 'formula').length;
    expect(formulas).toBeGreaterThan(0);
    expect(book.worksheets[1].columnCount).toBe(qaColumns.length - formulas);
  });

  it('reads back into the same tables: no column added, every value as it was', async () => {
    const { bytes, tabs } = await buildSyncWorkbook([zones, qa]);
    const read = await readExcelSheets(bytes);
    for (const table of [zones, qa]) {
      const tab = tabs.find((item) => item.sheetId === table.sheetId)!;
      const data = read.find((sheet) => sheet.name === tab.tab)!;
      const { matched, fresh } = matchHeaders(table.columns, data.headers, tab.headerMap);
      expect(fresh).toEqual([]);
      const { rows, problems } = cellsFor(matched, data, (column) => (column.type === 'link' ? ['A1', 'A2', 'B9'] : []));
      expect(problems).toBe(0);
      const entry = table.columns.filter((column) => column.type !== 'formula').map((column) => column.key);
      expect(rows).toHaveLength(table.rows.length);
      rows.forEach((cells, index) => {
        for (const key of entry) expect(cells[key] ?? '', `${table.title} row ${index + 1} ${key}`).toBe(table.rows[index].data[key] ?? '');
      });
    }
  });
});
