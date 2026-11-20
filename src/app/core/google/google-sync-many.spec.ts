import { TestBed } from '@angular/core/testing';

import { buildSyncWorkbook } from '@shared/excel/sync-workbook';
import { loadExcel } from '@shared/excel/exceljs';
import { readExcelSheets } from '@shared/excel/sheet-from-excel';
import { planLinks } from './link-plan';
import { makeMac, makeSheet } from '@shared/testing/test-helpers';
import { Api } from '../api';
import { Google } from './google';
import type { GoogleLink } from '../models';

const columns = [
  { key: 'c1', name: 'Date', type: 'text' as const },
  { key: 'c2', name: 'Note', type: 'text' as const },
];

describe('reading several tables of one Google Sheet', () => {
  it('downloads the sheet once, and fills every table from its own tab', async () => {
    // The input workbook, with a row in each of the two tabs; the tables here are still empty.
    const filled = [
      makeSheet(5, 'Soil Preparation', columns, [{ c1: 'a', c2: 'one' }]),
      makeSheet(6, 'Irrigation', columns, [{ c1: 'b', c2: 'two' }, { c1: 'c', c2: 'three' }]),
    ];
    const { bytes } = await buildSyncWorkbook(filled);
    const empty = [makeSheet(5, 'Soil Preparation', columns, []), makeSheet(6, 'Irrigation', columns, [])];
    const plan = planLinks(empty, await readExcelSheets(bytes));
    const links: GoogleLink[] = plan.ready.map((item, index) => ({
      linkId: index + 1,
      sheetId: item.table.sheetId,
      macId: 1,
      macName: 'Pursat',
      tableTitle: item.table.title,
      spreadsheetId: 'sheet-1',
      spreadsheetTitle: 'UKMAC input',
      tabTitle: item.tab.name,
      headerMap: item.headerMap,
      lastSyncedAt: null,
      lastRowCount: 0,
      layout: null,
    }));

    const downloads: string[] = [];
    const written: Record<number, number> = {};
    const api = {
      googleDownload: async (id: string) => {
        downloads.push(id);
        return bytes;
      },
      getWorkbook: async () => ({ mac: makeMac(), sheets: empty }),
      addRows: async (sheetId: number, rows: unknown[]) => {
        written[sheetId] = rows.length;
        return [];
      },
      googleLinkSynced: async (sheetId: number) => links.find((link) => link.sheetId === sheetId)!,
      listMacs: async () => [],
      getSetting: async () => null,
    };
    TestBed.configureTestingModule({ providers: [{ provide: Api, useValue: api }] });
    const google = TestBed.inject(Google);
    google.links.set(links);

    const results = await google.syncMany([5, 6]);
    expect(downloads).toEqual(['sheet-1']); // not one per table
    expect(written).toEqual({ 5: 1, 6: 2 });
    expect([...results.values()].every((result) => !(result instanceof Error))).toBe(true);
  });

  it('opens the sheet once for tables read the same way, and apart for a table with its own layout', async () => {
    // One tab, a units row under its names: one table says its data starts under the units (its own layout), the other reads it plainly.
    const Excel = await loadExcel();
    const book = new Excel.Workbook();
    const tab = book.addWorksheet('Nursery');
    tab.addRow(['Date', 'Note']);
    tab.addRow(['dd/mm', 'text']);
    tab.addRow(['01/07', 'one']);
    tab.addRow(['02/07', 'two']);
    const bytes = (await book.xlsx.writeBuffer()) as ArrayBuffer;
    const link = (sheetId: number, layout: GoogleLink['layout']): GoogleLink => ({
      linkId: sheetId,
      sheetId,
      macId: 1,
      macName: 'Pursat',
      tableTitle: `Table ${sheetId}`,
      spreadsheetId: 'sheet-1',
      spreadsheetTitle: 'UKMAC input',
      tabTitle: 'Nursery',
      headerMap: {},
      lastSyncedAt: null,
      lastRowCount: 0,
      layout,
    });
    const links = [link(7, { headerFrom: 1, headerTo: 1, dataFrom: 3 }), link(8, null), link(9, null)];
    const empty = [7, 8, 9].map((id) => makeSheet(id, `Table ${id}`, columns, []));

    const downloads: string[] = [];
    const written: Record<number, unknown[][]> = {};
    const api = {
      googleDownload: async (id: string) => {
        downloads.push(id);
        return bytes;
      },
      getWorkbook: async () => ({ mac: makeMac(), sheets: empty }),
      addRows: async (sheetId: number, rows: Record<string, unknown>[]) => {
        written[sheetId] = rows.map((row) => [row['c1'], row['c2']]);
        return [];
      },
      googleLinkSynced: async (sheetId: number) => links.find((item) => item.sheetId === sheetId)!,
      listMacs: async () => [],
      getSetting: async () => null,
    };
    TestBed.configureTestingModule({ providers: [{ provide: Api, useValue: api }] });
    const google = TestBed.inject(Google);
    google.links.set(links);

    const results = await google.syncMany([7, 8, 9]);
    expect([...results.values()].filter((result) => result instanceof Error)).toEqual([]);
    expect(downloads).toEqual(['sheet-1']);
    // Its own layout leaves the units row out; read plainly, it is a row like the others (both plain tables alike).
    expect(written[7]).toEqual([['01/07', 'one'], ['02/07', 'two']]);
    expect(written[8]).toEqual([['dd/mm', 'text'], ['01/07', 'one'], ['02/07', 'two']]);
    expect(written[9]).toEqual(written[8]);
  });
});
