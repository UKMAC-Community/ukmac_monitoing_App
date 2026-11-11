import type { Column } from '../core/models';
import { cellsFor, matchHeaders } from '../google/sheet-sync';
import type { ExcelSheetData } from './sheet-from-excel';
import { plotColumnKey } from '../sheet/columns';
import columns from '../sheet/fixtures/zone-measurement-columns.json';
import { makeSheet } from '../test-helpers';
import { loadExcel } from './exceljs';
import { readImport } from './excel-template';

/** A file made from the web system's own Zone Measurement template still fills the farm's design, and nothing stray is added. */
const table = makeSheet(2, 'Zone Measurement', columns as Column[]);
const ctx = { linkOptions: () => [] as string[] };
const WEB_HEADERS = ['Zone plot', 'Planned plot', 'Width (m)', 'Length (m)', 'Area (m²)', 'Note'];

describe('the web system\'s Zone Measurement headers, read into the farm\'s design', () => {
  it('fills Actual width and Actual length from Width (m) and Length (m), works the area out itself, and leaves out only what the design has no column for', async () => {
    const Excel = await loadExcel();
    const book = new Excel.Workbook();
    const tab = book.addWorksheet('Data');
    tab.addRow(WEB_HEADERS);
    tab.addRow(['A-1-01', '12', 12.5, 8, 100, 'checked']);
    const preview = await readImport((await book.xlsx.writeBuffer()) as ArrayBuffer, 'zone-measurement.xlsx', table, ctx);
    expect(preview.matched.map((item) => [item.fileHeader, item.header])).toEqual([
      ['Zone plot', 'Zone plot'],
      ['Width (m)', 'Actual width (m)'],
      ['Length (m)', 'Actual length (m)'],
      ['Note', 'Note'],
    ]);
    expect(preview.workedOut).toEqual(['Area (m²)']);
    expect(preview.unknownHeaders).toEqual(['Planned plot']);
  });

  it('does the same when a connected table is synced from a Google Sheet tab', () => {
    const { matched, fresh } = matchHeaders(columns as Column[], WEB_HEADERS, {});
    expect([...matched.entries()].map(([index, column]) => [WEB_HEADERS[index], column.name])).toEqual([
      ['Zone plot', 'Zone plot'],
      ['Width (m)', 'Actual width'],
      ['Length (m)', 'Actual length'],
      ['Note', 'Note'],
    ]);
    // Only the header the design has no column for would be added; the worked-out Area (m²) is not.
    expect(fresh.map((index) => WEB_HEADERS[index])).toEqual(['Planned plot']);
  });
});

describe('a Zone Measurement row with no zone plot is not brought in', () => {
  const measurement = makeSheet(2, 'Zone Measurement', columns as Column[], [], 'zone-measurement');

  it('only a Zone Measurement table has the rule', () => {
    expect(plotColumnKey(measurement)).toBe((columns as Column[]).find((column) => column.name === 'Zone plot')!.key);
    expect(plotColumnKey(makeSheet(3, 'Other', columns as Column[]))).toBeNull();
  });

  it('a Google Sheet tab: the rows without a plot are left out and counted', () => {
    const headers = ['Zone plot', 'Width (m)', 'Length (m)'];
    const { matched } = matchHeaders(columns as Column[], headers, {});
    const data = { name: 'Zone Measurement', headers, rows: [['A1', '50', '110'], ['', '5', '6'], ['  ', '', ''], ['B1', '46', '117.5']] } as unknown as ExcelSheetData;
    const result = cellsFor(matched, data, () => ['A1', 'B1'], plotColumnKey(measurement));
    expect(result.rows.length).toBe(2);
    expect(result.skipped).toBe(2);
    // Without the rule every row is kept.
    expect(cellsFor(matched, data, () => ['A1', 'B1']).rows.length).toBe(4);
  });

  it('a file: the rows without a plot are not read', async () => {
    const Excel = await loadExcel();
    const book = new Excel.Workbook();
    const tab = book.addWorksheet('Data');
    tab.addRow(['Zone plot', 'Width (m)', 'Length (m)']);
    tab.addRow(['A1', 50, 110]);
    tab.addRow([null, 5, 6]);
    tab.addRow(['B1', 46, 117.5]);
    const preview = await readImport((await book.xlsx.writeBuffer()) as ArrayBuffer, 'zm.xlsx', measurement, ctx);
    expect(preview.rows.map((row) => row.rowNumber)).toEqual([2, 4]);
  });
});
