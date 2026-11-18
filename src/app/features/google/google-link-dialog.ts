import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { errorText } from '@core/api';
import { Google, type OpenedSheet } from '@core/google/google';
import type { SheetWithRows } from '@core/models';
import { Toasts } from '@core/toast';
import { headerMapOf, matchHeaders } from '@core/google/sheet-sync';
import { isEntryColumn } from '@shared/sheet/columns';
import { GoogleSignIn } from '@core/layout/google-sign-in';
import { Icon } from '@shared/ui/icon';
import { Modal } from '@shared/ui/modal';
import { spreadsheetOf, tabNamed } from './link-target';

/**
 * Which tab of the MAC's Google Sheet a table reads: the person types the tab's name, and the tab with that name
 * (capitals and spaces aside) is found in the Google Sheet the table, or else its MAC, already reads. No link
 * to paste again. Saving only moves the link: the rows stay as they are until Sync (or "Save & sync") reads the
 * tab. The columns the link has matched keep filling from the same headers.
 */
@Component({
  selector: 'app-google-link-dialog',
  imports: [Modal, Icon, GoogleSignIn, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [open]="open()" title="Google Sheet tab" [subtitle]="sheet().title" (closed)="closed.emit()">
      @if (!google.signedIn()) {
        <div class="center">
          <p class="muted">Sign in to Google to look at the sheet and change the tab. The app only reads: it never changes anything in Google.</p>
          <app-google-sign-in />
        </div>
      } @else if (!target()) {
        <div class="center">
          <p class="muted">This MAC isn't read from a Google Sheet yet. Connect it once; after that a table only needs its tab's name.</p>
          <a class="btn btn-secondary btn-sm" [routerLink]="['/mac', sheet().macId, 'google']" (click)="closed.emit()"><app-icon name="table" /> Connect Google Sheet</a>
        </div>
      } @else {
        <form (submit)="$event.preventDefault(); save(canSync())">
          <label class="form-group">
            <span class="form-label">Tab name</span>
            <input
              class="input-field"
              type="text"
              spellcheck="false"
              autocomplete="off"
              placeholder="The tab's name, as at the bottom of the Google Sheet"
              [attr.list]="listId()"
              [value]="typed()"
              (input)="typed.set($any($event.target).value)"
            />
            <datalist [id]="listId()">
              @for (tab of opened()?.tabs ?? []; track tab.name) {
                <option [value]="tab.name"></option>
              }
            </datalist>
            <small class="form-hint">A tab of <strong>{{ opened()?.file?.name ?? target()!.spreadsheetTitle }}</strong>, the Google Sheet this MAC reads.</small>
          </label>
        </form>

        <div class="status" aria-live="polite">
          @if (readError()) {
            <div class="alert-box error"><app-icon name="alert" /> {{ readError() }}</div>
          } @else if (!opened()) {
            <p class="say muted"><span class="spinner-sm"></span> Looking at the Google Sheet's tabs…</p>
          } @else if (typed().trim()) {
            @if (found(); as tab) {
              @if (!tab.rows.length) {
                <p class="say bad"><app-icon name="alert" [size]="14" /> The tab {{ tab.name }} has no rows under its headers.</p>
              } @else {
                <p class="say" [class.ok]="matches(tab)" [class.warn]="!matches(tab)">
                  <app-icon [name]="matches(tab) ? 'check' : 'alert'" [size]="14" />
                  <span>
                    <strong>{{ tab.name }}</strong> · {{ tab.rows.length }}{{ tab.truncated ? '+' : '' }} row{{ tab.rows.length === 1 ? '' : 's' }} ·
                    {{ matches(tab) }} of {{ entryCount() }} of this table's columns in it{{ changed() ? '' : ' · the tab it reads now' }}
                  </span>
                </p>
              }
            } @else {
              <p class="say bad">
                <app-icon name="alert" [size]="14" />
                <span>No tab called “{{ typed().trim() }}”. Its tabs: {{ tabNames() }}.</span>
              </p>
            }
          }
        </div>
      }

      <ng-container footer>
        @if (link()) {
          <button type="button" class="btn btn-plain danger-text" title="Stop reading this table from Google; its rows stay" [disabled]="saving()" (click)="disconnect()">Disconnect</button>
        }
        <span class="grow"></span>
        <button type="button" class="btn btn-secondary" (click)="closed.emit()">Cancel</button>
        @if (target()) {
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
        }
      </ng-container>
    </app-modal>
  `,
  styles: `
    .grow { flex: 1; }
    .danger-text { color: var(--danger); }
    small { font-size: 0.75rem; }
    .center { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
    .center p { margin: 0; font-size: 0.8125rem; }
    form .form-group { margin: 0; }
    .status { min-height: 1.5rem; margin-top: 12px; }
    .status .alert-box { margin: 0; }
    .say { display: flex; align-items: flex-start; gap: 8px; margin: 0; font-size: 0.8125rem; line-height: 1.45; }
    .say app-icon { flex: none; margin-top: 2px; }
    .say.ok { color: var(--success); }
    .say.ok strong, .say.warn strong { color: var(--text); }
    .say.warn { color: var(--warning); }
    .say.bad { color: var(--danger); }
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

  readonly link = computed(() => this.google.linkOf(this.sheet().sheetId));
  /** The Google Sheet the tab is looked for in: the table's own, else its MAC's. */
  readonly target = computed(() => spreadsheetOf(this.google.links(), this.sheet().sheetId, this.sheet().macId));
  private readonly targetId = computed(() => this.target()?.spreadsheetId ?? null);
  readonly listId = computed(() => `google-tabs-${this.sheet().sheetId}`);
  /** The tab's name as typed. */
  readonly typed = signal('');
  readonly reading = signal(false);
  readonly readError = signal('');
  readonly opened = signal<OpenedSheet | null>(null);
  readonly saving = signal(false);
  readonly entryCount = computed(() => this.sheet().columns.filter(isEntryColumn).length);
  /** The tab the typed name means. */
  readonly found = computed(() => tabNamed(this.opened()?.tabs ?? [], this.typed()));
  readonly tabNames = computed(() => (this.opened()?.tabs ?? []).map((tab) => tab.name).join(', '));
  /** A tab with rows is found, and it isn't what the table reads now. */
  readonly changed = computed(() => {
    const link = this.link();
    const opened = this.opened();
    const tab = this.found();
    return !!opened && !!tab && tab.rows.length > 0 && (!link || opened.file.id !== link.spreadsheetId || tab.name !== link.tabTitle);
  });

  /** Each read has a number, so an answer for a sheet no longer asked about is dropped. */
  private reads = 0;

  constructor() {
    // Each time it opens: the name of the tab in use (and make sure what's known of the sign-in is current).
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.reads += 1;
        this.opened.set(null);
        this.readError.set('');
        this.reading.set(false);
        this.typed.set(this.link()?.tabTitle ?? '');
        void this.google.init().then(() => this.google.refreshStatus());
      });
    });
    // Signed in (already, or right here): the Google Sheet is read, so a typed name can be found among its tabs.
    effect(() => {
      const id = this.targetId();
      if (this.open() && this.google.signedIn() && id) untracked(() => void this.read(id));
    });
  }

  private async read(spreadsheetId: string) {
    const mine = ++this.reads;
    this.reading.set(true);
    this.readError.set('');
    try {
      const opened = await this.google.open(spreadsheetId);
      if (mine === this.reads) this.opened.set(opened);
    } catch (error) {
      if (mine !== this.reads) return;
      this.opened.set(null);
      this.readError.set(errorText(error));
    } finally {
      if (mine === this.reads) this.reading.set(false);
    }
  }

  /** How many of the table's columns a tab's headers name, as the link reads them (what it remembers, then names). */
  matches(tab: { headers: string[] }) {
    return matchHeaders(this.sheet().columns, tab.headers, this.link()?.headerMap ?? {}).matched.size;
  }

  async save(syncAfter: boolean) {
    const opened = this.opened();
    const tab = this.found()?.name;
    if (!opened || !tab || !this.changed() || this.saving()) return;
    const sheetId = this.sheet().sheetId;
    this.saving.set(true);
    try {
      if (this.link()) {
        await this.google.relink(sheetId, { spreadsheetId: opened.file.id, spreadsheetTitle: opened.file.name, tabTitle: tab });
      } else {
        // The table's first link: the tab's headers matched to its columns, as the Connect page does.
        const data = opened.tabs.find((item) => item.name === tab)!;
        const { matched } = matchHeaders(this.sheet().columns, data.headers, {});
        await this.google.connectTable(
          sheetId,
          { spreadsheetId: opened.file.id, spreadsheetTitle: opened.file.name, tabTitle: tab, headerMap: headerMapOf(data.headers, matched), layout: null },
          data.rows.length,
        );
      }
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
