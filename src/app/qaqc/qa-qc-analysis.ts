import { ChangeDetectionStrategy, Component, computed, effect, input, signal, untracked } from '@angular/core';

import type { Row, SheetWithRows } from '../core/models';
import { formatFormulaValue, isFormulaError } from '../formula/evaluate-formula';
import { formatPattern } from '../formula/number-format';
import { WorkbookFormulas } from '../formula/sheet-formulas';
import { formatDate, isIsoDate, todayIso } from '../sheet/columns';
import { Icon } from '../components/icon';
import { type AnalysisColumn, batchSourceOf, buildAnalysis } from './analysis-sheet';
import { stageSummaries } from './stage-summary';

interface Span {
  label: string;
  span: number;
}

interface Cell {
  text: string;
  /** A Status: its word, for the pill. */
  status: 'green' | 'yellow' | 'red' | null;
  /** A formula that went wrong: why. */
  error: string | null;
}

/**
 * The QA/QC Analysis, as the web system's Analysis tab: a row for each zone plot (its latest QC record) and, stage by
 * stage, each check against the growth standard — Value, Status (GREEN / YELLOW / RED), Actual Result and the standard's
 * Corrective Action — every one a formula over the records, shown on the 4th header row as the web shows it. Worked out
 * again whenever a record changes; nothing of it is saved.
 */
@Component({
  selector: 'app-qa-qc-analysis',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card analysis">
      <header class="head">
        <div class="title">
          <h2>QA/QC Analysis</h2>
          <p>
            Each zone plot's latest QC record against the growth standard · {{ built().rows.length }} plot{{ built().rows.length === 1 ? '' : 's' }}
            @if (summaries().redPlots) {
              · <b class="need">{{ summaries().redPlots }} with a red check</b>
            }
          </p>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" [attr.aria-pressed]="showFormulas()" (click)="showFormulas.set(!showFormulas())" title="Show each column's formula under its name">
          <app-icon name="table" /> {{ showFormulas() ? 'Hide formulas' : 'Show formulas' }}
        </button>
      </header>
      <div class="bar">
        <div class="jump">
          <span class="jump-label">Show</span>
          <button type="button" class="chip" [class.active]="stage() === null" (click)="pick(null)">All</button>
          @for (chip of chips(); track chip.name) {
            <button type="button" class="chip" [class.active]="stage() === chip.name" [title]="chip.title" (click)="pick(chip.name)">{{ chip.name }} <small>{{ chip.read }}</small></button>
          }
        </div>
        <div class="folds">
          <button type="button" class="btn btn-plain btn-sm" [disabled]="!anyOpen()" title="Fold every stage to its first column" (click)="setAll(false)">
            <app-icon name="circle-minus" [size]="14" /> Fold all
          </button>
          <button type="button" class="btn btn-plain btn-sm" [disabled]="allOpen()" title="Open every stage" (click)="setAll(true)">
            <app-icon name="circle-plus" [size]="14" /> Open all
          </button>
        </div>
      </div>
      @if (!built().rows.length) {
        <p class="none">No QC records yet — import them from the Google Sheet, or add them in the table.</p>
      } @else {
        <!-- One table, as the web's: a row for each plot, each stage a group of columns that folds to its first. -->
        <div class="table-card scroller">
          <table class="data-table">
            <thead>
              <tr class="boxes">
                @for (item of view().groups; track $index) {
                  <th class="group" [class.edge]="item.stage" [class.is-folded]="item.stage && !item.open" [attr.colspan]="item.span">
                    @if (item.stage) {
                      <button type="button" class="fold" [attr.aria-expanded]="item.open" [title]="item.open ? 'Fold the stage to its first column' : 'Open the stage'" (click)="toggleStage(item.stage)">
                        <app-icon [name]="item.open ? 'circle-minus' : 'circle-plus'" [size]="14" />
                        <span class="fold-label">{{ item.stage }}</span>
                      </button>
                    }
                  </th>
                }
              </tr>
              <tr class="boxes">
                @for (item of view().checks; track $index) {
                  <th class="group" [class.edge]="item.edge" [attr.colspan]="item.span"><span class="stick">{{ item.label }}</span></th>
                }
              </tr>
              <tr>
                @for (item of view().columns; track $index) {
                  <th [class.edge]="item.edge" [style.min-width.px]="item.col.width" [class.left]="item.col.kind === 'result' || item.col.kind === 'action'">{{ item.col.header }}</th>
                }
              </tr>
              @if (showFormulas()) {
                <tr class="formulas">
                  @for (item of view().columns; track $index) {
                    <th [class.edge]="item.edge" [title]="item.col.formulaText"><code>{{ item.col.formulaText || (item.col.kind === 'identity' || item.col.kind === 'date' ? 'From the record' : '') }}</code></th>
                  }
                </tr>
              }
            </thead>
            <tbody>
              @for (line of view().lines; track line.id) {
                <tr>
                  @for (cell of line.cells; track $index) {
                    <td [class.edge]="view().columns[$index].edge" [class.left]="view().columns[$index].col.kind === 'result' || view().columns[$index].col.kind === 'action'" [title]="cell.error ?? cell.text">
                      @if (cell.status) {
                        <span class="pill" [class]="'pill ' + cell.status">{{ cell.text }}</span>
                      } @else {
                        {{ cell.text }}
                      }
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (view().total > preview) {
          <div class="more">
            <span class="more-note">Showing {{ view().lines.length }} of {{ view().total }} plots</span>
            <button type="button" class="btn btn-secondary btn-sm" (click)="allRows.set(!allRows())">
              {{ allRows() ? 'Show fewer' : 'Show all ' + view().total }}
            </button>
          </div>
        }
      }
      @if (built().skipped.length) {
        <p class="foot">Left empty — the table has no column for what these read: {{ built().skipped.join(', ') }}.</p>
      }
      <p class="foot">
        A baseline compares a plot with the average of its nursery batch's records (the batch from Plant Progress). The sheet keeps each plant's own reading, so a plant average here is the average of the
        plants, the yield a plant the sum of the harvest rounds, and the pest and disease totals the sum of the weeks.
      </p>
    </section>
  `,
  styles: `
    :host { display: block; }
    .analysis { padding: 0; overflow: hidden; }
    .head { display: flex; align-items: center; gap: 12px; padding: 16px 20px 8px; }
    .title { flex: 1; min-width: 0; }
    .title h2 { margin: 0; font-size: 1.0625rem; }
    .title p { margin: 2px 0 0; color: var(--text-muted); font-size: 0.8125rem; }
    .bar { display: flex; align-items: center; gap: 12px; padding: 0 20px; border-bottom: var(--hairline) solid var(--border); }
    .jump { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 8px 0 12px; overflow-x: auto; scrollbar-width: none; }
    .jump-label { font-size: 0.8125rem; font-weight: 500; color: var(--text-muted); white-space: nowrap; }
    .jump .chip { white-space: nowrap; cursor: pointer; font-size: 0.8125rem; }
    .jump .chip small { color: var(--text-muted); font-size: 0.6875rem; margin-left: 4px; font-variant-numeric: tabular-nums; }
    .folds { flex: none; display: flex; gap: 2px; }
    .fold { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 2px 8px; border: 0; border-radius: var(--radius-sm); background: none; color: inherit; font: inherit; font-weight: 600; cursor: pointer; }
    .fold:hover { background: var(--surface-hover); }
    .fold app-icon { flex: none; color: var(--text-muted); }
    .fold-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .need { color: var(--danger); font-weight: 600; }
    .data-table th.is-folded { min-width: 130px; }
    .data-table .edge { border-left: var(--hairline) solid var(--border); }
    .more { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 20px 4px; }
    .more-note { font-size: 0.8125rem; color: var(--text-muted); }
    .scroller { background: transparent; overflow-x: auto; }
    .data-table { width: max-content; min-width: 100%; }
    .data-table thead th { background: var(--surface-solid); text-align: center; }
    .data-table thead th.box, .data-table thead th.group { color: var(--text); font-weight: 600; text-align: center; }
    .data-table th.left, .data-table td.left { text-align: left; }
    .data-table td { text-align: center; max-width: 320px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
    .data-table tr.formulas th { font-weight: 400; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .data-table tr.formulas code { font-size: 0.6875rem; color: var(--text-muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .pill { display: inline-block; min-width: 64px; padding: 2px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; letter-spacing: 0.02em; }
    .pill.green { background: var(--success-soft); color: var(--success); }
    .pill.yellow { background: var(--warning-soft); color: var(--warning); }
    .pill.red { background: var(--danger-soft); color: var(--danger); }
    .none { padding: 28px 20px; text-align: center; color: var(--text-muted); font-size: 0.875rem; }
    .foot { margin: 0; padding: 10px 20px 14px; color: var(--text-muted); font-size: 0.75rem; line-height: 1.5; }
  `,
})
export class QaQcAnalysis {
  /** The QA/QC table, and the MAC's tables (Plant Progress gives each plot's batch). */
  readonly sheet = input.required<SheetWithRows>();
  readonly sheets = input.required<readonly SheetWithRows[]>();

  readonly stage = signal<string | null>(null);

  /** How many plots show before "Show all". */
  readonly preview = 10;
  readonly allRows = signal(false);
  /**
   * The stages opened (the rest fold to their first column; the first stage starts open until the person chooses),
   * remembered for the table between pages and launches.
   */
  private readonly opened = signal<ReadonlySet<string> | null>(null);
  /** Each stage's standing over the plots (red / yellow / green / no reading), and the plots needing action. */
  readonly summaries = computed(() => stageSummaries(this.built(), this.formulas()));
  readonly showFormulas = signal(true);

  constructor() {
    effect(() => {
      const id = this.sheet().sheetId;
      untracked(() => this.opened.set(readOpened(id)));
    });
  }

  readonly built = computed(() => buildAnalysis(this.sheet(), batchSourceOf(this.sheets())));
  private readonly formulas = computed(() => new WorkbookFormulas([...this.sheets(), this.built().sheet], todayIso()));

  readonly stages = computed(() => [...new Set(this.built().columns.map((item) => item.stage).filter(Boolean))]);

  /** The plot's own columns (batch, zone, planting date), which the table starts with. */
  private readonly plotColumns = computed(() => this.built().columns.filter((item) => !item.stage));

  private readonly openSet = computed(() => this.opened() ?? new Set(this.stages().slice(0, 1)));

  /** A chip for each stage: how many plots have a reading in it. */
  readonly chips = computed(() => {
    const stages = this.summaries().stages;
    return this.stages().map((name) => {
      const sum = stages.get(name);
      return {
        name,
        read: sum ? sum.red + sum.yellow + sum.green : 0,
        title: sum ? `${sum.red} red · ${sum.yellow} yellow · ${sum.green} green · ${sum.none} with no reading` : '',
      };
    });
  });

  /** The one table: the plot's columns, then each stage in view (all its columns when open, its first when folded). */
  readonly view = computed(() => {
    const { rows, sheet, columns } = this.built();
    const formulas = this.formulas();
    const picked = this.stage();
    const open = this.openSet();
    const segments = [
      { stage: '', open: true, cols: this.plotColumns() },
      ...this.stages()
        .filter((name) => picked === null || picked === name)
        .map((name) => {
          const all = columns.filter((item) => item.stage === name);
          const isOpen = picked === name || open.has(name);
          return { stage: name, open: isOpen, cols: isOpen ? all : all.slice(0, 1) };
        }),
    ];
    const shown = segments.flatMap((seg) => seg.cols.map((col, index) => ({ col, edge: seg.stage !== '' && index === 0 })));
    const groups = segments.map((seg) => ({ stage: seg.stage, open: seg.open, span: seg.cols.length }));
    // The checks named over their columns (the plot's own and the stage's date have none), within each stage.
    const checks = segments.flatMap((seg) => runs(seg.cols.map((item) => item.check)).map((run, index) => ({ ...run, edge: seg.stage !== '' && index === 0 })));
    // With one stage picked, its plots needing action come first; else the table's order.
    const order = picked ? this.summaries().stages.get(picked)?.order : undefined;
    const byId = new Map(rows.map((row) => [row.rowId, row]));
    const ordered = order ? order.flatMap((id) => byId.get(id) ?? []) : rows;
    const lines = (this.allRows() ? ordered : ordered.slice(0, this.preview)).map((row) => ({ id: row.rowId, cells: shown.map((item) => this.cellOf(formulas, sheet, row, item.col)) }));
    return { groups, checks, columns: shown, lines, total: rows.length };
  });

  readonly anyOpen = computed(() => this.stages().some((name) => this.openSet().has(name)));
  readonly allOpen = computed(() => this.stages().every((name) => this.openSet().has(name)));

  /** One stage on its own from its chip, opened (it is what was asked for); All lists them again as they were. */
  pick(name: string | null) {
    this.stage.set(name);
    if (name !== null) {
      this.opened.set(new Set(this.openSet()).add(name));
      this.remember();
    }
  }

  toggleStage(name: string) {
    this.opened.set(toggled(this.openSet(), name));
    this.remember();
  }

  /** Every stage opened or folded to its first column. */
  setAll(open: boolean) {
    this.opened.set(open ? new Set(this.stages()) : new Set());
    this.remember();
  }

  private remember() {
    try {
      localStorage.setItem(openedKey(this.sheet().sheetId), JSON.stringify([...(this.opened() ?? [])]));
    } catch {
      /* kept for this run only */
    }
  }

  private cellOf(formulas: WorkbookFormulas, sheet: SheetWithRows, row: Row, item: AnalysisColumn): Cell {
    const value = formulas.cell(sheet, row, item.column);
    if (isFormulaError(value)) return { text: value.code, status: null, error: value.reason };
    let text = formatFormulaValue(value);
    if (typeof value === 'number' && item.format) text = formatPattern(value, item.format);
    else if (typeof value === 'string' && isIsoDate(value.slice(0, 10)) && (item.kind === 'date' || item.kind === 'identity')) text = formatDate(value.slice(0, 10));
    const word = text.toUpperCase();
    const status = item.kind === 'status' ? (word === 'GREEN' ? 'green' : word === 'YELLOW' ? 'yellow' : word === 'RED' ? 'red' : null) : null;
    return { text, status, error: null };
  }
}

const openedKey = (sheetId: number) => `ukmac.qaqc-open.${sheetId}`;

/** The stages left open for a table, as last saved. */
function readOpened(sheetId: number): ReadonlySet<string> | null {
  try {
    const raw = localStorage.getItem(openedKey(sheetId));
    if (raw === null) return null;
    const saved = JSON.parse(raw);
    return new Set(Array.isArray(saved) ? saved.filter((name): name is string => typeof name === 'string') : []);
  } catch {
    return null;
  }
}

function toggled(set: ReadonlySet<string>, name: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(name)) next.add(name);
  return next;
}

/** Consecutive equal labels as one header cell each (a blank one stays blank). */
function runs(labels: string[]): Span[] {
  const spans: Span[] = [];
  for (const label of labels) {
    const last = spans.at(-1);
    if (last && last.label === label && label !== '') last.span += 1;
    else spans.push({ label, span: 1 });
  }
  return spans;
}
