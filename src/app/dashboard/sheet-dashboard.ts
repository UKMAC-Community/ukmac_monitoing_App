import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { Icon } from '../components/icon';
import { Pager, pageSlice, savedPageSize } from '../components/pager';
import type { Dashboard, Kpi, SheetWithRows, SummaryTable } from '../core/models';
import type { WorkbookFormulas } from '../formula/sheet-formulas';
import {
  aggregateLabel,
  BAD_COLOR,
  chartPoints,
  dashboardColumnName,
  dashboardOf,
  formatNumber,
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
              [class.is-pickable]="selectable()"
              [class.is-selected]="selected() === chart.kpi.id"
              [attr.tabindex]="selectable() ? 0 : null"
              [attr.aria-pressed]="selectable() ? selected() === chart.kpi.id : null"
              (click)="pick(chart.kpi.id, $event)"
              (keydown.enter)="pick(chart.kpi.id, $event)"
            >
              <header>
                <h3>{{ kpiTitle(chart.kpi) }}</h3>
              </header>
              @if (chart.empty) {
                <p class="placeholder">{{ selectable() ? emptyHint(chart.kpi.visual) : notSetUp }}</p>
              } @else if (chart.gone) {
                <p class="foot gone">Its column isn't in the table any more — pick another in Edit dashboard.</p>
              } @else {
                <app-kpi-chart [points]="chart.points" [visual]="chart.kpi.visual" [decimals]="chart.kpi.decimals" [label]="kpiTitle(chart.kpi)" [value]="chart.value" [goal]="chart.kpi.goal" />
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
          <header>
            <h3>{{ summaryTitle(item.summary) }}</h3>
          </header>
          @if (!item.summary.groupBy) {
            <p class="placeholder">{{ selectable() ? 'Tick a field in Data for its rows (Plant type, Zone…), then the numbers to show for each.' : notSetUp }}</p>
          } @else if (item.result; as result) {
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>{{ result.header }}</th>
                    @for (column of result.columns; track $index) {
                      <th class="cell-num">{{ column }}</th>
                    }
                  </tr>
                </thead>
                <tbody>
                  @for (row of pageRows(item.summary.id, result.rows); track row.label) {
                    <tr>
                      <td>{{ row.label }}</td>
                      @for (value of row.values; track $index) {
                        <td class="cell-num">{{ format(value) }}</td>
                      }
                    </tr>
                  } @empty {
                    <tr><td [attr.colspan]="result.columns.length + 1" class="muted">No rows yet.</td></tr>
                  }
                </tbody>
                @if (result.rows.length && result.columns.length) {
                  <tfoot>
                    <tr>
                      <td>Total</td>
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
    .summary .table-wrap { overflow: auto; max-height: 420px; }
    .data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .data-table th { text-align: left; font-weight: 600; color: #605e5c; padding: 8px 10px; border-bottom: 1px solid #e1dfdd; position: sticky; top: 0; background: #fff; }
    .data-table td { padding: 7px 10px; border-bottom: 1px solid #f3f2f1; }
    .data-table .cell-num { text-align: right; font-variant-numeric: tabular-nums; }
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

  /** Each summary table's page and rows per page. */
  private readonly summaryPaging = signal<Readonly<Record<string, { page: number; size: number }>>>({});
  private readonly summarySize = savedPageSize(10);

  readonly dashboard = computed(() => this.board() ?? dashboardOf(this.sheet()).dashboard);

  readonly cards = computed<CardView[]>(() =>
    this.dashboard()
      .kpis.filter((kpi) => kpi.visual === 'card')
      .map((kpi) => this.cardView(kpi)),
  );

  readonly charts = computed(() =>
    this.dashboard()
      .kpis.filter((kpi) => kpi.visual !== 'card')
      .map((kpi) => {
        const gauge = !hasAxis(kpi.visual);
        const noValue = !kpi.column && kpi.aggregate !== 'count';
        return {
          kpi,
          empty: noValue || (!gauge && !kpi.groupBy),
          gone: kpiColumnGone(this.sheet(), kpi),
          // A gauge is one number; the others are a number per group.
          points: gauge ? [] : chartPoints(this.formulas(), this.sheet(), kpi),
          value: gauge && !noValue ? kpiValue(this.formulas(), this.sheet(), kpi) : null,
        };
      }),
  );

  readonly summaries = computed(() =>
    this.dashboard().summaries.map((summary: SummaryTable) => ({ summary, result: summaryResult(this.formulas(), this.sheet(), summary) })),
  );

  readonly shownSummaries = computed(() => (this.part() === 'top' ? [] : this.summaries()));

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
    const value = gone || empty ? null : kpiValue(this.formulas(), sheet, kpi);
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

  format(value: number | null) {
    return formatNumber(value);
  }
}
