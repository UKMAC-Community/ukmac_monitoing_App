import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { errorText } from '../core/api';
import { Google, type OpenedSheet } from '../core/google';
import type { DriveFile, Workbook } from '../core/models';
import { Toasts } from '../core/toast';
import { planLinks, tabNameOf } from '../google/link-plan';
import { GoogleSignIn } from './google-sign-in';
import { Icon } from './icon';
import { Modal } from './modal';

/**
 * Links every table of a MAC that is not in Google yet (Zones aside) to the tab of the same name in one Google Sheet, the
 * one made from "Google Sheet for input": pick the sheet or paste its link, see which tables have their tab, link them.
 * After that, importing the MAC's file reads all of them from that sheet.
 */
@Component({
  selector: 'app-link-tables-dialog',
  imports: [Modal, Icon, GoogleSignIn, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [open]="open()" title="Link tables to a Google Sheet" [subtitle]="book()?.mac?.macName ?? ''" size="wide" (closed)="closed.emit()">
      @if (!google.status()) {
        <p class="muted">Checking Google…</p>
      } @else if (!google.status()!.configured) {
        <div class="alert-box info">
          <app-icon name="info" />
          <div class="grow">
            <strong>Google sign-in isn't set up yet.</strong>
            It needs a Client ID from your Google Cloud project, once. The steps are in Settings.
          </div>
          <a class="btn btn-secondary btn-sm" routerLink="/settings" (click)="closed.emit()">Open Settings</a>
        </div>
      } @else if (!google.signedIn()) {
        <div class="center">
          <h3>Sign in to pick a Google Sheet</h3>
          <app-google-sign-in />
        </div>
      } @else if (opened(); as sheet) {
        <button type="button" class="back" (click)="opened.set(null)"><app-icon name="arrow-left" [size]="14" /> Choose another sheet</button>
        <div class="file-head">
          <span class="file-icon"><app-icon name="table" [size]="18" /></span>
          <div>
            <strong>{{ sheet.file.name }}</strong>
            <small class="muted">{{ sheet.tabs.length }} tab{{ sheet.tabs.length === 1 ? '' : 's' }}</small>
          </div>
        </div>
        @if (plan(); as plan) {
          <ul class="tabs">
            @for (item of plan.ready; track item.table.sheetId) {
              <li class="tab ok"><app-icon name="check" [size]="14" /> <span class="name">{{ item.table.title }}</span><small class="muted">tab “{{ item.tab.name }}”, {{ item.tab.rows.length }} row{{ item.tab.rows.length === 1 ? '' : 's' }}</small></li>
            }
            @for (item of plan.different; track item.table.sheetId) {
              <li class="tab bad"><app-icon name="alert" [size]="14" /> <span class="name">{{ item.table.title }}</span><small>tab has columns the table does not: {{ item.extra.join(', ') }}</small></li>
            }
            @for (table of plan.noTab; track table.sheetId) {
              <li class="tab off"><app-icon name="minus" [size]="14" /> <span class="name">{{ table.title }}</span><small class="muted">no tab “{{ tabName(table) }}”</small></li>
            }
          </ul>
          @if (!plan.ready.length && !plan.different.length && !plan.noTab.length) {
            <p class="muted">Every table of this MAC is linked to a Google Sheet already (or is the map).</p>
          }
        }
        <p class="muted small">
          Tables already linked, and Zones (the map is in the file), are left as they are. Once a table is linked, its rows are typed in the Google Sheet, and
          <strong>Sync</strong> (or importing the file) replaces what is in the app by what the sheet holds.
        </p>
      } @else {
        <div class="who"><span class="muted">{{ google.status()?.email || 'Signed in' }}</span></div>
        <label class="input-wrap search">
          <span class="input-prefix"><app-icon name="search" [size]="15" /></span>
          <input class="input-field has-prefix" type="search" placeholder="Search your Google Sheets" [value]="query()" (input)="search($any($event.target).value)" />
        </label>
        <div class="files" role="listbox" aria-label="Your Google Sheets">
          @if (loading()) {
            <p class="muted none">Looking…</p>
          } @else if (listError()) {
            <div class="alert-box error"><app-icon name="alert" /> {{ listError() }}</div>
          } @else {
            @for (file of files(); track file.id) {
              <button type="button" class="file" role="option" [disabled]="!!reading()" (click)="choose(file.id)">
                <span class="file-icon"><app-icon name="table" [size]="16" /></span>
                <span class="file-text"><strong>{{ file.name }}</strong><small class="muted">{{ file.owner ? file.owner + ' · ' : '' }}{{ modified(file) }}</small></span>
                @if (reading() === file.id) {
                  <span class="spinner-sm"></span>
                } @else {
                  <app-icon name="chevron-right" [size]="15" />
                }
              </button>
            } @empty {
              <p class="muted none">{{ query().trim() ? 'No Google Sheet by that name.' : 'No Google Sheets in this account yet.' }}</p>
            }
          }
        </div>
        <form class="paste" (submit)="$event.preventDefault(); choose(link())">
          <label class="form-group">
            <span class="form-label">Or paste its link</span>
            <span class="paste-row">
              <input class="input-field" placeholder="https://docs.google.com/spreadsheets/d/…" [value]="link()" (input)="link.set($any($event.target).value)" />
              <button type="submit" class="btn btn-secondary" [disabled]="!link().trim() || !!reading()">Read</button>
            </span>
          </label>
        </form>
      }
      @if (error()) {
        <div class="alert-box error"><app-icon name="alert" /> {{ error() }}</div>
      }
      <ng-container footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="closed.emit()">Close</button>
        @if (opened() && plan()?.ready?.length) {
          <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="run(false)" title="Link the tables; nothing is read until Sync or an import">Link only</button>
          <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="run(true)" title="Link them, then read each tab: the rows in the app are replaced by the sheet's">
            <app-icon name="refresh" /> Link and read {{ plan()!.ready.length }} table{{ plan()!.ready.length === 1 ? '' : 's' }}
          </button>
        }
      </ng-container>
    </app-modal>
  `,
  styles: `
    .grow { flex: 1; }
    .center { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 24px 8px; text-align: center; }
    .center h3 { margin: 4px 0 0; font-size: 1rem; }
    .who { margin-bottom: 10px; font-size: 0.8125rem; }
    .search { margin-bottom: 10px; display: block; }
    .files { display: flex; flex-direction: column; gap: 4px; max-height: 280px; overflow: auto; padding: 2px; margin: 0 -2px 14px; }
    .file { display: flex; align-items: center; gap: 12px; width: 100%; padding: 9px 12px; border: var(--hairline) solid var(--border); border-radius: var(--radius-md); background: var(--surface-solid); color: var(--text); font: inherit; text-align: left; cursor: pointer; }
    button.file:hover:not(:disabled) { background: var(--accent-soft); border-color: var(--accent); }
    button.file:disabled { opacity: 0.6; cursor: default; }
    .file-icon { flex: none; width: 32px; height: 32px; border-radius: 9px; background: var(--accent-soft); color: var(--accent); display: inline-flex; align-items: center; justify-content: center; }
    .file-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .file-text strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    small { font-size: 0.75rem; }
    .none { padding: 14px 4px; margin: 0; }
    .paste .form-group { margin: 0; }
    .paste-row { display: flex; gap: 8px; }
    .paste-row .input-field { flex: 1; }
    .back { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 12px; padding: 0; border: 0; background: none; color: var(--accent); font: inherit; font-size: 0.8125rem; cursor: pointer; }
    .file-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
    .file-head div { display: flex; flex-direction: column; }
    .tabs { list-style: none; margin: 0 0 14px; padding: 0; display: flex; flex-direction: column; gap: 6px; max-height: 320px; overflow: auto; }
    .tab { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: var(--hairline) solid var(--border); border-radius: var(--radius-md); background: var(--surface-solid); }
    .tab .name { font-weight: 600; }
    .tab small { margin-left: auto; }
    .tab.ok { border-color: var(--accent); color: var(--text); }
    .tab.bad small { color: var(--danger); }
    .tab.off { opacity: 0.8; }
    .small { font-size: 0.75rem; margin: 10px 0 0; line-height: 1.5; }
  `,
})
export class LinkTablesDialog {
  readonly google = inject(Google);
  private readonly toasts = inject(Toasts);

  readonly open = input(false);
  /** The MAC whose tables are linked, with its tables. */
  readonly book = input<Workbook | null>(null);
  readonly closed = output<void>();
  /** Tables were linked (and perhaps read): the page shows them again. */
  readonly linked = output<void>();

  readonly files = signal<DriveFile[]>([]);
  readonly query = signal('');
  readonly link = signal('');
  readonly loading = signal(false);
  readonly listError = signal('');
  readonly reading = signal('');
  readonly error = signal('');
  readonly opened = signal<OpenedSheet | null>(null);
  readonly busy = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly plan = computed(() => {
    const opened = this.opened();
    const book = this.book();
    return opened && book ? planLinks(this.google.inputTables(book), opened.tabs) : null;
  });

  constructor() {
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.opened.set(null);
        this.error.set('');
        this.link.set('');
        this.query.set('');
        void this.google.init().then(() => this.google.refreshStatus());
      });
    });
    effect(() => {
      if (this.open() && this.google.signedIn()) untracked(() => void this.load(this.query()));
    });
  }

  tabName(table: { title: string }) {
    return tabNameOf(table);
  }

  search(text: string) {
    this.query.set(text);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.load(text), 300);
  }

  private async load(text: string) {
    this.loading.set(true);
    this.listError.set('');
    try {
      const files = await this.google.listSheets(text);
      if (text === this.query()) this.files.set(files);
    } catch (error) {
      this.listError.set(errorText(error));
      this.files.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  modified(file: DriveFile) {
    if (!file.modifiedTime) return '';
    const date = new Date(file.modifiedTime);
    return Number.isFinite(date.getTime()) ? `edited ${date.toLocaleDateString('en-GB', { timeZone: 'Asia/Phnom_Penh' })}` : '';
  }

  async choose(file: string) {
    if (!file.trim() || this.reading()) return;
    this.reading.set(file.trim());
    this.error.set('');
    try {
      this.opened.set(await this.google.open(file.trim()));
    } catch (error) {
      this.error.set(errorText(error));
    } finally {
      this.reading.set('');
    }
  }

  /** Links the tables that have their tab; with `readNow`, reads each of them from it right after. */
  async run(readNow: boolean) {
    const book = this.book();
    const opened = this.opened();
    if (!book || !opened || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const report = await this.google.linkTables(book, opened);
      let text = `${report.linked.length} table${report.linked.length === 1 ? '' : 's'} linked to “${opened.file.name}”`;
      if (readNow && report.linked.length) {
        const results = await this.google.syncMany(report.linked.map((item) => item.sheetId));
        let rows = 0;
        const failed: string[] = [];
        for (const item of report.linked) {
          const result = results.get(item.sheetId);
          if (result instanceof Error) failed.push(`${item.title}: ${result.message}`);
          else if (result) rows += result.rows;
        }
        text += `, ${rows} rows read`;
        if (failed.length) this.toasts.error(`Not read: ${failed.join(' · ')}`);
      } else if (report.linked.length) {
        text += '. They are read by Sync, or when the MAC\'s file is imported.';
      }
      this.toasts.show(text);
      if (report.noTab.length) this.toasts.show(`No tab in that sheet for: ${report.noTab.join(', ')}.`, 'info', undefined, 9000);
      if (report.different.length) {
        this.toasts.show(`Not linked, the tab has other columns: ${report.different.map((item) => item.title).join(', ')}.`, 'error', undefined, 9000);
      }
      this.linked.emit();
      this.closed.emit();
    } catch (error) {
      this.error.set(errorText(error));
    } finally {
      this.busy.set(false);
    }
  }
}
