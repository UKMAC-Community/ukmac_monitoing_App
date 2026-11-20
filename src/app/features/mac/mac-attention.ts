import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';

import { errorText } from '@core/api';
import { AutoSync } from '@core/auto-sync';
import { Google } from '@core/google/google';
import type { SheetWithRows } from '@core/models';
import { Toasts } from '@core/toast';
import { Icon } from '@shared/ui/icon';
import { needsYou, recordsLine } from './mac-attention-model';

/** What a person took off the list, per MAC: the table, and what was missing in it then (so a change brings it back). */
const key = (macId: number) => `ukmac.attention.${macId}`;

function read(macId: number): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(key(macId)) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

/**
 * Under the dashboard's map: on the left, how this MAC's tables are connected to their Google Sheets and when each was last read;
 * on the right, what still needs filling in (a box for each table: a column with nothing entered by its name alone, a partly filled
 * one with the records that lack it), each box taken off with its ✕.
 */
@Component({
  selector: 'app-mac-attention',
  imports: [Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pair">
      <section class="card box" aria-labelledby="att-sheets">
        <header class="head">
          <h2 class="card-title" id="att-sheets">Google Sheets</h2>
          <span class="badge" [class]="connected().length ? 'success' : 'neutral'">{{ connected().length }} of {{ sheets().length }} tables</span>
          <span class="grow"></span>
          @if (connected().length && signedIn()) {
            <!-- Every table here, each Google Sheet downloaded and opened once however many of them read it. -->
            <button
              type="button"
              class="btn btn-secondary btn-sm sync-all"
              [class.is-busy]="run()"
              [disabled]="run() !== null || reading()"
              [attr.aria-busy]="run() !== null"
              title="Read every table here from its Google Sheet again (a sheet several tables read is downloaded once)"
              (click)="syncAll()"
            >
              @if (run(); as now) {
                <span class="spinner-sm"></span> Reading {{ now.done + 1 > now.ids.length ? now.ids.length : now.done + 1 }} of {{ now.ids.length }}
                <span class="sync-bar" aria-hidden="true"><span [style.width.%]="(now.done / now.ids.length) * 100"></span></span>
              } @else {
                <app-icon name="refresh" [size]="14" /> Sync all
              }
            </button>
          }
          <a class="more" [routerLink]="['/mac', macId(), 'google']">Manage <app-icon name="arrow-right" [size]="13" /></a>
        </header>
        @if (connected().length) {
          @if (oneSpreadsheet(); as one) {
            <p class="from"><app-icon name="table" [size]="13" /> All read from <b>{{ one }}</b></p>
          }
          <!-- One slim line a table: its state, its name, the tab it reads, how many rows, when. -->
          <ul class="rows" [class.can-sync]="signedIn()">
            @for (item of connected(); track item.sheetId) {
              <li class="row">
                <span class="dot" [class]="item.state" [title]="stateWords[item.state]" aria-hidden="true"></span>
                <a class="name" [routerLink]="['/mac', macId(), 'table', item.sheetId]" [title]="'Open ' + item.title">{{ item.title }}</a>
                <span class="tab" [title]="item.tab + ' · ' + item.spreadsheet">{{ oneSpreadsheet() ? item.tab : item.tab + ' · ' + item.spreadsheet }}</span>
                <span class="num">{{ item.rows.toLocaleString('en-US') }} {{ item.rows === 1 ? 'row' : 'rows' }}</span>
                <span class="ago" [class.stale]="item.state !== 'fresh' && !item.syncing && !item.waiting" [class.busy]="item.syncing">{{ item.syncing ? 'Reading…' : item.waiting ? 'Waiting' : item.ago }}</span>
                @if (signedIn()) {
                  <!-- This table alone: only its tab is read. -->
                  <span class="sync">
                    @if (item.syncing) {
                      <span class="spinner-sm" aria-hidden="true"></span>
                    } @else {
                      <button
                        type="button"
                        class="icon-btn is-quiet is-sm"
                        [disabled]="run() !== null || item.held"
                        [title]="item.held ? 'Close the sheet view of ' + item.title + ' to sync it' : 'Sync ' + item.title + ' only'"
                        [attr.aria-label]="'Sync ' + item.title"
                        (click)="syncOne(item.sheetId)"
                      >
                        <app-icon name="refresh" [size]="14" />
                      </button>
                    }
                  </span>
                }
              </li>
            }
          </ul>
        } @else {
          <p class="none">No table of this MAC reads a Google Sheet yet.</p>
        }
        @if (unconnected().length) {
          <p class="foot">Not connected: {{ unconnected().join(', ') }}</p>
        }
      </section>

      <section class="card box" aria-labelledby="att-needs">
        <header class="head">
          <h2 class="card-title" id="att-needs">Needs you</h2>
          @if (needs().length) {
            <span class="badge warning">{{ needs().length }} {{ needs().length === 1 ? 'table' : 'tables' }}</span>
          }
          <span class="grow"></span>
          @if (hidden()) {
            <button type="button" class="more" (click)="restore()">Show {{ hidden() }} hidden</button>
          }
        </header>
        @if (needs().length) {
          <ul class="needs">
            @for (need of needs(); track need.sheetId) {
              <li class="need">
                <div class="need-head">
                  <a class="need-title" [routerLink]="['/mac', macId(), 'table', need.sheetId]" [title]="'Open ' + need.title"><app-icon [name]="need.icon || 'table'" [size]="15" /> {{ need.title }}</a>
                  <span class="pct" [class.low]="need.filled < 80">{{ need.filled }}% filled</span>
                  <button type="button" class="icon-btn is-quiet is-sm" [title]="'Take ' + need.title + ' off this list'" [attr.aria-label]="'Take ' + need.title + ' off this list'" (click)="dismiss(need.sheetId, need.signature)"><app-icon name="x" [size]="14" /></button>
                </div>
                <div class="meter" [class.low]="need.filled < 80" role="img" [attr.aria-label]="need.filled + '% filled in'"><i [style.width.%]="need.filled"></i></div>
                @if (need.emptyColumns.length) {
                  <p class="empty-line"><span class="flag" aria-hidden="true"></span><span><b>Nothing entered:</b> {{ need.emptyColumns.join(', ') }}@if (need.moreEmpty) { and {{ need.moreEmpty }} more}</span></p>
                }
                @for (column of need.partly; track column.key) {
                  <div class="col-line">
                    <div class="col-top">
                      <span class="col" [title]="column.name">{{ column.name }}</span>
                      <span class="mini" aria-hidden="true"><i [style.width.%]="(column.missing / column.total) * 100"></i></span>
                      <span class="count">{{ column.missing }} of {{ column.total }} missing</span>
                    </div>
                    @if (column.records.length) {
                      <p class="recs" [title]="line(column.records, column.more)">{{ line(column.records, column.more) }}</p>
                    }
                  </div>
                }
                @if (need.moreColumns) {
                  <a class="more-cols" [routerLink]="['/mac', macId(), 'data-check']">+ {{ need.moreColumns }} more {{ need.moreColumns === 1 ? 'column' : 'columns' }} partly filled <app-icon name="arrow-right" [size]="12" /></a>
                }
              </li>
            }
          </ul>
        } @else {
          <p class="none"><app-icon name="check" [size]="15" /> {{ hidden() ? 'Nothing else is missing.' : 'Everything that is typed in is filled in.' }}</p>
        }
      </section>
    </div>
  `,
  styles: `
    :host { display: block; }
    .pair { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
    @media (max-width: 900px) { .pair { grid-template-columns: minmax(0, 1fr); } }
    .box { padding: 16px 18px; display: flex; flex-direction: column; gap: 10px; }
    .head { display: flex; align-items: center; gap: 10px; }
    .grow { flex: 1; }
    .more { display: inline-flex; align-items: center; gap: 4px; border: 0; background: none; padding: 0; font: inherit; font-size: 0.8125rem; font-weight: 600; color: var(--accent); cursor: pointer; text-decoration: none; }
    .none { margin: 0; display: flex; align-items: center; gap: 8px; font-size: 0.875rem; color: var(--text-muted); }
    .foot { margin: 0; font-size: 0.75rem; color: var(--text-muted); }

    /* Google Sheets: a slim line a table, a hairline between. */
    .from { margin: 0; display: flex; align-items: center; gap: 6px; font-size: 0.75rem; color: var(--text-muted); }
    .from b { font-weight: 600; color: var(--text); }
    .rows { margin: 0; padding: 2px 10px; list-style: none; border-radius: var(--radius); background: var(--fill); }
    .row { display: grid; grid-template-columns: 8px minmax(96px, 0.9fr) minmax(0, 1fr) 76px 62px; align-items: center; gap: 10px; min-height: 34px; font-size: 0.8125rem; }
    .row + .row { border-top: var(--hairline) solid var(--border); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-muted); }
    .dot.fresh { background: var(--success); }
    .dot.old { background: var(--warning); }
    .dot.never { background: var(--danger, #d92d20); }
    .name { font-weight: 600; color: var(--text); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .name:hover { color: var(--accent); }
    .tab, .num { font-size: 0.75rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .num { text-align: right; font-variant-numeric: tabular-nums; }
    .ago { text-align: right; font-size: 0.75rem; font-weight: 600; color: var(--text); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .ago.stale { color: var(--warning); }
    .ago.busy { color: var(--accent); }
    .rows.can-sync .row { grid-template-columns: 8px minmax(96px, 0.9fr) minmax(0, 1fr) 76px 62px 26px; }
    .sync { display: flex; align-items: center; justify-content: center; }
    .sync .icon-btn { width: 26px; height: 26px; }
    .sync .spinner-sm { width: 13px; height: 13px; }
    .sync-all { position: relative; overflow: hidden; }
    .sync-all.is-busy { color: var(--accent); opacity: 1; }
    .sync-bar { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: color-mix(in srgb, var(--accent) 18%, transparent); }
    .sync-bar > span { display: block; height: 100%; background: var(--accent); transition: width 300ms ease; }

    /* Needs you: a table a block, how full it is, then what is missing in it. */
    .needs { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; max-height: 460px; overflow-y: auto; }
    .need { display: flex; flex-direction: column; gap: 8px; padding: 12px 2px; }
    .need + .need { border-top: var(--hairline) solid var(--border); }
    .need:first-child { padding-top: 2px; }
    .need-head { display: flex; align-items: center; gap: 8px; }
    .need-title { flex: 1; min-width: 0; display: inline-flex; align-items: center; gap: 8px; font-weight: 600; color: var(--text); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .need-title:hover { color: var(--accent); }
    .pct { flex: none; font-size: 0.75rem; font-weight: 600; color: var(--success); font-variant-numeric: tabular-nums; }
    .pct.low { color: var(--warning); }
    .meter { height: 4px; border-radius: 999px; background: var(--fill); overflow: hidden; }
    .meter i { display: block; height: 100%; border-radius: inherit; background: var(--success); }
    .meter.low i { background: var(--warning); }
    .empty-line { margin: 0; display: flex; align-items: baseline; gap: 8px; font-size: 0.8125rem; color: var(--text); }
    .empty-line b { font-weight: 600; color: var(--danger, #b42318); }
    .flag { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--danger, #d92d20); transform: translateY(-1px); }
    .col-line { display: flex; flex-direction: column; gap: 2px; padding-left: 15px; }
    .col-top { display: grid; grid-template-columns: minmax(0, 1fr) 72px 118px; align-items: center; gap: 10px; font-size: 0.8125rem; }
    .col { font-weight: 500; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mini { height: 4px; border-radius: 999px; background: var(--fill); overflow: hidden; }
    .mini i { display: block; height: 100%; background: var(--warning); border-radius: inherit; }
    .count { text-align: right; font-size: 0.75rem; color: var(--warning); font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .recs { margin: 0; font-size: 0.75rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .more-cols { align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; padding-left: 15px; font-size: 0.75rem; font-weight: 600; color: var(--accent); text-decoration: none; }
  `,
})
export class MacAttention {
  readonly sheets = input.required<readonly SheetWithRows[]>();
  readonly macId = input.required<number>();
  private readonly google = inject(Google);
  private readonly autoSync = inject(AutoSync);
  private readonly toasts = inject(Toasts);
  /** Syncing needs the Google sign-in, as the top bar's Sync does. */
  readonly signedIn = this.google.signedIn;
  /** This card's Sync all: the tables in the order they are read and how many are done; null when it isn't reading. */
  readonly run = signal<{ ids: readonly number[]; done: number } | null>(null);

  /** What was taken off: the table, and what was missing then. */
  private readonly taken = signal<Record<string, string>>({});

  constructor() {
    effect(() => {
      const id = this.macId();
      untracked(() => this.taken.set(read(id)));
    });
  }

  private readonly all = computed(() => needsYou(this.sheets()));
  readonly needs = computed(() => this.all().filter((need) => this.taken()[need.sheetId] !== need.signature));
  readonly hidden = computed(() => this.all().length - this.needs().length);

  dismiss(sheetId: number, signature: string) {
    this.taken.update((now) => ({ ...now, [sheetId]: signature }));
    this.save();
  }

  restore() {
    this.taken.set({});
    this.save();
  }

  private save() {
    try {
      localStorage.setItem(key(this.macId()), JSON.stringify(this.taken()));
    } catch {
      /* kept for this run only */
    }
  }

  /** The tables of this MAC that read a Google Sheet (not one the app made from the table and writes to), and when each was last read. */
  readonly connected = computed(() => {
    const titles = new Map(this.sheets().map((sheet) => [sheet.sheetId, sheet.title]));
    return this.google
      .links()
      .filter((link) => link.macId === this.macId() && link.origin !== 'app' && titles.has(link.sheetId))
      .map((link) => {
        const synced = link.lastSyncedAt ? new Date(`${link.lastSyncedAt.replace(' ', 'T')}Z`).getTime() : null;
        const state = synced === null ? 'never' : Date.now() - synced > 24 * 3_600_000 ? 'old' : 'fresh';
        return {
          sheetId: link.sheetId,
          title: titles.get(link.sheetId)!,
          tab: link.tabTitle,
          spreadsheet: link.spreadsheetTitle,
          ago: this.google.ago(link.lastSyncedAt),
          rows: link.lastRowCount,
          state,
          syncing: this.google.syncing().has(link.sheetId),
          // Still to come in Sync all (the one at `done` is being read).
          waiting: this.waiting(link.sheetId),
          // Open in the sheet view: a read would race the sheet's own saves (the top bar's Sync leaves it out too).
          held: this.autoSync.held().has(link.sheetId),
        };
      });
  });

  /** One of this MAC's tables is being read (its own Sync, the top bar's, or the app's own): Sync all waits for it. */
  readonly reading = computed(() => this.connected().some((item) => item.syncing));

  private waiting(sheetId: number) {
    const now = this.run();
    return now !== null && now.ids.indexOf(sheetId) > now.done;
  }

  /** One table: only it is read again. */
  async syncOne(sheetId: number) {
    if (this.run() || this.autoSync.held().has(sheetId)) return;
    await this.google.syncAndTell(sheetId);
  }

  /** Every table of this MAC that reads a Google Sheet (one open in the sheet view left out), each Google Sheet downloaded once. */
  async syncAll() {
    if (this.run() || this.reading()) return;
    const held = this.autoSync.held();
    const items = this.connected();
    const ids = items.filter((item) => !held.has(item.sheetId)).map((item) => item.sheetId);
    const left = items.length - ids.length;
    if (!ids.length) {
      this.toasts.show('Close the sheet view to sync that table.', 'info');
      return;
    }
    this.run.set({ ids, done: 0 });
    let outcomes: Awaited<ReturnType<Google['syncMany']>>;
    try {
      outcomes = await this.google.syncMany(ids, (done) => this.run.update((now) => now && { ...now, done }));
    } finally {
      this.run.set(null);
    }
    const titles = new Map(items.map((item) => [item.sheetId, item.title]));
    const failed = [...outcomes].filter((entry): entry is [number, Error] => entry[1] instanceof Error);
    const read = outcomes.size - failed.length;
    const rows = [...outcomes.values()].reduce((sum, outcome) => sum + (outcome instanceof Error ? 0 : outcome.rows), 0);
    if (failed.length) {
      const [sheetId, error] = failed[0];
      this.toasts.error(`${read} of ${outcomes.size} tables read. ${titles.get(sheetId)}: ${errorText(error)}`);
    } else {
      this.toasts.show(
        `${read} table${read === 1 ? '' : 's'} read from Google (${rows.toLocaleString('en-US')} rows)${left ? ` · ${left} open in sheet view left for now` : ''}`,
        'ok',
      );
    }
  }

  /** When every table reads the same spreadsheet, it is named once over them. */
  readonly oneSpreadsheet = computed(() => {
    const names = new Set(this.connected().map((item) => item.spreadsheet));
    return names.size === 1 ? [...names][0] : null;
  });

  readonly stateWords: Record<string, string> = { fresh: 'Read in the last day', old: 'Not read for more than a day', never: 'Not read yet' };

  line(records: readonly string[], more: number) {
    return recordsLine(records, more);
  }

  readonly unconnected = computed(() => {
    const linked = new Set(this.connected().map((item) => item.sheetId));
    return this.sheets().filter((sheet) => !linked.has(sheet.sheetId)).map((sheet) => sheet.title);
  });
}
