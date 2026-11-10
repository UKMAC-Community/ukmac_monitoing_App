import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';

import { errorText } from '../core/api';
import { Google, sheetUrl, type OpenedSheet } from '../core/google';
import type { SheetWithRows } from '../core/models';
import { Toasts } from '../core/toast';
import { matchHeaders } from '../google/sheet-sync';
import { isEntryColumn } from '../sheet/columns';
import { GoogleSignIn } from './google-sign-in';
import { Icon } from './icon';
import { Modal } from './modal';

/**
 * Edits where a table is read from: paste another Google Sheet's link (or fix a broken one), then pick
 * its tab. Saving only moves the link: the rows stay as they are until Sync (or "Save & sync") reads
 * the tab. The columns the link has matched keep filling from the same headers.
 */
@Component({
  selector: 'app-google-link-dialog',
  imports: [Modal, Icon, GoogleSignIn],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [open]="open()" title="Google Sheet link" [subtitle]="sheet().title" size="wide" (closed)="closed.emit()">
      @if (link(); as current) {
        <div class="now">
          <span class="file-icon"><app-icon name="table" [size]="18" /></span>
          <div class="now-text">
            <small class="muted">Now reading from</small>
            <strong>{{ current.spreadsheetTitle }} › {{ current.tabTitle }}</strong>
            <small class="muted">{{ current.lastSyncedAt ? current.lastRowCount + ' rows · read ' + google.ago(current.lastSyncedAt) : 'Not read yet' }}</small>
          </div>
        </div>

        @if (google.signedIn()) {
          <div class="redo">
            <button type="button" class="btn btn-secondary btn-sm" [disabled]="saving()" (click)="redefine.emit()">
              <app-icon name="refresh" /> Define the rows and columns again…
            </button>
            <small class="muted">A row of names showing up as data, or columns read from the wrong row? Say where the column names and the data start, check the matches, and read the tab again.</small>
          </div>
        }

        @if (!google.signedIn()) {
          <div class="center">
            <p class="muted">Sign in to Google to look at the sheet and change the link. The app only reads: it never changes anything in Google.</p>
            <app-google-sign-in />
          </div>
        } @else {
          <form class="paste" (submit)="$event.preventDefault(); read()">
            <label class="form-group">
              <span class="form-label">Link of the Google Sheet</span>
              <span class="paste-row">
                <input
                  class="input-field"
                  type="text"
                  spellcheck="false"
                  placeholder="https://docs.google.com/spreadsheets/d/…"
                  [value]="address()"
                  (input)="address.set($any($event.target).value)"
                />
                <button type="submit" class="btn btn-secondary" [disabled]="!address().trim() || reading()">{{ reading() ? 'Reading…' : 'Read' }}</button>
              </span>
              <small class="form-hint">Paste another sheet's link to read that one instead, then press Read to see its tabs.</small>
            </label>
          </form>

          @if (readError()) {
            <div class="alert-box error"><app-icon name="alert" /> {{ readError() }}</div>
          }
          @if (reading() && !opened()) {
            <p class="muted small">Reading the Google Sheet…</p>
          }

          @if (opened(); as file) {
            <div class="file-head">
              <strong>{{ file.file.name }}</strong>
              <small class="muted">{{ file.tabs.length }} tab{{ file.tabs.length === 1 ? '' : 's' }} with data</small>
            </div>
            <ul class="tabs" role="radiogroup" aria-label="Tabs">
              @for (tab of file.tabs; track tab.name) {
                <li class="tab" [class.off]="pickedTab() !== tab.name" [class.disabled]="!tab.rows.length">
                  <label class="check-label">
                    <input type="radio" name="link-tab" [checked]="pickedTab() === tab.name" [disabled]="!tab.rows.length" (change)="pickedTab.set(tab.name)" />
                    <span class="tab-name">{{ tab.name }}</span>
                    @if (isCurrent(file, tab.name)) {
                      <span class="badge info">Current</span>
                    }
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
            @if (!changed()) {
              <p class="small muted">This is the sheet and tab the table is reading now.</p>
            } @else {
              <p class="small muted">
                Saving only moves the link: the rows stay as they are until you press <strong>Sync</strong>. A header the table has no column for is added as a new column when it is read.
              </p>
            }
          }
        }
      }

      <ng-container footer>
        <button type="button" class="btn btn-plain danger-text" title="Stop reading this table from Google; its rows stay" [disabled]="saving() || !link()" (click)="disconnect()">Disconnect</button>
        <span class="grow"></span>
        <button type="button" class="btn btn-secondary" (click)="closed.emit()">Cancel</button>
        <button type="button" class="btn btn-secondary" [disabled]="!changed() || saving()" (click)="save(false)">Save link</button>
        <button
          type="button"
          class="btn btn-primary"
          [disabled]="!changed() || saving() || !canSync()"
          [title]="canSync() ? 'Save, then read the tab now: the table\\'s rows are replaced by the tab\\'s' : 'Go back to the table to sync'"
          (click)="save(true)"
        >
          <app-icon name="refresh" /> Save &amp; sync
        </button>
      </ng-container>
    </app-modal>
  `,
  styles: `
    .grow { flex: 1; }
    .danger-text { color: var(--danger); }
    .now { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; padding: 10px 12px; border: var(--hairline) solid var(--border); border-radius: var(--radius-md); background: var(--surface-solid); }
    .now-text { display: flex; flex-direction: column; min-width: 0; }
    .now-text strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .file-icon { flex: none; width: 32px; height: 32px; border-radius: 9px; background: var(--accent-soft); color: var(--accent); display: inline-flex; align-items: center; justify-content: center; }
    small { font-size: 0.75rem; }
    .redo { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; margin: -4px 0 16px; }
    .center { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
    .center p { margin: 0; font-size: 0.8125rem; }
    .paste .form-group { margin: 0 0 12px; }
    .paste-row { display: flex; gap: 8px; }
    .paste-row .input-field { flex: 1; }
    .file-head { display: flex; align-items: baseline; gap: 10px; margin: 4px 0 8px; }
    .tabs { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 8px; max-height: 300px; overflow: auto; }
    .tab { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; align-items: center; padding: 10px 12px; border: var(--hairline) solid var(--border); border-radius: var(--radius-md); background: var(--surface-solid); }
    .tab:not(.off) { border-color: var(--accent); }
    .tab.disabled { opacity: 0.75; }
    .tab > :not(.check-label):not(.tab-meta) { grid-column: 1 / -1; }
    .tab-name { font-weight: 600; }
    .tab-meta { font-size: 0.75rem; white-space: nowrap; }
    .note { display: inline-flex; align-items: center; gap: 6px; font-size: 0.75rem; color: var(--text-muted); }
    .note.bad { color: var(--danger); }
    .small { font-size: 0.75rem; margin: 0; line-height: 1.5; }
  `,
})
export class GoogleLinkDialog {
  readonly google = inject(Google);
  private readonly toasts = inject(Toasts);

  readonly open = input(false);
  readonly sheet = input.required<SheetWithRows>();
  /** False in the spreadsheet view, where a read would race the sheet's autosave. */
  readonly canSync = input(true);
  readonly closed = output<void>();
  /** The person wants to say again where the tab's names and data are (the import's first step, on this table). */
  readonly redefine = output<void>();

  readonly link = computed(() => this.google.linkOf(this.sheet().sheetId));
  /** What is in the link field (a sheet's address, or just its id). */
  readonly address = signal('');
  readonly reading = signal(false);
  readonly readError = signal('');
  readonly opened = signal<OpenedSheet | null>(null);
  readonly pickedTab = signal('');
  readonly saving = signal(false);
  readonly entryCount = computed(() => this.sheet().columns.filter(isEntryColumn).length);
  /** The sheet and tab picked are not what the table reads now. */
  readonly changed = computed(() => {
    const link = this.link();
    const opened = this.opened();
    const tab = this.pickedTab();
    return !!link && !!opened && !!tab && (opened.file.id !== link.spreadsheetId || tab !== link.tabTitle);
  });

  /** Each read has a number, so an answer for an address typed over since is dropped. */
  private reads = 0;

  constructor() {
    // Each time it opens: back to the link in use (and make sure what's known of the sign-in is current).
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.reads += 1;
        this.opened.set(null);
        this.pickedTab.set('');
        this.readError.set('');
        this.reading.set(false);
        const link = this.link();
        this.address.set(link ? sheetUrl(link.spreadsheetId) : '');
        void this.google.init().then(() => this.google.refreshStatus());
      });
    });
    // Signed in (already, or right here): the sheet in use is read, so its tabs are there to choose from.
    effect(() => {
      if (this.open() && this.google.signedIn() && this.link()) untracked(() => void this.read());
    });
  }

  async read() {
    const text = this.address().trim();
    if (!text || this.reading()) return;
    const mine = ++this.reads;
    this.reading.set(true);
    this.readError.set('');
    try {
      const opened = await this.google.open(text);
      if (mine !== this.reads) return;
      this.opened.set(opened);
      this.pickedTab.set(this.firstTab(opened));
    } catch (error) {
      if (mine !== this.reads) return;
      this.opened.set(null);
      this.pickedTab.set('');
      this.readError.set(errorText(error));
    } finally {
      if (mine === this.reads) this.reading.set(false);
    }
  }

  /** The table's own tab when this is its sheet, else the tab that names most of the table's columns. */
  private firstTab(opened: OpenedSheet): string {
    const link = this.link();
    if (link && opened.file.id === link.spreadsheetId) {
      const mine = opened.tabs.find((tab) => tab.name === link.tabTitle && tab.rows.length);
      if (mine) return mine.name;
    }
    let best = { name: '', found: -1 };
    for (const tab of opened.tabs) {
      const found = tab.rows.length ? this.matches(tab) : -1;
      if (found > best.found) best = { name: tab.name, found };
    }
    return best.name;
  }

  isCurrent(opened: OpenedSheet, tab: string) {
    const link = this.link();
    return !!link && opened.file.id === link.spreadsheetId && tab === link.tabTitle;
  }

  /** How many of the table's columns a tab's headers name, as the link reads them (what it remembers, then names). */
  matches(tab: { headers: string[] }) {
    return matchHeaders(this.sheet().columns, tab.headers, this.link()?.headerMap ?? {}).matched.size;
  }

  async save(syncAfter: boolean) {
    const opened = this.opened();
    const tab = this.pickedTab();
    if (!opened || !tab || !this.changed() || this.saving()) return;
    const sheetId = this.sheet().sheetId;
    this.saving.set(true);
    try {
      await this.google.relink(sheetId, { spreadsheetId: opened.file.id, spreadsheetTitle: opened.file.name, tabTitle: tab });
    } catch (error) {
      this.toasts.error(errorText(error));
      return;
    } finally {
      this.saving.set(false);
    }
    this.closed.emit();
    if (syncAfter && this.canSync()) await this.google.syncAndTell(sheetId);
    else this.toasts.show(`Linked to ${opened.file.name} › ${tab}. Press Sync to read it.`);
  }

  async disconnect() {
    const link = this.link();
    if (!link || this.saving()) return;
    this.saving.set(true);
    try {
      await this.google.disconnect(link.sheetId);
      this.closed.emit();
      this.toasts.show(`${link.tableTitle} is no longer read from Google; its rows stay`);
    } catch (error) {
      this.toasts.error(errorText(error));
    } finally {
      this.saving.set(false);
    }
  }
}
