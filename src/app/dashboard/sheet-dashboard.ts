import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { Icon } from '../components/icon';
import { Pager, pageSlice, savedPageSize } from '../components/pager';
import type { Dashboard, GroupPart, Kpi, SheetWithRows, SummaryTable } from '../core/models';
import type { WorkbookFormulas } from '../formula/sheet-formulas';
import {
  aggregateLabel,
  BAD_COLOR,
  chartPoints,
  chartSeries,
  seriesColour,
  type CrossFilter,
  dashboardColumnName,
  dashboardOf,
  formatNumber,
  filteredSheet,
  GOOD_COLOR,
  hasAxis,
  kpiColumnGone,
  kpiValue,
  summaryResult,
} from './dashboard-model';
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
  imports: [Icon, KpiChart, Pager],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="canvas" [class.flat]="!selectable()" [class.studio]="selectable()">
      @if (part() !== 'summaries' && cards().length) {
        <div class="cards">
          @for (card of cards(); track card.kpi.id) {
            <article
              class="tile kpi-card"
              [class.is-pickable]="selectable()"
              [class.is-selected]="selected() === card.kpi.id"
              [attr.tabindex]="selectable() ? 0 : null"
              [attr.aria-pressed]="selectable() ? selected() === card.kpi.id : null"
              (click)="pick(card.kpi.id, $event)"
              (keydown.enter)="pick(card.kpi.id, $event)"
            >
              <header>
                <h3>{{ kpiTitle(card.kpi) }}</h3>
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
                  <span>{{ card.value }}</span>
                </p>
                <p class="foot" [class.gone]="card.gone">
                  {{ card.foot }}
                  @if (card.delta) {
                    <b [style.color]="card.color">{{ card.delta }}</b>
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
            <article
              class="tile"
              [class.wide]="chart.kpi.wide"
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
                  <div class="segmented is-sm" role="group" aria-label="Group the chart by">
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
                    <app-kpi-chart [points]="chart.points" [series]="chart.series" [visual]="chart.kpi.visual" [timeline]="!!chart.kpi.timeline" [totalLine]="!!chart.kpi.totalLine" [decimals]="chart.kpi.decimals" [label]="kpiTitle(chart.kpi)" [value]="chart.value" [goal]="chart.kpi.goal" [pickable]="!selectable() && chart.kpi.visual !== 'gauge'" [selected]="lit(chart.kpi.id, chart.kpi.groupBy, chart.kpi.groupPart)" (groupClick)="clickGroup(chart.kpi.id, chart.kpi.groupBy, chart.kpi.groupPart, $event)" />
                  </div>
                  @if (chart.total !== null) {
                    <aside class="total-box">
                      <span class="total-name">{{ chart.kpi.total }}</span>
                      <div class="ring" role="img" [attr.aria-label]="chart.kpi.total + ': ' + chart.total">
                        <svg viewBox="0 0 140 140" aria-hidden="true">
                          <circle class="ring-track" cx="70" cy="70" r="52" pathLength="100" />
                          @for (part of chart.totalParts; track part.label) {
                            <circle class="ring-part" cx="70" cy="70" r="52" pathLength="100" [attr.stroke]="part.colour" [attr.stroke-dasharray]="part.dash" [attr.stroke-dashoffset]="part.offset">
                              <title>{{ part.label }}: {{ part.text }} ({{ part.percent }}%)</title>
                            </circle>
                          }
                        </svg>
                        <b class="big"><span>{{ chart.total }}</span></b>
                      </div>
                      @if (chart.totalParts.length > 1) {
                        <ul class="ring-legend">
                          @for (part of chart.totalParts; track part.label) {
                            <li><span class="dot" [style.background]="part.colour"></span><span class="name">{{ part.label }}</span><span class="num">{{ part.text }} · {{ part.percent }}%</span></li>
                          }
                        </ul>
                      }
                    </aside>
                  }
                </div>
              }
            </article>
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
                        <td class="cell-num">{{ format(value) }}</td>
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
    @media (prefers-reduced-motion: no-preference) { .tile { animation: itemIn 420ms var(--ease) both; animation-delay: calc(var(--i, 0) * 45ms); } }
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
      font-size: 13px; font-weight: 600; line-height: 1.3; color: #252423; letter-spacing: 0;
      overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; }
    .kpi-card { min-height: 140px; }
    .big {
      flex: 1; display: flex; align-items: center; gap: 6px; font-size: 34px; line-height: 1; font-weight: 600;
      letter-spacing: -0.02em; font-variant-numeric: tabular-nums; color: #252423;
    }
    .big span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .foot { font-size: 12px; color: #605e5c; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .foot.gone { color: var(--danger); white-space: normal; }
    .placeholder { flex: 1; display: grid; place-items: center; min-height: 80px; padding: 12px; border: 1px dashed #c7cfcb; border-radius: 10px; color: #6b7470; font-size: 12.5px; text-align: center; line-height: 1.45; }
    .charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 14px; }
    .charts .tile.wide { grid-column: 1 / -1; }
    /* A chart and, when it has one, the box with its total beside it. */
    .chart-row { display: flex; align-items: stretch; gap: 16px; min-width: 0; }
    .chart-main { flex: 1; min-width: 0; }
    .total-box {
      flex: none; width: 220px; display: flex; flex-direction: column; justify-content: center; gap: 10px; padding: 16px 20px;
      border: var(--hairline) solid var(--border); border-radius: var(--radius-lg); background: var(--surface);
    }
    .total-name { font-size: 12px; font-weight: 600; color: #605e5c; }
    /* The total as a ring split into its parts (ripe and unripe), the number in its middle. */
    .ring { position: relative; width: 150px; max-width: 100%; aspect-ratio: 1; align-self: center; }
    .ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
    .ring circle { fill: none; stroke-width: 20; }
    .ring-track { stroke: #edebe9; }
    .ring .big { position: absolute; inset: 0; display: grid; place-items: center; font-size: 20px; padding: 0 30px; text-align: center; }
    .ring-legend { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
    .ring-legend li { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .ring-legend .dot { flex: none; width: 9px; height: 9px; border-radius: 50%; }
    .ring-legend .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #605e5c; }
    .ring-legend .num { font-variant-numeric: tabular-nums; font-weight: 600; }
    @media (max-width: 760px) { .chart-row { flex-direction: column; } .total-box { width: auto; } }
    /* The pager keeps a page short, so the table shows all of its page's rows (no scrolling inside it). */
    .summary .table-wrap { overflow-x: auto; }
    .data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .data-table th { text-align: center; font-weight: 600; color: #605e5c; padding: 8px 10px; border-bottom: 1px solid #e1dfdd; position: sticky; top: 0; background: #fff; }
    .data-table td { text-align: center; padding: 7px 10px; border-bottom: 1px solid #f3f2f1; }
    .data-table .cell-num { text-align: center; font-variant-numeric: tabular-nums; }
    .data-table tr.hit { cursor: pointer; }
    .data-table tr.hit:hover td { background: var(--accent-soft); }
    .data-table tr.lit td { background: var(--accent-soft); font-weight: 600; }
    .data-table tr.dim td { opacity: 0.4; }
    .data-table tfoot td { font-weight: 700; border-top: 1px solid #c8c6c4; border-bottom: none; }
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
  private readonly summarySize = savedPageSize(10);

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
    this.filterChange.emit({ sheetId: sheet.sheetId, source, column, part, keys, labels, name: field ? dashboardColumnName(sheet.columns, field) : '' });
  }

  readonly cards = computed<CardView[]>(() =>
    this.dashboard()
      .kpis.filter((kpi) => kpi.visual === 'card')
      .map((kpi) => this.cardView(kpi)),
  );

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
        const kpi: Kpi = view ? { ...own, groupBy: view.groupBy, groupPart: view.groupPart, title: view.title ?? own.title, timeline: view.timeline ?? own.timeline } : own;
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
          totalParts: kpi.total && !noValue ? this.totalParts(rows, kpi) : [],
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

  /** The total's ring: a stacked chart's series each a part of it (ripe red, unripe green); else one whole ring. */
  private totalParts(rows: SheetWithRows, kpi: Kpi) {
    const series = kpi.visual === 'stacked' && kpi.aggregate === 'sum' ? chartSeries(this.formulas(), rows, kpi) : [];
    const sums = series.map((one, index) => ({ label: one.label, value: one.points.reduce((sum, point) => sum + Math.max(point.value, 0), 0), colour: seriesColour(one.label, index) }));
    const parts = sums.length > 1 ? sums : [{ label: kpi.total ?? '', value: 1, colour: seriesColour('', 0) }];
    const whole = parts.reduce((sum, part) => sum + part.value, 0);
    let start = 0;
    return parts
      .filter((part) => part.value > 0)
      .map((part) => {
        const share = whole > 0 ? (part.value / whole) * 100 : 0;
        const out = { label: part.label, colour: part.colour, text: formatNumber(part.value, kpi.decimals), percent: Math.round(share), dash: `${share} ${100 - share}`, offset: -start };
        start += share;
        return out;
      });
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
    const source = kpi.aggregate === 'count' ? 'Count of rows' : `${aggregateLabel(kpi.aggregate)} · ${column ? dashboardColumnName(sheet.columns, column) : ''}`;
    const foot = gone
      ? "Its column isn't in the table any more — pick another in Edit dashboard."
      : hasGoal
        ? `Goal: ${formatNumber(kpi.goal, kpi.decimals)}`
        : source;
    const deltaText = delta !== null ? `(${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%)` : null;
    return {
      kpi,
      value: formatNumber(value, kpi.decimals),
      color,
      arrow: hasGoal ? (good ? 'up' : 'down') : null,
      foot,
      delta: gone ? null : deltaText,
      gone,
      empty,
    };
  }

  format(value: number | string | null) {
    return typeof value === 'string' ? value : formatNumber(value);
  }
}
