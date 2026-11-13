import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

import type { Row, SheetWithRows } from '../core/models';
import { formatFormulaValue, isFormulaError } from '../formula/evaluate-formula';
import { formatPattern } from '../formula/number-format';
import { WorkbookFormulas } from '../formula/sheet-formulas';
import { formatDate, isIsoDate, todayIso } from '../sheet/columns';
import { Icon } from '../components/icon';
import { type AnalysisColumn, batchSourceOf, buildAnalysis } from './analysis-sheet';

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
          </p>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" (click)="setAll(!anyOpen())" title="Open every stage's table, or fold them all away">
          {{ anyOpen() ? 'Collapse all' : 'Expand all' }}
        </button>
        <button type="button" class="btn btn-secondary btn-sm" [attr.aria-pressed]="showFormulas()" (click)="showFormulas.set(!showFormulas())" title="Show each column's formula under its name">
          <app-icon name="table" /> {{ showFormulas() ? 'Hide formulas' : 'Show formulas' }}
        </button>
      </header>
      <div class="jump">
        <span class="jump-label">Show</span>
        <button type="button" class="chip" [class.active]="stage() === null" (click)="pick(null)">All</button>
        @for (name of stages(); track name) {
          <button type="button" class="chip" [class.active]="stage() === name" (click)="pick(name)">{{ name }}</button>
        }
      </div>
      @if (!built().rows.length) {
        <p class="none">No QC records yet — import them from the Google Sheet, or add them in the table.</p>
      } @else {
        <!-- Each stage is a table of its own, one under the other: its checks over the plots (the plot's own columns repeat). -->
        @for (block of blocks(); track block.stage) {
          <section class="stage">
            <h3 class="stage-title">
              <button type="button" class="stage-toggle" [attr.aria-expanded]="block.open" (click)="toggleStage(block.stage)">
                <app-icon name="chevron-down" [size]="16" class="chev" [class.shut]="!block.open" />
                <span class="stage-name">{{ block.stage }}</span>
                <span class="stage-count">{{ block.total }} plot{{ block.total === 1 ? '' : 's' }}</span>
              </button>
            </h3>
            @if (block.open) {
            <div class="table-card scroller">
              <table class="data-table">
                <thead>
                  <tr class="boxes">
                    @for (item of block.spans; track $index) {
                      <th class="group" [attr.colspan]="item.span"><span class="stick">{{ item.label }}</span></th>
                    }
                  </tr>
                  <tr>
                    @for (item of block.columns; track $index) {
                      <th [style.min-width.px]="item.width" [class.left]="item.kind === 'result' || item.kind === 'action'">{{ item.header }}</th>
                    }
                  </tr>
                  @if (showFormulas()) {
                    <tr class="formulas">
                      @for (item of block.columns; track $index) {
                        <th [title]="item.formulaText"><code>{{ item.formulaText || (item.kind === 'identity' || item.kind === 'date' ? 'From the record' : '') }}</code></th>
                      }
                    </tr>
                  }
                </thead>
                <tbody>
                  @for (line of block.lines; track line.id) {
                    <tr>
                      @for (cell of line.cells; track $index) {
                        <td [class.left]="block.columns[$index].kind === 'result' || block.columns[$index].kind === 'action'" [title]="cell.error ?? cell.text">
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
            @if (block.total > preview) {
              <div class="more">
                <span class="more-note">Showing {{ block.lines.length }} of {{ block.total }} plots</span>
                <button type="button" class="btn btn-secondary btn-sm" (click)="toggleRows(block.stage)">
                  {{ block.all ? 'Show fewer' : 'Show all ' + block.total }}
                </button>
              </div>
            }
            }
          </section>
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
    .jump { display: flex; align-items: center; gap: 8px; padding: 8px 20px 12px; overflow-x: auto; scrollbar-width: none; border-bottom: var(--hairline) solid var(--border); }
    .jump-label { font-size: 0.8125rem; font-weight: 500; color: var(--text-muted); white-space: nowrap; }
    .jump .chip { white-space: nowrap; cursor: pointer; font-size: 0.8125rem; }
    .stage { padding: 4px 0 8px; }
    .stage + .stage { border-top: var(--hairline) solid var(--border); }
    .stage-title { margin: 0; padding: 6px 12px 4px; font-size: 0.9375rem; font-weight: 600; }
    .stage-toggle { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px; border: 0; border-radius: var(--radius-sm, 8px); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .stage-toggle:hover { background: var(--surface-hover, rgb(0 0 0 / 0.04)); }
    .stage-name { font-weight: 600; }
    .stage-count { margin-left: auto; font-size: 0.8125rem; font-weight: 400; color: var(--text-muted); }
    .chev { display: inline-flex; transition: transform 0.15s ease; }
    .chev.shut { transform: rotate(-90deg); }
    .more { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 20px 4px; }
    .more-note { font-size: 0.8125rem; color: var(--text-muted); }
    .scroller { background: transparent; overflow-x: auto; }
    .data-table { width: max-content; min-width: 100%; }
    .data-table thead th { background: var(--surface-solid); text-align: center; }
    .data-table thead th.box, .data-table thead th.group { color: var(--text); font-weight: 600; text-align: left !important; }
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

  /** How many plots a stage shows before "Show all". */
  readonly preview = 5;
  /**
   * The stages opened (every stage starts closed, its title only, so the page is a short list to pick from), and the
   * ones showing every plot (the rest show the first few).
   */
  private readonly opened = signal<ReadonlySet<string>>(new Set());
  private readonly everyRow = signal<ReadonlySet<string>>(new Set());
  readonly showFormulas = signal(true);

  readonly built = computed(() => buildAnalysis(this.sheet(), batchSourceOf(this.sheets())));
  private readonly formulas = computed(() => new WorkbookFormulas([...this.sheets(), this.built().sheet], todayIso()));

  readonly stages = computed(() => [...new Set(this.built().columns.map((item) => item.stage).filter(Boolean))]);

  /** The plot's own columns (batch, zone, planting date), which every stage's table starts with. */
  private readonly plotColumns = computed(() => this.built().columns.filter((item) => !item.stage));

  /** A table for each stage in view (all of them, or the one picked), one under the other. */
  readonly blocks = computed(() => {
    const { rows, sheet, columns } = this.built();
    const formulas = this.formulas();
    const picked = this.stage();
    const own = this.plotColumns();
    return this.stages()
      .filter((name) => picked === null || picked === name)
      .map((name) => {
        const shown = [...own, ...columns.filter((item) => item.stage === name)];
        const all = this.everyRow().has(name);
        return {
          stage: name,
          open: this.opened().has(name),
          all,
          total: rows.length,
          columns: shown,
          // The checks named over their columns (the plot's own and the stage's date have none).
          spans: runs(shown.map((item) => item.check)),
          lines: (all ? rows : rows.slice(0, this.preview)).map((row) => ({ id: row.rowId, cells: shown.map((item) => this.cellOf(formulas, sheet, row, item)) })),
        };
      });
  });

  readonly anyOpen = computed(() => this.stages().some((name) => this.opened().has(name)));

  /** One stage on its own from its chip, opened (it is what was asked for); All lists them again as they were. */
  pick(name: string | null) {
    this.stage.set(name);
    if (name !== null) this.opened.update((set) => new Set(set).add(name));
  }

  toggleStage(name: string) {
    this.opened.update((set) => toggled(set, name));
  }

  toggleRows(name: string) {
    this.everyRow.update((set) => toggled(set, name));
  }

  /** Every stage's table opened (showing the first few plots) or folded away. */
  setAll(open: boolean) {
    this.opened.set(open ? new Set(this.stages()) : new Set());
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
