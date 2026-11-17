import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, output, signal, untracked, viewChild } from '@angular/core';

import type { Column, Row, SheetWithRows } from '@core/models';
import { formatFormulaValue, isFormulaError } from '@shared/formula/evaluate-formula';
import type { WorkbookFormulas } from '@shared/formula/sheet-formulas';
import { alignsRight, columnLabel, displayCell, formatDate, isIsoDate } from '@shared/sheet/columns';
import { Icon } from '@shared/ui/icon';
import { Pager, pageSlice, savedPageSize } from '@shared/ui/pager';
import { isBlank } from './missing-data';

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
  host: { '(window:resize)': 'measure()' },
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
    <div class="scroll-wrap">
    <!-- Missing data on, and some columns with gaps out of sight: an arrow each way says how many, and goes to the next. -->
    @if (aside().left.length) {
      <button type="button" class="gap-aside is-left" [title]="asideTitle(aside().left.length, 'left')" (click)="goGap('left')">
        <app-icon name="arrow-left" [size]="14" /> {{ aside().left.length }} missing
      </button>
    }
    @if (aside().right.length) {
      <button type="button" class="gap-aside is-right" [title]="asideTitle(aside().right.length, 'right')" (click)="goGap('right')">
        {{ aside().right.length }} missing <app-icon name="arrow-right" [size]="14" />
      </button>
    }
    <div class="table-card scroller" #scroller (scroll)="measure()">
      <table class="data-table">
        <thead>
          @if (showBoxes()) {
            <tr class="boxes">
              @for (box of boxSpans(); track box.id) {
                <th [attr.colspan]="box.span" [attr.data-start]="box.start" class="box" [class.edge]="startsBox(box.start)" [class.is-folded]="box.folded">
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
                <th [attr.colspan]="group.span" class="group" [class.edge]="startsBox(group.start)" [class.is-folded]="group.folded">
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
              <th [class.num]="right(item.column)" [class.edge]="startsBox(item.index)" [class.is-lit]="lit() === item.column.key" [attr.data-col]="item.column.key">
                <button type="button" class="sort-btn" [class.is-active]="sort()?.key === item.column.key" (click)="sortBy.emit(item.column.key)">
                  {{ label(item.column) }}
                  @if (sort()?.key === item.column.key) {
                    <app-icon [name]="sort()!.dir === 1 ? 'arrow-up' : 'arrow-down'" [size]="12" />
                  }
                </button>
                @if (missing()?.get(item.column.key); as gaps) {
                  <span class="gap-line">
                    <button
                      type="button"
                      class="gap-count"
                      [class.on]="gapFirst() === item.column.key"
                      [attr.aria-pressed]="gapFirst() === item.column.key"
                      [title]="gapFirst() === item.column.key ? 'The rows missing ' + label(item.column) + ' are on top: click for the usual order' : 'Nothing entered on ' + gaps + ' of the ' + sheet().rows.length + ' rows: click to put them on top'"
                      (click)="gapFirstBy.emit(item.column.key)"
                    >
                      {{ gaps.toLocaleString('en') }} missing
                    </button>
                  </span>
                }
              </th>
            }
          </tr>
        </thead>
        <tbody>
          @for (row of shown(); track row.rowId) {
            <tr>
              @for (item of visible(); track item.column.key) {
                @if (isGap(row, item.column)) {
                  <td class="is-gap" [class.num]="right(item.column)" [class.edge]="startsBox(item.index)" [class.is-lit]="lit() === item.column.key" title="Nothing entered"><span class="gap">Missing</span></td>
                } @else {
                  <td [class.num]="right(item.column)" [class.edge]="startsBox(item.index)" [class.is-lit]="lit() === item.column.key" [title]="text(row, item.column)">{{ text(row, item.column) }}</td>
                }
              }
            </tr>
          }
        </tbody>
      </table>
      @if (!rows().length) {
        <p class="none">{{ emptyText() ?? (searching() ? 'No rows match the search.' : 'No rows yet — Sync them from the Google Sheet, or open the sheet and type them in.') }}</p>
      }
    </div>
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
    /* Each stage starts behind a hairline, as the QA/QC Analysis draws its stages. */
    .data-table .edge { border-left: var(--hairline) solid var(--border); }
    .jump .chip small { color: var(--text-muted); font-size: 0.6875rem; margin-left: 4px; font-variant-numeric: tabular-nums; }
    .jump-label { font-size: 0.8125rem; font-weight: 500; color: var(--text-muted); white-space: nowrap; }
    .jump .chip { white-space: nowrap; cursor: pointer; font-size: 0.8125rem; }
    /* Sideways only: the rows run down the page, so the wheel over the table scrolls the page, not a box inside it. */
    .scroll-wrap { position: relative; }
    .scroller { background: transparent; overflow-x: auto; }
    /* The arrows to the columns with gaps that are out of sight: on the table's edges, over the header. */
    .gap-aside { position: absolute; top: 10px; z-index: 3; display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border: 0; border-radius: 999px; background: var(--warning); color: #fff; font: inherit; font-size: 0.75rem; font-weight: 600; white-space: nowrap; box-shadow: var(--shadow-card); cursor: pointer; }
    .gap-aside:hover { filter: brightness(0.95); }
    .gap-aside.is-left { left: 10px; }
    .gap-aside.is-right { right: 10px; }
    .data-table { width: max-content; min-width: 100%; }
    .data-table thead tr:last-child th { min-width: 130px; }
    .data-table th.num, .data-table td.num { text-align: right; }
    /* A column asked for (from the Data Check): lit for a few seconds, then it fades back. */
    .data-table th, .data-table td { transition: background-color 600ms ease, box-shadow 600ms ease; }
    .data-table th.is-lit { background: color-mix(in srgb, var(--accent) 16%, var(--surface-solid)); box-shadow: inset 0 -3px 0 var(--accent); color: var(--accent); }
    .data-table td.is-lit { background: color-mix(in srgb, var(--accent) 9%, transparent); }
    .data-table th.box, .data-table th.group { text-align: center; color: var(--text); font-weight: 600; background: var(--surface-solid); }
    .data-table thead th { position: sticky; background: var(--surface-solid); z-index: 1; }
    .data-table tr.boxes:nth-child(1) th { top: 0; }
    .data-table td { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .data-table td.num { font-variant-numeric: tabular-nums; }
    /* Missing data, when the page's switch shows it: each column's count under its name, each empty cell tinted. */
    .data-table thead tr:last-child th { vertical-align: top; }
    .gap-line { display: block; margin-top: 2px; }
    /* A click puts the rows missing it on top; lit while they are. */
    .gap-count { margin: 0 -6px; padding: 1px 6px; border: 0; border-radius: 6px; background: none; font: inherit; font-size: 0.6875rem; font-weight: 600; color: var(--warning); font-variant-numeric: tabular-nums; white-space: nowrap; cursor: pointer; transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease); }
    .gap-count:hover { background: var(--warning-soft); }
    .gap-count.on { background: var(--warning); color: #fff; }
    .data-table td.is-gap { background: var(--warning-soft); }
    .gap { font-size: 0.75rem; font-weight: 600; color: var(--warning); }
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
  /** Columns left out of the table (the empty ones, when the page's switch hides them). */
  readonly hide = input<ReadonlySet<string>>(new Set());
  /** The page's missing data, when its switch shows it: each column with a gap and on how many rows (none: not shown). */
  readonly missing = input<ReadonlyMap<string, number> | null>(null);
  /** The column whose rows missing it are on top (its count lit); a click on a count asks for it, or for none. */
  readonly gapFirst = input<string | null>(null);
  readonly gapFirstBy = output<string>();
  /** What to say when there are no rows to show, in place of the usual words. */
  readonly emptyText = input<string | null>(null);
  readonly sortBy = output<string>();
  /** A column to bring into view and light up (from the Data Check, or a link): its key. */
  readonly focusColumn = input<string | null>(null);
  /** The column lit now (it fades after a few seconds). */
  readonly lit = signal<string | null>(null);
  private litTimer: ReturnType<typeof setTimeout> | undefined;

  readonly pageSize = signal(savedPageSize());
  readonly page = signal(0);
  /** The box (or group, in a table with no boxes) whose columns are shown with the row's own; null: all of them. */
  readonly stage = signal<string | null>(null);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  /** The columns with gaps that are out of sight, to the left and to the right of what is on the screen (their keys, in table order). */
  readonly aside = signal<{ left: string[]; right: string[] }>({ left: [], right: [] });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

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

  /** Whether the column at this place (among those in view) is the first of its stage: a hairline is drawn before it. */
  startsBox(index: number): boolean {
    const columns = this.columns();
    const box = columns[index]?.box;
    return !!box && index > 0 && columns[index - 1].box !== box;
  }

  /**
   * A table of stages seen for the first time: its first stage open and the rest folded to their first column, as the
   * QA/QC Analysis begins, so a table of hundreds of columns reads at once. What a person folds or opens is kept after.
   */
  private firstOpen(): ReadonlySet<string> {
    if (!this.showBoxes() || this.stageChips().length < 3) return new Set();
    const counts = new Map<string, number>();
    for (const column of this.sheet().columns) if (column.box) counts.set(column.box, (counts.get(column.box) ?? 0) + 1);
    return new Set([...counts].filter(([, total]) => total > 1).slice(1).map(([label]) => `box:${label}`));
  }

  /** The columns a folded box or group hides: each one's but its first. */
  private readonly hidden = computed(() => {
    const hidden = new Set<number>();
    for (const run of this.foldables()) {
      if (!this.folded().has(run.id)) continue;
      for (let at = run.start + 1; at < run.start + run.total; at += 1) hidden.add(at);
    }
    return hidden;
  });
  /** The columns of the table that are in view: all, or one stage's with the columns that belong to none (the row's own) and, in a table with no boxes, its Batch group. */
  readonly columns = computed(() => {
    const stage = this.stage();
    const skip = this.hide();
    const all = skip.size ? this.sheet().columns.filter((column) => !skip.has(column.key)) : this.sheet().columns;
    if (stage === null) return all;
    const part = this.showBoxes() ? (column: Column) => column.box : (column: Column) => column.group;
    // A row is known by its batch (Nursery Progress): that group stays beside whichever group is shown, with the row's ID.
    const batch = !this.showBoxes() ? 'Batch' : null;
    return all.filter((column) => !part(column) || part(column) === stage || (batch !== null && column.group === batch));
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
    // The arrows to columns with gaps out of sight follow what is drawn: measured once the columns and counts are in the page.
    effect(() => {
      this.visible();
      this.missing();
      this.shown();
      untracked(() => setTimeout(() => this.measure(), 0));
    });
    // Each table's folds are kept, and read again when another table is shown.
    effect(() => {
      const key = this.foldKey();
      untracked(() => this.folded.set(readFolded(key) ?? this.firstOpen()));
    });
    // Another table is shown: all its columns again.
    effect(() => {
      this.sheet().sheetId;
      untracked(() => this.stage.set(null));
    });
    // A column asked for: shown (its stage picked apart, its fold opened), scrolled to, and lit for a few seconds.
    effect(() => {
      const key = this.focusColumn();
      const known = this.sheet().columns.some((column) => column.key === key);
      if (key && known) untracked(() => this.reveal(key));
    });
    // A new search or sort starts again from the first page.
    effect(() => {
      this.rows();
      untracked(() => this.page.set(0));
    });
  }

  /** Brings a column into view: every column shown, its fold opened, scrolled to (across and down the page), and lit for a few seconds. */
  private reveal(key: string) {
    this.stage.set(null);
    const at = this.sheet().columns.findIndex((column) => column.key === key);
    const hiding = this.foldables().filter((run) => this.folded().has(run.id) && at > run.start && at < run.start + run.total);
    if (hiding.length) {
      this.folded.update((set) => new Set([...set].filter((id) => !hiding.some((run) => run.id === id))));
      this.keep();
    }
    this.lit.set(key);
    clearTimeout(this.litTimer);
    this.litTimer = setTimeout(() => this.lit.set(null), 5000);
    // After the columns have been drawn.
    setTimeout(() => this.host.nativeElement.querySelector(`th[data-col="${key}"]`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center', inline: 'center' }), 80);
  }

  /** Which columns with gaps are out of sight to the left and to the right of what is on the screen. */
  measure() {
    const scroller = this.scroller()?.nativeElement;
    const gaps = this.missing();
    const none = this.aside().left.length === 0 && this.aside().right.length === 0;
    if (!scroller || !gaps?.size) {
      if (!none) this.aside.set({ left: [], right: [] });
      return;
    }
    const box = scroller.getBoundingClientRect();
    const left: string[] = [];
    const right: string[] = [];
    scroller.querySelectorAll<HTMLElement>('thead th[data-col]').forEach((th) => {
      const key = th.dataset['col'] ?? '';
      if (!gaps.has(key)) return;
      const at = th.getBoundingClientRect();
      if (at.right <= box.left + 4) left.push(key);
      else if (at.left >= box.right - 4) right.push(key);
    });
    const now = this.aside();
    if (now.left.join() !== left.join() || now.right.join() !== right.join()) this.aside.set({ left, right });
  }

  /** To the next column with a gap on that side: scrolled into the middle, and lit for a moment. */
  goGap(side: 'left' | 'right') {
    const key = side === 'right' ? this.aside().right[0] : this.aside().left.at(-1);
    const scroller = this.scroller()?.nativeElement;
    const th = key ? scroller?.querySelector<HTMLElement>(`thead th[data-col="${key}"]`) : null;
    if (!scroller || !th || !key) return;
    const box = scroller.getBoundingClientRect();
    const at = th.getBoundingClientRect();
    scroller.scrollTo({ left: scroller.scrollLeft + (at.left - box.left) - (scroller.clientWidth - at.width) / 2, behavior: 'smooth' });
    this.lit.set(key);
    clearTimeout(this.litTimer);
    this.litTimer = setTimeout(() => this.lit.set(null), 3000);
  }

  asideTitle(count: number, side: string) {
    return `${count} column${count === 1 ? '' : 's'} with missing data to the ${side}: click to go to the next one`;
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

  /** A cell to mark as missing: blank, in a column a person fills in (formula and ID columns are never on the list). */
  isGap(row: Row, column: Column): boolean {
    return !!this.missing()?.has(column.key) && isBlank(row.data[column.key]);
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
function readFolded(key: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const saved = JSON.parse(raw);
    return new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return null;
  }
}
