import type { Column } from '../core/models';
import { matchHeaders } from '../google/sheet-sync';
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
