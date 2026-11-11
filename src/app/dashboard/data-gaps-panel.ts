import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Icon } from '../components/icon';
import type { SheetWithRows } from '../core/models';
import { columnRecords, gapSentence, tableGaps, type ColumnGap, type GapState, type TableGaps } from './data-gaps';

const STATE_TEXT: Record<GapState, string> = { missing: 'Nothing entered', partly: 'Partly filled', complete: 'Complete' };
const STATE_BADGE: Record<GapState, string> = { missing: 'danger', partly: 'warning', complete: 'success' };

/**
 * "Data Check": a tab for each table, and for the one
 * picked, which columns have nothing entered, which are only partly filled
 * (and on how many records), and which are complete.
 */
@Component({
  selector: 'app-data-gaps',
  imports: [Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card gaps" aria-labelledby="gaps-title">
      <header class="head">
        <p class="sub" id="gaps-title">Pick a table to see which of its columns still have nothing entered.</p>
        <span class="badge" [class]="overall().columns ? 'warning' : 'success'">
          @if (overall().columns) { {{ overall().columns }} {{ overall().columns === 1 ? 'column needs' : 'columns need' }} input } @else { Everything filled in }
        </span>
      </header>

      @if (tables().length) {
        <nav class="tabs" role="tablist" aria-label="Tables">
          @for (table of tables(); track table.sheet.sheetId) {
            <button type="button" role="tab" class="tab" [attr.aria-selected]="current()?.sheet?.sheetId === table.sheet.sheetId" (click)="pick(table.sheet.sheetId)">
              <span class="tab-name">{{ table.sheet.title }}</span>
              @if (!table.rows) {
                <span class="badge neutral">No records</span>
              } @else if (table.none + table.partly) {
                <span class="badge" [class]="table.none ? 'danger' : 'warning'">{{ table.none + table.partly }} to fill</span>
              } @else {
                <span class="badge success"><app-icon name="check" [size]="11" /> Complete</span>
              }
            </button>
          }
        </nav>

        @if (current(); as table) {
          <div class="detail">
            <p class="lead" [class.good]="table.rows && !table.none && !table.partly">{{ sentence() }}</p>

            @if (table.rows && table.none + table.partly) {
              <ul class="legend" aria-label="What the bars mean">
                <li><span class="dot danger"></span> Nothing entered: {{ table.none }}</li>
                <li><span class="dot warning"></span> Partly filled: {{ table.partly }}</li>
                <li><span class="dot success"></span> Complete: {{ table.complete }}</li>
              </ul>
            }

            @if (table.rows) {
              <ul class="list">
                @for (column of shown(); track column.key) {
                  <li class="item" [class.is-open]="open() === column.key">
                    <button type="button" class="line" [attr.aria-expanded]="open() === column.key" (click)="toggle(column)">
                      <div class="who">
                        <app-icon class="caret" name="chevron-right" [size]="14" />
                        <span class="name">{{ column.name }}</span>
                        @if (column.required) { <span class="req">Required</span> }
                        @if (column.where) { <span class="where">{{ column.where }}</span> }
                      </div>
                      <div class="how">
                        <div class="progress" aria-hidden="true"><div class="progress-bar" [class]="column.state === 'missing' ? 'is-danger' : column.state === 'partly' ? 'is-warning' : 'is-success'" [style.width.%]="column.percent"></div></div>
                        <span class="count">
                          @if (column.state === 'missing') { none of {{ table.rows }} filled }
                          @else if (column.state === 'partly') { {{ column.filled }} of {{ table.rows }} filled · {{ column.missing }} missing }
                          @else { all {{ table.rows }} filled }
                        </span>
                      </div>
                      <span class="badge" [class]="badge(column.state)">{{ text(column.state) }}</span>
                    </button>
                    @if (open() === column.key && records(); as rec) {
                      <div class="records">
                        <div class="segmented is-sm" role="group" aria-label="Which records">
                          <button type="button" class="segment" [attr.aria-pressed]="view() === 'missing'" (click)="setView('missing')">Not input ({{ rec.missing.length }})</button>
                          <button type="button" class="segment" [attr.aria-pressed]="view() === 'filled'" (click)="setView('filled')">Input ({{ rec.filled.length }})</button>
                        </div>
                        @if (listed(); as list) {
                          <ul class="recs">
                            @for (record of list.items; track record.rowId) {
                              <li class="rec">
                                <span class="no">#{{ record.number }}</span>
                                <span class="what">{{ record.label || 'No other input on this record' }}</span>
                                @if (view() === 'filled') { <b class="val" [title]="record.value">{{ record.value }}</b> } @else { <span class="badge danger">Not input</span> }
                              </li>
                            } @empty {
                              <li class="rec none">{{ view() === 'missing' ? 'Every record has it.' : 'No record has it yet.' }}</li>
                            }
                          </ul>
                          @if (list.more) {
                            <button type="button" class="chip" (click)="more()">Show {{ list.more > PAGE ? PAGE : list.more }} more ({{ list.more }} left)</button>
                          }
                        }
                      </div>
                    }
                  </li>
                }
              </ul>
              @if (table.complete && table.none + table.partly) {
                <button type="button" class="chip" [attr.aria-pressed]="showComplete()" (click)="showComplete.set(!showComplete())">
                  {{ showComplete() ? 'Hide' : 'Show' }} the {{ table.complete }} complete {{ table.complete === 1 ? 'column' : 'columns' }}
                </button>
              }
            }

            <a class="btn btn-plain btn-sm open" [routerLink]="['/mac', table.sheet.macId, 'table', table.sheet.sheetId]">Open {{ table.sheet.title }} <app-icon name="arrow-right" [size]="14" /></a>
          </div>
        }
      } @else {
        <p class="muted none">No tables yet.</p>
      }
    </section>
  `,
  styles: `
    :host { display: block; }
    .gaps { display: flex; flex-direction: column; gap: 14px; }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .sub { font-size: 0.8125rem; color: var(--text-muted); }
    .tabs { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; border-bottom: var(--hairline) solid var(--border); }
    .tab {
      display: inline-flex; align-items: center; gap: 8px; flex: none; padding: 8px 12px; border: 0; border-bottom: 2px solid transparent;
      background: transparent; font: inherit; font-size: 0.875rem; font-weight: 500; color: var(--text-muted); cursor: pointer; white-space: nowrap;
    }
    .tab:hover { color: var(--text); }
    .tab[aria-selected='true'] { color: var(--accent); border-bottom-color: var(--accent); }
    .detail { display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
    .lead { font-size: 0.9375rem; font-weight: 600; color: var(--text); line-height: 1.45; }
    .lead.good { color: var(--success); }
    .legend { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 0.75rem; color: var(--text-muted); }
    .legend li { display: inline-flex; align-items: center; gap: 6px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--fill); }
    .dot.danger { background: var(--danger); } .dot.warning { background: var(--warning); } .dot.success { background: var(--success); }
    .list { width: 100%; max-height: 420px; overflow: auto; display: flex; flex-direction: column; }
    .item { border-bottom: var(--hairline) solid var(--border); }
    .item:last-child { border-bottom: 0; }
    .line { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) auto; gap: 14px; align-items: center; width: 100%; padding: 9px 2px; border: 0; background: transparent; font: inherit; text-align: left; cursor: pointer; }
    .line:hover .name { color: var(--accent); }
    .caret { color: var(--text-muted); transition: transform var(--dur-fast) var(--ease); align-self: center; }
    .item.is-open .caret { transform: rotate(90deg); }
    .records { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; padding: 4px 4px 14px 24px; }
    .recs { width: 100%; display: flex; flex-direction: column; }
    .rec { display: grid; grid-template-columns: 3.5rem minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 6px 8px; border-radius: 8px; font-size: 0.8125rem; }
    .rec:nth-child(odd) { background: var(--fill); }
    .rec.none { display: block; color: var(--text-muted); background: transparent; }
    .no { color: var(--text-muted); font-variant-numeric: tabular-nums; }
    .what { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
    .val { max-width: 16rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .who { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; min-width: 0; }
    .name { font-size: 0.875rem; font-weight: 500; color: var(--text); }
    .where { font-size: 0.75rem; color: var(--text-muted); }
    .req { font-size: 0.6875rem; font-weight: 600; color: var(--danger); }
    .how { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    .count { font-size: 0.75rem; color: var(--text-muted); }
    .open { margin-top: 2px; }
    .none { padding: 4px 0 0; font-size: 0.875rem; }
    @media (max-width: 760px) { .line { grid-template-columns: 1fr; gap: 6px; } }
  `,
})
export class DataGaps {
  readonly sheets = input.required<readonly SheetWithRows[]>();
  readonly showComplete = signal(false);
  readonly PAGE = 25;
  /** The column opened (its records shown), which of its records, and how many of them are listed. */
  readonly open = signal<string | null>(null);
  readonly view = signal<'missing' | 'filled'>('missing');
  private readonly shownCount = signal(this.PAGE);
  private readonly picked = signal<number | null>(null);

  readonly tables = computed<TableGaps[]>(() => this.sheets().map((sheet) => tableGaps(sheet)));

  /** The tab open: the one picked, else the first table that needs input (or the first). */
  readonly current = computed(() => {
    const tables = this.tables();
    return tables.find((table) => table.sheet.sheetId === this.picked()) ?? tables.find((table) => table.none + table.partly > 0) ?? tables[0] ?? null;
  });

  readonly sentence = computed(() => {
    const table = this.current();
    return table ? gapSentence(table) : '';
  });

  /** The columns listed: those that need input; with the complete ones too once asked for (or when there is nothing else). */
  readonly shown = computed(() => {
    const table = this.current();
    if (!table) return [];
    const all = this.showComplete() || table.none + table.partly === 0;
    return all ? table.columns : table.columns.filter((column) => column.state !== 'complete');
  });

  /** How many columns, over every table, still need input. */
  readonly overall = computed(() => ({ columns: this.tables().reduce((sum, table) => sum + (table.rows ? table.none + table.partly : 0), 0) }));

  pick(sheetId: number) {
    this.picked.set(sheetId);
    this.showComplete.set(false);
    this.open.set(null);
  }

  /** The open column's records: those with nothing entered, and those with something. */
  readonly records = computed(() => {
    const table = this.current();
    const key = this.open();
    return table && key ? columnRecords(table.sheet, key) : null;
  });

  readonly listed = computed(() => {
    const rec = this.records();
    if (!rec) return null;
    const all = this.view() === 'missing' ? rec.missing : rec.filled;
    return { items: all.slice(0, this.shownCount()), more: Math.max(0, all.length - this.shownCount()) };
  });

  /** A column clicked: its records open under it (clicked again, shut). It opens on the records not input, if it has any. */
  toggle(column: ColumnGap) {
    if (this.open() === column.key) {
      this.open.set(null);
      return;
    }
    this.open.set(column.key);
    this.view.set(column.missing ? 'missing' : 'filled');
    this.shownCount.set(this.PAGE);
  }

  setView(view: 'missing' | 'filled') {
    this.view.set(view);
    this.shownCount.set(this.PAGE);
  }

  more() {
    this.shownCount.update((n) => n + this.PAGE);
  }

  text(state: GapState) {
    return STATE_TEXT[state];
  }

  badge(state: GapState) {
    return STATE_BADGE[state];
  }
}
