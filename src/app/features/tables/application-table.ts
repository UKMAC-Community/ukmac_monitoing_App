import { ChangeDetectionStrategy, Component, computed, effect, input, signal, untracked } from '@angular/core';

import type { Column, SheetWithRows } from '@core/models';
import { alignsRight, columnLabel } from '@shared/sheet/columns';
import { Icon } from '@shared/ui/icon';
import { Pager, pageSlice, savedPageSize } from '@shared/ui/pager';
import { type ApplicationLine, type ApplicationPivot, gapsOf, isGap } from './application-view';

/**
 * A table of applications with the applications on top: a line for each plot, a group of columns for each application (1st
 * Application, 2nd…) and under it what was done (disease, date, chemical, dose). Read only; the table's own rows are unchanged.
 * An application folds to one column (its date) so ten of them can be looked over at once. With the page's Missing data on, it is
 * given only the plots missing something, and each empty cell says so, as in the table seen row by row.
 */
@Component({
  selector: 'app-application-table',
  imports: [Icon, Pager],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (pivot(); as view) {
      <div class="bar">
        <span class="note">{{ missing() ? 'The plots with something left empty, each empty cell marked' : 'A line for each plot, the applications along the top' }}</span>
        <span class="grow"></span>
        <button type="button" class="btn btn-plain btn-sm" [disabled]="allFolded()" title="Fold every application to its first column" (click)="foldAll()">
          <app-icon name="circle-minus" [size]="14" /> Fold all
        </button>
        <button type="button" class="btn btn-plain btn-sm" [disabled]="!folded().size" title="Open every application" (click)="openAll()">
          <app-icon name="circle-plus" [size]="14" /> Open all
        </button>
      </div>
      <div class="table-card scroller">
        <table class="data-table">
          <thead>
            <tr class="boxes">
              <th class="plot" rowspan="2">{{ view.layout.plot.name }}</th>
              @for (round of view.rounds; track round) {
                <th class="group edge" [attr.colspan]="shownFields(round).length">
                  <button type="button" class="fold" [attr.aria-expanded]="!folded().has(round)" [title]="folded().has(round) ? 'Open ' + round : 'Fold ' + round + ' to its ' + label(first()) + ' column'" (click)="toggle(round)">
                    <app-icon [name]="folded().has(round) ? 'circle-plus' : 'circle-minus'" [size]="14" />
                    <span class="fold-label">{{ round }}</span>
                  </button>
                </th>
              }
            </tr>
            <tr>
              @for (round of view.rounds; track round) {
                @for (field of shownFields(round); track field.key; let i = $index) {
                  <th [class.num]="right(field)" [class.edge]="i === 0">
                    {{ label(field) }}
                    @if (gapCount(round, field.key); as count) {
                      <span class="gap-line"><span class="gap-count" [title]="'Nothing entered on ' + count + ' plot' + (count === 1 ? '' : 's') + ' in the ' + round">{{ count.toLocaleString('en') }} missing</span></span>
                    } @else if (missing()) {
                      <!-- Nothing missing here: an empty line all the same, so this name sits level with the ones that have a count. -->
                      <span class="gap-line" aria-hidden="true"><span class="gap-blank">&nbsp;</span></span>
                    }
                  </th>
                }
              }
            </tr>
          </thead>
          <tbody>
            @for (line of shown(); track line.plot) {
              <tr>
                <td class="plot" [title]="line.plot">{{ line.plot }}</td>
                @for (round of view.rounds; track round) {
                  @for (field of shownFields(round); track field.key; let i = $index) {
                    @if (gap(line, round, field)) {
                      <td class="is-gap" [class.num]="right(field)" [class.edge]="i === 0" title="Nothing entered"><span class="gap">Missing</span></td>
                    } @else if (hiddenGaps(line, round); as hidden) {
                      <!-- Folded, and something under it missing: marked, and named on hover. -->
                      <td class="is-gap" [class.num]="right(field)" [class.edge]="i === 0" [title]="hidden">{{ line.done.get(round)?.[field.key] ?? '' }}</td>
                    } @else {
                      <td [class.num]="right(field)" [class.edge]="i === 0" [class.blank]="!line.done.get(round)?.[field.key]" [title]="line.done.get(round)?.[field.key] ?? ''">{{ line.done.get(round)?.[field.key] ?? '' }}</td>
                    }
                  }
                }
              </tr>
            }
          </tbody>
        </table>
        @if (!view.lines.length) {
          <p class="none">{{ emptyText() }}</p>
        }
      </div>
      <app-pager [always]="true" [total]="view.lines.length" [(page)]="page" [(size)]="pageSize" />
    }
  `,
  styles: `
    :host { display: block; }
    .bar { display: flex; align-items: center; gap: 6px; padding: 8px 20px; border-bottom: var(--hairline) solid var(--border); }
    .note { font-size: 0.8125rem; color: var(--text-muted); }
    .grow { flex: 1; }
    .scroller { background: transparent; overflow-x: auto; }
    .data-table { width: max-content; min-width: 100%; }
    .data-table thead tr:last-child th { min-width: 110px; }
    .data-table thead th { position: sticky; background: var(--surface-solid); z-index: 1; }
    .data-table tr.boxes:nth-child(1) th { top: 0; }
    .data-table th.group { color: var(--text); font-weight: 600; }
    .data-table td { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .data-table .edge { border-left: var(--hairline) solid var(--border); }
    /* The plot stays in view while the applications scroll past. */
    .data-table th.plot, .data-table td.plot { position: sticky; left: 0; z-index: 2; background: var(--surface-solid); font-weight: 600; min-width: 90px; }
    .data-table td.blank { background: color-mix(in srgb, var(--text-muted) 4%, transparent); }
    .fold { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 2px 8px; border: 0; border-radius: var(--radius-sm); background: none; color: inherit; font: inherit; font-weight: 600; cursor: pointer; }
    .fold:hover { background: var(--surface-hover); }
    .fold app-icon { flex: none; color: var(--text-muted); }
    .fold-label { white-space: nowrap; }
    .none { margin: 0; padding: 36px 0; text-align: center; color: var(--text-muted); }
    /* Missing data, marked as in the table seen row by row. */
    .gap-line { display: block; margin-top: 2px; }
    .data-table thead th:has(.gap-line) { padding-top: 6px; padding-bottom: 6px; }
    .gap-count { font-size: 0.6875rem; font-weight: 600; color: var(--warning); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .gap-blank { font-size: 0.6875rem; }
    .data-table td.is-gap { background: var(--warning-soft); }
    .gap { font-size: 0.75rem; font-weight: 600; color: var(--warning); }
  `,
})
export class ApplicationTable {
  readonly sheet = input.required<SheetWithRows>();
  /** The plots to show, as the page sees them (its search kept, and only those missing something while Missing data is on). */
  readonly pivot = input.required<ApplicationPivot | null>();
  readonly searching = input(false);
  /** The page's missing data, when its switch shows it: each column with a gap (none: not shown). */
  readonly missing = input<ReadonlyMap<string, number> | null>(null);

  readonly pageSize = signal(savedPageSize());
  readonly page = signal(0);
  readonly folded = signal<ReadonlySet<string>>(new Set());
  readonly shown = computed(() => pageSlice(this.pivot()?.lines ?? [], this.page(), this.pageSize()));

  /** The column a folded application keeps: its date (one with something in it, where a table has a date nobody fills in), else its first. */
  readonly first = computed<Column>(() => {
    const pivot = this.pivot();
    const fields = pivot?.layout.fields ?? [];
    const filled = (field: Column) => !!pivot?.lines.some((line) => [...line.done.values()].some((done) => !!done[field.key]));
    const dates = fields.filter((field) => field.type === 'date');
    return dates.find(filled) ?? dates[0] ?? fields[0];
  });
  readonly allFolded = computed(() => !!this.pivot() && this.folded().size >= this.pivot()!.rounds.length);
  /** What is told of each application, its date first (the column it folds to), then the rest in the table's order. */
  private readonly ordered = computed<Column[]>(() => {
    const fields = this.pivot()?.layout.fields ?? [];
    const first = this.first();
    return first ? [first, ...fields.filter((field) => field.key !== first.key)] : fields;
  });

  /** Under each application's field, on how many of the plots shown it is missing (Missing data on). */
  private readonly gapCounts = computed(() => {
    const pivot = this.pivot();
    const gaps = this.missing();
    const counts = new Map<string, number>();
    if (!pivot || !gaps) return counts;
    for (const line of pivot.lines) {
      for (const round of pivot.rounds) {
        for (const field of pivot.layout.fields) {
          if (isGap(line, round, field.key, gaps)) counts.set(`${round}\n${field.key}`, (counts.get(`${round}\n${field.key}`) ?? 0) + 1);
        }
      }
    }
    return counts;
  });

  readonly emptyText = computed(() => {
    if (this.missing()) return this.searching() ? 'No plots missing anything match the search.' : 'Nothing missing: every plot has all its applications filled in.';
    return this.searching() ? 'No plots match the search.' : 'No rows yet — Sync them from the Google Sheet.';
  });

  constructor() {
    // Another table (or other columns): start with every application open.
    effect(() => {
      this.sheet().sheetId;
      untracked(() => this.folded.set(new Set()));
    });
    // Other plots (a search, Missing data on or off): from the first page again.
    effect(() => {
      this.pivot();
      this.missing();
      untracked(() => this.page.set(0));
    });
  }

  gapCount(round: string, key: string): number {
    return this.gapCounts().get(`${round}\n${key}`) ?? 0;
  }

  /** A cell to mark as missing: its plot's application is there and has nothing in this column. */
  gap(line: ApplicationLine, round: string, field: Column): boolean {
    const gaps = this.missing();
    return !!gaps && isGap(line, round, field.key, gaps);
  }

  /** A folded application with something missing out of sight: what, in words (none: nothing). */
  hiddenGaps(line: ApplicationLine, round: string): string {
    const gaps = this.missing();
    const pivot = this.pivot();
    if (!gaps || !pivot || !this.folded().has(round)) return '';
    const hidden = gapsOf(pivot, line, round, gaps).filter((field) => field.key !== this.first()?.key);
    return hidden.length ? `Nothing entered for ${hidden.map((field) => columnLabel(field)).join(', ')}: open the ${round} to see` : '';
  }

  shownFields(round: string): Column[] {
    return this.folded().has(round) ? [this.first()].filter(Boolean) : this.ordered();
  }

  toggle(round: string) {
    this.folded.update((set) => {
      const next = new Set(set);
      if (!next.delete(round)) next.add(round);
      return next;
    });
  }

  openAll() {
    this.folded.set(new Set());
  }

  foldAll() {
    this.folded.set(new Set(this.pivot()?.rounds ?? []));
  }

  label(column: Column | undefined) {
    return column ? columnLabel(column) : '';
  }

  right(column: Column) {
    return alignsRight(column);
  }
}
