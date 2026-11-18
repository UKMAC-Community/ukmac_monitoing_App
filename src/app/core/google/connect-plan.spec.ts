import type { Column } from '../models';
import { loadImportBook, readImportFrom } from '@shared/excel/excel-template';
import { loadExcel } from '@shared/excel/exceljs';
import { plainLayout } from '@shared/excel/file-layout';
import { readExcelSheets } from '@shared/excel/sheet-from-excel';
import { makeSheet } from '@shared/testing/test-helpers';
import { defaultTab, linkChanged, linkHeaderMap, linkLayout, looseName } from './connect-plan';
import { cellsFor, mappingFromLink, matchHeaders } from './sheet-sync';

const soilColumns: Column[] = [
  { key: 'c1', name: 'Date', type: 'text' },
  { key: 'c2', name: 'Zone', type: 'text' },
  { key: 'c3', name: 'Note', type: 'text' },
];
const soil = makeSheet(5, 'Soil Preparation', soilColumns, []);

/** A Google Sheet as the farm keeps it: its own tab names and headers, and a column the app has no use for. */
async function farmSheet(): Promise<ArrayBuffer> {
  const Excel = await loadExcel();
  const book = new Excel.Workbook();
  const tab = book.addWorksheet('soil_preparation');
  tab.addRow(['Day', 'Zone', 'Remarks', 'Tractor driver']);
  tab.addRow(['2026-06-01', 'A1', 'ploughed', 'Sok']);
  tab.addRow(['2026-06-02', 'A2', 'harrowed', 'Dara']);
  book.addWorksheet('Plant Progress').addRow(['Zone plot', 'Plants']);
  return (await book.xlsx.writeBuffer()) as ArrayBuffer;
}

describe('connecting a MAC to one Google Sheet', () => {
  it('saves the matches made by hand so Sync reads the tab the same way, and leaves the other headers out', async () => {
    const bytes = await farmSheet();
    const tabs = await readExcelSheets(bytes);
    const tab = defaultTab(soil, tabs, null, 'sheet-1');
    expect(tab).toBe('soil_preparation');
    const data = tabs.find((item) => item.name === tab)!;

    const book = await loadImportBook(bytes);
    // As the page reads a tab for a table not connected to it yet: the names are looked for.
    const preview = readImportFrom(book, `Farm › ${tab}.xlsx`, soil, { linkOptions: () => [] }, { tab: tab! });
    // By name only Zone is found; the person matches Day → Date and Remarks → Note.
    expect(preview.matched.map((item) => item.key)).toEqual(['c2']);
    const at = (header: string) => preview.sync.positions[preview.sync.headers.indexOf(header)];
    const mapping = { c1: at('Day'), c2: at('Zone'), c3: at('Remarks') };

    const headerMap = linkHeaderMap(preview.sync, mapping);
    expect(headerMap).toEqual({ day: 'c1', zone: 'c2', remarks: 'c3', 'tractor driver': '' });
    expect(linkLayout(preview.layout, data.auto.headerFrom)).toBeNull();

    // What Sync then does with the link: every header goes where it was put, none is added as a column.
    const { matched, fresh } = matchHeaders(soilColumns, data.headers, headerMap);
    expect(fresh).toEqual([]);
    expect([...matched].map(([index, column]) => [data.headers[index], column.key])).toEqual([
      ['Day', 'c1'],
      ['Zone', 'c2'],
      ['Remarks', 'c3'],
    ]);
    expect(cellsFor(matched, data, () => []).rows).toEqual([
      { c1: '2026-06-01', c2: 'A1', c3: 'ploughed' },
      { c1: '2026-06-02', c2: 'A2', c3: 'harrowed' },
    ]);

    // Opened again on the page (connected: read where Sync reads it), the link comes back as it is.
    const link = { spreadsheetId: 'sheet-1', tabTitle: tab!, headerMap, layout: null };
    const again = readImportFrom(book, `Farm › ${tab}.xlsx`, soil, { linkOptions: () => [] }, { tab: tab!, layout: plainLayout(data.auto.headerFrom) });
    const kept = mappingFromLink(soilColumns, again.sync.headers, again.sync.positions, headerMap);
    expect(kept).toEqual(mapping);
    expect(linkChanged(link, { ...link, headerMap: linkHeaderMap(again.sync, kept), layout: linkLayout(again.layout, data.auto.headerFrom) })).toBe(false);
  });

  it('finds the names under a group row by the table\'s own names, and keeps where they are in the link', async () => {
    const Excel = await loadExcel();
    const sheetBook = new Excel.Workbook();
    const ws = sheetBook.addWorksheet('Irrigation log');
    ws.getRow(1).values = ['', '', 'Water', '', ''];
    ws.mergeCells('C1:D1');
    ws.getRow(2).values = ['Date', 'Zone', 'Litres', 'Minutes', 'Note'];
    ws.getRow(3).values = ['2026-06-03', 'A1', '1200', '40', 'ok'];
    const bytes = (await sheetBook.xlsx.writeBuffer()) as ArrayBuffer;
    const tab = (await readExcelSheets(bytes)).find((item) => item.name === 'Irrigation log')!;
    const preview = readImportFrom(await loadImportBook(bytes), 'x.xlsx', soil, { linkOptions: () => [] }, { tab: tab.name });
    expect(preview.layout.dataFrom).toBe(3);
    expect(preview.matched.map((item) => item.key).sort()).toEqual(['c1', 'c2', 'c3']);
    const layout = linkLayout(preview.layout, tab.auto.headerFrom);
    expect(layout).not.toBeNull();
    // Sync reads it there, and every matched name is found.
    const data = (await readExcelSheets(bytes, { tab: tab.name, layout: layout! })).find((item) => item.name === tab.name)!;
    const headerMap = linkHeaderMap(preview.sync, Object.fromEntries(preview.matched.map((item) => [item.key, item.position])));
    const { matched } = matchHeaders(soilColumns, data.headers, headerMap);
    expect(cellsFor(matched, data, () => []).rows).toEqual([{ c1: '2026-06-03', c2: 'A1', c3: 'ok' }]);
  });

  it('opens a link made with names on two rows (a stage over each field) and gives the same link back, so it is not saved again', async () => {
    const Excel = await loadExcel();
    const sheetBook = new Excel.Workbook();
    const ws = sheetBook.addWorksheet('QA QC');
    ws.getRow(1).values = ['', 'Stage 1', '', 'Stage 2', '', ''];
    ws.mergeCells('B1:C1');
    ws.mergeCells('D1:E1');
    ws.getRow(2).values = ['Zone', 'Disease', 'Healthy', 'Disease', 'Healthy', 'Remark'];
    ws.getRow(3).values = ['A1', '2', '18', '1', '19', 'ok'];
    ws.getRow(4).values = ['A2', '0', '20', '3', '17', ''];
    const bytes = (await sheetBook.xlsx.writeBuffer()) as ArrayBuffer;
    const qaColumns: Column[] = [
      { key: 'c1', name: 'Zone', type: 'text' },
      { key: 'c2', name: 'Disease 1', type: 'number' },
      { key: 'c3', name: 'Healthy 1', type: 'number' },
      { key: 'c4', name: 'Disease 2', type: 'number' },
      { key: 'c5', name: 'Healthy 2', type: 'number' },
    ];
    const qa = makeSheet(11, 'QA/QC Management', qaColumns, []);
    const tab = (await readExcelSheets(bytes)).find((item) => item.name === 'QA QC')!;
    const headerRow = tab.auto.headerFrom;
    const ctx = { linkOptions: () => [] };

    // Connected the wizard's way: the person said the names are on rows 1–2 and matched each column; Remark is left out.
    const said = { headerFrom: 1, headerTo: 2, dataFrom: 3 };
    const first = readImportFrom(await loadImportBook(bytes), 'QA.xlsx', qa, ctx, { tab: 'QA QC', layout: said });
    const mapping = { c1: 1, c2: 2, c3: 3, c4: 4, c5: 5 };
    const link = { spreadsheetId: 's', tabTitle: 'QA QC', headerMap: linkHeaderMap(first.sync, mapping), layout: linkLayout(first.layout, headerRow) };
    expect(link.layout).toEqual(said);
    expect(Object.values(link.headerMap).sort()).toEqual(['', 'c1', 'c2', 'c3', 'c4', 'c5']);

    // The page opens it again: same matches, same link, nothing to save.
    const again = readImportFrom(await loadImportBook(bytes), 'QA.xlsx', qa, ctx, { tab: 'QA QC', layout: link.layout ?? plainLayout(headerRow) });
    const kept = mappingFromLink(qaColumns, again.sync.headers, again.sync.positions, link.headerMap);
    expect(kept).toEqual(mapping);
    const next = { spreadsheetId: 's', tabTitle: 'QA QC', headerMap: linkHeaderMap(again.sync, kept), layout: linkLayout(again.layout, headerRow) };
    expect(linkChanged(link, next)).toBe(false);

    // And Sync reads the tab with it: each stage's Disease to its own column, Remark left out.
    const data = (await readExcelSheets(bytes, { tab: 'QA QC', layout: link.layout! })).find((item) => item.name === 'QA QC')!;
    const { matched, fresh } = matchHeaders(qaColumns, data.headers, link.headerMap);
    expect(fresh).toEqual([]);
    expect(cellsFor(matched, data, () => []).rows).toEqual([
      { c1: 'A1', c2: '2', c3: '18', c4: '1', c5: '19' },
      { c1: 'A2', c2: '0', c3: '20', c4: '3', c5: '17' },
    ]);
  });

  it('keeps a header that fills a column when another by the same name fills none', () => {
    const map = linkHeaderMap({ headers: ['Note', 'Note'], positions: [3, 7] }, { c3: 7 });
    expect(map).toEqual({ note: 'c3' });
  });

  it('keeps the layout only when Sync would not find the names there by itself', () => {
    expect(linkLayout({ headerFrom: 2, headerTo: 2, dataFrom: 3 }, 2)).toBeNull();
    expect(linkLayout({ headerFrom: 1, headerTo: 2, dataFrom: 3 }, 2)).toEqual({ headerFrom: 1, headerTo: 2, dataFrom: 3 });
  });

  describe('the tab a table reads unless the person picks another', () => {
    const tabs = [{ name: 'Soil Preparation' }, { name: 'QA-QC Management' }, { name: 'Zones' }, { name: 'Old soil' }];

    it('is the tab of its name, written as the input workbook writes it or loosely', () => {
      expect(defaultTab(makeSheet(11, 'QA/QC Management', []), tabs, null, 's')).toBe('QA-QC Management');
      expect(defaultTab(makeSheet(5, 'soil  preparation', []), tabs, null, 's')).toBe('Soil Preparation');
      expect(defaultTab(makeSheet(6, 'Harvest', []), tabs, null, 's')).toBeNull();
    });

    it('is the tab it reads now when it reads this sheet, and none when it reads another (its link stays)', () => {
      expect(defaultTab(soil, tabs, { spreadsheetId: 's', tabTitle: 'Old soil' }, 's')).toBe('Old soil');
      expect(defaultTab(soil, tabs, { spreadsheetId: 'other', tabTitle: 'Soil Preparation' }, 's')).toBeNull();
    });

    it('is never picked for Zones by itself: a read would replace the map', () => {
      expect(defaultTab(makeSheet(1, 'Zones', [], [], 'zones'), tabs, null, 's')).toBeNull();
    });

    it("pairs Fertigation with the farm sheet's Fertilizer tab, Pesticides with its Fungicide tab, Pruning with Pruning", () => {
      const farm = ['Zone_Map', 'Pruning', 'Fertilizer', 'Fungicide', 'Zone_Map_Data', 'Plant Progress', 'Harvest'].map((name) => ({ name }));
      const tab = (title: string, key: string, tabs = farm) => defaultTab(makeSheet(7, title, [], [], key), tabs, null, 's');
      expect([tab('Fertigation', 'fertigation'), tab('Pesticides', 'pesticides'), tab('Pruning', 'pruning')]).toEqual(['Fertilizer', 'Fungicide', 'Pruning']);
      // A tab by the table's own name still comes first.
      expect(tab('Pesticides', 'pesticides', [...farm, { name: 'Pesticides' }])).toBe('Pesticides');
      // Only by the template: a table of another kind named so finds nothing.
      expect(tab('Sprays', 'irrigation')).toBeNull();
    });
  });

  it('says a link changes only when its sheet, tab, matches or layout do', () => {
    const link = { spreadsheetId: 's', tabTitle: 'Soil', headerMap: { 'Day ': 'c1', zone: 'c2' }, layout: null };
    const same = { spreadsheetId: 's', tabTitle: 'Soil', headerMap: { day: 'c1', zone: 'c2' }, layout: null };
    expect(linkChanged(link, same)).toBe(false);
    expect(linkChanged(null, same)).toBe(true);
    expect(linkChanged(link, { ...same, tabTitle: 'Soil 2' })).toBe(true);
    expect(linkChanged(link, { ...same, headerMap: { day: 'c1', zone: '' } })).toBe(true);
    expect(linkChanged(link, { ...same, layout: { headerFrom: 1, headerTo: 2, dataFrom: 3 } })).toBe(true);
  });

  it('reads names loosely', () => {
    expect(looseName('QA/QC  Management')).toBe(looseName('qa-qc_management'));
  });
});
