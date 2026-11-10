import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import type { SheetWithRows } from '../core/models';
import type { WorkbookFormulas } from '../formula/sheet-formulas';
import { formatNumber, type ChartPoint } from './dashboard-model';
import { sheetOf, yearSeries, type ChiliKpi, type KpiShow } from './chili-kpis';
import { KpiChart } from './kpi-chart';

/**
 * A chili MAC's dashboard, as the system's Chili page draws its starter
 * report (`cropDashboardReport`): Power BI KPI tiles, each its latest
 * year's value next to the year before, over its trend year to year, and
 * the charts of the years. Which KPIs, and what each works out, is the
 * list a person edits (Edit dashboard); read from the MAC's tables (found
 * by their template keys, their columns by name). One whose table or
 * column isn't in this MAC is left out of it.
 */

interface YearTile {
  id: string;
  title: string;
  value: string;
  note: string;
  trend: ChartPoint[];
}

@Component({
  selector: 'app-chili-dashboard',
  imports: [KpiChart],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="canvas">
      @if (!kpis().length) {
        <div class="empty">
          <strong>No KPIs on this dashboard</strong>
          <p>Add the numbers and charts you want to keep an eye on.</p>
          <button type="button" class="btn btn-primary btn-sm" (click)="edit.emit()">Edit dashboard</button>
        </div>
      }
      <div class="tiles">
        @for (tile of tiles(); track tile.id; let i = $index) {
          <article class="tile" [style.--i]="i">
            <h3>{{ tile.title }}</h3>
            <div class="body">
              <span class="value">{{ tile.value }}</span>
              <span class="note">{{ tile.note }}</span>
              <svg class="trend" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
                @if (tile.trend.length >= 2) {
                  <defs>
                    <linearGradient [attr.id]="'fade-' + $index" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stop-color="#118DFF" stop-opacity="0.22" />
                      <stop offset="100%" stop-color="#118DFF" stop-opacity="0" />
                    </linearGradient>
                  </defs>
                  <path [attr.d]="area(tile.trend)" [attr.fill]="'url(#fade-' + $index + ')'" />
                }
                <path [attr.d]="line(tile.trend)" fill="none" stroke="#118DFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
              </svg>
            </div>
          </article>
        }
      </div>
      @if (charts().length) {
        <div class="charts">
          @for (chart of charts(); track chart.id; let i = $index) {
            <article class="tile chart" [style.--i]="i + 6">
              <h3>{{ chart.title }}</h3>
              <app-kpi-chart [points]="chart.points" [visual]="chart.visual" [label]="chart.title" />
            </article>
          }
        </div>
      }
    </div>
  `,
  styles: `
    @media (prefers-reduced-motion: no-preference) { .tile { animation: itemIn 420ms var(--ease) both; animation-delay: calc(var(--i, 0) * 45ms); } }
    /* As the system's KPI page: soft white cards straight on the page, no grey canvas. */
    .canvas { display: flex; flex-direction: column; gap: 12px; }
    .tiles { display: grid; grid-template-columns: repeat(var(--kpi-cols, 3), minmax(0, 1fr)); gap: 12px; }
    .tile {
      container-type: inline-size;
      display: flex; flex-direction: column; min-width: 0; height: 176px; padding: 18px 22px 14px;
      background: var(--surface); border: var(--hairline) solid var(--border);
      border-radius: var(--radius-lg); box-shadow: var(--shadow-card);
    }
    h3 { font-size: 0.9375rem; font-weight: 400; color: var(--text-muted); letter-spacing: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .body { flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: flex-start; justify-content: flex-end; gap: 6px; }
    .value { font-size: max(16px, min(42px, 10cqw)); line-height: 1.05; font-weight: 700; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; color: var(--text); }
    .note { font-size: 0.8125rem; color: var(--text-muted); }
    .trend { display: block; width: 100%; flex: 1; min-height: 24px; max-height: 56px; margin-top: 2px; }
    .charts { display: grid; grid-template-columns: repeat(var(--chart-cols, 2), minmax(0, 1fr)); gap: 12px; }
    .tile.chart { height: auto; min-height: 0; padding: 18px 22px 16px; gap: 10px; }
    .tile.chart h3 { font-weight: 600; color: var(--text); }
    .empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 28px 20px; text-align: center; background: var(--surface); border: var(--hairline) dashed var(--border); border-radius: var(--radius-lg); }
    .empty p { margin: 0 0 6px; font-size: 0.8125rem; color: var(--text-muted); }
  `,
})
export class ChiliDashboard {
  readonly sheets = input.required<readonly SheetWithRows[]>();
  readonly formulas = input.required<WorkbookFormulas>();
  readonly kpis = input.required<readonly ChiliKpi[]>();
  /** The empty page's own "Edit dashboard". */
  readonly edit = output<void>();

  readonly tiles = computed<YearTile[]>(() =>
    this.kpis().flatMap((kpi) => {
      if (kpi.show !== 'card') return [];
      const found = yearSeries(kpi, this.sheets(), this.formulas());
      if (!found) return [];
      const { trend, whole } = found;
      const last = trend.at(-1);
      const before = trend.length > 1 ? trend[trend.length - 2] : null;
      // As the system's KPI: the latest year, next to the year before.
      const value = last ? last.value : whole;
      const hasRows = !!sheetOf(this.sheets(), kpi.table)?.rows.length;
      let note = hasRows ? 'No values yet' : 'No rows yet';
      if (before && last && before.value) {
        const change = ((last.value - before.value) / Math.abs(before.value)) * 100;
        note = `${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(1)}% vs ${before.label}`;
      } else if (last) note = last.label;
      else if (whole !== null && hasRows) note = 'All rows (no dates yet)';
      return [{ id: kpi.id, title: kpi.title, value: formatNumber(value, kpi.decimals), note, trend }];
    }),
  );

  readonly charts = computed<{ id: string; title: string; points: ChartPoint[]; visual: Exclude<KpiShow, 'card'> }[]>(() =>
    this.kpis().flatMap((kpi) => {
      if (kpi.show === 'card') return [];
      const found = yearSeries(kpi, this.sheets(), this.formulas());
      return found ? [{ id: kpi.id, title: kpi.title, points: found.trend, visual: kpi.show }] : [];
    }),
  );

  /** The trend's line across the tile (flat along the bottom with under two years). */
  line(trend: ChartPoint[]) {
    return this.path(trend, false);
  }

  area(trend: ChartPoint[]) {
    return this.path(trend, true);
  }

  private path(trend: ChartPoint[], closed: boolean) {
    const points = trend.length >= 2 ? trend : [{ value: 0 }, { value: 0 }];
    const values = points.map((point) => point.value);
    const low = Math.min(...values);
    const high = Math.max(...values);
    const room = (high - low || Math.abs(high) || 1) * 0.2;
    const [min, max] = [low - room * 1.5, high + room];
    const y = (value: number) => (trend.length >= 2 ? 40 - ((value - min) / (max - min)) * 38 : 38);
    const xy = points.map((point, index) => ({ x: (index / (points.length - 1)) * 100, y: y(point.value) }));
    // A smooth curve through the points (Catmull-Rom as Béziers), as the system's trend.
    let line = `M ${xy[0].x},${xy[0].y.toFixed(2)}`;
    for (let i = 0; i < xy.length - 1; i += 1) {
      const [p0, p1, p2, p3] = [xy[Math.max(0, i - 1)], xy[i], xy[i + 1], xy[Math.min(xy.length - 1, i + 2)]];
      const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
      const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
      line += ` C ${c1.x.toFixed(2)},${c1.y.toFixed(2)} ${c2.x.toFixed(2)},${c2.y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
    }
    return closed ? `${line} L 100,40 L 0,40 Z` : line;
  }
}
