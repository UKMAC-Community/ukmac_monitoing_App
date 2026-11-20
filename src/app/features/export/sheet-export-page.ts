import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewEncapsulation, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';

import { Api, errorText } from '@core/api';
import { Google } from '@core/google/google';
import type { Dashboard, Kpi, SheetWithRows, SummaryTable } from '@core/models';
import { baseName } from '@core/paths';
import { Toasts } from '@core/toast';
import { WorkbookStore } from '@core/workbook-store';
import { dashboardOf } from '@features/dashboard/dashboard-model';
import { SheetDashboard } from '@features/dashboard/sheet-dashboard';
import { autoTitle, studioFields, visualsOf } from '@features/dashboard/studio-model';
import type { WorkbookFormulas } from '@shared/formula/sheet-formulas';
import { formatDate, todayIso } from '@shared/sheet/columns';
import { Icon } from '@shared/ui/icon';
import { type A4Orientation, MM_TO_PX, type Measured, paginate, SHEET, sheetBody, type Slice } from './a4';
import { pagesToPdf, type PagePicture } from './image-pdf';
import { dataTable, type ReportTable, summaryTable } from './report-tables';

/** Saved at twice the screen's resolution: sharp text on paper. */
const PIXEL_RATIO = 2;

/** What a chart's shapes and words take from the app's CSS (their colour, size, lines), written on them for the picture. */
const SVG_STYLE = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linejoin',
  'stroke-linecap',
  'opacity',
  'display',
  'visibility',
  'font-size',
  'font-weight',
  'font-family',
  'letter-spacing',
  'font-variant-numeric',
  'paint-order',
  'text-anchor',
  'dominant-baseline',
  'shape-rendering',
];

/**
 * html-to-image copies a chart (an <svg>) as it is, without the CSS its shapes and words are drawn with (a hover area
 * comes out black, a name at the browser's size): each is given its own styles for the picture, and they are taken off after.
 */
function inlineSvgStyles(root: HTMLElement): () => void {
  const saved: [Element, string | null][] = [];
  for (const el of root.querySelectorAll('svg *')) {
    const computed = getComputedStyle(el);
    saved.push([el, el.getAttribute('style')]);
    const own = SVG_STYLE.map((name) => `${name}:${computed.getPropertyValue(name)}`).join(';');
    el.setAttribute('style', `${el.getAttribute('style') ?? ''};${own}`);
  }
  return () => saved.forEach(([el, style]) => (style === null ? el.removeAttribute('style') : el.setAttribute('style', style)));
}

/** Something that goes on the pages: the KPI cards (together), a chart, or a table (a summary, the rows) split over pages as it needs. */
type Part =
  | { key: string; kind: 'cards' | 'chart'; title: string; board: Dashboard }
  | { key: string; kind: 'table'; title: string; subtitle: string; table: ReportTable };

/** One thing to tick on the left: what it is called, a line about it, its icon. */
interface Choice {
  key: string;
  label: string;
  sub: string;
  icon: string;
}

const VISUAL_WORDS: Record<string, string> = {
  column: 'Column chart',
  stacked: 'Stacked columns',
  bar: 'Bar chart',
  line: 'Line chart',
  area: 'Area chart',
  waterfall: 'Waterfall',
  pie: 'Pie chart',
  donut: 'Donut chart',
  treemap: 'Treemap',
  funnel: 'Funnel',
  radar: 'Radar',
  gauge: 'Gauge',
  lollipop: 'Lollipop chart',
  dot: 'Dot chart',
  pareto: 'Pareto chart',
  polar: 'Polar chart',
};

/**
 * A table's report as a PDF (the user, 2026-11-19; the web's Export Studio): its KPI cards, charts and summaries as the
 * dashboard shows them, and its rows, on A4 pages. Down the left, each of them ticked to go in or not, and the pages upright
 * or on their side; on the right the pages as they will be saved — each saved as a picture of itself, so what is seen is the file.
 */
@Component({
  selector: 'app-sheet-export-page',
  imports: [NgTemplateOutlet, RouterLink, Icon, SheetDashboard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    @if (sheet(); as sheet) {
      <div class="page sx-page">
        <header class="page-header">
          <a class="page-back-icon" [routerLink]="['/mac', sheet.macId, 'table', sheet.sheetId]" [title]="'Back to ' + sheet.title" aria-label="Back"><app-icon name="arrow-left" [size]="16" /></a>
          <div class="page-header-text">
            <h1 class="page-title">Report as PDF <span class="badge neutral">{{ sheet.title }}</span></h1>
            <p class="page-desc">Tick what goes in. The preview shows the PDF's A4 pages exactly as they will be saved.</p>
          </div>
        </header>

        <div class="sx-layout">
          <aside class="card sx-options" aria-label="What goes in the PDF">
            <div class="sx-scroll">
              @for (group of choices(); track group.title) {
                <fieldset class="sx-group">
                  <legend class="sx-legend">
                    <span>{{ group.title }}</span>
                    @if (group.items.length > 1) {
                      <button type="button" class="btn btn-plain btn-sm" [disabled]="!!busy()" (click)="setAll(group.items, !allIn(group.items))">{{ allIn(group.items) ? 'None' : 'All' }}</button>
                    }
                  </legend>
                  @for (item of group.items; track item.key) {
                    <button type="button" role="checkbox" class="sx-choice" [class.on]="isIn(item.key)" [attr.aria-checked]="isIn(item.key)" [disabled]="!!busy()" (click)="toggle(item.key)">
                      <span class="sx-visual"><app-icon [name]="item.icon" [size]="17" /></span>
                      <span class="sx-text"><b>{{ item.label }}</b><small>{{ item.sub }}</small></span>
                      <span class="sx-tick" aria-hidden="true"><app-icon name="check" [size]="12" /></span>
                    </button>
                  }
                </fieldset>
              } @empty {
                <p class="muted">This table has nothing to put in a report yet.</p>
              }

              <fieldset class="sx-group" role="radiogroup" aria-label="Page">
                <legend class="sx-legend"><span>Page</span></legend>
                @for (way of ways; track way.value) {
                  <button type="button" role="radio" class="sx-choice" [class.on]="orientation() === way.value" [attr.aria-checked]="orientation() === way.value" [disabled]="!!busy()" (click)="orientation.set(way.value)">
                    <span class="sx-visual">
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true">
                        @if (way.value === 'portrait') {
                          <rect x="5.5" y="3" width="13" height="18" rx="2" /><path d="M9 8h6M9 11.5h6M9 15h4" />
                        } @else {
                          <rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="M7 9.5h10M7 12.5h10M7 15.5h6" />
                        }
                      </svg>
                    </span>
                    <span class="sx-text"><b>{{ way.label }}</b><small>{{ way.sub }}</small></span>
                    <span class="sx-tick round" aria-hidden="true"><app-icon name="check" [size]="12" /></span>
                  </button>
                }
              </fieldset>
            </div>

            <div class="sx-foot">
              <p class="sx-state" aria-live="polite">
                {{ busy() ?? (!parts().length ? 'Tick at least one thing to put in.' : pages() === null ? 'Laying out the pages…' : pageCount() + (pageCount() === 1 ? ' page' : ' pages') + ' · A4 ' + orientation()) }}
              </p>
              <button type="button" class="btn btn-primary sx-download" [disabled]="!pages() || !parts().length || !!busy()" (click)="download()">
                @if (busy()) {
                  <span class="spinner-sm"></span>
                } @else {
                  <app-icon name="download" [size]="15" />
                }
                Save PDF
              </button>
            </div>
          </aside>

          <section class="sx-preview" aria-label="Preview">
            <div class="sx-preview-head">
              <h2>Preview</h2>
              <span class="muted">Saved exactly as shown</span>
            </div>
            <div class="sx-sheets" #previewBox>
              @if (!parts().length) {
                <p class="sx-empty">Tick what goes in to see its pages here.</p>
              } @else if (!pages() || !scale()) {
                <p class="sx-empty"><span class="spinner-sm"></span> Laying out the pages…</p>
              } @else {
                <div #sheetsEl class="sx-sheet-list">
                  @for (slices of pages(); track $index; let n = $index) {
                    <div class="a4-frame" [style.width.px]="paperPx().width * scale()" [style.height.px]="paperPx().height * scale()">
                      <div class="a4-scale" [style.transform]="'scale(' + scale() + ')'">
                        <div class="a4-sheet" data-sheet [style.width.mm]="paper().widthMm" [style.height.mm]="paper().heightMm" [style.padding.mm]="margin">
                          <header class="a4-head">
                            <div class="a4-brand">
                              <img src="logo/UKMAC_Logo.webp" alt="" />
                              <div>
                                <p class="a4-name">UKMAC</p>
                                <p class="a4-doc">{{ sheet.title }} report</p>
                              </div>
                            </div>
                            <div class="a4-meta">
                              <p class="a4-mac">{{ macName() }}</p>
                              <p>Made {{ madeAt }}</p>
                            </div>
                          </header>
                          <div class="a4-body" [style.gap.px]="gapPx">
                            @for (slice of slices; track slice.key + ':' + slice.from) {
                              <ng-container [ngTemplateOutlet]="partView" [ngTemplateOutletContext]="{ part: partOf(slice.key), slice: slice }" />
                            }
                          </div>
                          <footer class="a4-foot">
                            <span>{{ preparedBy() ? 'Prepared by ' + preparedBy() : '' }}</span>
                            <span>Page {{ n + 1 }} of {{ pageCount() }}</span>
                          </footer>
                        </div>
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          </section>
        </div>

        <!-- Every part laid out whole at a page's width, out of sight: its height (a table's, row by row) says where the pages break. -->
        <div class="a4-measure" #measureEl aria-hidden="true" [style.width.px]="bodyWidth()">
          @for (part of parts(); track part.key) {
            <div class="a4-measured" [attr.data-part]="part.key">
              <ng-container [ngTemplateOutlet]="partView" [ngTemplateOutletContext]="{ part: part, slice: whole(part) }" />
            </div>
          }
        </div>

        <ng-template #partView let-part="part" let-slice="slice">
          @if (part) {
            @if (part.kind === 'table') {
              <div class="rp-table">
                <div class="rp-heading" data-heading>
                  <h2>{{ part.title }}@if (!slice.first) {<span class="rp-cont"> · continued</span>}</h2>
                  @if (part.subtitle) {
                    <p>{{ part.subtitle }}</p>
                  }
                </div>
                <table class="rp-grid">
                  <colgroup>
                    @for (width of part.table.widths; track $index) {
                      <col [style.width.%]="width" />
                    }
                  </colgroup>
                  <thead>
                    <tr>
                      @for (header of part.table.headers; track $index) {
                        <th [class.num]="part.table.numeric[$index]">{{ header }}</th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of rowsOf(part, slice); track $index) {
                      <tr data-row>
                        @for (cell of row; track $index) {
                          <td [class.num]="part.table.numeric[$index]">{{ cell }}</td>
                        }
                      </tr>
                    }
                    @if (slice.last && part.table.totals) {
                      <tr class="rp-total" data-tail>
                        @for (cell of part.table.totals; track $index) {
                          <td [class.num]="$index > 0 && part.table.numeric[$index]">{{ cell }}</td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
                @if (slice.last) {
                  <p class="rp-count" data-tail>{{ part.table.count }}</p>
                }
              </div>
            } @else {
              <app-sheet-dashboard class="rp-board" [sheet]="sheet" [formulas]="formulas()" [board]="part.board" part="top" [print]="true" />
            }
          }
        </ng-template>
      </div>
    } @else {
      <div class="page"><p class="muted">This table isn't here any more.</p></div>
    }
  `,
  styles: `
    /* As every routed page (styles.css): it fills the space under the top bar, so its .page scrolls. */
    app-sheet-export-page { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .sx-page { gap: 16px; }
    .sx-layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 20px; align-items: start; }
    .sx-options { position: sticky; top: 0; display: flex; flex-direction: column; max-height: calc(100vh - 150px); padding: 0; overflow: hidden; }
    .sx-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 18px; }
    .sx-group { border: 0; margin: 0; padding: 0; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
    .sx-legend { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 0 0 2px; font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); }
    .sx-legend .btn { text-transform: none; letter-spacing: 0; font-size: 0.75rem; padding: 2px 8px; min-height: 0; height: auto; }
    .sx-choice { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border: var(--hairline) solid var(--border); border-radius: var(--radius-md, 12px); background: var(--surface-solid); color: var(--text); font: inherit; text-align: left; cursor: pointer; transition: border-color var(--dur-fast, 0.15s), background var(--dur-fast, 0.15s); }
    .sx-choice:hover:not(:disabled) { border-color: var(--border-strong); }
    .sx-choice.on { border-color: var(--accent); background: var(--accent-soft, rgba(0, 102, 217, 0.08)); }
    .sx-choice:disabled { opacity: 0.55; cursor: default; }
    .sx-visual { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 9px; background: var(--surface-hover, #f2f2f4); color: var(--text-muted); }
    .sx-choice.on .sx-visual { background: var(--surface-solid); color: var(--accent); }
    .sx-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .sx-text b { font-size: 0.8125rem; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sx-text small { font-size: 0.71875rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sx-tick { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 5px; border: 1.5px solid var(--border-strong); background: var(--surface-solid); color: transparent; }
    .sx-tick.round { border-radius: 50%; }
    .sx-choice.on .sx-tick { border-color: var(--accent); background: var(--accent); color: #fff; }
    .sx-foot { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 14px 16px 16px; border-top: var(--hairline) solid var(--border); }
    .sx-state { margin: 0; font-size: 0.75rem; color: var(--text-muted); }
    .sx-download { width: 100%; justify-content: center; gap: 8px; }
    .sx-preview { min-width: 0; padding: 16px; border-radius: var(--radius-lg, 16px); background: var(--surface-hover, #ececef); }
    .sx-preview-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 4px 14px; }
    .sx-preview-head h2 { margin: 0; font-size: 0.875rem; font-weight: 600; }
    .sx-preview-head span { font-size: 0.75rem; }
    .sx-empty { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 80px 16px; margin: 0; color: var(--text-muted); font-size: 0.875rem; border: 1px dashed var(--border-strong); border-radius: var(--radius-md, 12px); background: var(--surface-solid); }
    .sx-sheet-list { display: flex; flex-direction: column; align-items: center; gap: 22px; }
    @media (max-width: 980px) { .sx-layout { grid-template-columns: minmax(0, 1fr); } .sx-options { position: static; max-height: none; } }

    /* An A4 sheet at its real size (the preview scales it, the PDF is a picture of it). */
    .a4-frame { flex: none; overflow: hidden; border-radius: 3px; background: #fff; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.12); }
    .a4-scale { transform-origin: top left; pointer-events: none; }
    .a4-sheet { box-sizing: border-box; display: flex; flex-direction: column; background: #fff; color: #1d1d1f; }
    .a4-head { flex: none; height: 12mm; margin-bottom: 4mm; display: flex; align-items: flex-start; justify-content: space-between; gap: 6mm; border-bottom: 1px solid #d2d2d7; }
    .a4-brand { display: flex; align-items: center; gap: 2.5mm; min-width: 0; }
    .a4-brand img { width: 10mm; height: 10mm; object-fit: contain; }
    .a4-head p { margin: 0; }
    .a4-name { font-size: 12pt; font-weight: 700; letter-spacing: 0.02em; line-height: 1.15; }
    .a4-doc { font-size: 8pt; font-weight: 500; color: #6e6e73; }
    .a4-meta { text-align: right; font-size: 7.5pt; line-height: 1.55; color: #6e6e73; }
    .a4-mac { font-weight: 600; color: #1d1d1f; }
    .a4-body { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
    .a4-foot { flex: none; height: 8mm; display: flex; align-items: flex-end; justify-content: space-between; gap: 4mm; font-size: 7.5pt; color: #6e6e73; font-variant-numeric: tabular-nums; }
    .a4-measure { position: fixed; left: -20000px; top: 0; visibility: hidden; pointer-events: none; display: flex; flex-direction: column; }
    .a4-measured { flex: none; }
    /* Nothing moves on paper: a chart drawn whole, a card at its number. */
    .a4-sheet *, .a4-sheet *::before, .a4-sheet *::after, .a4-measure *, .a4-measure *::before, .a4-measure *::after { animation: none !important; transition: none !important; }
    /* The board's own host grows to fill a page on screen; on the page it is as tall as what it holds. */
    .a4-sheet app-sheet-dashboard.rp-board, .a4-measure app-sheet-dashboard.rp-board { display: block; flex: none; }

    /* A table on the page: its title, its column names (again on each page it runs on to), its rows, its totals and count. */
    .rp-table { flex: none; }
    .rp-heading { padding-bottom: 2.5mm; }
    .rp-heading h2 { margin: 0; font-size: 12pt; font-weight: 600; letter-spacing: -0.01em; }
    .rp-heading p { margin: 0.8mm 0 0; font-size: 8.5pt; color: #6e6e73; }
    .rp-cont { font-weight: 400; color: #6e6e73; }
    .rp-grid { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 8pt; line-height: 1.35; font-variant-numeric: tabular-nums; }
    .rp-grid th { padding: 1.4mm 1.6mm; text-align: left; font-size: 6.5pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #6e6e73; border-bottom: 1px solid #c7c7cc; vertical-align: bottom; overflow-wrap: anywhere; }
    .rp-grid td { padding: 1.2mm 1.6mm; border-bottom: 1px solid #ececf0; vertical-align: top; overflow-wrap: anywhere; }
    .rp-grid .num { text-align: right; }
    .rp-total td { font-weight: 600; border-top: 1px solid #c7c7cc; border-bottom: 0; background: #f7f7f9; }
    .rp-count { margin: 0; padding-top: 2mm; font-size: 7.5pt; color: #6e6e73; }
  `,
})
export class SheetExportPage {
  readonly sheetId = input.required<string>();

  private readonly store = inject(WorkbookStore);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly google = inject(Google);

  readonly sheet = computed(() => this.store.sheet(Number(this.sheetId())));
  readonly formulas = computed<WorkbookFormulas>(() => this.store.formulas());
  readonly macName = computed(() => this.store.mac()?.macName ?? '');
  readonly preparedBy = computed(() => this.google.status()?.name ?? '');
  readonly madeAt = `${formatDate(todayIso())} ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;

  readonly orientation = signal<A4Orientation>('portrait');
  readonly ways = [
    { value: 'portrait' as const, label: 'Upright', sub: 'Portrait · tall pages' },
    { value: 'landscape' as const, label: 'On its side', sub: 'Landscape · room for more columns' },
  ];
  readonly margin = SHEET.marginMm;
  readonly gapPx = SHEET.gapMm * MM_TO_PX;
  readonly paper = computed(() => SHEET.paper[this.orientation()]);
  readonly paperPx = computed(() => ({ width: this.paper().widthMm * MM_TO_PX, height: this.paper().heightMm * MM_TO_PX }));
  readonly bodyWidth = computed(() => sheetBody(this.orientation()).width);

  /** What was unticked (everything goes in to begin with). */
  private readonly leftOut = signal<ReadonlySet<string>>(new Set());
  readonly busy = signal<string | null>(null);

  private readonly board = computed<Dashboard>(() => {
    const sheet = this.sheet();
    return sheet ? dashboardOf(sheet).dashboard : { kpis: [], summaries: [] };
  });
  private readonly cards = computed(() => this.board().kpis.filter((kpi) => kpi.visual === 'card'));
  private readonly charts = computed(() => this.board().kpis.filter((kpi) => kpi.visual !== 'card'));

  /** The things to tick, by kind: each KPI card, each chart, each summary, and the rows. */
  readonly choices = computed(() => {
    const sheet = this.sheet();
    if (!sheet) return [];
    const groups: { title: string; items: Choice[] }[] = [
      { title: 'KPI cards', items: this.cards().map((kpi) => ({ key: `card:${kpi.id}`, label: this.kpiTitle(sheet, kpi), sub: 'Number card', icon: 'hash' })) },
      { title: 'Charts', items: this.charts().map((kpi) => ({ key: `chart:${kpi.id}`, label: this.kpiTitle(sheet, kpi), sub: VISUAL_WORDS[kpi.visual] ?? 'Chart', icon: 'chart' })) },
      {
        title: 'Summaries',
        items: this.board()
          .summaries.filter((summary) => summary.groupBy)
          .map((summary) => ({ key: `summary:${summary.id}`, label: this.summaryTitle(sheet, summary), sub: 'Table of totals', icon: 'table' })),
      },
      { title: 'Data', items: [{ key: 'data', label: 'The rows', sub: `${sheet.rows.length.toLocaleString('en-US')} records, every column with something in it`, icon: 'database' }] },
    ];
    return groups.filter((group) => group.items.length);
  });

  isIn(key: string) {
    return !this.leftOut().has(key);
  }

  allIn(items: readonly Choice[]) {
    return items.every((item) => this.isIn(item.key));
  }

  toggle(key: string) {
    this.leftOut.update((now) => {
      const next = new Set(now);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  setAll(items: readonly Choice[], on: boolean) {
    this.leftOut.update((now) => {
      const next = new Set(now);
      for (const item of items) {
        if (on) next.delete(item.key);
        else next.add(item.key);
      }
      return next;
    });
  }

  /** What goes on the pages, in the dashboard's order: the cards together, each chart, each summary, then the rows. */
  readonly parts = computed<Part[]>(() => {
    const sheet = this.sheet();
    if (!sheet) return [];
    const formulas = this.formulas();
    const parts: Part[] = [];
    const cards = this.cards().filter((kpi) => this.isIn(`card:${kpi.id}`));
    if (cards.length) parts.push({ key: 'cards', kind: 'cards', title: 'KPI cards', board: { kpis: cards, summaries: [] } });
    for (const kpi of this.charts()) {
      if (this.isIn(`chart:${kpi.id}`)) parts.push({ key: `chart:${kpi.id}`, kind: 'chart', title: this.kpiTitle(sheet, kpi), board: { kpis: [kpi], summaries: [] } });
    }
    for (const summary of this.board().summaries) {
      if (!this.isIn(`summary:${summary.id}`)) continue;
      const table = summaryTable(formulas, sheet, summary);
      if (table) parts.push({ key: `summary:${summary.id}`, kind: 'table', title: this.summaryTitle(sheet, summary), subtitle: '', table });
    }
    if (this.isIn('data')) parts.push({ key: 'data', kind: 'table', title: `${sheet.title}: the rows`, subtitle: '', table: dataTable(formulas, sheet) });
    return parts;
  });

  private readonly byKey = computed(() => new Map(this.parts().map((part) => [part.key, part])));
  partOf(key: string) {
    return this.byKey().get(key) ?? null;
  }

  whole(part: Part): Slice {
    return { key: part.key, from: 0, to: part.kind === 'table' ? part.table.rows.length : 0, first: true, last: true };
  }

  rowsOf(part: Part, slice: Slice) {
    return part.kind === 'table' ? part.table.rows.slice(slice.from, slice.to) : [];
  }

  /** The parts as last measured, for the parts and the way the pages face they were measured at (stale ones wait for the next). */
  private readonly measured = signal<{ parts: Part[]; orientation: A4Orientation; measures: Measured[] } | null>(null);
  readonly pages = computed(() => {
    const taken = this.measured();
    if (!taken || taken.parts !== this.parts() || taken.orientation !== this.orientation()) return null;
    // A couple of px spare, so a row measured at the edge never ends up half cut.
    return paginate(taken.measures, sheetBody(taken.orientation).height - 3, this.gapPx);
  });
  readonly pageCount = computed(() => this.pages()?.length ?? 0);

  private readonly measureEl = viewChild<ElementRef<HTMLElement>>('measureEl');
  private readonly previewBox = viewChild<ElementRef<HTMLElement>>('previewBox');
  private readonly sheetsEl = viewChild<ElementRef<HTMLElement>>('sheetsEl');
  private readonly previewWidth = signal(0);
  /** The preview's pages at the width there is, never bigger than real size. */
  readonly scale = computed(() => (this.previewWidth() ? Math.min(1, Math.max(0.2, (this.previewWidth() - 8) / this.paperPx().width)) : 0));

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const box = this.previewBox()?.nativeElement;
      if (!box) return;
      const observer = new ResizeObserver(([entry]) => this.previewWidth.set(entry.contentRect.width));
      observer.observe(box);
      destroyRef.onDestroy(() => observer.disconnect());
    });
    // Whenever what goes in, or the way the pages face, changes: measured again once it is laid out (the charts take their width first).
    let round = 0;
    effect(() => {
      const parts = this.parts();
      const orientation = this.orientation();
      const mine = ++round;
      setTimeout(() => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (mine !== round) return;
            untracked(() => this.measure(parts, orientation));
          }),
        );
      }, 220);
    });
  }

  private measure(parts: Part[], orientation: A4Orientation) {
    const root = this.measureEl()?.nativeElement;
    if (!root) return;
    const measures = parts.map((part): Measured => {
      const box = root.querySelector<HTMLElement>(`[data-part="${CSS.escape(part.key)}"]`);
      const height = (el: Element | null | undefined) => (el ? el.getBoundingClientRect().height : 0);
      if (part.kind !== 'table' || !box) return { key: part.key, kind: 'whole', height: height(box) };
      return {
        key: part.key,
        kind: 'rows',
        heading: height(box.querySelector('[data-heading]')) + height(box.querySelector('thead')),
        rows: [...box.querySelectorAll('tr[data-row]')].map(height),
        tail: [...box.querySelectorAll('[data-tail]')].reduce((sum, el) => sum + height(el), 0),
      };
    });
    this.measured.set({ parts, orientation, measures });
  }

  private kpiTitle(sheet: SheetWithRows, kpi: Kpi) {
    return kpi.title || autoTitle(visualsOf({ kpis: [kpi], summaries: [] })[0], studioFields(this.formulas(), sheet));
  }

  private summaryTitle(sheet: SheetWithRows, summary: SummaryTable) {
    return summary.title || autoTitle(visualsOf({ kpis: [], summaries: [summary] })[0], studioFields(this.formulas(), sheet));
  }

  /** Each page as a picture of itself, in a PDF saved where the person says. */
  async download() {
    const sheet = this.sheet();
    const root = this.sheetsEl()?.nativeElement;
    if (!sheet || !root || !this.pages() || this.busy()) return;
    const mac = this.store.mac();
    const name = `${sheet.title} report${mac ? ` - ${mac.macCode}` : ''} - ${todayIso()}.pdf`.replace(/[\\/:*?"<>|]/g, '-');
    const path = await this.api.pickSavePath(name, 'PDF document', ['pdf']);
    if (!path) return;
    const orientation = this.orientation();
    this.busy.set('Getting the pages ready…');
    try {
      await document.fonts?.ready;
      const { toCanvas } = await import('html-to-image');
      const sheets = [...root.querySelectorAll<HTMLElement>('[data-sheet]')];
      const options = (el: HTMLElement) => ({ backgroundColor: '#ffffff', pixelRatio: PIXEL_RATIO, width: el.offsetWidth, height: el.offsetHeight, cacheBust: false });
      const restore = inlineSvgStyles(root);
      const pictures: PagePicture[] = [];
      try {
        // Safari's first picture of a page can come out without its images (the logo): one taken and thrown away first.
        if (sheets[0]) await toCanvas(sheets[0], options(sheets[0]));
        for (const [index, el] of sheets.entries()) {
          this.busy.set(`Saving page ${index + 1} of ${sheets.length}…`);
          const canvas = await toCanvas(el, options(el));
          pictures.push({ jpeg: canvas.toDataURL('image/jpeg', 0.92), width: canvas.width, height: canvas.height });
        }
      } finally {
        restore();
      }
      await this.api.writeFile(path, pagesToPdf(pictures, SHEET.paper[orientation]));
      this.toasts.show(`Saved ${baseName(path)}`);
    } catch (error) {
      this.toasts.error(`Couldn't make the PDF: ${errorText(error)}`);
    } finally {
      this.busy.set(null);
    }
  }
}
