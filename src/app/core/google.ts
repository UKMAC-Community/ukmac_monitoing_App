import { computed, inject, Injectable, signal } from '@angular/core';

import { WorkbookFormulas } from '../formula/sheet-formulas';
import type { FileLayout } from '../excel/file-layout';
import { readExcelSheets, tableFromSheet, type ExcelSheetData } from '../excel/sheet-from-excel';
import { cellsFor, headerMapOf, matchHeaders, newColumns } from '../google/sheet-sync';
import { parseLinkSource, todayIso } from '../sheet/columns';
import { Api, errorText } from './api';
import { MacList } from './mac-list';
import type { DriveFile, GoogleLink, GoogleStatus, SheetWithRows } from './models';
import { PowerBi } from './powerbi';
import { Toasts } from './toast';
import { WorkbookStore } from './workbook-store';

/** What a read of a Google Sheet's tab into its table did. */
export interface SyncOutcome {
  rows: number;
  /** Names of the columns that were added because the tab had new headers. */
  added: string[];
  /** Cells that don't fit their column (drawn red in the table). */
  problems: number;
  /** The tab has more rows than the app takes. */
  truncated: boolean;
}

/** A Google Sheet opened: its file and the tabs that have data. */
export interface OpenedSheet {
  file: DriveFile;
  bytes: ArrayBuffer;
  tabs: ExcelSheetData[];
}

/**
 * Google sign-in and Google Sheets: who is signed in, which tables are kept in step with a tab, and
 * reading a tab into its table. Everything with Google happens in the backend (src-tauri/src/google.rs),
 * which holds the tokens; this side only asks.
 */
@Injectable({ providedIn: 'root' })
export class Google {
  private readonly api = inject(Api);
  private readonly store = inject(WorkbookStore);
  private readonly toasts = inject(Toasts);
  private readonly macList = inject(MacList);
  private readonly powerBi = inject(PowerBi);

  readonly status = signal<GoogleStatus | null>(null);
  /** The browser is open on Google, waiting for the answer. */
  readonly signingIn = signal(false);
  /** Every table kept in step with a tab, of every MAC. */
  readonly links = signal<GoogleLink[]>([]);
  /** Tables being read now (by sheet id). */
  readonly syncing = signal<ReadonlySet<number>>(new Set());

  readonly signedIn = computed(() => this.status()?.signedIn ?? false);
  private started = false;

  async init() {
    if (this.started) return;
    this.started = true;
    await Promise.all([this.refreshStatus(), this.refreshLinks()]);
  }

  async refreshStatus() {
    try {
      this.status.set(await this.api.googleStatus());
    } catch {
      /* shown as not set up */
    }
  }

  async refreshLinks() {
    try {
      this.links.set(await this.api.listGoogleLinks());
    } catch {
      /* none shown */
    }
  }

  linkOf(sheetId: number) {
    return this.links().find((link) => link.sheetId === sheetId) ?? null;
  }

  isSyncing(sheetId: number) {
    return this.syncing().has(sheetId);
  }

  async saveClient(clientId: string, clientSecret: string) {
    this.status.set(await this.api.googleSaveClient(clientId, clientSecret));
  }

  /** Opens Google in the browser; resolves when the user has finished there (or it failed). */
  async signIn(): Promise<boolean> {
    if (this.signingIn()) return false;
    this.signingIn.set(true);
    try {
      this.status.set(await this.api.googleSignIn());
      const who = this.status()?.email;
      this.toasts.show(who ? `Signed in as ${who}` : 'Signed in with Google');
      return true;
    } catch (error) {
      const text = errorText(error);
      if (text !== 'Sign-in cancelled.') this.toasts.error(text);
      return false;
    } finally {
      this.signingIn.set(false);
    }
  }

  async cancelSignIn() {
    try {
      await this.api.googleCancelSignIn();
    } catch {
      /* nothing was waiting */
    }
  }

  /**
   * Log out: Google is told to forget this app's access and the tokens are dropped. The Client ID
   * and secret stay, unless `forgetClient` is set: then they are removed too.
   */
  async signOut(forgetClient = false): Promise<boolean> {
    const wasSignedIn = this.signedIn();
    try {
      this.status.set(await this.api.googleSignOut(forgetClient));
      this.toasts.show(
        !forgetClient
          ? 'Logged out of Google. Sign in again to sync.'
          : wasSignedIn
            ? 'Logged out, and the Google client was forgotten.'
            : 'The Google client was forgotten.',
      );
      return true;
    } catch (error) {
      this.toasts.error(errorText(error));
      return false;
    }
  }

  /** A Google call that may find the sign-in has ended: the status is read again then, so the screen says so. */
  private async guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      void this.refreshStatus();
      throw error;
    }
  }

  listSheets(query: string) {
    return this.guard(() => this.api.googleListSpreadsheets(query.trim() || null));
  }

  /** A sheet (picked from the list, or pasted as a link) downloaded and its tabs read (`set`: one tab as the person said its names and data are). */
  async open(file: string, set?: { tab: string; layout: FileLayout }): Promise<OpenedSheet> {
    return this.guard(async () => {
      const info = await this.api.googleFileInfo(file);
      const bytes = await this.api.googleDownload(info.id);
      return { file: info, bytes, tabs: await readExcelSheets(bytes, set) };
    });
  }

  /**
   * Makes a table of a tab, linked to it, in the open MAC. The table's columns are the tab's headers
   * (their types guessed from what's under them), its rows the tab's rows.
   */
  async importTab(opened: OpenedSheet, data: ExcelSheetData, input: { title: string; heading: string }): Promise<SheetWithRows> {
    const { columns, rows } = tableFromSheet(data);
    const created = await this.store.createSheet({
      title: input.title,
      heading: input.heading,
      about: `Read from the Google Sheet “${opened.file.name}”, tab “${data.name}”. Press Sync to read it again.`,
      columns,
      rows,
    });
    try {
      const matched = new Map(created.columns.map((column, index) => [index, column] as const));
      await this.api.saveGoogleLink({
        sheetId: created.sheetId,
        spreadsheetId: opened.file.id,
        spreadsheetTitle: opened.file.name,
        tabTitle: data.name,
        headerMap: headerMapOf(data.headers, matched),
        rowCount: created.rows.length,
      });
      await this.refreshLinks();
    } catch (error) {
      // The table exists but isn't linked: say so rather than leave it looking synced.
      this.toasts.error(`“${input.title}” was made, but couldn't be linked to Google: ${errorText(error)}`);
    }
    void this.macList.refresh();
    this.powerBi.changed();
    return created;
  }

  /** Connects a table that already exists to a tab, with the column matches the user made. */
  async connectTable(
    sheetId: number,
    link: { spreadsheetId: string; spreadsheetTitle: string; tabTitle: string; headerMap: Record<string, string>; layout?: FileLayout | null },
    rowCount: number,
  ) {
    await this.api.saveGoogleLink({ sheetId, ...link, rowCount });
    await this.refreshLinks();
  }

  /**
   * Reads the table's tab again: the rows there are replaced by the tab's, columns the tab has
   * gained are added. (Edits made in the table to what comes from the tab are overwritten, which
   * is what keeping in step means.)
   */
  async sync(sheetId: number): Promise<SyncOutcome> {
    const link = this.linkOf(sheetId);
    if (!link) throw new Error("This table isn't linked to a Google Sheet.");
    if (this.isSyncing(sheetId)) throw new Error('This table is being read already.');
    this.syncing.update((set) => new Set(set).add(sheetId));
    try {
      return await this.guard(() => this.read(link));
    } finally {
      this.syncing.update((set) => {
        const next = new Set(set);
        next.delete(sheetId);
        return next;
      });
    }
  }

  private async read(link: GoogleLink): Promise<SyncOutcome> {
    const bytes = await this.api.googleDownload(link.spreadsheetId);
    // Where the tab's names and data are, if the person said when it was connected; else found as for any tab.
    const tabs = await readExcelSheets(bytes, link.layout ? { tab: link.tabTitle, layout: link.layout } : undefined);
    const same = (name: string) => name.trim().toLowerCase() === link.tabTitle.trim().toLowerCase();
    const data = tabs.find((tab) => tab.name === link.tabTitle) ?? tabs.find((tab) => same(tab.name));
    if (!data) {
      throw new Error(`The tab “${link.tabTitle}” isn't in the Google Sheet any more. Its tabs: ${tabs.map((tab) => tab.name).join(', ')}.`);
    }

    // The MAC's tables: the open ones are in memory, another MAC's are read.
    const open = this.store.mac()?.macId === link.macId;
    const book = open ? this.store.sheets() : (await this.api.getWorkbook(link.macId)).sheets;
    let sheet = book.find((item) => item.sheetId === link.sheetId);
    if (!sheet) throw new Error("The table doesn't exist any more.");

    let { matched, fresh } = matchHeaders(sheet.columns, data.headers, link.headerMap);
    const added = fresh.map((index) => data.headers[index]);
    if (!data.rows.length && sheet.rows.length) {
      throw new Error(`The tab “${data.name}” has no rows right now, so the table was left as it is.`);
    }
    if (fresh.length) {
      const meta = await this.api.saveColumns(sheet.sheetId, [...sheet.columns, ...newColumns(data, fresh)]);
      sheet = { ...sheet, columns: meta.columns };
      ({ matched, fresh } = matchHeaders(sheet.columns, data.headers, link.headerMap));
    }

    const formulas = new WorkbookFormulas(book, todayIso());
    const { rows, problems } = cellsFor(matched, data, (column) =>
      column.type === 'link' ? formulas.linkOptions(parseLinkSource(column.source)) : [],
    );
    await this.api.addRows(sheet.sheetId, rows, {
      import: { fileName: `Google Sheets · ${link.spreadsheetTitle} › ${link.tabTitle}`, mode: 'replace' },
    });
    const updated = await this.api.googleLinkSynced(sheet.sheetId, rows.length, headerMapOf(data.headers, matched, link.headerMap));
    this.links.update((links) => links.map((item) => (item.sheetId === updated.sheetId ? updated : item)));
    if (open) await this.store.reload();
    void this.macList.refresh();
    this.powerBi.changed();
    return { rows: rows.length, added, problems, truncated: !!data.truncated };
  }

  /** `sync`, with its result told to the user. */
  async syncAndTell(sheetId: number): Promise<boolean> {
    try {
      const outcome = await this.sync(sheetId);
      const parts = [`${outcome.rows} row${outcome.rows === 1 ? '' : 's'} read from Google`];
      if (outcome.added.length) parts.push(`new column${outcome.added.length === 1 ? '' : 's'}: ${outcome.added.join(', ')}`);
      if (outcome.problems) parts.push(`${outcome.problems} cell${outcome.problems === 1 ? '' : 's'} to check (drawn red)`);
      this.toasts.show(parts.join(' · '), outcome.problems ? 'info' : 'ok');
      if (outcome.truncated) this.toasts.show('The Google tab has more rows than the app takes at a time (5000): the first 5000 were read.', 'info');
      return true;
    } catch (error) {
      this.toasts.error(errorText(error));
      return false;
    }
  }

  /**
   * Points a table's link at another Google Sheet or tab. The column matches the link remembers stay,
   * so the same headers fill the same columns. Nothing is read until Sync. Returns false when the
   * link is already this sheet and tab (nothing to change).
   */
  async relink(sheetId: number, target: { spreadsheetId: string; spreadsheetTitle: string; tabTitle: string }): Promise<boolean> {
    const link = this.linkOf(sheetId);
    if (!link) throw new Error("This table isn't linked to a Google Sheet.");
    if (link.spreadsheetId === target.spreadsheetId && link.tabTitle === target.tabTitle) return false;
    const saved = await this.api.saveGoogleLink({ sheetId, ...target, headerMap: link.headerMap, layout: link.layout });
    this.links.update((links) => links.map((item) => (item.sheetId === saved.sheetId ? saved : item)));
    return true;
  }

  async disconnect(sheetId: number) {
    await this.api.deleteGoogleLink(sheetId);
    this.links.update((links) => links.filter((link) => link.sheetId !== sheetId));
  }

  /** "2 min ago", from the backend's UTC time. */
  ago(utc: string | null): string {
    if (!utc) return 'not read yet';
    const then = new Date(`${utc.replace(' ', 'T')}Z`).getTime();
    if (!Number.isFinite(then)) return utc;
    const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    return new Date(then).toLocaleDateString('en-GB', { timeZone: 'Asia/Phnom_Penh' });
  }
}

/** A Google Sheet's address, as the browser shows it (pasted back, it opens the same sheet). */
export function sheetUrl(spreadsheetId: string) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

/** A tab's name as a table name (a table's name can't have [ or ] in it). */
export function tableNameOf(tab: string) {
  return tab.replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}
