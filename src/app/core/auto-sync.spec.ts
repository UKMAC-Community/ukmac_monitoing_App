import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Api } from './api';
import { AutoSync } from './auto-sync';
import { Google, type SyncOutcome } from './google';
import type { GoogleLink } from './models';
import { Toasts } from './toast';
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
  let toasts: string[];
  let links: ReturnType<typeof signal<GoogleLink[]>>;
  let signedIn: ReturnType<typeof signal<boolean>>;
  let sync: AutoSync;
  const fileInfo = vi.fn();

  beforeEach(() => {
    changed = {};
    read = [];
    toasts = [];
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
        { provide: Toasts, useValue: { show: (text: string) => toasts.push(text) } },
      ],
    });
    sync = TestBed.inject(AutoSync);
  });

  it('reads a table whose sheet changed after it was last read, and says how many rows came', async () => {
    links.set([link(1, 'a', '2026-11-10 10:00:00')]);
    changed['a'] = '2026-11-10T10:05:00.000Z';
    expect(await sync.check()).toBe(1);
    expect(read).toEqual([[1]]);
    expect(toasts).toEqual(['Table 1 updated from Google · 3 new rows']);
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
