import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { Icon } from '../components/icon';
import { MacDialog } from '../components/mac-dialog';
import { UpdateButton } from '../components/update-button';
import { Api, errorText } from '../core/api';
import { Google } from '../core/google';
import { MacList } from '../core/mac-list';
import type { ImportedMac, Mac } from '../core/models';
import { Toasts } from '../core/toast';
import { WorkbookStore } from '../core/workbook-store';
import { formatDate } from '../sheet/columns';
import { baseName } from '../core/paths';

/** Every MAC on this Mac, under its province (its location), and a new one. */
@Component({
  selector: 'app-home-page',
  imports: [RouterLink, Icon, MacDialog, UpdateButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="home">
      <header class="hero">
        <div class="hero-brand">
          <img src="logo/UKMAC_Logo.webp" alt="" />
          <div>
            <h1>UKMAC</h1>
            <p>Monitoring · kept on this Mac, no server needed</p>
          </div>
        </div>
        <div class="hero-actions">
          <app-update-button />
          <a class="btn btn-plain" routerLink="/settings"><app-icon name="chart" [size]="15" /> Power BI &amp; backup</a>
        </div>
      </header>

      <div class="toolbar">
        <label class="input-wrap search">
          <span class="input-prefix"><app-icon name="search" [size]="15" /></span>
          <input class="input-field has-prefix" type="search" placeholder="Search MACs" [value]="search()" (input)="search.set($any($event.target).value)" />
        </label>
        <div class="toolbar-actions">
          <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="importFromFile()" title="Add a MAC saved to a file. Its data is read from Google, for accounts that can open the sheets">
            <app-icon name="upload" /> Import MAC
          </button>
          <button type="button" class="btn btn-primary" (click)="openNew()"><app-icon name="plus" /> Create MAC</button>
        </div>
      </div>

      @if (!macs.loaded()) {
        <div class="grid" aria-busy="true" aria-label="Loading MACs">
          @for (n of [1, 2, 3]; track n) {
            <div class="mac-card skel">
              <div class="mac-top"><span class="skeleton sk-avatar"></span><div class="grow sk-lines"><span class="skeleton sk-a"></span><span class="skeleton sk-b"></span></div></div>
              <span class="skeleton sk-c"></span>
              <span class="skeleton sk-d"></span>
            </div>
          }
        </div>
      }

      @if (macs.loaded() && !macs.macs().length) {
        <div class="card empty-state">
          <span class="empty-icon-wrap"><app-icon name="sprout" [size]="24" /></span>
          <strong>Start with your first MAC</strong>
          <p>
            A new chili MAC comes with the chili tables — Zones, Nursery Batches, Zone Records, QA/QC Management and the rest.
            Then download a table's Excel template, fill it in, and import it.
            Already have a MAC saved to a file on another computer? Import it here with its tables and rows.
          </p>
          <div class="empty-actions">
            <button type="button" class="btn btn-primary" (click)="openNew()"><app-icon name="plus" /> Create MAC</button>
            <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="importFromFile()"><app-icon name="upload" /> Import a MAC file</button>
          </div>
        </div>
      }

      @for (group of groups(); track group.place) {
        <section class="group">
          <div class="group-head">
            <h2 class="group-title"><app-icon name="pin" [size]="14" /> {{ group.place }} <small>{{ group.macs.length }} MAC{{ group.macs.length === 1 ? '' : 's' }}</small></h2>
          </div>
          <div class="grid">
            @for (mac of group.macs; track mac.macId) {
              <article class="mac-card" [style.animation-delay.ms]="$index * 60" (click)="open(mac)">
                <div class="mac-top">
                  <span class="mac-avatar">{{ initial(mac) }}</span>
                  <div class="grow">
                    <a class="mac-name" [routerLink]="['/mac', mac.macId]" (click)="$event.stopPropagation()">{{ mac.macName }}</a>
                    <span class="mac-where">{{ mac.macLocation || 'No location saved' }}</span>
                  </div>
                  <button type="button" class="icon-btn is-quiet is-sm" aria-label="More" (click)="$event.stopPropagation(); menuFor(mac, $event)">
                    <app-icon name="more-vertical" [size]="15" />
                  </button>
                </div>
                <div class="mac-tags">
                  <span class="chip crop"><app-icon name="sprout" [size]="13" /> {{ cropLabel(mac.crop) }}</span>
                  <span class="code">{{ mac.macCode }}</span>
                </div>
                <span class="mac-open">Open <app-icon name="arrow-right" [size]="14" /></span>
              </article>
            }
          </div>
        </section>
      }
    </div>

    @if (menu(); as menu) {
      <div class="menu-scrim" (mousedown)="menu$.set(null)"></div>
      <div class="menu-panel floating" [style.left.px]="menu.x" [style.top.px]="menu.y">
        <button type="button" class="menu-item" (click)="open(menu.mac)"><app-icon name="table" /> Open</button>
        <button type="button" class="menu-item" (click)="edit(menu.mac)"><app-icon name="edit" /> Edit</button>
        <button type="button" class="menu-item" (click)="saveToFile(menu.mac)" title="Save this MAC's tables and their Google links to a file, with the Zone Map's plots. No other data is in it: that is read from Google when the file is opened"><app-icon name="download" /> Save a link file…</button>
        <div class="menu-divider"></div>
        <button type="button" class="menu-item danger" (click)="remove(menu.mac)"><app-icon name="trash" /> Delete</button>
      </div>
    }

    <app-mac-dialog [open]="dialogOpen()" [mac]="editing()" (closed)="dialogOpen.set(false)" (saved)="saved($event)" />
  `,
  styles: `
    :host { display: block; flex: 1; overflow: auto; }
    .home { max-width: 1120px; margin: 0 auto; padding: 44px 32px 64px; display: flex; flex-direction: column; gap: 28px; }
    .hero { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .hero-brand { display: flex; align-items: center; gap: 16px; }
    .hero-actions { display: flex; align-items: center; gap: 8px; }
    .hero-brand img { width: 52px; height: 52px; border-radius: 14px; box-shadow: var(--shadow-card); background: var(--surface); }
    .hero h1 { margin: 0; font-size: 1.75rem; font-weight: 700; letter-spacing: -0.03em; line-height: 1.1; }
    .hero p { margin: 4px 0 0; font-size: 0.9375rem; color: var(--text-muted); }
    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .search { width: min(420px, 100%); }
    .toolbar-actions { display: flex; align-items: center; gap: 8px; }
    .search .input-field { background: var(--surface); }
        .group { display: flex; flex-direction: column; gap: 14px; }
    .group-title { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 1rem; font-weight: 600; }
    .group-title small { font-weight: 500; font-size: 0.8125rem; color: var(--text-muted); }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
    .mac-card { position: relative; display: flex; flex-direction: column; gap: 14px; padding: 20px; cursor: pointer; background: var(--surface); border: var(--hairline) solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-card); transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease; }
    .mac-card:hover { border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); box-shadow: 0 8px 24px -12px rgba(17, 24, 39, 0.18); }
    .mac-top { display: flex; align-items: center; gap: 12px; }
    .mac-avatar { display: grid; place-items: center; flex: none; width: 42px; height: 42px; border-radius: 12px; font-weight: 700; font-size: 1.125rem; background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); }
    .mac-name { display: block; font-weight: 600; font-size: 1.0625rem; color: var(--text); text-decoration: none; letter-spacing: -0.01em; }
    .mac-where { display: block; font-size: 0.8125rem; color: var(--text-muted); margin-top: 2px; }
    .mac-tags { display: flex; align-items: center; gap: 8px; }
    .chip.crop { padding: 3px 10px; font-size: 0.75rem; color: var(--text); cursor: default; }
    .code { font-size: 0.8125rem; font-weight: 600; color: var(--text); letter-spacing: 0.01em; }
    .mac-open { margin-top: 2px; padding-top: 12px; border-top: var(--hairline) solid var(--border); display: inline-flex; align-items: center; gap: 4px; font-size: 0.8125rem; font-weight: 600; color: var(--accent); }
    .mac-card:hover .mac-open app-icon { transform: translateX(3px); }
    .mac-open app-icon { transition: transform 0.18s ease; }
    .skel { pointer-events: none; cursor: default; }
    .sk-avatar { width: 42px; height: 42px; border-radius: 12px; }
    .sk-lines { display: flex; flex-direction: column; gap: 8px; }
    .sk-a { width: 120px; height: 14px; } .sk-b { width: 80px; height: 11px; }
    .sk-c { width: 140px; height: 24px; border-radius: 999px; } .sk-d { width: 60px; height: 12px; }
    @media (prefers-reduced-motion: no-preference) {
      .mac-card:not(.skel) { animation: itemIn 380ms var(--ease) both; }
      .hero, .toolbar { animation: itemIn 380ms var(--ease) both; }
      .toolbar { animation-delay: 60ms; }
    }
    @media (max-width: 720px) { .home { padding: 24px 16px 48px; } }
  `,
})
export class HomePage {
  readonly macs = inject(MacList);
  private readonly store = inject(WorkbookStore);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly router = inject(Router);
  private readonly google = inject(Google);

  readonly search = signal('');
  readonly dialogOpen = signal(false);
  readonly editing = signal<Mac | null>(null);
  readonly menu$ = signal<{ mac: Mac; x: number; y: number } | null>(null);
  readonly menu = this.menu$.asReadonly();
  /** A file is being written or read. */
  readonly busy = signal(false);


  /** MACs by province: the first part of their location ("Battambang, Thma Koul" → Battambang). */
  readonly groups = computed(() => {
    const words = this.search().trim().toLowerCase();
    const groups = new Map<string, Mac[]>();
    for (const mac of this.macs.macs()) {
      if (words && !`${mac.macName} ${mac.macCode} ${mac.macLocation ?? ''}`.toLowerCase().includes(words)) continue;
      const place = (mac.macLocation ?? '').split(/[,-]/)[0].trim() || 'Not placed yet';
      groups.set(place, [...(groups.get(place) ?? []), mac]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => (a === 'Not placed yet' ? 1 : b === 'Not placed yet' ? -1 : a.localeCompare(b)))
      .map(([place, macs]) => ({ place, macs }));
  });

  constructor() {
    void this.macs.refresh();
  }

  initial(mac: Mac) {
    return (mac.macName.trim()[0] ?? '?').toUpperCase();
  }

  cropLabel(crop: string) {
    return crop.charAt(0).toUpperCase() + crop.slice(1);
  }

  date(iso: string) {
    return formatDate(iso);
  }

  openNew() {
    this.editing.set(null);
    this.dialogOpen.set(true);
  }

  open(mac: Mac) {
    this.menu$.set(null);
    void this.router.navigate(['/mac', mac.macId]);
  }

  edit(mac: Mac) {
    this.menu$.set(null);
    this.editing.set(mac);
    this.dialogOpen.set(true);
  }

  menuFor(mac: Mac, event: MouseEvent) {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.menu$.set({ mac, x: Math.min(box.right - 200, window.innerWidth - 220), y: box.bottom + 4 });
  }

  saved(mac: Mac) {
    const editing = this.editing();
    this.dialogOpen.set(false);
    if (editing) {
      if (this.store.mac()?.macId === mac.macId) this.store.workbook.update((book) => (book ? { ...book, mac } : book));
      this.toasts.show(`${mac.macName} saved`);
    } else {
      void this.router.navigate(['/mac', mac.macId]);
    }
  }

  /** The MAC's tables and their Google links in one `.ukmac` file: no rows, so the file can't leak the farm's data. */
  async saveToFile(mac: Mac) {
    this.menu$.set(null);
    const stamp = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Phnom_Penh' });
    const name = mac.macName.replace(/[\\/:*?"<>|]+/g, ' ').trim() || mac.macCode;
    const path = await this.api.pickSavePath(`${name} ${stamp}.ukmac`, 'UKMAC MAC file', ['ukmac']);
    if (!path) return;
    this.busy.set(true);
    try {
      const saved = await this.api.exportMacFile(mac.macId, path);
      this.toasts.show(
        `${mac.macName} saved to ${baseName(path)}: ${saved.sheets} tables and ${saved.linked} Google link${saved.linked === 1 ? '' : 's'}; ` +
          (saved.rows > 0 ? `the Zone Map (${saved.rows} rows of Zones) is in the file, no other data` : 'no data in the file') +
          ` (${size(saved.bytes)})`,
      );
      if (saved.emptyOnOpen.length) {
        this.toasts.show(
          `Not linked to Google, so empty when the file is opened: ${saved.emptyOnOpen.join(', ')}. Link a table to a Google Sheet for its data to follow.`,
          'info',
          undefined,
          14000,
        );
      }
    } catch (error) {
      this.toasts.error(errorText(error));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Adds the MAC from a `.ukmac` file. A link file has no rows: its tables are made, linked to their Google Sheets, and read
   * from there with the signed-in account; where that account can't open a sheet, the tables stay empty. If this computer has
   * that MAC already, asks whether to replace it or keep both.
   */
  async importFromFile() {
    if (this.busy()) return;
    const path = await this.api.pickMacFile();
    if (!path) return;
    this.busy.set(true);
    try {
      const peek = await this.api.peekMacFile(path);
      // The file adds nothing unless this account can open every Google Sheet it points at: no MAC, no table, no zone.
      const refused = await this.refusedSheets(peek.spreadsheets);
      if (refused) {
        this.toasts.show(refused, 'error', undefined, 14000);
        return;
      }
      let replace = false;
      if (peek.sameMac) {
        const here = peek.sameMac;
        // Keep both is the first button (what Return picks): replacing is the one that loses data.
        const answer = await this.api.choose(
          `${here.macName} (${here.macCode}) is already on this computer: ${here.sheetCount} tables, ${here.rowCount} rows, last changed ${here.updatedAt.slice(0, 10)}.\n\n` +
            (peek.linksOnly
              ? `The file was saved on ${peek.exportedAt.slice(0, 10)}: ${peek.sheets} tables, ${peek.linkedTables} linked to Google${peek.rows ? `, and the Zone Map (${peek.rows} rows)` : ''}, no other data.\n\n` +
                `Keep both: the file's copy is added next to it, with a new code, and read from Google.\n` +
                `Replace: the one here is taken out, with every row in it (also tables that aren't linked to Google, which can't be read back), and the file's copy takes its place.`
              : `The file was saved on ${peek.exportedAt.slice(0, 10)}: ${peek.sheets} tables, ${peek.rows} rows.\n\n` +
                `Keep both: the file's copy is added next to it, with a new code.\n` +
                `Replace: the one here is taken out and the file's copy takes its place, so anything changed here since is lost.`),
          'This MAC is already here',
          'Keep both',
          'Replace',
        );
        if (answer === null) return;
        replace = answer === 'no';
      }
      const done = await this.macs.importFile(path, replace);
      if (done.replacedMacId !== null && this.store.mac()?.macId === done.replacedMacId) this.store.workbook.set(null);
      await this.google.refreshLinks();
      const code = done.codeChanged ? ` · code ${done.mac.macCode}, the file's was taken here` : '';
      if (peek.linksOnly) {
        this.toasts.show(`${done.mac.macName} added: ${done.sheets} tables${code}`);
        void this.router.navigate(['/mac', done.mac.macId]);
        await this.loadFromGoogle(done);
      } else {
        this.toasts.show(`${done.mac.macName} added: ${done.sheets} tables, ${done.rows} rows${code}`);
        void this.router.navigate(['/mac', done.mac.macId]);
      }
    } catch (error) {
      this.toasts.error(errorText(error));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Asks Google, with the signed-in account, whether it can open each of the file's sheets. Returns the message to show when it
   * can't (or can't tell), and nothing when all can be opened.
   */
  private async refusedSheets(sheets: { id: string; title: string }[]): Promise<string | null> {
    const who = this.google.status()?.email;
    for (const sheet of sheets) {
      try {
        await this.api.googleFileInfo(sheet.id);
      } catch (error) {
        const text = errorText(error);
        const account = who ? `The Google account ${who}` : 'This Google account';
        return NO_ACCESS.test(text)
          ? `${account} can't open the Google Sheet “${sheet.title}”, so nothing was added. Ask the owner to share it with this account, then open the file again.`
          : `Could not check the Google Sheet “${sheet.title}”, so nothing was added: ${text}`;
      }
    }
    return null;
  }

  /**
   * Reads a just-opened link file's tables from their Google Sheets with the signed-in account. A table whose sheet this
   * account can't open stays empty (nothing of it is read), and the person is told whose sheet it was; tables that were
   * never linked have no data to come from and are empty too.
   */
  private async loadFromGoogle(done: ImportedMac) {
    const name = done.mac.macName;
    const links = this.google.links().filter((link) => link.macId === done.mac.macId);
    const notLinked = done.empty;
    const unlinkedNote = notLinked > 0 ? ` ${notLinked} table${notLinked === 1 ? ' isn’t' : 's aren’t'} linked to Google, so ${notLinked === 1 ? 'it is' : 'they are'} empty.` : '';
    if (!links.length) {
      this.toasts.show(
        done.rows > 0
          ? `${name} added with its Zone Map. No other table is linked to Google, so the rest is empty.`
          : `${name} has no data in its file and no table is linked to Google, so every table is empty.`,
        'info',
        undefined,
        9000,
      );
      return;
    }
    if (!this.google.signedIn()) {
      const answer = await this.api.choose(
        `${name}'s data is in Google Sheets, not in the file.\n\nSign in with Google to read it. If the account you sign in with can't open those sheets, the tables stay empty.`,
        'Read the data from Google',
        'Sign in',
        'Not now',
      );
      if (answer === 'yes') await this.google.signIn();
    }
    if (!this.google.signedIn()) {
      this.toasts.show(`${name} is empty until you sign in with Google (Settings) and press Sync on each table.${unlinkedNote}`, 'info', undefined, 10000);
      return;
    }
    let tables = 0;
    let rows = 0;
    const refused = new Set<string>();
    const failed: string[] = [];
    for (const link of links) {
      try {
        const outcome = await this.google.sync(link.sheetId);
        tables++;
        rows += outcome.rows;
      } catch (error) {
        const text = errorText(error);
        if (NO_ACCESS.test(text)) refused.add(link.spreadsheetTitle || 'a Google Sheet');
        else failed.push(`${link.tableTitle}: ${text}`);
      }
    }
    if (tables) this.toasts.show(`${name}: ${tables} table${tables === 1 ? '' : 's'} read from Google (${rows} rows).${unlinkedNote}`);
    if (refused.size) {
      const who = this.google.status()?.email;
      this.toasts.show(
        `${who ? `The Google account ${who}` : 'This Google account'} can't open ${[...refused].map((title) => `“${title}”`).join(', ')}, so those tables are empty. Ask the owner to share the sheet, then press Sync.`,
        'error',
        undefined,
        12000,
      );
    }
    if (failed.length) this.toasts.error(`Not read: ${failed.join(' · ')}`);
  }

  async remove(mac: Mac) {
    this.menu$.set(null);
    const ok = await this.api.confirm(
      `Delete ${mac.macName}, its ${mac.sheetCount} tables and ${mac.rowCount} rows? This can't be undone.`,
      'Delete MAC',
      'Delete',
    );
    if (!ok) return;
    try {
      await this.macs.remove(mac.macId);
      if (this.store.mac()?.macId === mac.macId) this.store.workbook.set(null);
      this.toasts.show(`${mac.macName} deleted`);
    } catch (error) {
      this.toasts.error(errorText(error));
    }
  }
}

/** Google's answers when the signed-in account may not open a sheet. */
const NO_ACCESS = /can't open it|didn't let this account|share it with you|can't find that sheet/i;

function size(bytes: number) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
