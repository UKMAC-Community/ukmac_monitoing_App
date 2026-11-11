import { inject, Injectable, signal } from '@angular/core';

import { Api } from './api';
import { Google } from './google';
import type { GoogleLink } from './models';
import { Toasts } from './toast';
import { WorkbookStore } from './workbook-store';

const KEY = 'google.autosync';
/** How often each linked Google Sheet is asked when it last changed (a small request: nothing is downloaded). */
const EVERY_MS = 30_000;

/**
 * Keeps every table linked to a Google Sheet in step with it, as the sheet changes. Google can't push to a
 * desktop app, so while the app is open and signed in it asks Drive when each linked sheet was last changed
 * and reads the tables of a sheet that changed after they were last read (the same read as the Sync button).
 *
 * A table open in Open in sheet is left alone (a read replaces its rows, which would race the spreadsheet's own saves)
 * and is read once it is closed. A sheet that can't be read is not tried again until it changes again.
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
        if (changed && this.newer(changed, link.lastSyncedAt!) && this.tried.get(link.sheetId) !== changed) stale.push({ link, changed });
      }
      if (!stale.length) return 0;
      for (const { link, changed } of stale) this.tried.set(link.sheetId, changed);
      const before = new Map(stale.map(({ link }) => [link.sheetId, link.lastRowCount]));
      const outcomes = await this.google.syncMany(stale.map(({ link }) => link.sheetId));
      for (const { link } of stale) {
        const outcome = outcomes.get(link.sheetId);
        if (!outcome || outcome instanceof Error) continue;
        read += 1;
        const gained = outcome.rows - (before.get(link.sheetId) ?? 0);
        const news = [gained > 0 ? `${gained} new row${gained === 1 ? '' : 's'}` : '', outcome.added.length ? `new column${outcome.added.length === 1 ? '' : 's'}: ${outcome.added.join(', ')}` : ''].filter(Boolean);
        this.toasts.show(`${link.tableTitle} updated from Google${news.length ? ` · ${news.join(' · ')}` : ''}`, 'info');
      }
    } finally {
      this.checking = false;
    }
    return read;
  }

  /** Whether Drive's change time (ISO) is after a read's time (UTC, `YYYY-MM-DD HH:MM:SS`). */
  private newer(changed: string, readAt: string): boolean {
    const changedAt = Date.parse(changed);
    const read = Date.parse(`${readAt.replace(' ', 'T')}Z`);
    return Number.isFinite(changedAt) && Number.isFinite(read) && changedAt > read;
  }
}
