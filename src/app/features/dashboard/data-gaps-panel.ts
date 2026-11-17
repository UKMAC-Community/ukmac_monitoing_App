import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import { Icon } from '@shared/ui/icon';
import { HEADING_ICONS, LAYOUT_HEADING } from '@core/headings';
import { GapRing } from '@shared/ui/gap-ring';
import { SegmentedThumb } from '@shared/ui/segmented-thumb';
import type { Row, SheetWithRows } from '@core/models';
import { WorkbookStore } from '@core/workbook-store';
import { isFormulaError } from '@shared/formula/evaluate-formula';
import { gapsFirst, hasGap, missingData } from '@features/tables/missing-data';
import { SheetTable } from '@features/tables/sheet-table';
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
  imports: [Icon, RouterLink, SegmentedThumb, GapRing, DecimalPipe, SheetTable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card gaps" aria-labelledby="gaps-title">
      <header class="head">
        <p class="sub" id="gaps-title">{{ current() ? 'Which columns of this table still have nothing entered.' : 'Each table, as in the menu, with how filled it is. Pick one to see which of its columns still have nothing entered.' }}</p>
        <span class="badge" [class]="overall().columns ? 'warning' : 'success'">
          @if (overall().columns) { {{ overall().columns }} {{ overall().columns === 1 ? 'column needs' : 'columns need' }} input } @else { Everything filled in }
        </span>
      </header>

      @if (tables().length) {
        @if (!current()) {
          <!-- The tables as the menu groups them (Farm Layout, then each Farm Progress group), a card for each; a click opens its columns. -->
          <div class="sections">
            @for (section of sections(); track section.heading; let first = $first) {
              @if (section.layout) {
                <span class="section-label">Farm Layout</span>
              } @else if (first || sections()[$index - 1].layout) {
                <span class="section-label">Farm Progress</span>
              }
              <section class="group" [attr.aria-label]="section.layout ? 'Farm Layout' : section.heading">
                @if (!section.layout) {
                  <span class="sec-name"><app-icon [name]="icon(section.heading)" [size]="17" /> {{ section.heading }}</span>
                }
                <ul class="cards grid">
                  @for (card of section.cards; track card.table.sheet.sheetId) {
                    <li class="item">
                      <button type="button" class="line" (click)="pick(card.table.sheet.sheetId)" [title]="'Open the columns of ' + card.table.sheet.title">
                        <span class="top">
                          <span class="name">{{ card.table.sheet.title }}</span>
                          <app-gap-ring [filled]="card.filled" [total]="card.cells" [tone]="badge(card.state) === 'danger' ? 'danger' : badge(card.state) === 'warning' ? 'warning' : 'success'" [size]="34" />
                        </span>
                        <span class="meta">
                          @if (!card.table.rows) {
                            <span class="mchip gone is-none">No records</span>
                          } @else {
                            <span class="mchip"><b class="fraction">{{ card.filled | number }}<span class="of">/{{ card.cells | number }}</span></b> cells</span>
                            @if (card.table.none + card.table.partly) {
                              <span class="mchip gone" [class.is-none]="card.state === 'missing'">{{ card.table.none + card.table.partly }} {{ card.table.none + card.table.partly === 1 ? 'column' : 'columns' }} to fill</span>
                            } @else {
                              <span class="mchip good"><app-icon name="check" [size]="11" /> All filled</span>
                            }
                            <span class="mchip where">{{ card.table.rows }} {{ card.table.rows === 1 ? 'record' : 'records' }}</span>
                          }
                        </span>
                      </button>
                    </li>
                  }
                </ul>
              </section>
            }
          </div>
        } @else {
          <button type="button" class="btn btn-plain btn-sm back" (click)="pick(null)"><app-icon name="arrow-left" [size]="14" /> All tables</button>
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

            @if (table.rows) {
              <div class="overview">
                <app-gap-ring [filled]="totals().filled" [total]="totals().cells" [tone]="totals().missing ? 'warning' : 'success'" [size]="84" />
                <div class="overview-text">
                  <b class="fraction">{{ totals().filled | number }}<span class="of">/{{ totals().cells | number }}</span></b>
                  <span class="muted">cells filled across {{ table.rows }} {{ table.rows === 1 ? 'record' : 'records' }} × {{ table.columns.length }} columns</span>
                  @if (totals().missing) { <span class="gone">{{ totals().missing | number }} missing</span> } @else { <span class="all">Nothing missing</span> }
                </div>
              </div>
            }

            @if (table.rows) {
              <div class="segmented" role="group" aria-label="Show what is missing">
                <button type="button" class="segment" [attr.aria-pressed]="shape() === 'columns'" (click)="setShape('columns')"><app-icon name="grid" [size]="14" /> By column</button>
                <button type="button" class="segment" [attr.aria-pressed]="shape() === 'table'" (click)="setShape('table')"><app-icon name="table" [size]="14" /> As the table</button>
              </div>
            }

            @if (table.rows && shape() === 'table') {
              <!-- The table itself: only its records with something missing, each empty cell saying so, each column how many it lacks. -->
              <p class="table-note">
                @if (gapRows().length) {
                  <b>{{ gapRows().length | number }}</b> of {{ table.rows | number }} {{ table.rows === 1 ? 'record has' : 'records have' }} something missing. Each empty cell says <span class="gone">Missing</span>, and each column how many it lacks.
                } @else {
                  Every record has all its columns filled in.
                }
              </p>
              @if (gapRows().length) {
                <div class="gap-table">
                  <app-sheet-table [sheet]="table.sheet" [rows]="gapRows()" [formulas]="store.formulas()" [sort]="sort()" [missing]="gapColumns()" [gapFirst]="gapFirst()" (gapFirstBy)="toggleGapFirst($event)" (sortBy)="sortBy($event)" />
                </div>
              }
            }

            @if (table.rows && shape() === 'columns') {
              <!-- A board: a lane for each state, a card for each column. -->
              <div class="board" role="list" aria-label="Columns by how filled they are">
                @for (lane of lanes(); track lane.state) {
                  <section class="lane" [class]="'lane is-' + lane.state" role="listitem" [attr.aria-label]="lane.title">
                    <header class="lane-head">
                      <span class="lane-pill" [class]="'lane-pill ' + badge(lane.state)"><span class="lane-dot"></span> {{ lane.title }}</span>
                      <span class="lane-count">{{ lane.columns.length }}</span>
                    </header>
                    <ul class="cards">
                      @for (column of lane.columns; track column.key) {
                        <li class="item has-goto" [class.is-open]="open() === column.key">
                          <a class="goto" [routerLink]="['/mac', table.sheet.macId, 'table', table.sheet.sheetId]" [queryParams]="{ column: column.key }" [title]="'Show ' + column.name + ' in ' + table.sheet.title" [attr.aria-label]="'Show ' + column.name + ' in ' + table.sheet.title"><app-icon name="arrow-right" [size]="14" /></a>
                          <button type="button" class="line" [attr.aria-expanded]="open() === column.key" (click)="toggle(column)">
                            <span class="top">
                              <span class="name">{{ column.name }}</span>
                              <app-gap-ring [filled]="column.filled" [total]="table.rows" [tone]="badge(column.state) === 'danger' ? 'danger' : badge(column.state) === 'warning' ? 'warning' : 'success'" [size]="34" />
                            </span>
                            <span class="meta">
                              <span class="count">
                                <span class="mchip"><b class="fraction">{{ column.filled }}<span class="of">/{{ table.rows }}</span></b></span>
                                @if (column.state === 'complete') { <span class="mchip good"><app-icon name="check" [size]="11" /> All filled</span> }
                                @else { <span class="mchip gone" [class.is-none]="column.state === 'missing'">{{ column.missing }} missing</span> }
                              </span>
                              @if (column.required) { <span class="mchip req"><app-icon name="alert" [size]="11" /> Required</span> }
                              @if (column.where) { <span class="mchip where">{{ column.where }}</span> }
                            </span>
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
                      } @empty {
                        <li class="lane-none">{{ lane.state === 'complete' ? 'Nothing complete yet' : 'None' }}</li>
                      }
                    </ul>
                  </section>
                }
              </div>
            }

            <a class="btn btn-plain btn-sm open" [routerLink]="['/mac', table.sheet.macId, 'table', table.sheet.sheetId]">Open {{ table.sheet.title }} <app-icon name="arrow-right" [size]="14" /></a>
          </div>
        }
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
    .board { width: 100%; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; align-items: start; }
    .lane { display: flex; flex-direction: column; gap: 10px; padding: 10px; border-radius: 16px; background: var(--fill); min-width: 0; }
    .lane-head { display: flex; align-items: center; gap: 8px; padding: 2px 2px 0; }
    .lane-pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
    .lane-pill.danger { background: var(--danger); color: #fff; }
    .lane-pill.warning { background: var(--warning); color: #fff; }
    .lane-pill.success { background: var(--success); color: #fff; }
    .lane-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: 0.85; }
    .lane-count { font-size: 0.8125rem; font-weight: 600; color: var(--text-muted); font-variant-numeric: tabular-nums; }
    .lane.is-missing .lane-count { color: var(--danger); } .lane.is-partly .lane-count { color: var(--warning); } .lane.is-complete .lane-count { color: var(--success); }
    .cards { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .lane-none { padding: 14px 8px; border: 1px dashed var(--border); border-radius: 12px; text-align: center; font-size: 0.8125rem; color: var(--text-muted); }
    .item { border: var(--hairline) solid var(--border); border-radius: 12px; background: var(--surface-solid); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); transition: box-shadow var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease); }
    .item:hover { box-shadow: 0 3px 10px rgba(0, 0, 0, 0.09); }
    .item.is-open { border-color: var(--accent); }
    .line { display: flex; flex-direction: column; gap: 10px; width: 100%; padding: 12px; border: 0; background: transparent; font: inherit; text-align: left; cursor: pointer; border-radius: 12px; }
    .top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .line:hover .name { color: var(--accent); }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .has-goto { position: relative; }
    .has-goto .meta { padding-right: 34px; }
    /* A way to the column itself: the table opens scrolled to it, and lights it. */
    .goto { position: absolute; right: 10px; top: 56px; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; color: var(--text-muted); background: var(--fill); transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease); }
    .goto:hover { background: var(--accent); color: #fff; }
    .count { display: contents; }
    .mchip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border: var(--hairline) solid var(--border); border-radius: 8px; background: var(--surface-solid); font-size: 0.75rem; color: var(--text-muted); white-space: nowrap; }
    .mchip .fraction { font-size: 0.8125rem; }
    .overview .gone { font-weight: 600; color: var(--warning); }
    .mchip.gone { color: var(--warning); font-weight: 600; } .mchip.gone.is-none { color: var(--danger); }
    .mchip.good { color: var(--success); font-weight: 600; }
    .mchip.req { color: var(--danger); font-weight: 600; }
    .records { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; padding: 2px 12px 12px; }
    .recs { width: 100%; display: flex; flex-direction: column; }
    .rec { display: grid; grid-template-columns: 3.5rem minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 6px 8px; border-radius: 8px; font-size: 0.8125rem; }
    .rec:nth-child(odd) { background: var(--fill); }
    .rec.none { display: block; color: var(--text-muted); background: transparent; }
    .no { color: var(--text-muted); font-variant-numeric: tabular-nums; }
    .what { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
    .val { max-width: 16rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .name { font-size: 0.9375rem; font-weight: 600; color: var(--text); line-height: 1.3; min-width: 0; overflow-wrap: anywhere; }
    .fraction { font-size: 0.9375rem; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
    .of { font-weight: 500; color: var(--text-muted); }
    .all { font-weight: 600; color: var(--success); }
    .overview { align-self: stretch; display: flex; align-items: center; gap: 18px; flex-wrap: wrap; padding: 14px 16px; border: var(--hairline) solid var(--border); border-radius: 14px; background: var(--fill); }
    .overview-text { display: flex; flex-direction: column; gap: 2px; font-size: 0.8125rem; }
    .overview-text .fraction { font-size: 1.5rem; line-height: 1.1; }
    .open { margin-top: 2px; }
    .table-note { font-size: 0.8125rem; color: var(--text-muted); }
    .table-note b { color: var(--text); font-variant-numeric: tabular-nums; }
    .table-note .gone { font-weight: 600; color: var(--warning); }
    .gap-table { align-self: stretch; min-width: 0; border: var(--hairline) solid var(--border); border-radius: 14px; overflow: hidden; background: var(--surface-solid); }
    .back { align-self: flex-start; margin-left: -6px; }
    .sections { display: flex; flex-direction: column; gap: 14px; }
    .section-label { margin-top: 6px; font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
    .group { display: flex; flex-direction: column; gap: 10px; }
    .sec-name { display: flex; align-items: center; gap: 8px; font-size: 0.9375rem; font-weight: 600; color: var(--text); }
    .cards.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
    .none { padding: 4px 0 0; font-size: 0.875rem; }
    @media (max-width: 1100px) { .board { grid-template-columns: 1fr; } }
  `,
})
export class DataGaps {
  readonly sheets = input.required<readonly SheetWithRows[]>();
  readonly store = inject(WorkbookStore);
  /** How the open table's gaps are shown: a card for each column, or the table itself with each empty cell marked (kept). */
  readonly shape = signal<'columns' | 'table'>(readShape());
  readonly sort = signal<{ key: string; dir: 1 | -1 } | null>(null);
  /** A column's "9 missing" clicked in the table: its records with nothing there on top (clicked again: the usual order). */
  readonly gapFirst = signal<string | null>(null);
  toggleGapFirst(key: string) {
    this.gapFirst.update((now) => (now === key ? null : key));
  }
  readonly PAGE = 25;
  /** The column opened (its records shown), which of its records, and how many of them are listed. */
  readonly open = signal<string | null>(null);
  readonly view = signal<'missing' | 'filled'>('missing');
  private readonly shownCount = signal(this.PAGE);
  /** The table whose columns are open; none: the board of tables. */
  private readonly picked = signal<number | null>(null);

  readonly tables = computed<TableGaps[]>(() => this.sheets().map((sheet) => tableGaps(sheet)));

  /** The table open (its columns shown): the one picked; none while the board of tables is up. */
  readonly current = computed(() => this.tables().find((table) => table.sheet.sheetId === this.picked()) ?? null);

  /** The tables as the menu groups them: the layout tables first, then each progress heading, each table with how filled it is. */
  readonly sections = computed(() => {
    const groups = new Map<string, { heading: string; layout: boolean; cards: { table: TableGaps; cells: number; filled: number; state: GapState }[] }>();
    for (const table of this.tables()) {
      const heading = table.sheet.heading;
      const cells = table.rows * table.columns.length;
      const filled = table.columns.reduce((sum, column) => sum + column.filled, 0);
      const state: GapState = !table.rows || (table.columns.length > 0 && filled === 0) ? 'missing' : table.none + table.partly ? 'partly' : 'complete';
      const group = groups.get(heading) ?? { heading, layout: heading === LAYOUT_HEADING, cards: [] };
      group.cards.push({ table, cells, filled, state });
      groups.set(heading, group);
    }
    // As in the menu: Farm Layout above Farm Progress.
    return [...groups.values()].sort((a, b) => Number(b.layout) - Number(a.layout));
  });

  icon(heading: string) {
    return HEADING_ICONS[heading] ?? 'table';
  }

  /** Every cell of the open table (records × columns): how many have an input, how many don't. */
  readonly totals = computed(() => {
    const table = this.current();
    const cells = table ? table.rows * table.columns.length : 0;
    const filled = table ? table.columns.reduce((sum, column) => sum + column.filled, 0) : 0;
    return { cells, filled, missing: cells - filled };
  });

  readonly sentence = computed(() => {
    const table = this.current();
    return table ? gapSentence(table) : '';
  });

  /** The board: a lane for each state, with the table's columns that are in it (the ones needing most first). */
  readonly lanes = computed(() => {
    const table = this.current();
    const columns = table?.columns ?? [];
    return (['missing', 'partly', 'complete'] as const).map((state) => ({
      state,
      title: STATE_TEXT[state],
      columns: columns.filter((column) => column.state === state),
    }));
  });

  /** How many columns, over every table, still need input. */
  readonly overall = computed(() => ({ columns: this.tables().reduce((sum, table) => sum + (table.rows ? table.none + table.partly : 0), 0) }));

  pick(sheetId: number | null) {
    this.picked.set(sheetId);
    this.open.set(null);
    this.sort.set(null);
    this.gapFirst.set(null);
  }

  setShape(shape: 'columns' | 'table') {
    this.shape.set(shape);
    try {
      localStorage.setItem(SHAPE_KEY, shape);
    } catch {
      /* kept for this run only */
    }
  }

  /** The open table's columns with a gap, and on how many records (as the ring above counts them). */
  readonly gapColumns = computed(() => {
    const table = this.current();
    return table ? missingData(table.sheet).columns : null;
  });

  /** The open table's records with something missing, sorted as its table page sorts (a blank last). */
  readonly gapRows = computed<Row[]>(() => {
    const table = this.current();
    const gaps = this.gapColumns();
    if (!table || !gaps) return [];
    const rows = table.sheet.rows.filter((row) => hasGap(row, gaps));
    const first = this.gapFirst();
    const sort = this.sort();
    const column = sort && table.sheet.columns.find((item) => item.key === sort.key);
    if (!sort || !column) return first && gaps.has(first) ? gapsFirst(rows, first) : rows;
    const formulas = this.store.formulas();
    const value = (row: Row) => {
      const raw = formulas.cell(table.sheet, row, column);
      return raw === null || raw === '' || isFormulaError(raw) ? null : raw;
    };
    const sorted = [...rows].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * sort.dir;
      return String(x).localeCompare(String(y), 'en', { numeric: true, sensitivity: 'base' }) * sort.dir;
    });
    return first && gaps.has(first) ? gapsFirst(sorted, first) : sorted;
  });

  /** A column's name clicked in the table: sorted up, then down, then as entered. */
  sortBy(key: string) {
    const sort = this.sort();
    this.sort.set(!sort || sort.key !== key ? { key, dir: 1 } : sort.dir === 1 ? { key, dir: -1 } : null);
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

const SHAPE_KEY = 'ukmac.data-check.shape';

function readShape(): 'columns' | 'table' {
  try {
    return localStorage.getItem(SHAPE_KEY) === 'table' ? 'table' : 'columns';
  } catch {
    return 'columns';
  }
}
