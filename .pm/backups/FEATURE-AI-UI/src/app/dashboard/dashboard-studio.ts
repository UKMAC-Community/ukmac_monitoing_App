import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import { Icon } from '../components/icon';
import { Api, errorText } from '../core/api';
import type { GroupPart, KpiAggregate, SheetWithRows } from '../core/models';
import { Toasts } from '../core/toast';
import { WorkbookStore } from '../core/workbook-store';
import { safeFileName } from '../excel/exceljs';
import type { WorkbookFormulas } from '../formula/sheet-formulas';
import { dashboardOf, summaryResult } from './dashboard-model';
import { SheetDashboard } from './sheet-dashboard';
import { VizPreview } from './viz-preview';
import {
  addField,
  aggregatesFor,
  autoTitle,
  blankVisual,
  boardOf,
  chipLabel,
  COUNT_OF_ROWS,
  holdsManyValues,
  removeField,
  STUDIO_TYPES,
  studioFields,
  usesField,
  visualsOf,
  wellNames,
  type StudioField,
  type StudioType,
  type StudioVisual,
} from './studio-model';
import { buildSummaryWorkbook } from './summary-export';

const FIELD_DRAG = 'application/x-ukmac-field';

/** The table's page keeps this much clear on each side of its dashboard (sheet-page.css: .kpi-panel). */
const PAGE_MARGIN = 20;

/**
 * Edit dashboard, as Power BI's (the system's report studio): the page of
 * visuals on the left — click one to pick it — and on the right the
 * Visualizations pane (its type; Build: its fields in wells, each value a
 * chip saying what it works out; Format: title, decimals, goal) and the
 * Data pane (the table's fields, ticked when the visual uses them).
 * Changes show at once and are saved as they're made.
 *
 * The page is drawn at the width the table's own page gives its dashboard and scaled down to fit
 * beside the panes (as the system's report canvas does), so what's laid out here — how many cards
 * sit in a row, which charts stand side by side — is what the table's page shows, not a narrower
 * rearrangement of it.
 */
@Component({
  selector: 'app-dashboard-studio',
  imports: [Icon, SheetDashboard, VizPreview],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:keydown.escape)': 'hidePreview(true)' },
  template: `
    <div class="stage" (click)="select(null)">
      <div class="stage-bar" (click)="$event.stopPropagation()">
        @if (suggested()) {
          <span class="badge info">Suggested</span>
          <span class="hint">Worked out from this table's columns. Change anything and it's saved as this table's own.</span>
        } @else {
          <span class="hint">{{ saving() ? 'Saving…' : 'Saved. Changes are kept as you make them.' }}</span>
        }
        <span class="grow"></span>
        <div class="zoom" role="group" aria-label="Page size">
          <button type="button" [attr.aria-pressed]="zoom() === 'fit'" (click)="zoom.set('fit')" title="The whole page, scaled to fit">Fit</button>
          <button type="button" [attr.aria-pressed]="zoom() === 'full'" (click)="zoom.set('full')" title="The page at its real size">100%</button>
        </div>
        @if (!suggested()) {
          <button type="button" class="btn btn-plain btn-sm" (click)="reset()"><app-icon name="refresh" /> Back to suggested</button>
        }
        <button type="button" class="btn btn-secondary btn-sm" (click)="exportTables()" [disabled]="!hasTables()"><app-icon name="download" /> Tables to Excel</button>
      </div>
      <div class="stage-scroll" #scroller>
        <div class="frame" [style.width.px]="pageWidth() * scale()" [style.height.px]="pageHeight() * scale()">
          <div class="page" #page [style.width.px]="pageWidth()" [style.transform]="'scale(' + scale() + ')'">
            <app-sheet-dashboard [sheet]="sheet()" [formulas]="formulas()" [board]="board()" [selectable]="true" [selected]="selectedId()" (picked)="select($event)" />
          </div>
        </div>
      </div>
    </div>

    <div class="panes">
      <section class="pane" aria-label="Visualizations">
        <header><h3>Visualizations</h3></header>
        <div class="pane-body">
          <div class="viz-grid" role="toolbar" aria-label="Visual types">
            @for (item of types; track item.type) {
              <button
                type="button"
                [attr.aria-label]="item.label"
                [attr.aria-pressed]="selected()?.type === item.type"
                (click)="pickType(item.type)"
                (pointerenter)="previewEnter($event, item.type)"
                (pointerleave)="hidePreview()"
                (pointerdown)="hidePreview(true)"
                (focus)="previewFocus($event, item.type)"
                (blur)="hidePreview(true)"
              >
                <app-icon [name]="item.icon" [size]="17" />
              </button>
            }
          </div>
          <p class="viz-hint">{{ selected() ? 'Click a type to change the selected visual.' : 'Click a type to add it to the page.' }}</p>

          @if (selected(); as visual) {
            <div class="viz-tabs" role="tablist">
              <button type="button" role="tab" [attr.aria-selected]="tab() === 'build'" (click)="tab.set('build')"><app-icon name="wrench" [size]="13" /> Build</button>
              <button type="button" role="tab" [attr.aria-selected]="tab() === 'format'" (click)="tab.set('format')"><app-icon name="paintbrush" [size]="13" /> Format</button>
            </div>

            @if (tab() === 'build') {
              <div class="wells">
                @if (wells().axis; as axisName) {
                  <div class="well" [class.over]="over() === 'axis'" (dragover)="dragOver($event, 'axis')" (dragleave)="over.set(null)" (drop)="drop($event, 'axis')">
                    <h4>{{ axisName }}</h4>
                    @if (axisField(); as field) {
                      <div class="chip">
                        <span class="chip-label" [title]="field.name">{{ field.name }}</span>
                        <button type="button" title="Remove" aria-label="Remove" (click)="clearAxis()"><app-icon name="x" [size]="12" /></button>
                      </div>
                      @if (field.kind === 'date') {
                        <label class="chip-sub">
                          Its dates by
                          <select (change)="setPart($any($event.target).value)">
                            @for (item of parts; track item.value) {
                              <option [value]="item.value" [selected]="visual.part === item.value">{{ item.label }}</option>
                            }
                          </select>
                        </label>
                      }
                    } @else {
                      <p class="well-placeholder">Add a field here</p>
                    }
                  </div>
                }

                <div class="well" [class.over]="over() === 'values'" (dragover)="dragOver($event, 'values')" (dragleave)="over.set(null)" (drop)="drop($event, 'values')">
                  <h4>{{ wells().values }}</h4>
                  @for (value of visual.values; track $index; let i = $index) {
                    <div class="chip" [class.open]="menu() === i">
                      @if (value.aggregate === 'count' || !value.column) {
                        <span class="chip-label">Count of rows</span>
                      } @else {
                        <button type="button" class="chip-label chip-pick" [attr.aria-expanded]="menu() === i" (click)="toggleMenu(i)">
                          <span>{{ label(value) }}</span>
                          <app-icon name="chevron-down" [size]="12" />
                        </button>
                      }
                      <button type="button" title="Remove" aria-label="Remove" (click)="removeValue(i)"><app-icon name="x" [size]="12" /></button>
                      @if (menu() === i) {
                        <div class="chip-menu" role="menu">
                          @for (item of aggregatesOf(value.column); track item.value) {
                            <button type="button" role="menuitemradio" [attr.aria-checked]="value.aggregate === item.value" (click)="setAggregate(i, item.value)">
                              <span class="tick">@if (value.aggregate === item.value) { <app-icon name="check" [size]="12" /> }</span>
                              {{ item.label }}
                            </button>
                          }
                        </div>
                      }
                    </div>
                  }
                  @if (!visual.values.length || many()) {
                    <p class="well-placeholder">{{ visual.values.length ? 'Add more fields here' : 'Add a field here' }}</p>
                  }
                </div>
              </div>
              <p class="pane-note"><app-icon name="info" [size]="13" /> Tick fields in Data, or drag them into a box. Click a value to change how it's worked out.</p>
            } @else {
              <div class="format">
                <label class="form-group">
                  <span class="format-label">Title</span>
                  <input class="input-field is-sm" [value]="visual.title" [placeholder]="autoTitleOf(visual)" (input)="setTitle($any($event.target).value)" />
                </label>
                <label class="form-group">
                  <span class="format-label">Decimal places</span>
                  <select class="input-field is-sm" (change)="setDecimals($any($event.target).value)">
                    @for (item of decimalChoices; track item.value) {
                      <option [value]="item.value" [selected]="(visual.decimals ?? '') === item.value">{{ item.label }}</option>
                    }
                  </select>
                </label>
                @if (visual.type === 'card' || visual.type === 'gauge') {
                  <label class="form-group">
                    <span class="format-label">{{ visual.type === 'gauge' ? 'Target (the tick on the dial)' : 'Goal' }}</span>
                    <input class="input-field is-sm" type="number" [value]="visual.goal ?? ''" placeholder="None" (input)="setGoal($any($event.target).value)" />
                  </label>
                }
                @if (visual.type === 'card') {
                  <label class="toggle-row">
                    <input type="checkbox" [checked]="visual.higherIsBetter" (change)="setHigherIsBetter($any($event.target).checked)" />
                    Higher is better (green when at or over the goal)
                  </label>
                }
              </div>
            }

            <div class="visual-actions">
              <button type="button" class="icon-btn is-quiet is-sm" [disabled]="!canMove(-1)" (click)="move(-1)" title="Move earlier on the page" aria-label="Move earlier on the page"><app-icon name="arrow-up" [size]="14" /></button>
              <button type="button" class="icon-btn is-quiet is-sm" [disabled]="!canMove(1)" (click)="move(1)" title="Move later on the page" aria-label="Move later on the page"><app-icon name="arrow-down" [size]="14" /></button>
              <span class="grow"></span>
              <button type="button" class="btn btn-plain btn-sm danger-text" (click)="removeVisual()"><app-icon name="trash" /> Remove visual</button>
            </div>
          } @else {
            <p class="pane-note">Click a visual on the page to change it: its type, its fields and how they're worked out, its title.</p>
          }
        </div>
      </section>

      @if (preview(); as shown) {
        <app-viz-preview [type]="shown.type" [anchor]="shown.anchor" />
      }

      <section class="pane" aria-label="Data">
        <header><h3>Data</h3></header>
        <div class="pane-body">
          <label class="pane-search">
            <app-icon name="search" [size]="13" />
            <input type="search" placeholder="Search" [value]="find()" (input)="find.set($any($event.target).value)" />
          </label>
          <div class="tree-head"><app-icon name="table" [size]="14" /><span>{{ sheet().title }}</span></div>
          <ul class="fields">
            @for (field of shownFields(); track field.key) {
              <li>
                <label class="field-item" [class.measure]="field.kind === 'number'" draggable="true" (dragstart)="dragStart($event, field)" [title]="field.name">
                  <input type="checkbox" [checked]="uses(field)" (change)="toggleField(field)" />
                  <app-icon [name]="field.key === '' ? 'hash' : field.kind === 'number' ? 'sum' : field.kind === 'date' ? 'calendar' : 'type'" [size]="13" />
                  <span>{{ field.name }}</span>
                </label>
              </li>
            } @empty {
              <li class="pane-note">No field matches.</li>
            }
          </ul>
        </div>
      </section>
    </div>
  `,
  styles: `
    :host {
      --studio-line: #e2e5e3; --studio-soft: #f7f8f7; --studio-canvas: #eceeec; --studio-ink: #252a27; --studio-muted: #6b7470; --studio-select: var(--accent);
      display: flex; flex: 1; min-height: 0;
    }
    .stage { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .stage-bar { display: flex; align-items: center; gap: 8px; padding: 8px 20px; background: var(--surface-solid); border-bottom: 1px solid var(--studio-line); }
    .hint { min-width: 0; overflow: hidden; font-size: 0.8125rem; color: var(--text-muted); text-overflow: ellipsis; white-space: nowrap; }
    .grow { flex: 1; }
    .stage-scroll { flex: 1; min-height: 0; overflow: auto; padding: 14px 20px 28px; scrollbar-gutter: stable; }
    .frame { position: relative; }
    .page { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
    .zoom { display: inline-flex; padding: 2px; border-radius: 8px; background: var(--fill); }
    .zoom button { padding: 3px 10px; border: 0; border-radius: 6px; background: transparent; color: var(--text-muted); font: inherit; font-size: 0.75rem; font-weight: 600; cursor: pointer; }
    .zoom button[aria-pressed='true'] { background: var(--surface-solid); color: var(--text); box-shadow: 0 1px 2px rgba(16, 24, 21, 0.12); }
    .panes { display: flex; flex-shrink: 0; border-left: 1px solid var(--studio-line); background: var(--studio-soft); }
    .pane { display: flex; flex-direction: column; width: 236px; min-height: 0; border-right: 1px solid var(--studio-line); }
    .pane:last-child { border-right: 0; }
    .pane > header { display: flex; align-items: center; padding: 10px 10px 8px 12px; }
    .pane > header h3 { font-size: 13px; font-weight: 700; color: var(--studio-ink); }
    .pane-body { flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; padding: 0 10px 14px; }
    .pane-note { display: flex; align-items: flex-start; gap: 6px; margin-top: 10px; color: var(--studio-muted); font-size: 11.5px; line-height: 1.4; list-style: none; }
    .pane-note app-icon { margin-top: 1px; }
    .viz-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(32px, 1fr)); gap: 3px; }
    .viz-grid button { display: grid; place-items: center; aspect-ratio: 1; border: 1px solid transparent; border-radius: 7px; background: transparent; color: #3a413d; cursor: pointer; }
    .viz-grid button:hover { background: #fff; border-color: var(--studio-line); }
    .viz-grid button[aria-pressed='true'] { background: var(--accent-soft); border-color: var(--studio-select); color: var(--studio-select); }
    .viz-hint { margin: 6px 0 10px; color: var(--studio-muted); font-size: 11px; }
    .viz-tabs { display: flex; gap: 4px; margin-bottom: 10px; padding: 3px; border-radius: 9px; background: #e8ece9; }
    .viz-tabs button { display: inline-flex; flex: 1; align-items: center; justify-content: center; gap: 5px; padding: 5px; border: 0; border-radius: 7px; background: transparent; color: var(--studio-muted); font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
    .viz-tabs button[aria-selected='true'] { background: #fff; color: var(--studio-ink); box-shadow: 0 1px 2px rgba(16, 24, 21, 0.1); }
    .wells { display: grid; gap: 12px; }
    .well { display: grid; gap: 4px; padding: 2px; border-radius: 8px; }
    .well h4 { color: #3a413d; font-size: 11.5px; font-weight: 700; }
    .well.over { background: var(--accent-soft); outline: 2px dashed var(--studio-select); }
    .well-placeholder { padding: 7px 8px; border: 1px dashed #c7cfcb; border-radius: 7px; background: #fff; color: #9aa39f; font-size: 11.5px; }
    .chip { position: relative; display: flex; align-items: center; gap: 2px; padding: 3px 3px 3px 8px; border: 1px solid #d5dbd8; border-radius: 7px; background: #fff; }
    .chip:hover, .chip.open { border-color: #aab5b0; }
    .chip-label { flex: 1; min-width: 0; overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; color: var(--studio-ink); }
    .chip-pick { display: flex; align-items: center; gap: 4px; padding: 0; border: 0; background: transparent; font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
    .chip-pick span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .chip > button:not(.chip-pick) { display: grid; place-items: center; flex: none; width: 20px; height: 20px; border: 0; border-radius: 5px; background: transparent; color: var(--studio-muted); cursor: pointer; }
    .chip > button:not(.chip-pick):hover { background: #eef1ef; color: var(--studio-ink); }
    .chip-menu { position: absolute; top: calc(100% + 3px); left: 0; right: 0; z-index: 30; display: grid; padding: 4px; border: 1px solid var(--studio-line); border-radius: 9px; background: #fff; box-shadow: 0 10px 30px rgba(16, 24, 21, 0.16); }
    .chip-menu button { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border: 0; border-radius: 6px; background: transparent; font: inherit; font-size: 12px; text-align: left; cursor: pointer; color: var(--studio-ink); }
    .chip-menu button:hover { background: #eef1ef; }
    .chip-menu button[aria-checked='true'] { color: var(--studio-select); font-weight: 600; }
    .tick { display: inline-grid; place-items: center; width: 12px; }
    .chip-sub { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--studio-muted); padding: 2px 2px 0; }
    .chip-sub select { flex: 1; font: inherit; font-size: 12px; padding: 2px 4px; border: 1px solid #d5dbd8; border-radius: 6px; background: #fff; }
    .format { display: grid; gap: 10px; }
    .format .form-group { display: grid; gap: 4px; }
    .format-label { color: #3a413d; font-size: 11.5px; font-weight: 700; }
    .toggle-row { display: flex; align-items: flex-start; gap: 6px; font-size: 12px; color: #3a413d; line-height: 1.4; }
    .toggle-row input { margin-top: 2px; accent-color: var(--studio-select); }
    .visual-actions { display: flex; align-items: center; gap: 2px; margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--studio-line); }
    .pane-search { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 6px; margin-bottom: 8px; padding: 6px 9px; border: 1px solid #d5dbd8; border-radius: 8px; background: #fff; color: var(--studio-muted); }
    .pane-search input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; font: inherit; font-size: 12.5px; }
    .tree-head { display: flex; align-items: center; gap: 6px; padding: 5px 4px; color: var(--studio-ink); font-size: 12.5px; font-weight: 600; }
    .tree-head span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fields { display: grid; grid-template-columns: minmax(0, 1fr); margin: 1px 0 4px 10px; padding: 0; list-style: none; }
    .field-item { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 3px 5px; border-radius: 5px; color: #3a413d; font-size: 12.5px; cursor: grab; user-select: none; }
    .field-item:hover { background: #e9ecea; }
    .field-item:active { cursor: grabbing; }
    .field-item input { accent-color: var(--studio-select); cursor: pointer; margin: 0; }
    .field-item app-icon { flex-shrink: 0; color: var(--studio-muted); }
    .field-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .field-item.measure { color: #0b5f59; font-weight: 550; }
    .field-item.measure app-icon { color: var(--studio-select); }
  `,
})
export class DashboardStudio implements OnDestroy {
  private readonly store = inject(WorkbookStore);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly destroyRef = inject(DestroyRef);

  readonly sheet = input.required<SheetWithRows>();
  readonly formulas = input.required<WorkbookFormulas>();

  readonly types = STUDIO_TYPES;
  readonly parts: { value: GroupPart; label: string }[] = [
    { value: 'month', label: 'Month' },
    { value: 'year', label: 'Year' },
    { value: 'value', label: 'Day' },
  ];
  readonly decimalChoices = [
    { value: '', label: 'As it is (up to 2)' },
    { value: 0, label: '0' },
    { value: 1, label: '1' },
    { value: 2, label: '2' },
    { value: 3, label: '3' },
  ];

  /** The page's visuals as they're edited (what's drawn); saved a moment after each change. */
  readonly visuals = signal<StudioVisual[]>([]);
  readonly suggested = signal(false);
  readonly saving = signal(false);
  readonly selectedId = signal<string | null>(null);
  readonly tab = signal<'build' | 'format'>('build');
  readonly find = signal('');
  /** The value chip whose menu is open. */
  readonly menu = signal<number | null>(null);
  readonly over = signal<'axis' | 'values' | null>(null);

  /** Fit: the whole page scaled into the space beside the panes; 100%: its real size, scrolled. */
  readonly zoom = signal<'fit' | 'full'>('fit');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  private readonly page = viewChild.required<ElementRef<HTMLElement>>('page');
  private readonly hostWidth = signal(0);
  private readonly stageWidth = signal(0);
  /** The page's own height, before it's scaled. */
  readonly pageHeight = signal(0);
  /** The width the table's page gives its dashboard: the whole window's, less its margins. */
  readonly pageWidth = computed(() => Math.max(640, this.hostWidth() - PAGE_MARGIN * 2));
  readonly scale = computed(() => {
    const room = this.stageWidth();
    if (this.zoom() === 'full' || !room || !this.hostWidth()) return 1;
    return Math.min(1, room / this.pageWidth());
  });

  /** The type whose animated preview shows, and where (the grid of types across, its button's row down). */
  readonly preview = signal<{ type: StudioType; anchor: DOMRect } | null>(null);
  private previewTimer: ReturnType<typeof setTimeout> | null = null;

  private loadedFor: number | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  readonly board = computed(() => boardOf(this.visuals()));
  readonly selected = computed(() => this.visuals().find((visual) => visual.id === this.selectedId()) ?? null);
  readonly fields = computed(() => studioFields(this.formulas(), this.sheet()));
  readonly shownFields = computed(() => {
    const words = this.find().trim().toLowerCase();
    const all = [COUNT_OF_ROWS, ...this.fields()];
    return words ? all.filter((field) => field.name.toLowerCase().includes(words)) : all;
  });
  readonly wells = computed(() => wellNames(this.selected()?.type ?? 'card'));
  readonly many = computed(() => holdsManyValues(this.selected()?.type ?? 'card'));
  readonly axisField = computed(() => {
    const key = this.selected()?.axis;
    return key ? (this.fields().find((field) => field.key === key) ?? null) : null;
  });
  readonly hasTables = computed(() => this.visuals().some((visual) => visual.type === 'table' && visual.axis));

  constructor() {
    // The three widths that decide the scale, kept as they change.
    afterNextRender(() => {
      const watch = (element: HTMLElement, set: (width: number, height: number) => void) => {
        const observer = new ResizeObserver(([entry]) => set(entry.contentRect.width, entry.contentRect.height));
        observer.observe(element);
        return observer;
      };
      const observers = [
        watch(this.host.nativeElement, (width) => this.hostWidth.set(Math.floor(width))),
        watch(this.scroller().nativeElement, (width) => this.stageWidth.set(Math.floor(width))),
        watch(this.page().nativeElement, (_, height) => this.pageHeight.set(Math.ceil(height))),
      ];
      this.destroyRef.onDestroy(() => observers.forEach((observer) => observer.disconnect()));
    });

    // The table's board, once as it opens (its own saves don't reset what's being edited).
    effect(() => {
      const sheet = this.sheet();
      if (this.loadedFor === sheet.sheetId) return;
      this.loadedFor = sheet.sheetId;
      const { dashboard, suggested } = dashboardOf(sheet);
      untracked(() => {
        this.visuals.set(visualsOf(dashboard));
        this.suggested.set(suggested);
        this.selectedId.set(null);
      });
    });
  }

  ngOnDestroy() {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    // Done (or leaving) saves what's still waiting.
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      void this.persist();
    }
  }

  // ------------------------------------------------- the types' animated preview

  /** Hover this long before a preview shows (not every button the pointer crosses on its way); once one shows, the next shows at once. */
  previewEnter(event: PointerEvent, type: StudioType) {
    if (event.pointerType === 'touch') return;
    this.showPreview(type, event.currentTarget as HTMLElement, this.preview() !== null);
  }

  /** Reached by keyboard: at once. */
  previewFocus(event: FocusEvent, type: StudioType) {
    const button = event.currentTarget as HTMLElement;
    if (button.matches(':focus-visible')) this.showPreview(type, button, true);
  }

  private showPreview(type: StudioType, button: HTMLElement, now: boolean) {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    const open = () => {
      const box = button.getBoundingClientRect();
      const grid = button.parentElement?.getBoundingClientRect() ?? box;
      this.preview.set({ type, anchor: new DOMRect(grid.x, box.y, grid.width, box.height) });
    };
    if (now) open();
    else this.previewTimer = setTimeout(open, 300);
  }

  /** Leaving a button hides it a moment later (the pointer is between two buttons); picking, Escape: at once. */
  hidePreview(now = false) {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    if (now) this.preview.set(null);
    else this.previewTimer = setTimeout(() => this.preview.set(null), 120);
  }

  select(id: string | null) {
    this.menu.set(null);
    if (id !== this.selectedId()) this.tab.set('build');
    this.selectedId.set(id);
  }

  label(value: StudioVisual['values'][number]) {
    return chipLabel(value, this.fields());
  }

  autoTitleOf(visual: StudioVisual) {
    return autoTitle(visual, this.fields());
  }

  aggregatesOf(key: string) {
    return aggregatesFor(this.fields().find((field) => field.key === key)?.kind ?? 'text');
  }

  uses(field: StudioField) {
    const visual = this.selected();
    return !!visual && usesField(visual, field.key);
  }

  canMove(by: number) {
    const list = this.visuals();
    const index = list.findIndex((visual) => visual.id === this.selectedId());
    if (index < 0) return false;
    const target = this.neighbour(list, index, by);
    return target >= 0;
  }

  // ------------------------------------------------------------ changes

  pickType(type: StudioType) {
    const visual = this.selected();
    if (visual) {
      this.change((current) => ({ ...current, type, values: holdsManyValues(type) ? current.values : current.values.slice(0, 1) }));
      return;
    }
    const added = blankVisual(type);
    added.title = autoTitle(added, this.fields());
    this.visuals.update((list) => [...list, added]);
    this.select(added.id);
    this.changed();
  }

  /** A field ticked or unticked in Data; with nothing picked, a new visual for it (a card for a number, else a column chart). */
  toggleField(field: StudioField) {
    const visual = this.selected();
    if (!visual) {
      const added = blankVisual(field.kind === 'number' ? 'card' : 'column');
      const filled = addField(added, field);
      filled.title = autoTitle(filled, this.fields());
      this.visuals.update((list) => [...list, filled]);
      this.select(filled.id);
      this.changed();
      return;
    }
    this.change((current) => (usesField(current, field.key) ? removeField(current, field.key) : addField(current, field)));
  }

  clearAxis() {
    this.change((current) => ({ ...current, axis: '' }));
  }

  setPart(part: GroupPart) {
    this.change((current) => ({ ...current, part }));
  }

  toggleMenu(index: number) {
    this.menu.set(this.menu() === index ? null : index);
  }

  setAggregate(index: number, aggregate: KpiAggregate) {
    this.menu.set(null);
    // Its own name (as "Seedlings") no longer fits once it works out something else.
    this.change((current) => ({ ...current, values: current.values.map((value, at) => (at === index ? { column: value.column, aggregate } : value)) }));
  }

  removeValue(index: number) {
    this.menu.set(null);
    this.change((current) => ({ ...current, values: current.values.filter((_, at) => at !== index) }));
  }

  setTitle(title: string) {
    this.change((current) => ({ ...current, title }), false);
  }

  setDecimals(value: string) {
    this.change((current) => ({ ...current, decimals: value === '' ? null : Number(value) }), false);
  }

  setGoal(value: string) {
    const goal = value.trim() === '' ? null : Number(value);
    this.change((current) => ({ ...current, goal: goal !== null && Number.isFinite(goal) ? goal : null }), false);
  }

  setHigherIsBetter(higherIsBetter: boolean) {
    this.change((current) => ({ ...current, higherIsBetter }), false);
  }

  move(by: number) {
    const list = [...this.visuals()];
    const index = list.findIndex((visual) => visual.id === this.selectedId());
    const target = this.neighbour(list, index, by);
    if (index < 0 || target < 0) return;
    [list[index], list[target]] = [list[target], list[index]];
    this.visuals.set(list);
    this.changed();
  }

  removeVisual() {
    const id = this.selectedId();
    this.visuals.update((list) => list.filter((visual) => visual.id !== id));
    this.select(null);
    this.changed();
  }

  async reset() {
    this.cancelSave();
    try {
      await this.store.saveDashboard(this.sheet().sheetId, null);
      this.visuals.set(visualsOf(dashboardOf({ ...this.sheet(), dashboard: null }).dashboard));
      this.suggested.set(true);
      this.select(null);
      this.toasts.show('Back to the suggested dashboard');
    } catch (error) {
      this.toasts.error(errorText(error));
    }
  }

  async exportTables() {
    const sheet = this.sheet();
    const mac = this.store.mac();
    const path = await this.api.pickSavePath(`${safeFileName(sheet.title)} summaries${mac ? ` - ${safeFileName(mac.macCode)}` : ''}.xlsx`);
    if (!path) return;
    try {
      const results = this.board()
        .summaries.map((summary) => ({ title: summary.title, result: summaryResult(this.formulas(), sheet, summary) }))
        .filter((item): item is { title: string; result: NonNullable<typeof item.result> } => !!item.result);
      await this.api.writeFile(path, await buildSummaryWorkbook(sheet.title, results));
      this.toasts.show(`Saved ${path.split('/').pop()}`);
    } catch (error) {
      this.toasts.error(errorText(error));
    }
  }

  // ------------------------------------------------------------ drag a field into a well

  dragStart(event: DragEvent, field: StudioField) {
    event.dataTransfer?.setData(FIELD_DRAG, field.key);
    event.dataTransfer?.setData('text/plain', field.name);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
  }

  dragOver(event: DragEvent, well: 'axis' | 'values') {
    if (!event.dataTransfer?.types.includes(FIELD_DRAG)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    this.over.set(well);
  }

  drop(event: DragEvent, well: 'axis' | 'values') {
    this.over.set(null);
    const key = event.dataTransfer?.getData(FIELD_DRAG);
    if (key === undefined) return;
    event.preventDefault();
    const field = key === '' ? COUNT_OF_ROWS : this.fields().find((item) => item.key === key);
    if (!field) return;
    this.change((current) => addField(current, field, field.key === '' ? 'values' : well));
  }

  // ------------------------------------------------------------ inner workings

  /** The selected visual changed; its title follows its fields while it's still the worked-out one. */
  private change(update: (visual: StudioVisual) => StudioVisual, retitle = true) {
    const id = this.selectedId();
    const fields = this.fields();
    this.visuals.update((list) =>
      list.map((visual) => {
        if (visual.id !== id) return visual;
        const next = update(visual);
        if (retitle && (!visual.title || visual.title === autoTitle(visual, fields))) next.title = autoTitle(next, fields);
        return next;
      }),
    );
    this.changed();
  }

  /** The next visual of the same kind (cards with cards, charts with charts, tables with tables), as the page shows them. */
  private neighbour(list: readonly StudioVisual[], index: number, by: number) {
    if (index < 0) return -1;
    const kind = (visual: StudioVisual) => (visual.type === 'card' ? 'card' : visual.type === 'table' ? 'table' : 'chart');
    const mine = kind(list[index]);
    for (let at = index + by; at >= 0 && at < list.length; at += by) if (kind(list[at]) === mine) return at;
    return -1;
  }

  private changed() {
    this.suggested.set(false);
    this.cancelSave();
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.persist();
    }, 500);
  }

  private cancelSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
  }

  private async persist() {
    this.saving.set(true);
    try {
      await this.store.saveDashboard(this.sheet().sheetId, this.board());
    } catch (error) {
      this.toasts.error(errorText(error));
    } finally {
      this.saving.set(false);
    }
  }
}
