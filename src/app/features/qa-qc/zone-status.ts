import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { SheetWithRows } from '@core/models';
import { plotZoneNumbers } from '@features/dashboard/dashboard-model';
import { WorkbookFormulas } from '@shared/formula/sheet-formulas';
import { todayIso } from '@shared/sheet/columns';
import { plotReadings, type Reading, type Status } from './analysis-readings';
import { batchSourceOf, buildAnalysis } from './analysis-sheet';
import { STATUS_COLOURS } from './qa-qc-map';

/** One zone number's checks by status (blank, not green, yellow or red, is not counted, as the farm's own formula leaves it out). */
export interface ZoneStatus {
  /** The zone number ("5"); '' for the plots Zones gives no number. */
  zone: string;
  GREEN: number;
  YELLOW: number;
  RED: number;
  total: number;
}

export const STATUSES: readonly Status[] = ['GREEN', 'YELLOW', 'RED'];

/**
 * How many checks are green, yellow and red in each zone number, as the farm's sheet counts them for a zone (every status
 * cell of its plots): each plot's readings (its latest QC record) added to its zone number's. The zone numbers in order, a
 * plot with none last; `all` is every zone together.
 */
export function zoneStatuses(readings: ReadonlyMap<string, readonly Reading[]>, zoneOf: (plot: string) => string | null): { zones: ZoneStatus[]; all: ZoneStatus } {
  const byZone = new Map<string, ZoneStatus>();
  const all: ZoneStatus = { zone: 'all', GREEN: 0, YELLOW: 0, RED: 0, total: 0 };
  for (const [plot, list] of readings) {
    if (!list.length) continue;
    const zone = zoneOf(plot) ?? '';
    const tally = byZone.get(zone) ?? { zone, GREEN: 0, YELLOW: 0, RED: 0, total: 0 };
    byZone.set(zone, tally);
    for (const reading of list) {
      tally[reading.status] += 1;
      tally.total += 1;
      all[reading.status] += 1;
      all.total += 1;
    }
  }
  const zones = [...byZone.values()].sort((a, b) => (a.zone === '' ? 1 : b.zone === '' ? -1 : a.zone.localeCompare(b.zone, 'en', { numeric: true })));
  return { zones, all };
}

/** A count's share of its zone's checks, as the farm writes it: "60.0%" (no checks: none). */
export function shareOf(count: number, total: number): string {
  return total ? `${((count / total) * 100).toFixed(1)}%` : '';
}

/**
 * The graph's count axis: a round top over the largest count and the lines up to it, about five (steps of 1, 2, 2.5 or 5
 * times a power of ten, always whole: a count is).
 */
export function countScale(largest: number): { max: number; ticks: number[] } {
  const top = Math.max(1, largest);
  const rough = top / 5;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, [1, 2, 2.5, 5, 10].map((m) => m * power).find((candidate) => candidate >= rough && Number.isInteger(candidate))!);
  const max = Math.ceil(top / step) * step;
  return { max, ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step) };
}

/**
 * The QA/QC checks by zone number, in two cards: a graph of how many of the checks on each zone's plots (their latest QC
 * record) are green, yellow and red, the three side by side for each zone number; and the zone summary, a table of each
 * colour's count and its share of the zone's checks (the zone numbers across, the colours down, all zones on the right).
 */
@Component({
  selector: 'app-qa-qc-zone-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pair">
      <section class="card zone-graph">
        <header class="head">
          <div class="title">
            <h2>Green, yellow and red by zone number</h2>
            <p>
              How many checks on each zone's plots (their latest QC record) are green, yellow and red
              @if (tally().all.total) {
                · {{ tally().all.total.toLocaleString('en') }} checks
              }
            </p>
          </div>
          <ul class="legend" aria-label="Colours">
            @for (status of statuses; track status) {
              <li><span class="dot" [style.background]="fill(status)"></span>{{ name(status) }}</li>
            }
          </ul>
        </header>

        @if (!tally().zones.length) {
          <p class="none">No QC checks to count yet: they come with the QC records.</p>
        } @else {
          <!-- Each zone number a group of three columns, green, yellow and red side by side, each its count of checks over it. -->
          <div class="chart" role="img" [attr.aria-label]="chartLabel()">
            <div class="axis" aria-hidden="true">
              @for (tick of scale().ticks; track tick) {
                <span [style.bottom.%]="(tick / scale().max) * 100">{{ tick.toLocaleString('en') }}</span>
              }
            </div>
            <div class="area">
              @for (tick of scale().ticks; track tick) {
                <span class="grid" [class.base]="tick === 0" [style.bottom.%]="(tick / scale().max) * 100" aria-hidden="true"></span>
              }
              @for (zone of tally().zones; track zone.zone; let i = $index) {
                <div class="group">
                  <div class="bars">
                    @for (status of statuses; track status; let j = $index) {
                      <div
                        class="bar"
                        [style.height.%]="(zone[status] / scale().max) * 100"
                        [style.background]="fill(status)"
                        [style.--i]="i * 3 + j"
                        [title]="zoneName(zone) + ' · ' + name(status) + ': ' + zone[status] + ' of ' + zone.total + (zone.total ? ' (' + share(zone[status], zone.total) + ')' : '')"
                      >
                        <span class="value">{{ zone[status].toLocaleString('en') }}</span>
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
            <span></span>
            <div class="names" aria-hidden="true">
              @for (zone of tally().zones; track zone.zone) {
                <span>{{ zoneName(zone) }}</span>
              }
            </div>
          </div>
        }
      </section>

      @if (tally().zones.length) {
        <!-- The zone summary, as the farm's sheet gives it for a zone: each colour's count and its share, then the total. -->
        <section class="card zone-summary">
          <header class="head">
            <div class="title">
              <h2>Zone summary</h2>
              <p>Each colour's checks in each zone number, and its share of the zone's checks; all zones together on the right</p>
            </div>
          </header>
          <div class="scroller">
            <table class="data-table">
              <thead>
                <tr>
                  <th class="lead">Status</th>
                  @for (zone of tally().zones; track zone.zone) {
                    <th class="num">{{ zoneName(zone) }}</th>
                  }
                  <th class="num all">All zones</th>
                </tr>
              </thead>
              <tbody>
                @for (status of statuses; track status) {
                  <tr>
                    <th class="lead" scope="row"><span class="status"><span class="dot" [style.background]="fill(status)"></span>{{ status }}</span></th>
                    @for (zone of withAll(); track zone.zone) {
                      <td class="num" [class.all]="zone.zone === 'all'">
                        <span class="n">{{ zone[status].toLocaleString('en') }}</span>
                        <small>({{ share(zone[status], zone.total) || '–' }})</small>
                      </td>
                    }
                  </tr>
                }
                <tr class="total">
                  <th class="lead" scope="row">TOTAL</th>
                  @for (zone of withAll(); track zone.zone) {
                    <td class="num" [class.all]="zone.zone === 'all'">{{ zone.total.toLocaleString('en') }}</td>
                  }
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      }
    </div>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    /* Two cards, the graph and the zone summary, one under the other. */
    .pair { display: grid; gap: 16px; }
    .card { padding: 0; overflow: hidden; }
    .head { display: flex; align-items: flex-start; gap: 16px; padding: 16px 20px 4px; }
    .title { flex: 1; min-width: 0; }
    .title h2 { margin: 0; font-size: 1.0625rem; }
    .title p { margin: 2px 0 0; color: var(--text-muted); font-size: 0.8125rem; }
    .legend { display: flex; gap: 14px; margin: 4px 0 0; padding: 0; list-style: none; font-size: 0.8125rem; color: var(--text-muted); white-space: nowrap; }
    .legend li { display: inline-flex; align-items: center; gap: 6px; }
    .dot { display: inline-block; flex: none; width: 10px; height: 10px; border-radius: 3px; }

    /* The graph: a count axis on the left, a line at each step, three columns for each zone number, its name under them. */
    .chart { display: grid; grid-template-columns: 40px 1fr; grid-template-rows: 240px auto; column-gap: 8px; padding: 30px 20px 14px; }
    .axis { position: relative; font-size: 0.6875rem; color: var(--text-muted); font-variant-numeric: tabular-nums; }
    .axis span { position: absolute; right: 0; transform: translateY(50%); }
    .area { position: relative; display: flex; }
    .grid { position: absolute; left: 0; right: 0; height: var(--hairline); background: var(--border); }
    .grid.base { background: var(--border-strong); }
    .group { position: relative; flex: 1; min-width: 0; display: flex; justify-content: center; }
    .bars { display: flex; align-items: flex-end; gap: 4px; width: min(86%, 96px); height: 100%; }
    .bar {
      position: relative;
      flex: 1;
      min-width: 0;
      border-radius: 4px 4px 0 0;
      transform-origin: bottom;
      animation: rise 520ms var(--ease, ease) both;
      animation-delay: calc(var(--i, 0) * 18ms);
      cursor: default;
    }
    .value { position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); padding-bottom: 3px; font-size: 0.6875rem; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .names { display: flex; padding-top: 8px; }
    .names span { flex: 1; min-width: 0; text-align: center; font-size: 0.75rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    @keyframes rise { from { transform: scaleY(0); } to { transform: scaleY(1); } }
    @media (prefers-reduced-motion: reduce) { .bar { animation: none; } }

    /* The zone summary: the zone numbers across, the colours down, all zones together on the right. */
    .scroller { background: transparent; overflow-x: auto; margin-top: 10px; border-top: var(--hairline) solid var(--border); }
    .data-table { width: 100%; }
    .data-table th, .data-table td { padding: 6px 10px; white-space: nowrap; }
    /* Each zone's column centred, as every table's columns are. */
    .data-table td.num { font-variant-numeric: tabular-nums; }
    .data-table th.lead { text-align: left; }
    .data-table tbody th.lead { font-size: 0.8125rem; font-weight: 600; color: var(--text); }
    .status { display: inline-flex; align-items: center; gap: 8px; }
    /* The count, its share under it: the table keeps every zone in view. */
    .data-table td .n { display: block; font-weight: 500; }
    .data-table td small { display: block; color: var(--text-muted); font-size: 0.6875rem; line-height: 1.3; }
    .data-table .all { border-left: var(--hairline) solid var(--border-strong); font-weight: 600; }
    .data-table tr.total th, .data-table tr.total td { font-weight: 700; background: var(--fill); }
    .none { padding: 28px 20px; text-align: center; color: var(--text-muted); font-size: 0.875rem; }
  `,
})
export class QaQcZoneStatus {
  /** The QA/QC table, and the MAC's tables (Zones gives each plot's zone number; Plant Progress its batch, for the analysis). */
  readonly sheet = input.required<SheetWithRows>();
  readonly sheets = input.required<readonly SheetWithRows[]>();

  readonly statuses = STATUSES;

  private readonly built = computed(() => buildAnalysis(this.sheet(), batchSourceOf(this.sheets())));
  private readonly formulas = computed(() => new WorkbookFormulas([...this.sheets(), this.built().sheet], todayIso()));

  /** Each zone number's checks by colour, from the QA/QC Analysis's readings and Zones' zone numbers. */
  readonly tally = computed(() => {
    const formulas = this.formulas();
    const readings = plotReadings(this.built(), formulas);
    const zoneColumn = this.sheet().columns.find((column) => !column.box && column.name === 'Zone');
    const numbers = plotZoneNumbers(formulas, zoneColumn);
    return zoneStatuses(readings, (plot) => {
      const value = numbers.get(plot.trim().toLowerCase());
      return value === null || value === undefined || String(value).trim() === '' ? null : String(value).trim();
    });
  });

  /** The graph's count axis, over the largest count of any colour in any zone. */
  readonly scale = computed(() => countScale(Math.max(0, ...this.tally().zones.flatMap((zone) => STATUSES.map((status) => zone[status])))));

  /** The zone numbers, then all of them together: the table's columns. */
  readonly withAll = computed(() => [...this.tally().zones, this.tally().all]);

  readonly chartLabel = computed(() =>
    this.tally()
      .zones.map((zone) => `${this.zoneName(zone)}: ${STATUSES.map((status) => `${zone[status]} ${status.toLowerCase()}`).join(', ')}`)
      .join('; '),
  );

  zoneName(zone: ZoneStatus): string {
    return zone.zone === '' ? 'No zone number' : `Zone ${zone.zone}`;
  }

  share(count: number, total: number): string {
    return shareOf(count, total);
  }

  fill(status: Status): string {
    return STATUS_COLOURS[status].fill;
  }

  name(status: Status): string {
    return STATUS_COLOURS[status].label;
  }
}
