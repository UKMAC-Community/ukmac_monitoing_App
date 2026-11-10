import { TestBed } from '@angular/core/testing';

import { buildSyncWorkbook } from '../excel/sync-workbook';
import { readExcelSheets } from '../excel/sheet-from-excel';
import { planLinks } from '../google/link-plan';
import { makeMac, makeSheet } from '../test-helpers';
import { Api } from './api';
import { Google } from './google';
import type { GoogleLink } from './models';

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
});
