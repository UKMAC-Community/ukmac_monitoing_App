import { makeMac, makeSheet, qaQcColumns } from '../test-helpers';
import { loadExcel } from './exceljs';
import { buildPowerBiWorkbook } from './powerbi-export';
import { readExcelSheets, tableFromSheet } from './sheet-from-excel';

describe('Power BI export', () => {
  it("puts every MAC's same table in one Excel table, typed, formulas worked out", async () => {
    const one = {
      mac: makeMac(),
      sheets: [makeSheet(1, 'QA/QC Management', qaQcColumns(), [{ c1: '2026-06-01', c2: 'A1', c9: '18' }])],
    };
    const two = {
      mac: makeMac({ macId: 2, macName: 'Kampot', macCode: 'KAMPOT-1234' }),
      sheets: [makeSheet(2, 'QA/QC Management', qaQcColumns(), [{ c1: '2026-07-01', c2: 'B1', c9: '20' }])],
    };
    const Excel = await loadExcel();
    const book = new Excel.Workbook();
    await book.xlsx.load(await buildPowerBiWorkbook([one, two]));
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(['About', 'MACs', 'QA-QC Management']);
    const qc = book.getWorksheet('QA-QC Management')!;
    const header: string[] = [];
    qc.getRow(1).eachCell((cell) => header.push(String(cell.value)));
    expect(header.slice(0, 4)).toEqual(['MAC', 'MAC code', 'Date', 'Zone']);
    const dead = header.indexOf('2 · Establishment (7 DAT) · Dead plant') + 1;
    const date = header.indexOf('Date') + 1;
    expect(qc.getRow(2).getCell(1).value).toBe('Battambang - Tmor Kol');
    expect(qc.getRow(3).getCell(2).value).toBe('KAMPOT-1234');
    expect(qc.getRow(2).getCell(dead).value).toBe(2);
    expect(qc.getRow(3).getCell(dead).value).toBe(0);
    expect(qc.getRow(2).getCell(date).value).toEqual(new Date(Date.UTC(2026, 5, 1)));
    const table = (qc as unknown as { getTables(): unknown[] }).getTables();
    expect(table.length).toBe(1);
  });
});

describe('a new table from any Excel sheet', () => {
  it('guesses each column: numbers, dates, yes/no, text', async () => {
    const Excel = await loadExcel();
    const book = new Excel.Workbook();
    const sheet = book.addWorksheet('Harvest');
    sheet.addRow(['Plot', 'Picked on', 'Kg', 'Sold', 'Note']);
    sheet.addRow(['A1', new Date(Date.UTC(2026, 7, 1)), 12.5, 'Yes', 'first']);
    sheet.addRow(['A2', new Date(Date.UTC(2026, 7, 2)), '1,040', 'No', '']);
    const [data] = await readExcelSheets((await book.xlsx.writeBuffer()) as ArrayBuffer);
    const { columns, rows } = tableFromSheet(data);
    expect(columns.map((column) => `${column.name}:${column.type}`)).toEqual([
      'Plot:text',
      'Picked on:date',
      'Kg:number',
      'Sold:yesno',
      'Note:text',
    ]);
    expect(rows[1]).toEqual({ n1: 'A2', n2: '2026-08-02', n3: '1040', n4: 'false' });
  });

  it('puts a picture on a sheet of its own after the table, opening on it, with no cells to read', async () => {
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const zones = makeSheet(1, 'Zones', [{ key: 'c1', name: 'Plot', type: 'text' }], [{ c1: 'A1' }]);
    const bytes = await buildPowerBiWorkbook([{ mac: makeMac(), sheets: [zones] }], {
      single: true,
      picture: { dataUrl: png, width: 1000, height: 600 },
    });
    const Excel = await loadExcel();
    const book = new Excel.Workbook();
    await book.xlsx.load(bytes);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(['Zones', 'Zone map']);
    expect(book.worksheets[1].getImages()).toHaveLength(1);
    expect(book.worksheets[1].actualRowCount).toBe(0);
    // Reading the file back finds only the table, not the picture's sheet.
    expect((await readExcelSheets(bytes)).map((tab) => tab.name)).toEqual(['Zones']);
  });
});
