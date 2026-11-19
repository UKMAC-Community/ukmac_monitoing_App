import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { makeSheet } from '@shared/testing/test-helpers';
import { Api } from './api';
import { AutoSync } from './auto-sync';
import { Google, type SyncOutcome } from './google/google';
import type { Column, GoogleLink } from './models';
import { WorkbookStore } from './workbook-store';

const link = (sheetId: number, spreadsheetId: string, lastSyncedAt: string | null, lastRowCount = 10): GoogleLink => ({
  linkId: sheetId,
  sheetId,
  macId: 1,
  macName: 'MAC',
  tableTitle: `Table ${sheetId}`,
  spreadsheetId,
  spreadsheetTitle: 'Farm',
  tabTitle: 'Tab',
  headerMap: {},
  lastSyncedAt,
  lastRowCount,
  layout: null,
});

describe('AutoSync: tables follow their Google Sheet', () => {
  let changed: Record<string, string | null>;
  let read: number[][];
  let links: ReturnType<typeof signal<GoogleLink[]>>;
  let signedIn: ReturnType<typeof signal<boolean>>;
  let sync: AutoSync;
  const fileInfo = vi.fn();

  beforeEach(() => {
    changed = {};
    read = [];
    links = signal<GoogleLink[]>([]);
    signedIn = signal(true);
    fileInfo.mockReset();
    fileInfo.mockImplementation(async (id: string) => ({ id, name: 'Farm', mimeType: '', owner: null, modifiedTime: changed[id] ?? null }));
    const outcome = (rows: number, added: string[] = []): SyncOutcome => ({ rows, added, problems: 0, truncated: false });
    TestBed.configureTestingModule({
      providers: [
        { provide: Api, useValue: { googleFileInfo: fileInfo, getSetting: async () => null, setSetting: async () => undefined } },
        {
          provide: Google,
          useValue: {
            signedIn,
            links,
            syncing: signal(new Set<number>()),
            syncMany: async (ids: number[]) => {
              read.push(ids);
              return new Map(ids.map((id) => [id, outcome(13)]));
            },
          },
        },
        { provide: WorkbookStore, useValue: { saving: () => 0 } },
      ],
    });
    sync = TestBed.inject(AutoSync);
  });

  it('reads a table whose sheet changed after it was last read', async () => {
    links.set([link(1, 'a', '2026-11-10 10:00:00')]);
    changed['a'] = '2026-11-10T10:05:00.000Z';
    expect(await sync.check()).toBe(1);
    expect(read).toEqual([[1]]);
  });

  it('leaves a table alone when its sheet has not changed since, or was never read', async () => {
    links.set([link(1, 'a', '2026-11-10 10:00:00'), link(2, 'b', null)]);
    changed['a'] = '2026-11-10T09:59:00.000Z';
    changed['b'] = '2026-11-10T11:00:00.000Z';
    expect(await sync.check()).toBe(0);
    expect(read).toEqual([]);
  });

  it('asks Drive once for each sheet, and reads all of its tables together', async () => {
    links.set([link(1, 'a', '2026-11-10 10:00:00'), link(2, 'a', '2026-11-10 10:00:00')]);
    changed['a'] = '2026-11-10T10:05:00.000Z';
    await sync.check();
    expect(fileInfo).toHaveBeenCalledTimes(1);
    expect(read).toEqual([[1, 2]]);
  });

  it('does not try a change again once tried, so a table that fails is not read every turn', async () => {
    links.set([link(1, 'a', '2026-11-10 10:00:00')]);
    changed['a'] = '2026-11-10T10:05:00.000Z';
    await sync.check();
    await sync.check();
    expect(read.length).toBe(1);
    changed['a'] = '2026-11-10T10:09:00.000Z';
    await sync.check();
    expect(read.length).toBe(2);
  });

  it('waits for a table open as a spreadsheet, then reads it', async () => {
    links.set([link(1, 'a', '2026-11-10 10:00:00')]);
    changed['a'] = '2026-11-10T10:05:00.000Z';
    const release = sync.hold(1);
    expect(await sync.check()).toBe(0);
    release();
    expect(await sync.check()).toBe(1);
  });

  it('does nothing when turned off, signed out, or Drive cannot be reached', async () => {
    links.set([link(1, 'a', '2026-11-10 10:00:00')]);
    changed['a'] = '2026-11-10T10:05:00.000Z';
    await sync.setOn(false);
    expect(await sync.check()).toBe(0);
    signedIn.set(false);
    await sync.setOn(true);
    expect(await sync.check()).toBe(0);
    signedIn.set(true);
    fileInfo.mockRejectedValueOnce(new Error('offline'));
    expect(await sync.check()).toBe(0);
    expect(await sync.check()).toBe(1);
  });
});

describe('AutoSync after an update', () => {
  let settings: Record<string, string | null>;
  let links: ReturnType<typeof signal<GoogleLink[]>>;
  let read: number[][];
  let saved: { sheetId: number; tabTitle: string; headerMap: Record<string, string> }[];
  let synced: number[];
  let sync: AutoSync;

  // A Pruning table as an update brings it (nothing in it, no link), beside a table already read from the farm's sheet.
  const pruning: Column[] = [
    { key: 'c4', name: 'ID', type: 'number', auto: true, aliases: ['Id', 'No'] },
    { key: 'c2', name: 'Zone', type: 'link', source: "'Zones'[Plot]", aliases: ['Zone plot', 'zone_plot'] },
    { key: 'c6', name: 'Round', type: 'number', aliases: ['Pruning round'] },
    { key: 'c8', name: 'Plants', type: 'number', aliases: ['Plants Eligible for Pruning'] },
    { key: 'c11', name: 'Date', type: 'date', aliases: ['Actual date'] },
  ];
  const tab = (name: string, headers: string[]) => ({ name, headers, rows: [headers.map(() => '1')] });

  function setUp(sheets: ReturnType<typeof makeSheet>[], tabs: ReturnType<typeof tab>[]) {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Api,
          useValue: {
            googleFileInfo: async (id: string) => ({ id, name: 'Farm', mimeType: '', owner: null, modifiedTime: '2026-11-10T09:00:00.000Z' }),
            getSetting: async (key: string) => settings[key] ?? null,
            setSetting: async (key: string, value: string | null) => void (settings[key] = value),
            getWorkbook: async () => ({ sheets }),
            saveGoogleLink: async (input: { sheetId: number; tabTitle: string; headerMap: Record<string, string> }) => void saved.push(input),
          },
        },
        {
          provide: Google,
          useValue: {
            signedIn: signal(true),
            links,
            syncing: signal(new Set<number>()),
            open: async (id: string) => ({ file: { id, name: 'Farm' }, tabs }),
            refreshLinks: async () => undefined,
            sync: async (id: number) => void synced.push(id),
            syncMany: async (ids: number[]) => {
              read.push(ids);
              return new Map(ids.map((id) => [id, { rows: 1, added: [], problems: 0, truncated: false }]));
            },
          },
        },
        { provide: WorkbookStore, useValue: { saving: () => 0 } },
      ],
    });
    sync = TestBed.inject(AutoSync);
  }

  beforeEach(() => {
    settings = {};
    links = signal<GoogleLink[]>([link(4, 'farm', '2026-11-10 10:00:00')]);
    read = [];
    saved = [];
    synced = [];
  });

  it('reads a table the update changed, though its sheet has not changed since, and only once', async () => {
    settings['google.resync'] = '[4]';
    setUp([], []);
    expect(await sync.check()).toBe(1);
    expect(read).toEqual([[4]]);
    expect(settings['google.resync']).toBeNull();
    expect(await sync.check()).toBe(0);
  });

  it("links a new table to its tab in the MAC's sheet, matched column by column, and reads it", async () => {
    setUp(
      [makeSheet(4, 'Plant Progress', [], [{}], 'zone-records'), makeSheet(8, 'Pruning', pruning, [], 'pruning')],
      [tab('Pruning', ['Zone Plot', 'Pruning Round', 'Plants Eligible for Pruning', 'Actual Date'])],
    );
    expect(await sync.linkNewTables()).toBe(1);
    expect(saved).toEqual([
      expect.objectContaining({ sheetId: 8, tabTitle: 'Pruning', headerMap: { 'zone plot': 'c2', 'pruning round': 'c6', 'plants eligible for pruning': 'c8', 'actual date': 'c11' } }),
    ]);
    expect(synced).toEqual([8]);
  });

  it('leaves a tab that another table of the MAC reads already to it', async () => {
    links.set([link(4, 'farm', '2026-11-10 10:00:00'), { ...link(20, 'farm', '2026-11-10 10:00:00'), tabTitle: 'Pruning' }]);
    setUp([makeSheet(8, 'Pruning', pruning, [], 'pruning')], [tab('Pruning', ['Zone Plot', 'Actual Date'])]);
    expect(await sync.linkNewTables()).toBe(0);
  });

  it('leaves alone a table with rows, one the person disconnected, and one whose tab has columns it has none for', async () => {
    settings['sheet.9.autoLink'] = 'off';
    setUp(
      [
        makeSheet(8, 'Pruning', pruning, [{ c2: 'A1' }], 'pruning'),
        makeSheet(9, 'Pesticides', pruning, [], 'pesticides'),
        makeSheet(7, 'Fertigation', pruning, [], 'fertigation'),
      ],
      [tab('Pruning', ['Zone Plot', 'Actual Date']), tab('Fungicide', ['Zone Plot', 'Actual Date']), tab('Fertilizer', ['Zone Plot', 'Actual Date', 'Supplier'])],
    );
    expect(await sync.linkNewTables()).toBe(0);
    expect(saved).toEqual([]);
  });
});
