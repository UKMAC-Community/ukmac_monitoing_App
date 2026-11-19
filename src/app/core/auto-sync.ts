import { inject, Injectable, signal } from '@angular/core';

import { Api } from './api';
import { defaultTab, spreadsheetOf } from './google/connect-plan';
import { Google, noAutoLink } from './google/google';
import { headerMapOf, matchHeaders } from './google/sheet-sync';
import type { GoogleLink, SheetWithRows } from './models';
import { Toasts } from './toast';
import { WorkbookStore } from './workbook-store';

const KEY = 'google.autosync';
/** The linked tables an update changed the columns of (src-tauri/src/db/upgrade.rs): read again as soon as the app can. */
const RESYNC = 'google.resync';
/** How often each linked Google Sheet is asked when it last changed (a small request: nothing is downloaded). */
const EVERY_MS = 30_000;

/**
 * Keeps every table linked to a Google Sheet in step with it, as the sheet changes. Google can't push to a
 * desktop app, so while the app is open and signed in it asks Drive when each linked sheet was last changed
 * and reads the tables of a sheet that changed after they were last read (the same read as the Sync button).
 *
 * A table open in Open in sheet is left alone (a read replaces its rows, which would race the spreadsheet's own saves)
 * and is read once it is closed. A sheet that can't be read is not tried again until it changes again.
 *
 * After an update: a table whose columns the update changed is read again even if its sheet hasn't changed, and a table of
 * the template that has no link yet (one the update brought) is linked to its tab in the sheet its MAC reads (`linkNewTables`).
 */
@Injectable({ providedIn: 'root' })
export class AutoSync {
  private readonly api = inject(Api);
  private readonly google = inject(Google);
  private readonly store = inject(WorkbookStore);
  private readonly toasts = inject(Toasts);

  /** On unless the person turned it off. */
  readonly on = signal(true);
  /** Tables being edited now as a spreadsheet (by sheet id): not read until let go. */
  readonly held = signal<ReadonlySet<number>>(new Set());

  private started = false;
  private checking = false;
  /** The change time already tried for each table, so one that fails is not tried again for nothing. */
  private readonly tried = new Map<number, string>();
  /** Tables to read again whatever their sheet's change time (`RESYNC`), once loaded. */
  private again: Set<number> | null = null;
  /** New tables are linked once a session. */
  private linkedNew = false;

  async init() {
    if (this.started) return;
    this.started = true;
    try {
      this.on.set((await this.api.getSetting(KEY)) !== 'false');
    } catch {
      /* no settings yet: on */
    }
    setInterval(() => void this.check(), EVERY_MS);
    // Back to the window: look at once, rather than wait for the next turn.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.check();
    });
    void this.check();
  }

  async setOn(on: boolean) {
    this.on.set(on);
    await this.api.setSetting(KEY, on ? 'true' : 'false');
    if (on) void this.check();
  }

  /** A table is being edited as a spreadsheet; the returned function lets it go. */
  hold(sheetId: number): () => void {
    this.held.update((set) => new Set(set).add(sheetId));
    return () =>
      this.held.update((set) => {
        const next = new Set(set);
        next.delete(sheetId);
        return next;
      });
  }

  /** Reads the tables whose Google Sheet changed since they were last read. Returns how many tables were read. */
  async check(): Promise<number> {
    if (!this.on() || this.checking || document.hidden || !this.google.signedIn()) return 0;
    // Not while something is being saved or read.
    if (this.store.saving() > 0 || this.google.syncing().size > 0) return 0;
    this.checking = true;
    let read = 0;
    try {
      if (!this.linkedNew) {
        this.linkedNew = true;
        await this.linkNewTables();
      }
      const again = await this.toReadAgain();
      const links = this.google.links().filter((link) => link.lastSyncedAt && !this.held().has(link.sheetId));
      const times = new Map<string, string | null>();
      const stale: { link: GoogleLink; changed: string }[] = [];
      for (const link of links) {
        if (!times.has(link.spreadsheetId)) {
          try {
            times.set(link.spreadsheetId, (await this.api.googleFileInfo(link.spreadsheetId)).modifiedTime);
          } catch {
            times.set(link.spreadsheetId, null); // offline, or no access: try at the next turn
          }
        }
        const changed = times.get(link.spreadsheetId);
        if (changed && this.tried.get(link.sheetId) !== changed && (again.has(link.sheetId) || this.newer(changed, link.lastSyncedAt!))) stale.push({ link, changed });
      }
      if (!stale.length) return 0;
      for (const { link, changed } of stale) this.tried.set(link.sheetId, changed);
      const outcomes = await this.google.syncMany(stale.map(({ link }) => link.sheetId));
      // Quiet on purpose: the tables just show the new data, with no message.
      let readAgain = false;
      for (const { link } of stale) {
        const outcome = outcomes.get(link.sheetId);
        if (outcome && !(outcome instanceof Error)) {
          read += 1;
          readAgain = again.delete(link.sheetId) || readAgain;
        }
      }
      if (readAgain) await this.api.setSetting(RESYNC, again.size ? JSON.stringify([...again]) : null).catch(() => undefined);
    } finally {
      this.checking = false;
    }
    return read;
  }

  /** The tables an update asked to be read again (none left once each is read). */
  private async toReadAgain(): Promise<Set<number>> {
    if (!this.again) {
      let ids: unknown = [];
      try {
        ids = JSON.parse((await this.api.getSetting(RESYNC)) ?? '[]');
      } catch {
        /* none */
      }
      this.again = new Set(Array.isArray(ids) ? ids.filter((id): id is number => typeof id === 'number') : []);
    }
    return this.again;
  }

  /**
   * Links the template's tables that have no Google link yet, nothing in them, and a tab of their own in the Google Sheet
   * their MAC reads (by its name, or the farm's: Fertigation's Fertilizer tab), then reads them: a table an update brought, or
   * one that wasn't connected before, follows the farm's sheet as the others do. Only when every column of the tab has a column
   * in the table (none is added, none left out). A table the person disconnected is never linked again by itself.
   */
  async linkNewTables(): Promise<number> {
    const done: string[] = [];
    try {
      const all = this.google.links();
      // The sheets the farm's tables are read from (not one the app made and writes to).
      const links = all.filter((link) => link.origin !== 'app');
      for (const macId of new Set(links.map((link) => link.macId))) {
        const book = await this.api.getWorkbook(macId);
        const unlinked: SheetWithRows[] = [];
        for (const sheet of book.sheets) {
          if (!sheet.templateKey || sheet.templateKey === 'zones' || sheet.rows.length || all.some((link) => link.sheetId === sheet.sheetId)) continue;
          if ((await this.api.getSetting(noAutoLink(sheet.sheetId))) === 'off') continue;
          unlinked.push(sheet);
        }
        const target = unlinked.length ? spreadsheetOf(links, unlinked[0].sheetId, macId) : null;
        if (!target) continue;
        const opened = await this.google.open(target.spreadsheetId);
        // A tab another table of the MAC reads already is left to it (a table imported from it, say): no second copy.
        const read = new Set(all.filter((link) => link.macId === macId && link.spreadsheetId === opened.file.id).map((link) => link.tabTitle));
        for (const sheet of unlinked) {
          const name = defaultTab(sheet, opened.tabs, null, opened.file.id);
          const tab = opened.tabs.find((item) => item.name === name);
          if (!tab?.rows.length || read.has(tab.name)) continue;
          const { matched, fresh } = matchHeaders(sheet.columns, tab.headers, {});
          if (fresh.length || matched.size < 2) continue;
          await this.api.saveGoogleLink({
            sheetId: sheet.sheetId,
            spreadsheetId: opened.file.id,
            spreadsheetTitle: opened.file.name,
            tabTitle: tab.name,
            headerMap: headerMapOf(tab.headers, matched),
            layout: null,
          });
          read.add(tab.name);
          await this.google.refreshLinks();
          await this.google.sync(sheet.sheetId);
          done.push(`${sheet.title} (${tab.name})`);
        }
      }
    } catch {
      /* offline, or no access: tried again next time the app opens */
    }
    if (done.length) this.toasts.show(`Now read from Google: ${done.join(', ')}`);
    return done.length;
  }

  /** Whether Drive's change time (ISO) is after a read's time (UTC, `YYYY-MM-DD HH:MM:SS`). */
  private newer(changed: string, readAt: string): boolean {
    const changedAt = Date.parse(changed);
    const read = Date.parse(`${readAt.replace(' ', 'T')}Z`);
    return Number.isFinite(changedAt) && Number.isFinite(read) && changedAt > read;
  }
}
