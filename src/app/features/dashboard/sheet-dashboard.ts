import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { CountUp } from '@shared/ui/count-up';
import { Icon } from '@shared/ui/icon';
import { Spark } from '@shared/ui/spark';
import { Pager, pageSlice, savedPageSize } from '@shared/ui/pager';
import { SegmentedThumb } from '@shared/ui/segmented-thumb';
import type { Dashboard, GroupPart, Kpi, SheetWithRows, SummaryTable } from '@core/models';
import type { WorkbookFormulas } from '@shared/formula/sheet-formulas';
import {
  aggregateLabel,
  BAD_COLOR,
  chartPoints,
  chartSeries,
  type ChartSeries,
  type CrossFilter,
  dashboardColumnName,
  dashboardOf,
  formatNumber,
  filteredSheet,
  GOOD_COLOR,
  hasAxis,
  kpiColumnGone,
  kpiPercent,
  kpiValue,
  summaryResult,
} from './dashboard-model';
import { enterDelay } from './enter';
import { KpiChart } from './kpi-chart';
import { autoTitle, studioFields, visualsOf } from './studio-model';

interface CardView {
  kpi: Kpi;
  value: string;
  color: string | null;
  arrow: 'up' | 'down' | null;
  foot: string;
  delta: string | null;
  gone: boolean;
  /** No field in it yet (just added in Edit dashboard). */
  empty: boolean;
}

/**
 * A table's dashboard, the system's KPI board: Power BI-style cards and
 * charts over the table's columns, and its summaries — worked out from
 * the rows now. On the table's page it's shown only; in Edit dashboard
 * (the studio) its tiles are picked to change them.
 */
@Component({
  selector: 'app-sheet-dashboard',
  imports: [CountUp, Icon, KpiChart, Pager, SegmentedThumb, Spark],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="canvas" [class.flat]="!selectable()" [class.studio]="selectable()">
      @if (part() !== 'summaries' && cards().length) {
        <div class="cards" [class.tiled]="spans().length > 0">
          @for (card of cards(); track card.kpi.id; let i = $index) {
            <article
              class="tile kpi-card"
              [style.--enter]="enter(i)"
              [style.grid-column]="spans()[i] ? 'span ' + spans()[i] : null"
              [class.is-pickable]="selectable()"
              [class.is-selected]="selected() === card.kpi.id"
              [attr.tabindex]="selectable() ? 0 : null"
              [attr.aria-pressed]="selectable() ? selected() === card.kpi.id : null"
              (click)="pick(card.kpi.id, $event)"
              (keydown.enter)="pick(card.kpi.id, $event)"
            >
              <header class="kpi-head">
                <h3 [title]="kpiTitle(card.kpi)">{{ kpiTitle(card.kpi) }}</h3>
              </header>
              @if (card.empty) {
                <p class="placeholder">{{ selectable() ? 'Tick a field in Data to show it here.' : notSetUp }}</p>
              } @else {
                <p class="big" [style.color]="card.color">
                  @if (card.arrow === 'up') {
                    <app-icon name="arrow-up" [size]="22" />
                  } @else if (card.arrow === 'down') {
                    <app-icon name="arrow-down" [size]="22" />
                  }
                  <span [appCountUp]="card.value"></span>
                </p>
                <p class="foot" [class.gone]="card.gone" [attr.title]="card.foot + (card.delta ? ' ' + card.delta : '')">
                  <span class="foot-text">{{ card.foot }}</span>
                  @if (card.delta) {
                    <b class="delta" [style.--tint]="card.color">{{ card.delta }}</b>
                  }
                </p>
              }
            </article>
          }
        </div>
      }

      @if (part() !== 'summaries' && charts().length) {
        <div class="charts">
          @for (chart of charts(); track chart.kpi.id) {
            <div class="slot" [class.paired]="chart.total !== null">
            <article
              class="tile"
              [class.wide]="chart.kpi.wide && chart.total === null"
              [class.is-pickable]="selectable()"
              [class.is-selected]="selected() === chart.kpi.id"
              [attr.tabindex]="selectable() ? 0 : null"
              [attr.aria-pressed]="selectable() ? selected() === chart.kpi.id : null"
              (click)="pick(chart.kpi.id, $event)"
              (keydown.enter)="pick(chart.kpi.id, $event)"
            >
              <header [class.has-switch]="chart.views.length > 1">
                <h3>{{ kpiTitle(chart.kpi) }}</h3>
                @if (chart.views.length > 1) {
                  <div class="segmented is-sm" role="group" aria-label="Show the chart as">
                    @for (view of chart.views; track view.label; let index = $index) {
                      <button type="button" class="segment" [attr.aria-pressed]="chart.viewAt === index" (click)="setView(chart.kpi.id, index, $event)">{{ view.label }}</button>
                    }
                  </div>
                }
              </header>
              @if (chart.empty) {
                <p class="placeholder">{{ selectable() ? emptyHint(chart.kpi.visual) : notSetUp }}</p>
              } @else if (chart.gone) {
                <p class="foot gone">Its column isn't in the table any more — pick another in Edit dashboard.</p>
              } @else {
                <div class="chart-row">
                  <div class="chart-main">
                    <app-kpi-chart [points]="chart.points" [series]="chart.series" [visual]="chart.kpi.visual" [timeline]="!!chart.kpi.timeline" [totalLine]="!!chart.kpi.totalLine" [zoneColours]="!!chart.kpi.zoneColours" [decimals]="chart.kpi.decimals" [label]="kpiTitle(chart.kpi)" [value]="chart.value" [goal]="chart.kpi.goal" [pickable]="!selectable() && chart.kpi.visual !== 'gauge'" [selected]="lit(chart.kpi.id, chart.kpi.groupBy, chart.kpi.groupPart)" (groupClick)="clickGroup(chart.kpi.id, chart.kpi.groupBy, chart.kpi.groupPart, $event)" />
                  </div>
                </div>
              }
            </article>
            @if (chart.total !== null) {
              <!-- The total is a chart of its own: one stack split into its parts (unripe, ripe), its number written over it, beside the chart it adds up; its plot sits on the same lines as the chart's. -->
              <article
                class="tile total-tile"
                [class.is-pickable]="selectable()"
                [class.is-selected]="selected() === chart.kpi.id"
                (click)="pick(chart.kpi.id, $event)"
              >
                <header><h3>{{ chart.kpi.total }}</h3></header>
                <app-kpi-chart [points]="chart.totalSeries[0]?.points ?? []" [series]="chart.totalSeries" visual="stacked" [decimals]="chart.kpi.decimals" [label]="chart.kpi.total ?? ''" />
              </article>
            }
            </div>
          }
        </div>
      }

      @for (item of shownSummaries(); track item.summary.id) {
        <article
          class="tile summary"
          [class.is-pickable]="selectable()"
          [class.is-selected]="selected() === item.summary.id"
          [attr.tabindex]="selectable() ? 0 : null"
          [attr.aria-pressed]="selectable() ? selected() === item.summary.id : null"
          (click)="pick(item.summary.id, $event)"
          (keydown.enter)="pick(item.summary.id, $event)"
        >
          <header [class.has-switch]="switchable()">
            @if (switchable()) {
              <div class="segmented is-sm" role="group" aria-label="Show the table">
                @for (other of summaries(); track other.summary.id; let index = $index) {
                  <button type="button" class="segment" [attr.aria-pressed]="summaryAt() === index" (click)="setSummary(index, $event)">{{ summaryTitle(other.summary) }}</button>
                }
              </div>
            } @else {
              <h3>{{ summaryTitle(item.summary) }}</h3>
            }
          </header>
          @if (!item.summary.groupBy) {
            <p class="placeholder">{{ selectable() ? 'Tick a field in Data for its rows (Plant type, Zone…), then the numbers to show for each.' : notSetUp }}</p>
          } @else if (item.result; as result) {
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>{{ result.header }}</th>
                    @if (result.header2) {
                      <th>{{ result.header2 }}</th>
                    }
                    @for (column of result.columns; track $index) {
                      <th class="cell-num">{{ column }}</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (row of pageRows(item.summary.id, result.rows); track $index) {
                    <tr
                      [class.hit]="!selectable()"
                      [class.lit]="!selectable() && lit(item.summary.id, item.summary.groupBy, item.summary.groupPart).includes(row.key)"
                      [class.dim]="!selectable() && lit(item.summary.id, item.summary.groupBy, item.summary.groupPart).length > 0 && !lit(item.summary.id, item.summary.groupBy, item.summary.groupPart).includes(row.key)"
                      (click)="clickGroup(item.summary.id, item.summary.groupBy, item.summary.groupPart, { key: row.key, label: row.label, additive: $any($event).ctrlKey || $any($event).metaKey || $any($event).shiftKey }, $event)"
                    >
                      <td>{{ row.label }}</td>
                      @if (result.header2) {
                        <td>{{ row.label2 }}</td>
                      }
                      @for (value of row.values; track $index) {
                        <td class="cell-num">
                          @if (row.sparks?.[$index]; as spark) {
                            <!-- A list of days drawn as a mini graph of what was added up on each. -->
                            <app-spark [points]="spark" />
                          } @else if (isText(value)) {
                            <!-- A list of values (the zone plots of a day, say): one line cut with … when it is long, whole when it is pointed at. -->
                            <span class="list-text" [class.dates]="isDates(value)" [title]="value">{{ value }}</span>
                          } @else {
                            {{ format(value) }}
                          }
                        </td>
                      }
                    </tr>
                  } @empty {
                    <tr><td [attr.colspan]="result.columns.length + (result.header2 ? 2 : 1)" class="muted">No rows yet.</td></tr>
                  }
                </tbody>
                @if (result.rows.length && result.columns.length) {
                  <tfoot>
                    <tr>
                      <td [attr.colspan]="result.header2 ? 2 : 1">Total</td>
                      @for (value of result.totals; track $index) {
                        <td class="cell-num">{{ format(value) }}</td>
                      }
                    </tr>
                  </tfoot>
                }
              </table>
            </div>
            <app-pager
              [compact]="true"
              [total]="result.rows.length"
              [page]="paging(item.summary.id).page"
              (pageChange)="setPaging(item.summary.id, { page: $event })"
              [size]="paging(item.summary.id).size"
              (sizeChange)="setPaging(item.summary.id, { size: $event })"
            />
          } @else {
            <p class="foot gone">The column it groups by isn't in the table any more — pick another in Edit dashboard.</p>
          }
        </article>
      }

      @if (selectable() && !cards().length && !charts().length && !summaries().length) {
        <div class="tile empty-state">
          <strong>Nothing on this dashboard yet</strong>
          <p>Pick a type in Visualizations on the right (a card, a chart or a table), then tick its fields in Data.</p>
        </div>
      }
    </div>
  `,
  styles: `
    /* The number cards rise one after another (--enter, at most eight steps; their numbers count up after it). A chart's marks
       start drawing as its tile comes up, so charts and tables rise with the board and are not held back. */
    @media (prefers-reduced-motion: no-preference) {
      .tile { animation: itemIn 420ms var(--ease) both; animation-delay: var(--enter, 0ms); }
      /* A tile answers the pointer: its shadow deepens, and a number card also lifts a little (a chart or a table stays put, its marks are what the pointer is for). */
      .tile:not(.is-pickable):not(.empty-state) { transition: box-shadow var(--dur) var(--ease), transform var(--dur) var(--ease); }
      .tile:not(.is-pickable):not(.empty-state):hover { box-shadow: var(--edge), 0 1px 2px rgb(0 0 0 / 0.05), 0 14px 32px -14px rgb(17 24 39 / 0.2); }
      .kpi-card:not(.is-pickable):hover { transform: translateY(-2px); }
      .data-table td { transition: background-color var(--dur-fast) var(--ease), opacity var(--dur) var(--ease); }
    }
    :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .canvas { flex: 1; min-height: 0; overflow: auto; background: #f3f2f1; padding: 18px 20px 28px; display: flex; flex-direction: column; gap: 14px; }
    .canvas.flat { flex: none; overflow: visible; padding: 0; background: transparent; }
    .canvas.studio { background: transparent; overflow: visible; flex: none; padding: 0; }
    .tile {
      background: var(--surface); border: var(--hairline) solid var(--border); border-radius: var(--radius-lg); padding: 16px 20px; min-width: 0;
      box-shadow: var(--shadow-card);
      display: flex; flex-direction: column; gap: 6px;
    }
    .tile { position: relative; }
    .tile.is-pickable { cursor: pointer; transition: box-shadow var(--dur-fast) var(--ease), outline-color var(--dur-fast) var(--ease); outline: 2px solid transparent; outline-offset: 2px; }
    .tile.is-pickable:hover { outline-color: #c7cfcb; }
    .tile.is-pickable:focus-visible { outline-color: var(--accent); }
    .tile.is-selected, .tile.is-selected:hover { outline-color: var(--accent); }
    .tile header { min-height: 22px; padding-right: 4px; }
    .tile header.has-switch { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .tile h3 {
      font-size: 13.5px; font-weight: 600; line-height: 1.3; color: var(--text); letter-spacing: -0.012em;
      overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; }
    /* A number card: the name small and quiet, the number large, the caption under it with its change as a pill. A soft wash of the accent (or the card's own colour) from the top corner. */
    .kpi-card {
      min-height: 148px; gap: 10px; overflow: hidden; container-type: inline-size;
      background:
        radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, var(--tint, var(--accent)) 9%, transparent) 0%, transparent 60%),
        var(--surface);
    }
    /* The name on one line (the whole of it on hover), so every card's number sits at the same height; the caption keeps to the foot. */
    .kpi-head { padding-right: 0; }
    .kpi-card h3 { display: block; font-size: 12.5px; font-weight: 600; color: var(--text-muted); letter-spacing: 0; white-space: nowrap; text-overflow: ellipsis; }
    /* The number shrinks with a narrow card (a small window, four in a row) before it is cut short. */
    .kpi-card .big { flex: none; margin-top: 4px; font-size: clamp(22px, 24cqi, 34px); font-weight: 700; letter-spacing: -0.035em; }
    .kpi-card .foot { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; margin-top: auto; font-size: 12px; }
    .kpi-card .foot-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .kpi-card .foot.gone .foot-text { white-space: normal; }
    .kpi-card .delta {
      flex: 0 1 auto; display: block; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; padding: 2px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap;
      color: var(--tint, var(--text-muted)); background: color-mix(in srgb, var(--tint, var(--text-muted)) 12%, transparent);
    }
    /* Seven or eight cards sit in two even rows (4 + 3), each row filling the width, not five and a straggler. The space between
       cards is their own margin, not the grid's gap: 59 gaps between sixty columns would be wider than a small window. */
    .cards.tiled { grid-template-columns: repeat(60, minmax(0, 1fr)); column-gap: 0; margin-inline: -7px; }
    .cards.tiled > .tile { margin-inline: 7px; }
    .big {
      flex: 1; display: flex; align-items: center; gap: 6px; font-size: 36px; line-height: 1; font-weight: 650;
      letter-spacing: -0.032em; font-variant-numeric: tabular-nums; color: var(--text);
    }
    .big span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .foot { font-size: 12px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .foot.gone { color: var(--danger); white-space: normal; }
    .placeholder { flex: 1; display: grid; place-items: center; min-height: 80px; padding: 12px; border: 1px dashed #c7cfcb; border-radius: 10px; color: #6b7470; font-size: 12.5px; text-align: center; line-height: 1.45; }
    .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 14px; }
    .charts .tile.wide { grid-column: 1 / -1; }
    /* A chart and, when it has one, the box with its total beside it. */
    .chart-row { display: flex; align-items: stretch; gap: 16px; min-width: 0; }
    .chart-main { flex: 1; min-width: 0; }
    /* A chart with a total: the chart and its total side by side, each its own card. */
    .slot { display: contents; }
    .slot.paired { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 14px; }
    .total-tile { justify-content: flex-start; }
    @media (max-width: 760px) { .chart-row { flex-direction: column; } .slot.paired { grid-template-columns: minmax(0, 1fr); } }
    /* The pager keeps a page short, so the table shows all of its page's rows (no scrolling inside it). */
    .summary .table-wrap { overflow-x: auto; }
    .data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    /* A quiet, ruled table: small muted capitals over the columns, each name centred over its values as every table is, a hairline between rows. */
    .data-table th { height: 38px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.045em; color: var(--text-muted); padding: 9px 14px; border-bottom: 1px solid var(--border-strong); position: sticky; top: 0; background: var(--surface-flat); }
    .data-table td { height: 40px; line-height: 1.35; padding: 6px 14px; border-bottom: var(--hairline) solid var(--border); color: var(--text); }
    .data-table tbody tr:last-child td { border-bottom: none; }
    /* A list of dates (a zone's harvest days) is shown whole, wrapping onto as many lines as it needs. */
    .data-table .list-text.dates { max-width: 340px; overflow: visible; text-overflow: clip; white-space: normal; text-align: left; line-height: 1.5; }
    .data-table tr.hit { cursor: pointer; }
    .data-table .list-text { display: inline-block; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
    .data-table tr.hit:hover td { background: var(--row-hover); }
    .data-table tr.lit td { background: var(--accent-soft); font-weight: 600; }
    .data-table tr.dim td { opacity: 0.4; }
    .data-table tfoot td { font-weight: 650; border-top: 1px solid var(--border-strong); border-bottom: none; background: var(--fill); font-variant-numeric: tabular-nums; }
    .data-table tfoot td:first-child { border-radius: 0 0 0 10px; }
    .data-table tfoot td:last-child { border-radius: 0 0 10px 0; }
    .empty-state { align-items: center; text-align: center; gap: 8px; padding: 40px 20px; }
    .empty-state p { color: var(--text-muted); font-size: 0.875rem; max-width: 420px; }
  `,
})
export class SheetDashboard {
  readonly sheet = input.required<SheetWithRows>();
  readonly formulas = input.required<WorkbookFormulas>();
  /** Which of it: everything; the cards and charts (over the records); the summaries (under them). */
  readonly part = input<'all' | 'top' | 'summaries'>('all');
  /** The board to draw instead of the table's saved one (Edit dashboard's, as it's changed). */
  readonly board = input<Dashboard | null>(null);
  /** In Edit dashboard: a tile is clicked to pick it. */
  readonly selectable = input(false);
  readonly selected = input<string | null>(null);
  readonly picked = output<string>();
  /** What a click on a group (a bar, a slice, a table row) keeps in the other visuals; shared by the board's parts. */
  readonly filter = input<CrossFilter | null>(null);
  readonly filterChange = output<CrossFilter | null>();

  /** Each summary table's page and rows per page. */
  private readonly summaryPaging = signal<Readonly<Record<string, { page: number; size: number }>>>({});
  private readonly summarySize = savedPageSize();

  readonly dashboard = computed(() => this.board() ?? dashboardOf(this.sheet()).dashboard);

  /** The rows the filter keeps. */
  private readonly kept = computed(() => (this.selectable() ? this.sheet() : filteredSheet(this.formulas(), this.sheet(), this.filter())));

  /** The rows a visual is worked out over: the kept ones, but the visual clicked shows all its groups. */
  private rowsFor(id: string): SheetWithRows {
    return this.filter()?.source === id ? this.sheet() : this.kept();
  }

  /** The groups lit in a visual (the clicked ones, in the visual clicked, while it still groups the same way). */
  lit(id: string, column: string, part: GroupPart): readonly string[] {
    const filter = this.filter();
    return filter && !this.selectable() && filter.sheetId === this.sheet().sheetId && filter.source === id && filter.column === column && filter.part === part ? filter.keys : [];
  }

  /** A group clicked: it alone is kept (again: let go); with Ctrl / ⌘ / Shift, added to or taken from the ones kept. */
  clickGroup(source: string, column: string, part: GroupPart, group: { key: string; label: string; additive: boolean }, event?: Event) {
    if (this.selectable() || !column) return;
    event?.stopPropagation();
    const sheet = this.sheet();
    const now = this.lit(source, column, part);
    const at = now.indexOf(group.key);
    const current = this.filter();
    if (at >= 0 && now.length === 1) {
      this.filterChange.emit(null);
      return;
    }
    let keys: string[];
    let labels: string[];
    if (at >= 0 && group.additive) {
      keys = now.filter((key) => key !== group.key);
      labels = (current?.labels ?? []).filter((_, index) => index !== at);
    } else if (at < 0 && group.additive && now.length) {
      keys = [...now, group.key];
      labels = [...(current?.labels ?? []), group.label];
    } else {
      keys = [group.key];
      labels = [group.label];
    }
    const field = sheet.columns.find((item) => item.key === column);
    const name = part === 'zone' ? 'Zone number' : field ? dashboardColumnName(sheet.columns, field) : '';
    this.filterChange.emit({ sheetId: sheet.sheetId, source, column, part, keys, labels, name });
  }

  /** How many of 60 columns each card spans when there are more than five (two rows as even as can be); none: the cards flow as they fit. */
  readonly spans = computed<number[]>(() => {
    const count = this.cards().length;
    if (count <= 5) return [];
    const perRow = Math.ceil(count / 2);
    return this.cards().map((_, index) => {
      const row = Math.floor(index / perRow);
      return 60 / (row === 0 ? perRow : count - perRow);
    });
  });

  readonly cards = computed<CardView[]>(() =>
    this.dashboard()
      .kpis.filter((kpi) => kpi.visual === 'card')
      .map((kpi) => this.cardView(kpi)),
  );

  /** When the n-th number card rises (the cards come up one after another; a chart or a table comes up with the board). */
  readonly enter = enterDelay;

  /** Which of a chart's ways to group it is showing (its switch), by chart: the first until another is picked. */
  private readonly viewPicked = signal<Readonly<Record<string, number>>>({});

  readonly charts = computed(() =>
    this.dashboard()
      .kpis.filter((kpi) => kpi.visual !== 'card')
      .map((own) => {
        const views = own.views ?? [];
        const viewAt = Math.min(this.viewPicked()[own.id] ?? 0, Math.max(views.length - 1, 0));
        const view = views[viewAt];
        // The chart as the picked view groups it (and calls it); its id stays, so it is the same tile.
        const kpi: Kpi = view ? { ...own, groupBy: view.groupBy, groupPart: view.groupPart, title: view.title ?? own.title, timeline: view.timeline ?? own.timeline, daysOnly: view.daysOnly ?? own.daysOnly, visual: view.visual ?? own.visual } : own;
        const gauge = !hasAxis(kpi.visual);
        const noValue = !kpi.column && kpi.aggregate !== 'count';
        const rows = this.rowsFor(own.id);
        return {
          kpi,
          views,
          viewAt,
          empty: noValue || (!gauge && !kpi.groupBy),
          gone: kpiColumnGone(this.sheet(), kpi),
          // A gauge is one number; the others are a number per group.
          points: gauge ? [] : chartPoints(this.formulas(), rows, kpi),
          series: kpi.visual === 'stacked' ? chartSeries(this.formulas(), rows, kpi) : [],
          value: gauge && !noValue ? kpiValue(this.formulas(), rows, kpi) : null,
          // The chart's own total, in the box beside it (the chart's rows added up: the bars' sum).
          total: kpi.total && !noValue ? formatNumber(this.chartTotal(rows, kpi), kpi.decimals) : null,
          totalSeries: kpi.total && !noValue ? this.totalSeries(rows, kpi) : [],
        };
      }),
  );

  readonly summaries = computed(() =>
    this.dashboard().summaries.map((summary: SummaryTable) => ({ summary, result: summaryResult(this.formulas(), this.rowsFor(summary.id), summary) })),
  );

  /** Which table is showing (its switch), when the board has more than one: the first until another is picked. */
  readonly summaryAt = computed(() => Math.min(this.summaryPicked(), Math.max(this.summaries().length - 1, 0)));
  private readonly summaryPicked = signal(0);

  /** On the page the tables share one tile with a switch between them; Edit dashboard lists each to pick it. */
  readonly switchable = computed(() => !this.selectable() && this.part() !== 'top' && this.summaries().length > 1);

  readonly shownSummaries = computed(() => {
    if (this.part() === 'top') return [];
    const all = this.summaries();
    return this.switchable() ? [all[this.summaryAt()]] : all;
  });

  readonly notSetUp = 'Not set up yet: open Edit dashboard to pick its fields.';

  /** What a chart with nothing in it yet asks for, in Edit dashboard. */
  emptyHint(visual: Kpi['visual']) {
    if (visual === 'gauge') return 'Tick a number in Data for the dial to show.';
    const one = visual === 'pie' || visual === 'donut' ? 'slices' : visual === 'treemap' ? 'boxes' : visual === 'funnel' ? 'stages' : visual === 'radar' ? 'spokes' : 'bars';
    return `Tick fields in Data: one for the ${one}, a number to show.`;
  }

  /** Its title; cleared in Edit dashboard, the one worked out from its fields. */
  kpiTitle(kpi: Kpi) {
    return kpi.title || autoTitle(visualsOf({ kpis: [kpi], summaries: [] })[0], studioFields(this.formulas(), this.sheet()));
  }

  summaryTitle(summary: SummaryTable) {
    return summary.title || autoTitle(visualsOf({ kpis: [], summaries: [summary] })[0], studioFields(this.formulas(), this.sheet()));
  }

  /** A chart's total: its column added up, or for a stacked chart, every value stacked in it. */
  private chartTotal(rows: SheetWithRows, kpi: Kpi): number | null {
    if (kpi.visual !== 'stacked' || kpi.aggregate !== 'sum') return kpiValue(this.formulas(), rows, kpi);
    return chartSeries(this.formulas(), rows, kpi).reduce((all, one) => all + one.points.reduce((sum, point) => sum + point.value, 0), 0);
  }

  /** The total as one stack: a stacked chart's series each a part of it (unripe green, ripe red); else one part. */
  private totalSeries(rows: SheetWithRows, kpi: Kpi): ChartSeries[] {
    const series = kpi.visual === 'stacked' && kpi.aggregate === 'sum' ? chartSeries(this.formulas(), rows, kpi) : [];
    const sums = series.map((one) => ({ label: one.label, value: one.points.reduce((sum, point) => sum + Math.max(point.value, 0), 0) }));
    const parts = sums.length > 1 ? sums : [{ label: kpi.total ?? '', value: this.chartTotal(rows, kpi) ?? 0 }];
    return parts.map((part) => ({ label: part.label, points: [{ key: 'total', label: 'Total', value: part.value }] }));
  }

  /** A chart's switch: group it the way its `index`th view says. */
  setView(id: string, index: number, event: Event) {
    event.stopPropagation();
    this.viewPicked.update((all) => ({ ...all, [id]: index }));
    // What was lit in it was by the way it grouped before.
    if (this.filter()?.source === id) this.filterChange.emit(null);
  }

  /** The tables' switch: show the `index`th. */
  setSummary(index: number, event: Event) {
    event.stopPropagation();
    const before = this.summaryAt();
    const hidden = this.summaries()[before]?.summary.id;
    this.summaryPicked.set(index);
    // What was lit in the table now hidden would keep filtering the rest.
    if (hidden && this.filter()?.source === hidden && index !== before) this.filterChange.emit(null);
  }

  pick(id: string, event: Event) {
    if (!this.selectable()) return;
    event.stopPropagation();
    if (event instanceof KeyboardEvent) event.preventDefault();
    this.picked.emit(id);
  }

  paging(id: string) {
    return this.summaryPaging()[id] ?? { page: 0, size: this.summarySize };
  }

  setPaging(id: string, change: Partial<{ page: number; size: number }>) {
    this.summaryPaging.update((all) => ({ ...all, [id]: { ...this.paging(id), ...change } }));
  }

  pageRows<T>(id: string, rows: readonly T[]): T[] {
    const { page, size } = this.paging(id);
    return pageSlice(rows, page, size);
  }

  private cardView(kpi: Kpi): CardView {
    const sheet = this.sheet();
    const empty = !kpi.column && kpi.aggregate !== 'count';
    const gone = kpiColumnGone(sheet, kpi);
    const value = gone || empty ? null : kpiValue(this.formulas(), this.rowsFor(kpi.id), kpi);
    const hasGoal = kpi.goal !== null && value !== null;
    const good = hasGoal && (kpi.higherIsBetter ? value! >= kpi.goal! : value! <= kpi.goal!);
    const delta = hasGoal && kpi.goal !== 0 ? ((value! - kpi.goal!) / Math.abs(kpi.goal!)) * 100 : null;
    const color = hasGoal ? (good ? GOOD_COLOR : BAD_COLOR) : null;
    const column = sheet.columns.find((item) => item.key === kpi.column);
    const nameOf = (key: string) => {
      const found = sheet.columns.find((item) => item.key === key);
      return found ? dashboardColumnName(sheet.columns, found) : '';
    };
    const named = column ? dashboardColumnName(sheet.columns, column) : '';
    // How the number is worked out, from the table's own columns.
    const source =
      kpi.aggregate === 'count'
        ? 'Count of rows'
        : kpi.perGroup
          ? `${aggregateLabel(kpi.aggregate)} per ${nameOf(kpi.perGroup.groupBy)} · ${named}`
          : kpi.plus?.length
            ? [named, ...kpi.plus.map(nameOf)].join(' + ')
            : `${aggregateLabel(kpi.aggregate)} · ${named}`;
    const foot = gone
      ? "Its column isn't in the table any more — pick another in Edit dashboard."
      : hasGoal
        ? `Goal: ${formatNumber(kpi.goal, kpi.decimals)}`
        : source;
    const percent = !gone && !empty ? kpiPercent(this.formulas(), this.rowsFor(kpi.id), kpi, value) : null;
    const share = percent === null ? null : `${percent.toFixed(2)}% of ${kpi.percentLabel ?? (kpi.percentOf ?? []).map(nameOf).join(' + ')}`;
    const deltaText = delta !== null ? `(${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%)` : null;
    return {
      kpi,
      value: formatNumber(value, kpi.decimals),
      color,
      arrow: hasGoal ? (good ? 'up' : 'down') : null,
      foot,
      delta: gone ? null : (deltaText ?? share),
      gone,
      empty,
    };
  }

  /** Whether a list holds dates (2026-07-01, 2026-07-02, …). */
  isDates(value: string) {
    return /^\d{4}-\d{2}-\d{2}(, \d{4}-\d{2}-\d{2})*$/.test(value);
  }

  isText(value: number | string | null): value is string {
    return typeof value === 'string' && value !== '';
  }

  format(value: number | string | null) {
    return typeof value === 'string' ? value : formatNumber(value);
  }
}
