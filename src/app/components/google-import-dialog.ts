import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { errorText } from '../core/api';
import { Google, tableNameOf, type OpenedSheet } from '../core/google';
import type { DriveFile, SheetWithRows } from '../core/models';
import { Toasts } from '../core/toast';
import { WorkbookStore } from '../core/workbook-store';
import { matchHeaders } from '../google/sheet-sync';
import { isEntryColumn } from '../sheet/columns';
import { Icon } from './icon';
import { GoogleSignIn } from './google-sign-in';
import type { ImportFile } from './import-dialog';
import { Modal } from './modal';

interface Pick {
  on: boolean;
  name: string;
}

/**
 * Brings tabs of a Google Sheet into the open MAC as tables: pick the sheet (from the user's own, or
 * pasted as a link), tick the tabs, and each becomes a table linked to its tab, to read again later.
 *
 * With `into` set (on a table's page) it picks one tab for that table instead: the tab then goes to the
 * same window as an Excel file, where its columns are matched to the table's and its rows previewed
 * (what matched, what didn't, add or replace) before anything is saved.
 */
@Component({
  selector: 'app-google-import-dialog',
  imports: [Modal, Icon, GoogleSignIn, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [open]="open()" title="Import from Google Sheets" [subtitle]="into()?.title ?? store.mac()?.macName ?? ''" size="wide" (closed)="closed.emit()">
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
          <span class="big-icon"><app-icon name="table" [size]="22" /></span>
          <h3>Sign in to pick a Google Sheet</h3>
          <p class="muted">The app only reads: it never changes anything in Google.</p>
          <app-google-sign-in />
        </div>
      } @else if (opened(); as sheet) {
        <button type="button" class="back" (click)="opened.set(null)"><app-icon name="arrow-left" [size]="14" /> Choose another sheet</button>
        <div class="file-head">
          <span class="file-icon"><app-icon name="table" [size]="18" /></span>
          <div>
            <strong>{{ sheet.file.name }}</strong>
            <small class="muted">{{ sheet.tabs.length }} tab{{ sheet.tabs.length === 1 ? '' : 's' }} with data</small>
          </div>
        </div>

        @if (into(); as target) {
          <p class="muted small lead">Pick the tab to read into <strong>{{ target.title }}</strong>. Nothing is saved until you've seen what matches.</p>
          <ul class="tabs" role="radiogroup" aria-label="Tabs">
            @for (tab of sheet.tabs; track tab.name; let i = $index) {
              <li class="tab" [class.off]="intoTab() !== i" [class.disabled]="!tab.rows.length">
                <label class="check-label">
                  <input type="radio" name="into-tab" [checked]="intoTab() === i" [disabled]="!tab.rows.length" (change)="intoTab.set(i)" />
                  <span class="tab-name">{{ tab.name }}</span>
                </label>
                <span class="tab-meta muted">{{ tab.rows.length }}{{ tab.truncated ? '+' : '' }} row{{ tab.rows.length === 1 ? '' : 's' }} · {{ tab.headers.length }} column{{ tab.headers.length === 1 ? '' : 's' }}</span>
                @if (!tab.rows.length) {
                  <span class="note muted">No rows under its headers</span>
                } @else {
                  <span class="note" [class.bad]="!matches(tab)">
                    <app-icon [name]="matches(tab) ? 'check' : 'alert'" [size]="13" />
                    {{ matches(tab) }} of {{ entryCount() }} of this table's columns found in it
                  </span>
                }
              </li>
            }
          </ul>
        } @else {
        <ul class="tabs" aria-label="Tabs">
          @for (tab of sheet.tabs; track tab.name; let i = $index) {
            <li class="tab" [class.off]="!picks()[i]?.on" [class.disabled]="linked(tab.name)">
              <label class="check-label">
                <input type="checkbox" class="checkbox" [checked]="picks()[i]?.on" [disabled]="!!linked(tab.name) || !tab.rows.length" (change)="toggle(i, $any($event.target).checked)" />
                <span class="tab-name">{{ tab.name }}</span>
              </label>
              <span class="tab-meta muted">{{ tab.rows.length }}{{ tab.truncated ? '+' : '' }} row{{ tab.rows.length === 1 ? '' : 's' }} · {{ tab.headers.length }} column{{ tab.headers.length === 1 ? '' : 's' }}</span>
              @if (linked(tab.name); as other) {
                <span class="note"><app-icon name="check" [size]="13" /> Already the table “{{ other.tableTitle }}” here: use Sync on its page</span>
              } @else if (!tab.rows.length) {
                <span class="note muted">No rows under its headers</span>
              } @else if (picks()[i]?.on) {
                <label class="rename">
                  <span class="muted">Table name</span>
                  <input class="input-field" [value]="picks()[i].name" (input)="rename(i, $any($event.target).value)" />
                </label>
                @if (problem(i); as text) {
                  <span class="bad"><app-icon name="alert" [size]="13" /> {{ text }}</span>
                }
                <span class="heads">
                  @for (head of tab.headers.slice(0, 8); track $index) {
                    <span class="badge neutral">{{ head }}</span>
                  }
                  @if (tab.headers.length > 8) {
                    <span class="muted">+{{ tab.headers.length - 8 }} more</span>
                  }
                </span>
                @if (tab.truncated) {
                  <span class="note"><app-icon name="info" [size]="13" /> More rows than the app takes at a time: the first 5000 are read.</span>
                }
              }
            </li>
          }
        </ul>

        <label class="form-group">
          <span class="form-label">Heading</span>
          <input class="input-field" list="google-headings" [value]="heading()" (input)="heading.set($any($event.target).value)" />
          <datalist id="google-headings">
            @for (name of headings(); track name) {
              <option [value]="name"></option>
            }
          </datalist>
          <small class="form-hint">The sidebar groups the new tables under it.</small>
        </label>
        <p class="muted small">
          Columns are the tab's headers, their types guessed from what's under them (change any later). To read the tab again, press
          <strong>Sync</strong> on the table's page: its rows are then replaced by the tab's.
        </p>
        }
      } @else {
        <div class="who">
          <span class="avatar is-sm">{{ initial() }}</span>
          <span class="muted">{{ google.status()?.email || 'Signed in' }}</span>
        </div>
        <label class="input-wrap search">
          <span class="input-prefix"><app-icon name="search" [size]="15" /></span>
          <input class="input-field has-prefix" type="search" placeholder="Search your Google Sheets" [value]="query()" (input)="search($any($event.target).value)" />
        </label>

        <div class="files" role="listbox" aria-label="Your Google Sheets">
          @if (loading()) {
            @for (n of [1, 2, 3, 4]; track n) {
              <div class="file skeleton-line"><span class="skeleton sk"></span></div>
            }
          } @else if (listError()) {
            <div class="alert-box error"><app-icon name="alert" /> {{ listError() }}</div>
          } @else {
            @for (file of files(); track file.id) {
              <button type="button" class="file" role="option" [disabled]="!!reading()" (click)="choose(file.id)">
                <span class="file-icon"><app-icon name="table" [size]="16" /></span>
                <span class="file-text">
                  <strong>{{ file.name }}</strong>
                  <small class="muted">{{ file.owner ? file.owner + ' · ' : '' }}{{ modified(file) }}</small>
                </span>
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
            <span class="form-label">Or paste a sheet's link</span>
            <span class="paste-row">
              <input class="input-field" placeholder="https://docs.google.com/spreadsheets/d/…" [value]="link()" (input)="link.set($any($event.target).value)" />
              <button type="submit" class="btn btn-secondary" [disabled]="!link().trim() || !!reading()">Read</button>
            </span>
          </label>
        </form>
        @if (readError()) {
          <div class="alert-box error"><app-icon name="alert" /> {{ readError() }}</div>
        }
      }

      <ng-container footer>
        @if (opened() && into()) {
          <button type="button" class="btn btn-secondary" (click)="closed.emit()">Cancel</button>
          <button type="button" class="btn btn-primary" [disabled]="intoTab() < 0" (click)="continueInto()">
            <app-icon name="arrow-right" /> Continue
          </button>
        } @else if (opened()) {
          <span class="count muted">{{ importing() ? 'Importing ' + progress() + '…' : '' }}</span>
          <button type="button" class="btn btn-secondary" [disabled]="importing()" (click)="closed.emit()">Cancel</button>
          <button type="button" class="btn btn-primary" [disabled]="!canImport() || importing()" (click)="run()">
            <app-icon name="upload" /> Import {{ chosen().length }} table{{ chosen().length === 1 ? '' : 's' }}
          </button>
        } @else {
          <button type="button" class="btn btn-secondary" (click)="closed.emit()">Close</button>
        }
      </ng-container>
    </app-modal>
  `,
  styles: `
    .grow { flex: 1; }
    .center { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 24px 8px; text-align: center; }
    .center h3 { margin: 4px 0 0; font-size: 1rem; }
    .center p { margin: 0 0 8px; }
    .big-icon { width: 46px; height: 46px; border-radius: 14px; background: var(--accent-soft); color: var(--accent); display: inline-flex; align-items: center; justify-content: center; }
    .who { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 0.8125rem; }
    .search { margin-bottom: 10px; display: block; }
    .files { display: flex; flex-direction: column; gap: 4px; max-height: 300px; overflow: auto; padding: 2px; margin: 0 -2px 14px; }
    .file { display: flex; align-items: center; gap: 12px; width: 100%; padding: 9px 12px; border: var(--hairline) solid var(--border); border-radius: var(--radius-md); background: var(--surface-solid); color: var(--text); font: inherit; text-align: left; cursor: pointer; transition: background-color var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease); }
    button.file:hover:not(:disabled) { background: var(--accent-soft); border-color: var(--accent); }
    button.file:disabled { opacity: 0.6; cursor: default; }
    .file-icon { flex: none; width: 32px; height: 32px; border-radius: 9px; background: var(--accent-soft); color: var(--accent); display: inline-flex; align-items: center; justify-content: center; }
    .file-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
    .file-text strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    small { font-size: 0.75rem; }
    .skeleton-line { height: 52px; }
    .sk { width: 55%; height: 12px; }
    .none { padding: 14px 4px; margin: 0; }
    .paste .form-group { margin: 0; }
    .paste-row { display: flex; gap: 8px; }
    .paste-row .input-field { flex: 1; }
    .back { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 12px; padding: 0; border: 0; background: none; color: var(--accent); font: inherit; font-size: 0.8125rem; cursor: pointer; }
    .file-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
    .file-head div { display: flex; flex-direction: column; }
    .tabs { list-style: none; margin: 0 0 16px; padding: 0; display: flex; flex-direction: column; gap: 8px; max-height: 340px; overflow: auto; }
    .tab { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; align-items: center; padding: 10px 12px; border: var(--hairline) solid var(--border); border-radius: var(--radius-md); background: var(--surface-solid); }
    .tab:not(.off) { border-color: var(--accent); }
    .tab.disabled { opacity: 0.75; }
    .tab > :not(.check-label):not(.tab-meta) { grid-column: 1 / -1; }
    .tab-name { font-weight: 600; }
    .tab-meta { font-size: 0.75rem; white-space: nowrap; }
    .rename { display: flex; align-items: center; gap: 10px; font-size: 0.8125rem; }
    .rename .input-field { flex: 1; max-width: 340px; }
    .heads { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 0.75rem; }
    .note { display: inline-flex; align-items: center; gap: 6px; font-size: 0.75rem; color: var(--text-muted); }
    .bad { display: inline-flex; align-items: center; gap: 6px; font-size: 0.75rem; color: var(--danger); }
    .small { font-size: 0.75rem; margin: 12px 0 0; line-height: 1.5; }
    .small.lead { margin: 0 0 10px; }
    .count { margin-right: auto; font-size: 0.8125rem; }
  `,
})
export class GoogleImportDialog {
  readonly google = inject(Google);
  readonly store = inject(WorkbookStore);
  private readonly toasts = inject(Toasts);

  readonly open = input(false);
  /** On a table's page: the table the tab's rows are for (one tab is picked, then the Excel import's preview). */
  readonly into = input<SheetWithRows | null>(null);
  readonly closed = output<void>();
  /** In `into` mode: the picked tab, as the file the import preview reads. */
  readonly picked = output<ImportFile>();
  /** The tables made, in the order of the tabs. */
  readonly imported = output<SheetWithRows[]>();

  readonly files = signal<DriveFile[]>([]);
  readonly query = signal('');
  readonly loading = signal(false);
  readonly listError = signal('');
  readonly link = signal('');
  /** The id of the file being read (a spinner on it). */
  readonly reading = signal('');
  readonly readError = signal('');
  readonly opened = signal<OpenedSheet | null>(null);
  readonly picks = signal<Pick[]>([]);
  /** In `into` mode: the tab picked (its index in the sheet's tabs), or -1. */
  readonly intoTab = signal(-1);
  readonly entryCount = computed(() => this.into()?.columns.filter(isEntryColumn).length ?? 0);
  readonly heading = signal('Google Sheets');
  readonly importing = signal(false);
  readonly progress = signal('');

  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly headings = computed(() => [...new Set(this.store.sheets().map((sheet) => sheet.heading))]);
  readonly initial = computed(() => ((this.google.status()?.name || this.google.status()?.email || '?').trim()[0] ?? '?').toUpperCase());
  readonly chosen = computed(() => this.picks().map((pick, index) => ({ pick, index })).filter(({ pick }) => pick.on));
  readonly canImport = computed(() => this.chosen().length > 0 && this.chosen().every(({ index }) => !this.problem(index)));

  constructor() {
    // Each time the dialog opens: start over (and make sure what's known of the sign-in is current).
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.opened.set(null);
        this.picks.set([]);
        this.intoTab.set(-1);
        this.files.set([]);
        this.query.set('');
        this.link.set('');
        this.readError.set('');
        this.listError.set('');
        this.heading.set('Google Sheets');
        void this.google.init().then(() => this.google.refreshStatus());
      });
    });
    // Once it's open and signed in (also right after signing in here), the user's sheets are listed.
    effect(() => {
      if (this.open() && this.google.signedIn()) untracked(() => void this.load(this.query()));
    });
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
      // An answer for words typed since is stale.
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
    this.readError.set('');
    try {
      const opened = await this.google.open(file.trim());
      this.opened.set(opened);
      // Every tab that holds rows and isn't a table here yet is ticked to begin with.
      this.picks.set(opened.tabs.map((tab) => ({ on: tab.rows.length > 0 && !this.linked(tab.name, opened), name: tableNameOf(tab.name) })));
      // Into a table: the tab that names most of its columns is picked to begin with.
      const withRows = opened.tabs.map((tab, index) => ({ index, found: tab.rows.length ? this.matches(tab) : -1 }));
      this.intoTab.set(withRows.reduce((best, tab) => (tab.found > best.found ? tab : best), { index: -1, found: -1 }).index);
    } catch (error) {
      this.readError.set(errorText(error));
    } finally {
      this.reading.set('');
    }
  }

  /** How many of the table's columns a tab's headers name (the same names the Excel import goes by). */
  matches(tab: { headers: string[] }) {
    const table = this.into();
    return table ? matchHeaders(table.columns, tab.headers, {}).matched.size : 0;
  }

  /** The tab picked: on to the import window, where its columns are matched to the table's and the rows previewed. */
  continueInto() {
    const opened = this.opened();
    const tab = opened?.tabs[this.intoTab()];
    if (!opened || !tab) return;
    this.picked.emit({
      fileName: `${opened.file.name} › ${tab.name}.xlsx`,
      bytes: opened.bytes,
      tab: tab.name,
      headerRow: tab.headerRow,
      connect: {
        spreadsheetId: opened.file.id,
        spreadsheetTitle: opened.file.name,
        tabTitle: tab.name,
      },
    });
  }

  /** The table in this MAC that already mirrors this tab, if any. */
  linked(tabName: string, opened: OpenedSheet | null = this.opened()) {
    const mac = this.store.mac();
    if (!opened || !mac) return null;
    return this.google.links().find((link) => link.macId === mac.macId && link.spreadsheetId === opened.file.id && link.tabTitle === tabName) ?? null;
  }

  toggle(index: number, on: boolean) {
    this.picks.update((picks) => picks.map((pick, i) => (i === index ? { ...pick, on } : pick)));
  }

  rename(index: number, name: string) {
    this.picks.update((picks) => picks.map((pick, i) => (i === index ? { ...pick, name } : pick)));
  }

  /** Why a ticked tab can't be imported as it's named, if it can't. */
  problem(index: number): string {
    const name = (this.picks()[index]?.name ?? '').trim();
    if (!name) return 'Give the table a name.';
    if (/[[\]]/.test(name)) return "A table's name can't have [ or ] in it.";
    const key = name.toLowerCase();
    if (this.store.sheets().some((sheet) => sheet.title.toLowerCase() === key)) return `This MAC already has a table called ${name}.`;
    const same = this.picks().filter((pick, i) => pick.on && i !== index && pick.name.trim().toLowerCase() === key);
    return same.length ? 'Two tabs have the same table name.' : '';
  }

  async run() {
    const opened = this.opened();
    if (!opened || !this.canImport()) return;
    const chosen = this.chosen();
    this.importing.set(true);
    const made: SheetWithRows[] = [];
    try {
      for (const [at, { pick, index }] of chosen.entries()) {
        this.progress.set(`${at + 1} of ${chosen.length}`);
        made.push(await this.google.importTab(opened, opened.tabs[index], { title: pick.name.trim(), heading: this.heading().trim() || 'Google Sheets' }));
      }
      const rows = made.reduce((sum, sheet) => sum + sheet.rows.length, 0);
      this.toasts.show(`${made.length} table${made.length === 1 ? '' : 's'} made from Google: ${rows} rows`);
    } catch (error) {
      this.toasts.error(
        `${made.length ? `${made.length} table${made.length === 1 ? '' : 's'} made, then it stopped: ` : 'Not imported: '}${errorText(error)}`,
      );
    } finally {
      this.importing.set(false);
      this.progress.set('');
    }
    if (made.length) this.imported.emit(made);
  }
}
