import { effect, inject, Injectable, signal, untracked } from '@angular/core';

import { buildPowerBiWorkbook } from '../excel/powerbi-export';
import { Api, errorText } from './api';
import { Toasts } from './toast';
import { WorkbookStore } from './workbook-store';
import { baseName } from './paths';

const PATH_KEY = 'powerbi.path';
const AUTO_KEY = 'powerbi.auto';
/** The Google account whose MACs the file shows: another account never rewrites it. */
const ACCOUNT_KEY = 'powerbi.account';

/**
 * The Power BI file: every MAC's tables in one .xlsx (see
 * `buildPowerBiWorkbook`). Kept up to date if asked: written again a few
 * seconds after each change, so Power BI's Refresh reads the latest.
 */
@Injectable({ providedIn: 'root' })
export class PowerBi {
  private readonly api = inject(Api);
  private readonly store = inject(WorkbookStore);
  private readonly toasts = inject(Toasts);

  readonly path = signal<string | null>(null);
  readonly auto = signal(false);
  readonly lastExport = signal<Date | null>(null);
  readonly exporting = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  constructor() {
    effect(() => {
      this.store.version();
      untracked(() => this.schedule());
    });
  }

  async init() {
    if (this.started) return;
    this.started = true;
    try {
      this.path.set(await this.api.getSetting(PATH_KEY));
      this.auto.set((await this.api.getSetting(AUTO_KEY)) === 'true');
      // A file made before accounts existed belongs to whoever is signed in now.
      const who = await this.account();
      if (who && this.path() && !(await this.api.getSetting(ACCOUNT_KEY))) await this.api.setSetting(ACCOUNT_KEY, who);
    } catch {
      /* no settings yet */
    }
  }

  /** Something outside the open MAC changed (a MAC made, renamed, deleted). */
  changed() {
    this.schedule();
  }

  private schedule() {
    if (!this.auto() || !this.path()) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.exportTo(this.path()!, true), 3000);
  }

  async setAuto(on: boolean) {
    this.auto.set(on);
    await this.api.setSetting(AUTO_KEY, on ? 'true' : 'false');
    if (on && this.path()) await this.exportTo(this.path()!, false);
  }

  /** Asks where, then writes the file there (and remembers it). */
  async exportAs(): Promise<string | null> {
    const suggested = this.path() ?? 'UKMAC Monitoring - Power BI.xlsx';
    const path = await this.api.pickSavePath(suggested);
    if (!path) return null;
    const ok = await this.exportTo(path, false);
    if (ok) {
      this.path.set(path);
      await this.api.setSetting(PATH_KEY, path);
    }
    return ok ? path : null;
  }

  /** The signed-in Google account, or null. */
  private async account(): Promise<string | null> {
    try {
      const status = await this.api.googleStatus();
      return status.signedIn ? (status.email ?? '').trim().toLowerCase() || null : null;
    } catch {
      return null;
    }
  }

  async exportTo(path: string, quiet: boolean): Promise<boolean> {
    if (this.exporting()) return false;
    this.exporting.set(true);
    try {
      const who = await this.account();
      const owner = await this.api.getSetting(ACCOUNT_KEY);
      if (!who || (owner && owner !== who)) {
        // Nobody signed in, or the file is another account's: it is left as it is.
        if (!quiet) this.toasts.error(!who ? 'Sign in with Google first.' : 'This Power BI file belongs to another Google account, so it was not changed.');
        return false;
      }
      const books = await this.api.getAllWorkbooks();
      const bytes = await buildPowerBiWorkbook(books);
      await this.api.writeFile(path, bytes);
      if (!owner) await this.api.setSetting(ACCOUNT_KEY, who);
      this.lastExport.set(new Date());
      if (!quiet) this.toasts.show(`Power BI file saved: ${baseName(path)}`);
      return true;
    } catch (error) {
      this.toasts.error(`Power BI file not saved: ${errorText(error)}`);
      return false;
    } finally {
      this.exporting.set(false);
    }
  }
}
