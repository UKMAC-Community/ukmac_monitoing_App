import type { Column } from '../core/models';
import { makeSheet, qaQcColumns } from '../test-helpers';
import { loadExcel } from './exceljs';
import { buildTemplate, readImport } from './excel-template';
import { readExcelSheets } from './sheet-from-excel';

const plots = ['A1', 'A2', 'B1'];
const ctx = { linkOptions: (column: Column) => (column.source?.includes('Zones') ? plots : []) };

async function fill(template: ArrayBuffer, rows: (string | number | Date | null)[][]) {
  const Excel = await loadExcel();
  const book = new Excel.Workbook();
  await book.xlsx.load(template);
  const data = book.getWorksheet('Data')!;
  rows.forEach((row, index) => {
    row.forEach((value, column) => {
      if (value !== null) data.getCell(index + 2, column + 1).value = value;
    });
  });
  return (await book.xlsx.writeBuffer()) as ArrayBuffer;
}

describe('Excel template and import', () => {
  const qc = makeSheet(2, 'QA/QC Management', qaQcColumns());

  it('writes the Data sheet with the server headers, no formula columns, and the Lists', async () => {
    const Excel = await loadExcel();
    const book = new Excel.Workbook();
    await book.xlsx.load(await buildTemplate(qc, ctx));
    const data = book.getWorksheet('Data')!;
    const headers: string[] = [];
    data.getRow(1).eachCell((cell) => headers.push(String(cell.value)));
    expect(headers).toEqual([
      'Date',
      'Zone',
      'QC record · Plant batch',
      '1 · Transplant (0 DAT) · Disease',
      '2 · Establishment (7 DAT) · Live plant',
    ]);
    expect(book.getWorksheet('Lists')!.getCell('A2').value).toBe('A1');
    expect(book.getWorksheet('Instructions')).toBeTruthy();
  });

  it('reads the filled template back, checking each value', async () => {
    const filled = await fill(await buildTemplate(qc, ctx), [
      ['16/06/2026', 'a1', 'B-01', 2, 19],
      [new Date(Date.UTC(2026, 5, 17)), 'Z9', null, 'none', 20],
      [null, null, null, null, null],
      ['2026-06-18', 'B1', null, null, '18'],
    ]);
    const preview = await readImport(filled, 'qc.xlsx', qc, ctx);
    expect(preview.issues).toEqual([]);
    expect(preview.rows.length).toBe(3); // the blank row is skipped
    expect(preview.rows[0].cells).toEqual({ c1: '2026-06-16', c2: 'A1', c3: 'B-01', c6: '2', c9: '19' });
    expect(preview.rows[0].errors).toEqual([]);
    expect(preview.rows[1].cells['c1']).toBe('2026-06-17');
    expect(preview.rows[1].errors.map((error) => error.key).sort()).toEqual(['c2', 'c6']);
    expect(preview.errorRows).toBe(1);
    expect(preview.missingLinks).toEqual([expect.objectContaining({ values: ['Z9'] })]);
    expect(preview.rows[2].cells['c9']).toBe('18');
  });

  it("takes a farm's own sheet: another name, a title row above, extra columns, box paths", async () => {
    const Excel = await loadExcel();
    const book = new Excel.Workbook();
    const sheet = book.addWorksheet('June checks');
    sheet.addRow(['QC June 2026']);
    sheet.addRow(['Zone', 'Date', 'Checked by', '2 · Establishment (7 DAT) › Plant Survival (No.) › Live plant', 'Dead plant']);
    sheet.addRow(['A2', '01/06/2026', 'Sokha', 17, 3]);
    const preview = await readImport((await book.xlsx.writeBuffer()) as ArrayBuffer, 'june.xlsx', qc, ctx);
    expect(preview.headerRow).toBe(2);
    expect(preview.unknownHeaders).toEqual(['Checked by']);
    expect(preview.workedOut).toEqual(['Dead plant']);
    expect(preview.rows[0].cells).toEqual({ c2: 'A2', c1: '2026-06-01', c9: '17' });
  });

  it('still reads the rows when a required column is missing, marking each', async () => {
    const Excel = await loadExcel();
    const book = new Excel.Workbook();
    book.addWorksheet('Data').addRow(['Zone']).commit();
    book.getWorksheet('Data')!.addRow(['A1']);
    const preview = await readImport((await book.xlsx.writeBuffer()) as ArrayBuffer, 'x.xlsx', qc, ctx);
    expect(preview.issues).toEqual([]);
    expect(preview.missingRequired).toEqual([{ key: 'c1', header: 'Date' }]);
    expect(preview.rows.length).toBe(1);
    expect(preview.rows[0].cells).toEqual({ c2: 'A1' });
    expect(preview.rows[0].errors.map((error) => error.key)).toEqual(['c1']);
    expect(preview.errorRows).toBe(1);
  });

  it('reads the tab it is told to, not the first one', async () => {
    const Excel = await loadExcel();
    const book = new Excel.Workbook();
    book.addWorksheet('Summary').addRow(['Notes']);
    const tab = book.addWorksheet('June checks');
    tab.addRow(['Zone', 'Date']);
    tab.addRow(['A2', '01/06/2026']);
    const bytes = (await book.xlsx.writeBuffer()) as ArrayBuffer;
    const preview = await readImport(bytes, 'g.xlsx', qc, ctx, { tab: 'June checks' });
    expect(preview.sheetName).toBe('June checks');
    expect(preview.issues).toEqual([]);
    expect(preview.rows[0].cells).toEqual({ c2: 'A2', c1: '2026-06-01' });
    await expect(readImport(bytes, 'g.xlsx', qc, ctx, { tab: 'Missing' })).rejects.toThrow('isn\'t in the workbook');
  });

  it("fills the columns the user matched, whatever the file calls them, and leaves the rest out", async () => {
    const Excel = await loadExcel();
    const book = new Excel.Workbook();
    const tab = book.addWorksheet('Visits');
    tab.addRow(['Title of the report']);
    tab.addRow(['Where', '', 'When', 'Zone', 'Notes']); // an empty header cell: positions skip it
    tab.addRow(['B1', '', '02/06/2026', 'ignored', 'x']);
    const bytes = (await book.xlsx.writeBuffer()) as ArrayBuffer;
    // Date (c1) ← "When" (column 3); Zone (c2) ← "Where" (column 1). The file's own "Zone" column is not used.
    const preview = await readImport(bytes, 'v.xlsx', qc, ctx, { columns: { c1: 3, c2: 1 }, headerRow: 2 });
    expect(preview.headerRow).toBe(2);
    expect(preview.issues).toEqual([]);
    expect(preview.matched.map((item) => [item.key, item.fileHeader])).toEqual([
      ['c2', 'Where'],
      ['c1', 'When'],
    ]);
    expect(preview.unknownHeaders).toEqual(['Zone', 'Notes']);
    expect(preview.rows[0].cells).toEqual({ c2: 'B1', c1: '2026-06-02' });
  });

  it("gives each column of the file its first different values, each with its row, to tell two of one name apart", async () => {
    const Excel = await loadExcel();
    const book = new Excel.Workbook();
    const sheet = book.addWorksheet('Data');
    sheet.addRow(['Total', 'Total', 'Empty']);
    sheet.addRow([10, 'x', null]);
    sheet.addRow([10, 'y', null]);
    sheet.addRow([null, '', null]);
    sheet.addRow([30, 'z', null]);
    for (let n = 0; n < 9; n += 1) sheet.addRow([100 + n, 'w' + n, null]);
    const bytes = (await book.xlsx.writeBuffer()) as ArrayBuffer;
    const preview = await readImport(bytes, 'f.xlsx', qc, ctx);
    const [first, second, empty] = preview.fileColumns;
    // A repeated value is shown once, at the first row it's on; an empty cell is skipped; six at most.
    expect(first.values).toEqual([
      { row: 2, text: '10' },
      { row: 5, text: '30' },
      { row: 6, text: '100' },
      { row: 7, text: '101' },
      { row: 8, text: '102' },
      { row: 9, text: '103' },
    ]);
    expect(second.values.map((value) => value.text)).toEqual(['x', 'y', 'z', 'w0', 'w1', 'w2']);
    expect(empty.values).toEqual([]);
    expect(empty.sample).toBe('');
  });

  it('reports every column of the file, with a sample, whether or not it matched; a "*" on a header is no part of its name', async () => {
    const Excel = await loadExcel();
    const book = new Excel.Workbook();
    const sheet = book.addWorksheet('Data');
    sheet.addRow(['Zone *', 'Remarks', 'Date']);
    sheet.addRow(['A1', 'dry', '01/06/2026']);
    const bytes = (await book.xlsx.writeBuffer()) as ArrayBuffer;
    const preview = await readImport(bytes, 'f.xlsx', qc, ctx);
    expect(preview.fileColumns).toEqual([
      { position: 1, header: 'Zone *', sample: 'A1', values: [{ row: 2, text: 'A1' }], stage: 0, parts: ['Zone *'] },
      { position: 2, header: 'Remarks', sample: 'dry', values: [{ row: 2, text: 'dry' }], stage: 0, parts: ['Remarks'] },
      { position: 3, header: 'Date', sample: '01/06/2026', values: [{ row: 2, text: '01/06/2026' }], stage: 0, parts: ['Date'] },
    ]);
    expect(preview.matched.map((item) => [item.key, item.position])).toEqual([
      ['c2', 1],
      ['c1', 3],
    ]);
    expect(preview.unknownHeaders).toEqual(['Remarks']);
  });

  it('still lists the file\'s columns when none of them match, so they can be matched by hand', async () => {
    const Excel = await loadExcel();
    const book = new Excel.Workbook();
    const sheet = book.addWorksheet('Data');
    sheet.addRow(['Place', 'Day']);
    sheet.addRow(['A1', '01/06/2026']);
    const bytes = (await book.xlsx.writeBuffer()) as ArrayBuffer;
    const preview = await readImport(bytes, 'f.xlsx', qc, ctx);
    expect(preview.issues[0]).toContain('Match the columns by hand');
    expect(preview.fileColumns.map((column) => column.header)).toEqual(['Place', 'Day']);
    // Matched by hand, they fill the table.
    const mapped = await readImport(bytes, 'f.xlsx', qc, ctx, { columns: { c2: 1, c1: 2 }, headerRow: 1 });
    expect(mapped.issues).toEqual([]);
    expect(mapped.rows[0].cells).toEqual({ c2: 'A1', c1: '2026-06-01' });
  });

  it('with no matching names, takes the first row with two or more cells as the headers, not a title above it', async () => {
    const Excel = await loadExcel();
    const book = new Excel.Workbook();
    const sheet = book.addWorksheet('Data');
    sheet.addRow(['Report of June']);
    sheet.addRow(['Place', 'Day']);
    sheet.addRow(['A1', '01/06/2026']);
    const preview = await readImport((await book.xlsx.writeBuffer()) as ArrayBuffer, 'f.xlsx', qc, ctx);
    expect(preview.headerRow).toBe(2);
    expect(preview.fileColumns.map((column) => column.header)).toEqual(['Place', 'Day']);
  });

  describe('where the names and the data are', () => {
    // The user's nursery file: a title row, then groups merged over their columns, then the names, then a row of units, then data.
    const nursery = makeSheet(3, 'Nursery Batches', [
      { key: 'c1', name: 'Batch #', type: 'text', required: true },
      { key: 'c2', name: 'Total number', type: 'number' },
      { key: 'c3', name: 'Healthy', type: 'number' },
      { key: 'c4', name: 'Stem rot', type: 'number', box: 'Not Healthy' },
      { key: 'c5', name: 'Leaf rot', type: 'number' },
    ]);

    async function groupedFile(title = true) {
      const Excel = await loadExcel();
      const book = new Excel.Workbook();
      const ws = book.addWorksheet('Nursery Progress');
      const top = title ? 1 : 0;
      if (title) ws.addRow(['Nursery Progress 2026']);
      ws.addRow(['Batch #', 'Total number', 'Healthy', null, 'Not Healthy', null]);
      ws.addRow([null, null, 'Healthy', 'Total', 'Stem rot', 'Leaf rot']);
      ws.addRow(['', '', '(plants)', '(plants)', '(plants)', '(plants)']); // a row of units
      ws.addRow(['B-1', 100, 90, 95, 3, 2]);
      ws.addRow(['B-2', 200, 180, 190, 6, 4]);
      if (title) ws.mergeCells(1, 1, 1, 6);
      const g = top + 1;
      ws.mergeCells(g, 1, g + 1, 1); // Batch # merged down
      ws.mergeCells(g, 2, g + 1, 2);
      ws.mergeCells(g, 3, g, 4); // Healthy over two
      ws.mergeCells(g, 5, g, 6); // Not Healthy over two
      return (await book.xlsx.writeBuffer()) as ArrayBuffer;
    }

    it('finds merged group names over the names and reads each column as "Group › Name", not the group twice', async () => {
      const preview = await readImport(await groupedFile(), 'n.xlsx', nursery, ctx);
      expect(preview.layout).toEqual({ headerFrom: 2, headerTo: 3, dataFrom: 4 });
      expect(preview.fileColumns.map((column) => column.header)).toEqual([
        'Batch #',
        'Total number',
        'Healthy',
        'Healthy › Total',
        'Not Healthy › Stem rot',
        'Not Healthy › Leaf rot',
      ]);
      expect(preview.repeated).toEqual([]);
      expect(preview.issues).toEqual([]);
    });

    it('matches "Not Healthy › Stem rot" to the column in the box Not Healthy, and "Leaf rot" by its own name when it is the only one', async () => {
      const preview = await readImport(await groupedFile(), 'n.xlsx', nursery, ctx);
      expect(preview.matched.map((item) => [item.key, item.fileHeader])).toEqual([
        ['c1', 'Batch #'],
        ['c2', 'Total number'],
        ['c3', 'Healthy'],
        ['c4', 'Not Healthy › Stem rot'],
        ['c5', 'Not Healthy › Leaf rot'],
      ]);
    });

    it('starts the rows where the layout says: the row of units under the names is not a row of data', async () => {
      const bytes = await groupedFile();
      const guessed = await readImport(bytes, 'n.xlsx', nursery, ctx);
      // The guess takes the units for data (a row of text, under the names): the person moves the data down one.
      expect(guessed.rows.length).toBe(3);
      const preview = await readImport(bytes, 'n.xlsx', nursery, ctx, { layout: { headerFrom: 2, headerTo: 3, dataFrom: 5 } });
      expect(preview.layout.dataFrom).toBe(5);
      expect(preview.rows.map((row) => [row.rowNumber, row.cells['c1'], row.cells['c2']])).toEqual([
        [5, 'B-1', '100'],
        [6, 'B-2', '200'],
      ]);
      expect(preview.fileColumns[1].values.map((value) => value.row)).toEqual([5, 6]);
    });

    it('reads the names from the rows the person says, whatever was guessed', async () => {
      const bytes = await groupedFile();
      const one = await readImport(bytes, 'n.xlsx', nursery, ctx, { layout: { headerFrom: 3, headerTo: 3, dataFrom: 5 } });
      expect(one.fileColumns.map((column) => column.header)).toEqual(['Batch #', 'Total number', 'Healthy', 'Total', 'Stem rot', 'Leaf rot']);
      expect(one.detected).toEqual({ headerFrom: 2, headerTo: 3, dataFrom: 4 });
    });

    it('does not take a title merged across the whole width for a row of groups', async () => {
      const Excel = await loadExcel();
      const book = new Excel.Workbook();
      const ws = book.addWorksheet('Data');
      ws.addRow(['Nursery Progress 2026']);
      ws.addRow(['Batch #', 'Total number', 'Healthy']);
      ws.addRow(['B-1', 100, 90]);
      ws.mergeCells(1, 1, 1, 3);
      const preview = await readImport((await book.xlsx.writeBuffer()) as ArrayBuffer, 'n.xlsx', nursery, ctx);
      expect(preview.layout).toEqual({ headerFrom: 2, headerTo: 2, dataFrom: 3 });
      expect(preview.fileColumns.map((column) => column.header)).toEqual(['Batch #', 'Total number', 'Healthy']);
    });

    it('takes a group written once over its columns (not merged) when the person says the names take two rows', async () => {
      const Excel = await loadExcel();
      const book = new Excel.Workbook();
      const ws = book.addWorksheet('Data');
      ws.addRow(['Batch #', 'Not Healthy', null, null]);
      ws.addRow([null, 'Stem rot', 'Leaf rot', 'Smaller']);
      ws.addRow(['B-1', 3, 2, 1]);
      const bytes = (await book.xlsx.writeBuffer()) as ArrayBuffer;
      const preview = await readImport(bytes, 'n.xlsx', nursery, ctx, { layout: { headerFrom: 1, headerTo: 2, dataFrom: 3 } });
      expect(preview.fileColumns.map((column) => column.header)).toEqual(['Batch #', 'Not Healthy › Stem rot', 'Not Healthy › Leaf rot', 'Not Healthy › Smaller']);
    });

    it('does not stop an import for a name the file has twice: the first fills the column, the other is left out and said', async () => {
      const Excel = await loadExcel();
      const book = new Excel.Workbook();
      const ws = book.addWorksheet('Data');
      ws.addRow(['Batch #', 'Healthy', 'Healthy']);
      ws.addRow(['B-1', 90, 80]);
      const preview = await readImport((await book.xlsx.writeBuffer()) as ArrayBuffer, 'n.xlsx', nursery, ctx);
      expect(preview.issues).toEqual([]);
      expect(preview.matched.map((item) => [item.key, item.position])).toEqual([['c1', 1], ['c3', 2]]);
      expect(preview.repeated).toEqual(['Healthy']);
      expect(preview.rows[0].cells).toEqual({ c1: 'B-1', c3: '90' });
    });

    it('does not guess a column by its own name when two groups have one of that name', async () => {
      const Excel = await loadExcel();
      const book = new Excel.Workbook();
      const ws = book.addWorksheet('Data');
      ws.addRow(['Batch #', 'Healthy', null, 'Not Healthy', null]);
      ws.addRow([null, 'Leaf rot', 'Plants', 'Leaf rot', 'Plants']);
      ws.addRow(['B-1', 1, 2, 3, 4]);
      ws.mergeCells(1, 2, 1, 3);
      ws.mergeCells(1, 4, 1, 5);
      const preview = await readImport((await book.xlsx.writeBuffer()) as ArrayBuffer, 'n.xlsx', nursery, ctx);
      expect(preview.layout.headerTo).toBe(2);
      // "Leaf rot" is under two groups: neither is taken for the table's "Leaf rot" (the person says which).
      expect(preview.matched.map((item) => item.key)).toEqual(['c1']);
      expect(preview.unknownHeaders).toEqual(['Healthy › Leaf rot', 'Healthy › Plants', 'Not Healthy › Leaf rot', 'Not Healthy › Plants']);
    });

    it('shows the first rows as they are, a merged name once where it starts, and how far a layout can reach', async () => {
      const preview = await readImport(await groupedFile(), 'n.xlsx', nursery, ctx);
      expect(preview.peek.total).toBe(6);
      expect(preview.peek.rows[1].cells.slice(0, 6)).toEqual(['Batch #', 'Total number', 'Healthy', '', 'Not Healthy', '']);
      expect(preview.peek.rows[0].cells).toEqual(['Nursery Progress 2026', '', '', '', '', '']);
    });

    it('gives Sync the same names and columns the import read, for a connected table', async () => {
      const bytes = await groupedFile();
      const layout = { headerFrom: 2, headerTo: 3, dataFrom: 5 };
      const preview = await readImport(bytes, 'n.xlsx', nursery, ctx, { layout });
      const [tab] = await readExcelSheets(bytes, { tab: 'nursery progress', layout });
      expect(tab.headers).toEqual(preview.sync.headers);
      expect(tab.positions).toEqual(preview.sync.positions);
      expect(tab.layout).toEqual(layout);
      expect(tab.rows).toEqual([['B-1', '100', '90', '95', '3', '2'], ['B-2', '200', '180', '190', '6', '4']]);
    });

    it('reads a tab with no layout set exactly as before: its first row with two cells, the single names row', async () => {
      const bytes = await groupedFile(false);
      const [tab] = await readExcelSheets(bytes);
      expect(tab.layout).toEqual({ headerFrom: 1, headerTo: 1, dataFrom: 2 });
      expect(tab.headers).toEqual(['Batch #', 'Total number', 'Healthy', 'Healthy 2', 'Not Healthy', 'Not Healthy 2']);
    });
  });

  it('only takes .xlsx files', async () => {
    await expect(readImport(new ArrayBuffer(4), 'old.xls', qc, ctx)).rejects.toThrow('.xlsx');
  });
});
