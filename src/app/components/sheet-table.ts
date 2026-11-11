import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, input, output, signal, untracked, viewChild } from '@angular/core';

import type { Column, Row, SheetWithRows } from '../core/models';
import { formatFormulaValue, isFormulaError } from '../formula/evaluate-formula';
import type { WorkbookFormulas } from '../formula/sheet-formulas';
import { alignsRight, columnLabel, displayCell, formatDate, isIsoDate } from '../sheet/columns';
import { Icon } from './icon';
import { Pager, pageSlice, savedPageSize } from './pager';

interface Span {
  /** What folds: a box's or a group's name (with the box it sits in). */
  id: string;
  label: string;
  /** The columns shown under it (a folded one shows its first). */
  span: number;
  /** Its first column's position among all the table's columns. */
  start: number;
  /** All its columns, folded or not. */
  total: number;
  folded: boolean;
  /** Named, with more than one column, and not inside a folded box: there is something to fold. */
  foldable: boolean;
}

/**
 * A table's rows to read, as the system shows them: a plain table, its column boxes over the names.
 * A box or a group folds to its first column (its name stays over it) with the ⊖ on its header, and
 * opens again with the ⊕, as the system's sheet does; what's folded is kept for the table.
 */
@Component({
  selector: 'app-sheet-table',
  imports: [Icon, Pager],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (stageChips().length >= 3 || foldables().length) {
      <div class="bar">
        @if (stageChips().length >= 3) {
          <div class="jump">
            <span class="jump-label">Show</span>
            <button type="button" class="chip" [class.active]="stage() === null" (click)="show(null)">All</button>
            @for (chip of stageChips(); track chip.label) {
              <button type="button" class="chip" [class.active]="stage() === chip.label" (click)="show(chip.label)">{{ stageName(chip.label) }} <small>{{ chip.total }}</small></button>
            }
          </div>
        } @else {
          <span class="grow"></span>
        }
        @if (foldables().length) {
          <div class="folds">
            <button type="button" class="btn btn-plain btn-sm" [disabled]="allFolded()" title="Fold every group to its first column" (click)="foldAll()">
              <app-icon name="circle-minus" [size]="14" /> Fold all
            </button>
            <button type="button" class="btn btn-plain btn-sm" [disabled]="!folded().size" title="Open every group" (click)="openAll()">
              <app-icon name="circle-plus" [size]="14" /> Open all
            </button>
          </div>
        }
      </div>
    }
    <div class="table-card scroller" #scroller>
      <table class="data-table">
        <thead>
          @if (showBoxes()) {
            <tr class="boxes">
              @for (box of boxSpans(); track box.id) {
                <th [attr.colspan]="box.span" [attr.data-start]="box.start" class="box" [class.is-folded]="box.folded">
                  @if (box.foldable) {
                    <button type="button" class="fold" [attr.aria-expanded]="!box.folded" [title]="box.folded ? 'Open the group' : 'Fold the group to its first column'" (click)="toggle(box.id)">
                      <app-icon [name]="box.folded ? 'circle-plus' : 'circle-minus'" [size]="14" />
                      <span class="fold-label">{{ stageName(box.label) }}</span>
                    </button>
                  } @else {
                    {{ stageName(box.label) }}
                  }
                </th>
              }
            </tr>
          }
          @if (showGroups()) {
            <tr class="boxes">
              @for (group of groupSpans(); track group.id) {
                <th [attr.colspan]="group.span" class="group" [class.is-folded]="group.folded">
                  @if (group.foldable) {
                    <button type="button" class="fold" [attr.aria-expanded]="!group.folded" [title]="group.folded ? 'Open the group' : 'Fold the group to its first column'" (click)="toggle(group.id)">
                      <app-icon [name]="group.folded ? 'circle-plus' : 'circle-minus'" [size]="14" />
                      <span class="fold-label">{{ group.label }}</span>
                    </button>
                  } @else {
                    {{ group.label }}
                  }
                </th>
              }
            </tr>
          }
          <tr>
            @for (item of visible(); track item.column.key) {
              <th [class.num]="right(item.column)">
                <button type="button" class="sort-btn" [class.is-active]="sort()?.key === item.column.key" (click)="sortBy.emit(item.column.key)">
                  {{ label(item.column) }}
                  @if (sort()?.key === item.column.key) {
                    <app-icon [name]="sort()!.dir === 1 ? 'arrow-up' : 'arrow-down'" [size]="12" />
                  }
                </button>
              </th>
            }
          </tr>
        </thead>
        <tbody>
          @for (row of shown(); track row.rowId) {
            <tr>
              @for (item of visible(); track item.column.key) {
                <td [class.num]="right(item.column)" [title]="text(row, item.column)">{{ text(row, item.column) }}</td>
              }
            </tr>
          }
        </tbody>
      </table>
      @if (!rows().length) {
        <p class="none">{{ searching() ? 'No rows match the search.' : 'No rows yet — import an Excel file, or open the sheet and type them in.' }}</p>
      }
    </div>
    <app-pager [always]="true" [total]="rows().length" [(page)]="page" [(size)]="pageSize" (moved)="toTop()" />
  `,
  styles: `
    :host { display: block; }
    .bar { display: flex; align-items: center; gap: 12px; padding: 0 20px; border-bottom: var(--hairline) solid var(--border); }
    .grow { flex: 1; }
    .jump { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 12px 0; overflow-x: auto; scrollbar-width: none; }
    .folds { flex: none; display: flex; gap: 2px; }
    .fold { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 2px 8px; border: 0; border-radius: var(--radius-sm); background: none; color: inherit; font: inherit; font-weight: 600; cursor: pointer; }
    .fold:hover { background: var(--surface-hover); }
    .fold app-icon { flex: none; color: var(--text-muted); }
    .fold-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .data-table th.is-folded { min-width: 130px; }
    .jump .chip small { color: var(--text-muted); font-size: 0.6875rem; margin-left: 4px; font-variant-numeric: tabular-nums; }
    .jump-label { font-size: 0.8125rem; font-weight: 500; color: var(--text-muted); white-space: nowrap; }
    .jump .chip { white-space: nowrap; cursor: pointer; font-size: 0.8125rem; }
    .scroller { background: transparent; max-height: 70vh; overflow: auto; }
    .data-table { width: max-content; min-width: 100%; }
    .data-table thead tr:last-child th { min-width: 130px; }
    .data-table th.num, .data-table td.num { text-align: right; }
    .data-table th.box, .data-table th.group { text-align: center; color: var(--text); font-weight: 600; background: var(--surface-solid); }
    .data-table thead th { position: sticky; background: var(--surface-solid); z-index: 1; }
    .data-table tr.boxes:nth-child(1) th { top: 0; }
    .data-table td { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .data-table td.num { font-variant-numeric: tabular-nums; }
    .none { position: sticky; left: 0; padding: 28px 20px; text-align: center; color: var(--text-muted); font-size: 0.875rem; }
    .data-table td.none { text-align: center; color: var(--text-muted); height: 96px; max-width: none; }
  `,
})
export class SheetTable {
  readonly sheet = input.required<SheetWithRows>();
  /** The rows to show, searched and sorted. */
  readonly rows = input.required<Row[]>();
  readonly formulas = input.required<WorkbookFormulas>();
  readonly sort = input<{ key: string; dir: 1 | -1 } | null>(null);
  readonly searching = input(false);
  readonly sortBy = output<string>();

  readonly pageSize = signal(savedPageSize());
  readonly page = signal(0);
  /** The box (or group, in a table with no boxes) whose columns are shown with the row's own; null: all of them. */
  readonly stage = signal<string | null>(null);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  readonly shown = computed(() => pageSlice(this.rows(), this.page(), this.pageSize()));
  readonly showBoxes = computed(() => this.sheet().columns.some((column) => column.box));
  readonly showGroups = computed(() => this.sheet().columns.some((column) => column.group));

  /** The boxes and groups that are folded (by id), kept for the table. */
  readonly folded = signal<ReadonlySet<string>>(new Set());

  /** Every box and group as the columns lay them out, folded or not. */
  private readonly boxRuns = computed(() => this.runs((column) => column.box ?? '', (column) => column.box ?? '', (label) => `box:${label}`));
  private readonly groupRuns = computed(() =>
    this.runs((column) => `${column.box ?? ''}\u0000${column.group ?? ''}`, (column) => column.group ?? '', (label, column) => `group:${column.box ?? ''}\u0000${label}`),
  );
  /** What there is to fold: a named box of two or more columns (a stage); a group only in a table with no boxes. */
  readonly foldables = computed(() => [...this.boxRuns(), ...(this.showBoxes() ? [] : this.groupRuns())].filter((run) => run.label && run.total > 1));
  readonly allFolded = computed(() => this.foldables().every((run) => this.folded().has(run.id)));

  /** The columns a folded box or group hides: each one's but its first. */
  private readonly hidden = computed(() => {
    const hidden = new Set<number>();
    for (const run of this.foldables()) {
      if (!this.folded().has(run.id)) continue;
      for (let at = run.start + 1; at < run.start + run.total; at += 1) hidden.add(at);
    }
    return hidden;
  });
  /** The columns of the table that are in view: all, or one stage's with the columns that belong to none (the row's own). */
  readonly columns = computed(() => {
    const stage = this.stage();
    const all = this.sheet().columns;
    if (stage === null) return all;
    const part = this.showBoxes() ? (column: Column) => column.box : (column: Column) => column.group;
    return all.filter((column) => !part(column) || part(column) === stage);
  });
  /** The columns shown, each with its place among those in view. */
  readonly visible = computed(() =>
    this.columns().map((column, index) => ({ column, index })).filter(({ index }) => !this.hidden().has(index)),
  );

  readonly boxSpans = computed(() => this.display(this.boxRuns(), () => false));
  readonly groupSpans = computed(() => {
    const columns = this.columns();
    // A group inside a folded box has nothing of its own to fold.
    return this.display(this.groupRuns(), (run) => this.showBoxes() || (!!columns[run.start].box && this.folded().has(`box:${columns[run.start].box}`)));
  });
  /** A wide table's boxes (or its groups, with no boxes) as chips that show one of them at a time, with how many columns each has. */
  readonly stageChips = computed(() => {
    const part = this.showBoxes() ? (column: Column) => column.box : this.showGroups() ? (column: Column) => column.group : () => undefined;
    const chips: { label: string; total: number }[] = [];
    for (const column of this.sheet().columns) {
      const label = part(column);
      if (!label) continue;
      const found = chips.find((chip) => chip.label === label);
      if (found) found.total += 1;
      else chips.push({ label, total: 1 });
    }
    return chips;
  });

  constructor() {
    // Each table's folds are kept, and read again when another table is shown.
    effect(() => {
      const key = this.foldKey();
      untracked(() => this.folded.set(readFolded(key)));
    });
    // Another table is shown: all its columns again.
    effect(() => {
      this.sheet().sheetId;
      untracked(() => this.stage.set(null));
    });
    // A new search or sort starts again from the first page.
    effect(() => {
      this.rows();
      untracked(() => this.page.set(0));
    });
  }

  toTop() {
    this.scroller()?.nativeElement.scrollTo({ top: 0 });
  }

  private foldKey() {
    return `ukmac.folded.${this.sheet().sheetId}`;
  }

  /** The runs of neighbouring columns that share a key: a box, or a group in a box. */
  private runs(key: (column: Column) => string, label: (column: Column) => string, id: (label: string, column: Column) => string) {
    const columns = this.columns();
    const runs: { id: string; label: string; start: number; total: number }[] = [];
    columns.forEach((column, index) => {
      const last = runs.at(-1);
      if (last && key(columns[index - 1]) === key(column)) last.total += 1;
      else runs.push({ id: id(label(column), column), label: label(column), start: index, total: 1 });
    });
    return runs;
  }

  /** The header cells: each run over the columns of it that are shown (none left: no cell). */
  private display(runs: { id: string; label: string; start: number; total: number }[], inFoldedBox: (run: { start: number }) => boolean): Span[] {
    return runs
      .map((run) => {
        let span = 0;
        for (let at = run.start; at < run.start + run.total; at += 1) if (!this.hidden().has(at)) span += 1;
        const foldable = !!run.label && run.total > 1 && !inFoldedBox(run);
        return { ...run, span, folded: foldable && this.folded().has(run.id), foldable };
      })
      .filter((run) => run.span > 0);
  }

  toggle(id: string) {
    this.folded.update((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
    this.keep();
  }

  foldAll() {
    this.folded.set(new Set(this.foldables().map((run) => run.id)));
    this.keep();
  }

  openAll() {
    this.folded.set(new Set());
    this.keep();
  }

  private keep() {
    try {
      localStorage.setItem(this.foldKey(), JSON.stringify([...this.folded()]));
    } catch {
      /* not kept: it still works for now */
    }
  }

  label(column: Column) {
    return columnLabel(column);
  }

  /** A stage as the header writes it: "1 · Transplant (0 DAT)" is "Stage 1 · Transplant (0 DAT)". */
  stageName(label: string) {
    return /^\d+ · /.test(label) ? `Stage ${label}` : label;
  }

  right(column: Column) {
    return alignsRight(column) || column.type === 'formula';
  }

  text(row: Row, column: Column): string {
    if (column.type === 'formula') {
      const value = this.formulas().value(this.sheet(), row, column);
      if (isFormulaError(value)) return value.code;
      if (typeof value === 'number' && !Number.isInteger(value)) return String(Number(value.toFixed(3)));
      const text = formatFormulaValue(value);
      return isIsoDate(text) ? formatDate(text) : text;
    }
    return displayCell(column, row.data[column.key]);
  }

  /** Shows one stage's columns (or all): what is shown opens, with the groups inside it, and the table goes back to its first column. */
  show(label: string | null) {
    this.stage.set(label);
    if (label !== null) {
      const ids = [`box:${label}`, ...this.groupRuns().filter((run) => run.id.startsWith(`group:${label}\u0000`)).map((run) => run.id)].filter((id) => this.folded().has(id));
      if (ids.length) {
        this.folded.update((set) => new Set([...set].filter((id) => !ids.includes(id))));
        this.keep();
      }
    }
    setTimeout(() => this.scroller()?.nativeElement.scrollTo({ left: 0 }), 0);
  }
}

/** What a table had folded, as saved. */
function readFolded(key: string): Set<string> {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '[]');
    return new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}
