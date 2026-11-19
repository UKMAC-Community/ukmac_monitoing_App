import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, untracked } from '@angular/core';

import type { Row, SheetWithRows } from '@core/models';
import { formatFormulaValue, isFormulaError } from '@shared/formula/evaluate-formula';
import { WorkbookFormulas } from '@shared/formula/sheet-formulas';
import { type ZoneCell, usageWord } from '@shared/map/zone-layout';
import { displayCell, formatDate, isIsoDate, todayIso } from '@shared/sheet/columns';
import { Icon } from '@shared/ui/icon';
import { Modal } from '@shared/ui/modal';

export type JourneyKind = 'planting' | 'progress' | 'soil' | 'irrigation' | 'fertigation' | 'pruning' | 'pesticides' | 'harvest';

/** One table of the Planting group (and the Planting Date table), and how a plot's rows are found in it. */
interface Source {
  kind: JourneyKind;
  template: string;
  label: string;
  icon: string;
  /** The columns that name the plot (the first the table has). */
  plot: string[];
  /** The column that dates a row. */
  date: string[];
}

/** In the order a plot lives them: planted, grown (records, soil, water, feed, pruning, spray), harvested. */
export const JOURNEY_SOURCES: readonly Source[] = [
  { kind: 'planting', template: 'planting-date', label: 'Planting Date', icon: 'calendar', plot: ['Zone', 'Zone plot', 'Plot'], date: ['Planting date', 'Date'] },
  { kind: 'progress', template: 'zone-records', label: 'Plant Progress', icon: 'sprout', plot: ['Zone plot'], date: ['Record date'] },
  { kind: 'soil', template: 'soil-preparation', label: 'Soil Preparation', icon: 'shovel', plot: ['Zone', 'Zone plot', 'Plot'], date: ['Date'] },
  { kind: 'irrigation', template: 'irrigation', label: 'Irrigation', icon: 'droplets', plot: ['Zone', 'Zone plot', 'Plot'], date: ['Date'] },
  { kind: 'fertigation', template: 'fertigation', label: 'Fertigation', icon: 'flask', plot: ['Zone', 'Zone plot', 'Plot'], date: ['Date'] },
  { kind: 'pruning', template: 'pruning', label: 'Pruning', icon: 'scissors', plot: ['Zone', 'Zone plot', 'Plot'], date: ['Date'] },
  { kind: 'pesticides', template: 'pesticides', label: 'Pesticides', icon: 'spray', plot: ['Zone', 'Zone plot', 'Plot'], date: ['Date'] },
  { kind: 'harvest', template: 'harvest', label: 'Harvest', icon: 'wheat', plot: ['Zone plot'], date: ['Date harvest'] },
];

/** The columns a record doesn't need to repeat: which plot it is, and its own number. */
const LEFT_OUT = new Set(['id', 'zone', 'zone plot', 'plot', 'zone number']);

export interface JourneyEvent {
  kind: JourneyKind;
  label: string;
  icon: string;
  /** ISO date, or '' for a row with none. */
  date: string;
  /** What the row says: each column's name and value. */
  facts: { name: string; value: string }[];
}

export interface Journey {
  events: JourneyEvent[];
  /** How many rows each table has for the plot (every table of the group, even with none). */
  counts: { kind: JourneyKind; label: string; icon: string; count: number }[];
  /** The plot's day of planting, of its first and last harvest, and what has come of it. */
  planted: string;
  firstHarvest: string;
  lastHarvest: string;
  plants: string;
  yield: number;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Everything the MAC's tables say of one plot, from planting to harvest: the planting date, each plant record, the
 * soil, irrigation, fertigation, pruning and pesticide rows, and each harvest, dated and in the order they happened.
 */
export function buildJourney(plot: string, sheets: readonly SheetWithRows[]): Journey {
  const formulas = new WorkbookFormulas([...sheets], todayIso());
  const events: JourneyEvent[] = [];
  const counts: Journey['counts'] = [];
  let yieldTotal = 0;
  for (const source of JOURNEY_SOURCES) {
    const sheet = sheets.find((item) => item.templateKey === source.template);
    let count = 0;
    if (sheet && plot) {
      const find = (names: string[]) => names.map((name) => sheet.columns.find((column) => column.name.toLowerCase() === name.toLowerCase())).find(Boolean);
      const plotColumn = find(source.plot);
      const dateColumn = find(source.date);
      if (plotColumn) {
        for (const row of sheet.rows) {
          if (!same(String(row.data[plotColumn.key] ?? ''), plot)) continue;
          count += 1;
          const rawDate = dateColumn ? String(row.data[dateColumn.key] ?? '') : '';
          const facts: JourneyEvent['facts'] = [];
          for (const column of sheet.columns) {
            if (column === plotColumn || column === dateColumn || LEFT_OUT.has(column.name.toLowerCase())) continue;
            const value = factOf(formulas, sheet, row, column);
            if (value) facts.push({ name: column.name, value });
            if (source.kind === 'harvest' && column.name.toLowerCase() === 'harvest yield') yieldTotal += Number(String(row.data[column.key] ?? '').replace(/,/g, '')) || 0;
          }
          events.push({ kind: source.kind, label: source.label, icon: source.icon, date: isIsoDate(rawDate.slice(0, 10)) ? rawDate.slice(0, 10) : '', facts });
        }
      }
    }
    counts.push({ kind: source.kind, label: source.label, icon: source.icon, count });
  }
  // As they happened: dated rows by date (a table's own order kept within a day), the undated last.
  const order = new Map(JOURNEY_SOURCES.map((source, index) => [source.kind, index]));
  events.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (order.get(a.kind) ?? 0) - (order.get(b.kind) ?? 0));
  const dated = (kind: JourneyKind) => events.filter((event) => event.kind === kind && event.date).map((event) => event.date);
  const planting = dated('planting');
  const progress = dated('progress');
  const harvests = dated('harvest');
  const latest = events.filter((event) => event.kind === 'progress' && event.date).at(-1);
  return {
    events,
    counts,
    planted: planting[0] ?? progress[0] ?? '',
    firstHarvest: harvests[0] ?? '',
    lastHarvest: harvests.at(-1) ?? '',
    plants: latest?.facts.find((fact) => fact.name.toLowerCase() === 'plant count')?.value ?? '',
    yield: yieldTotal,
  };
}

function factOf(formulas: WorkbookFormulas, sheet: SheetWithRows, row: Row, column: SheetWithRows['columns'][number]): string {
  if (column.type === 'formula') {
    const value = formulas.value(sheet, row, column);
    if (isFormulaError(value)) return '';
    if (typeof value === 'number') return String(Number(value.toFixed(3)));
    const text = formatFormulaValue(value);
    return isIsoDate(text) ? formatDate(text) : text;
  }
  return displayCell(column, String(row.data[column.key] ?? ''));
}

/** Which part of a plot's story a table is (by its template): 'harvest' for the Harvest table; the Zone Map's Show list uses it. */
export function journeyKindOf(templateKey: string | null | undefined): JourneyKind | null {
  return JOURNEY_SOURCES.find((source) => source.template === templateKey)?.kind ?? null;
}

/**
 * A plot's whole story, from planting to harvest: the planting date, every plant record, soil, irrigation, fertigation,
 * pruning, pesticide and harvest row, each with its date, newest last. Shown on a full screen (the dashboard map's card
 * opens it) and, `compact`, in the Zone Map's side panel.
 */
@Component({
  selector: 'app-journey-view',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="view" [class.compact]="compact()">
      <div class="stats">
        <div class="stat"><span>Planted</span><strong>{{ day(journey().planted) }}</strong></div>
        <div class="stat"><span>Plants now</span><strong>{{ journey().plants || '—' }}</strong></div>
        <div class="stat"><span>First harvest</span><strong>{{ day(journey().firstHarvest) }}</strong></div>
        <div class="stat"><span>Last harvest</span><strong>{{ day(journey().lastHarvest) }}</strong></div>
        <div class="stat"><span>Harvest yield</span><strong>{{ journey().yield ? total(journey().yield) : '—' }}</strong></div>
      </div>
      <div class="filters" role="group" aria-label="Show">
        <button type="button" class="chip" [class.active]="kind() === null" (click)="kind.set(null)">All <small>{{ journey().events.length }}</small></button>
        @for (item of journey().counts; track item.kind) {
          <button type="button" class="chip" [class.active]="kind() === item.kind" [class.is-empty]="!item.count" [attr.data-kind]="item.kind" (click)="kind.set(kind() === item.kind ? null : item.kind)">
            <app-icon [name]="item.icon" [size]="13" /> {{ item.label }} <small>{{ item.count }}</small>
          </button>
        }
      </div>
      @if (shown().length) {
        <ol class="timeline">
          @for (event of shown(); track $index) {
            <li class="event" [attr.data-kind]="event.kind">
              <time class="when">{{ day(event.date) }}</time>
              <span class="mark"><app-icon [name]="event.icon" [size]="compact() ? 12 : 14" /></span>
              <div class="what">
                <strong>{{ event.label }}</strong>
                @if (event.facts.length) {
                  <dl class="facts">
                    @for (fact of event.facts; track fact.name) {
                      <div><dt>{{ fact.name }}</dt><dd>{{ fact.value }}</dd></div>
                    }
                  </dl>
                }
              </div>
            </li>
          }
        </ol>
      } @else {
        <p class="none">{{ kind() === null ? 'Nothing is recorded for this plot yet.' : 'No ' + kindLabel() + ' rows for this plot yet.' }}</p>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 18px; }
    .stat { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; border: var(--hairline) solid var(--border); border-radius: var(--radius-md, 12px); background: var(--surface-solid); }
    .stat span { font-size: 0.8125rem; color: var(--text-muted); }
    .stat strong { font-size: 1.25rem; font-weight: 600; font-variant-numeric: tabular-nums; }
    .filters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
    .filters .chip { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.8125rem; }
    .filters .chip small { color: var(--text-muted); font-variant-numeric: tabular-nums; }
    .filters .chip.is-empty:not(.active) { opacity: 0.55; }
    .timeline { list-style: none; margin: 0; padding: 0; position: relative; }
    /* The line the events hang on, between the dates and the cards. */
    .timeline::before { content: ''; position: absolute; top: 8px; bottom: 8px; left: 128px; width: 2px; background: var(--border); }
    .event { display: grid; grid-template-columns: 112px 34px 1fr; column-gap: 16px; align-items: start; padding: 8px 0; }
    .when { padding-top: 6px; text-align: right; font-size: 0.875rem; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
    .mark { position: relative; z-index: 1; display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 50%; background: var(--c, #6e6e73); color: #fff; box-shadow: 0 0 0 4px var(--surface-solid, #fff); }
    .what { padding: 10px 14px; border: var(--hairline) solid var(--border); border-radius: var(--radius-md, 12px); background: var(--surface-solid); min-width: 0; }
    .what > strong { font-size: 0.9375rem; }
    .facts { display: flex; flex-wrap: wrap; gap: 6px 22px; margin: 6px 0 0; }
    .facts div { display: flex; flex-direction: column; min-width: 0; }
    .facts dt { font-size: 0.6875rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; text-align: left; }
    .facts dd { margin: 0; font-size: 0.875rem; font-weight: 400; text-align: left; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .none { padding: 48px 0; text-align: center; color: var(--text-muted); }
    [data-kind='planting'] { --c: #7c5cd6; }
    [data-kind='progress'] { --c: #2f9e77; }
    [data-kind='soil'] { --c: #a0703c; }
    [data-kind='irrigation'] { --c: #2b7fd6; }
    [data-kind='fertigation'] { --c: #12a3a3; }
    [data-kind='pruning'] { --c: #7a8f2c; }
    [data-kind='pesticides'] { --c: #d9732b; }
    [data-kind='harvest'] { --c: #d64545; }
    .chip[data-kind] app-icon { color: var(--c); }
    .chip[data-kind].active app-icon { color: inherit; }
    /* In a side panel: the dates over their cards, the line close to the left. */
    .compact .stats { grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 12px; }
    .compact .stat:last-child:nth-child(odd) { grid-column: 1 / -1; }
    .compact .stat { padding: 8px 10px; gap: 2px; }
    .compact .stat span { font-size: 0.6875rem; }
    .compact .stat strong { font-size: 0.9375rem; }
    .compact .filters { gap: 6px; margin-bottom: 14px; }
    .compact .filters .chip { font-size: 0.75rem; padding: 3px 8px; }
    .compact .timeline::before { left: 12px; }
    .compact .event { grid-template-columns: 26px 1fr; column-gap: 10px; padding: 5px 0; }
    .compact .when { grid-column: 2; text-align: left; padding: 0; font-size: 0.8125rem; }
    .compact .mark { grid-row: 1 / span 2; width: 26px; height: 26px; box-shadow: 0 0 0 3px var(--surface-solid, #fff); }
    .compact .what { grid-column: 2; padding: 7px 10px; border-radius: 10px; }
    .compact .what > strong { font-size: 0.8125rem; }
    .compact .facts { gap: 4px 14px; margin-top: 4px; }
    .compact .facts dt { font-size: 0.625rem; }
    .compact .facts dd { font-size: 0.8125rem; }
    .compact .none { padding: 20px 0; font-size: 0.8125rem; }
    @media (max-width: 700px) {
      .timeline::before { left: 20px; }
      .event { grid-template-columns: 34px 1fr; }
      .when { grid-column: 2; text-align: left; padding: 0; }
      .mark { grid-row: 1 / span 2; }
      .what { grid-column: 2; }
    }
  `,
})
export class JourneyView {
  readonly cell = input<ZoneCell | null>(null);
  readonly sheets = input.required<readonly SheetWithRows[]>();
  /** For a side panel: smaller, its dates over their cards. */
  readonly compact = input(false);
  /** Scroll to the first row of this part of the story (the table the map is showing), when a plot opens. */
  readonly scrollTo = input<JourneyKind | null>(null);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** One table's rows only (from its chip), or all of them. */
  readonly kind = signal<JourneyKind | null>(null);

  constructor() {
    // Another plot opened: all its rows again.
    effect(() => {
      this.cell();
      untracked(() => this.kind.set(null));
    });
    // A plot opened while the map shows a table: its panel scrolls to that table's rows (once drawn).
    effect(() => {
      const kind = this.scrollTo();
      this.cell();
      if (!kind) return;
      setTimeout(() => {
        const row = this.host.nativeElement.querySelector(`li.event[data-kind="${kind}"]`);
        row?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }, 60);
    });
  }

  readonly journey = computed(() => buildJourney(this.cell()?.plot ?? '', this.sheets()));
  readonly shown = computed(() => {
    const kind = this.kind();
    return kind ? this.journey().events.filter((event) => event.kind === kind) : this.journey().events;
  });
  readonly kindLabel = computed(() => this.journey().counts.find((item) => item.kind === this.kind())?.label ?? '');

  day(iso: string) {
    return iso ? formatDate(iso) : '—';
  }

  total(value: number) {
    return Number(value.toFixed(2)).toLocaleString('en-US');
  }
}

/** The plot's whole story in a panel down the right side: opened from its card on the dashboard map. */
@Component({
  selector: 'app-plot-journey',
  imports: [Modal, JourneyView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [open]="open()" [title]="cell()?.plot || cell()?.label || ''" [subtitle]="subtitle()" size="side" (closed)="closed.emit()">
      @if (cell()) {
        <app-journey-view [cell]="cell()" [sheets]="sheets()" [compact]="true" />
      }
    </app-modal>
  `,
})
export class PlotJourney {
  readonly open = input(false);
  readonly cell = input<ZoneCell | null>(null);
  readonly sheets = input.required<readonly SheetWithRows[]>();
  readonly closed = output<void>();

  readonly subtitle = computed(() => {
    const cell = this.cell();
    if (!cell) return '';
    const place = cell.section !== null ? `Zone ${cell.zone} · ${cell.section}` : cell.zone;
    return [place, usageWord(cell), 'From planting to harvest'].filter(Boolean).join(' · ');
  });
}
