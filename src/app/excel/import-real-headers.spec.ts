import type { Column } from '../core/models';
import columns from '../sheet/fixtures/qa-qc-columns.json';
import map from '../sheet/fixtures/qa-qc-sheet-map.json';
import { expectedColumn, type SheetColumn } from '../sheet/qa-qc-sheet-map.testing';
import { makeSheet } from '../test-helpers';
import { loadExcel } from './exceljs';
import { readImport } from './excel-template';
import headers from './fixtures/real-qaqc-headers.json';
import merges from './fixtures/real-qaqc-merges.json';
import { mergesOf, withGroupRow } from './file-layout';

/** The user's real "QA QC" tab (its three header rows, one made-up row of data) through the importer, into the QA/QC table. */
const table = makeSheet(2, 'QA/QC Management', columns as Column[]);
const sheet = map as SheetColumn[];
const expected = new Map(sheet.map((row) => [Number(row.n), expectedColumn(row, columns as Column[])] as const));
const ctx = { linkOptions: () => [] as string[] };

async function realTab() {
  const Excel = await loadExcel();
  const book = new Excel.Workbook();
  const tab = book.addWorksheet('QA QC');
  for (const item of headers as { n: number; r1: string; r2: string; r3: string }[]) {
    if (item.r1) tab.getCell(1, item.n).value = item.r1;
    if (item.r2) tab.getCell(2, item.n).value = item.r2;
    if (item.r3) tab.getCell(3, item.n).value = item.r3;
    tab.getCell(4, item.n).value = '1';
  }
  return (await book.xlsx.writeBuffer()) as ArrayBuffer;
}

describe('importing the real QA QC tab', () => {
  for (const [label, layout, unmatched] of [
    // The spacers hold only a banner (row 1): with the names on rows 2–3 they have none, so they are not columns of the file.
    ['names on rows 1–3', { headerFrom: 1, headerTo: 3, dataFrom: 4 }, [13, 144, 172, 229, 236, 237, 271]],
    ['names on rows 2–3', { headerFrom: 2, headerTo: 3, dataFrom: 4 }, [13, 236]],
  ] as const) {
    it(`puts every column where the sheet's map says, and finds all of them but the two worked out here (${label})`, async () => {
      const preview = await readImport(await realTab(), 'staging_analytics.xlsx', table, ctx, { layout });
      const wrong = preview.matched.filter((item) => expected.get(item.position)?.key !== item.key).map((item) => `${item.position} ${item.fileHeader} → ${item.header}`);
      expect(wrong).toEqual([]);
      // 287 columns of the map: 284 of the stages, the row's Block and Planting Date, and Notes. All but Dead Plant and the Rejected Total.
      expect(preview.matched).toHaveLength(285);
      expect(preview.issues).toEqual([]);
      expect(preview.repeated).toEqual([]);
      // What is left over: those two (worked out here), and the spacers that hold only a banner.
      const left = preview.fileColumns.filter((column) => !preview.matched.some((item) => item.position === column.position));
      expect(left).toHaveLength(preview.fileColumns.length - 285);
      expect(left.map((column) => column.position).sort((a, b) => a - b)).toEqual(unmatched);
    });
  }

  it('knows each file column\'s stage, so the screen can show them by stage', async () => {
    const preview = await readImport(await realTab(), 'staging_analytics.xlsx', table, ctx, { layout: { headerFrom: 1, headerTo: 3, dataFrom: 4 } });
    const stage = (position: number) => preview.fileColumns.find((column) => column.position === position)!.stage;
    expect([stage(1), stage(2), stage(3), stage(18), stage(169), stage(179), stage(300), stage(308)]).toEqual([0, 0, 1, 3, 5, 6, 10, 0]);
    const counts = new Map<number, number>();
    for (const column of preview.fileColumns) counts.set(column.stage, (counts.get(column.stage) ?? 0) + 1);
    // Stage 3 is its date and the five measures of 20 plants; every column is in some stage or is the row's own.
    expect(counts.get(3)).toBe(101);
    expect([...counts.values()].reduce((sum, count) => sum + count, 0)).toBe(preview.fileColumns.length);
    expect([...counts.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('matches a file with its names on one row as before, by name alone (no stage is involved)', async () => {
    const Excel = await loadExcel();
    const book = new Excel.Workbook();
    const tab = book.addWorksheet('Data');
    tab.addRow(['Planting Date', 'Block', '30 DAT Vegetative']);
    tab.addRow(['2026-05-10', 'A1', '2026-06-09']);
    const preview = await readImport((await book.xlsx.writeBuffer()) as ArrayBuffer, 'one.xlsx', table, ctx);
    // A name only one column answers to is matched with no stage involved; the file's "Planting Date" and "Block" are the row's own.
    expect(preview.matched.map((item) => item.header)).toEqual(['Date', 'Zone', '3 · Vegetative (30 DAT) · 30 DAT Vegetative']);
    expect(preview.unknownHeaders).toEqual([]);
  });

  it('finds the three rows that name the columns (banner, group, field) whichever of them is found first', async () => {
    const Excel = await loadExcel();
    const book = new Excel.Workbook();
    const tab = book.addWorksheet('QA QC');
    for (const item of headers as { n: number; r1: string; r2: string; r3: string }[]) {
      if (item.r1) tab.getCell(1, item.n).value = item.r1;
      if (item.r2) tab.getCell(2, item.n).value = item.r2;
      if (item.r3) tab.getCell(3, item.n).value = item.r3;
    }
    for (const range of merges as string[]) tab.mergeCells(range);
    const found = mergesOf(tab);
    expect(found).toHaveLength((merges as string[]).length);
    for (const row of [1, 2, 3]) expect(withGroupRow(found, row, 308), `found on row ${row}`).toEqual({ headerFrom: 1, headerTo: 3, dataFrom: 4 });
  });
});
