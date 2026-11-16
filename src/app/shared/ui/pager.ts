import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';

import { Icon } from './icon';

/** Rows per page to pick from; 0 is all of them. */
export const PAGE_SIZES = [10, 20, 30, 50, 100, 0];
const SIZE_KEY = 'ukmac.page-size';

/** The rows per page last picked on this Mac (any table), or the fallback. */
export function savedPageSize(fallback = 50): number {
  try {
    const saved = localStorage.getItem(SIZE_KEY);
    const size = Number(saved);
    return saved !== null && PAGE_SIZES.includes(size) ? size : fallback;
  } catch {
    return fallback;
  }
}

/** The page's rows (all when size is 0); past the end, the last page. */
export function pageSlice<T>(rows: readonly T[], page: number, size: number): T[] {
  if (!size) return [...rows];
  const last = Math.max(0, Math.ceil(rows.length / size) - 1);
  const at = Math.min(Math.max(0, page), last);
  return rows.slice(at * size, (at + 1) * size);
}

/** "1–10 of 139", rows per page, and the page buttons, under a table. */
@Component({
  selector: 'app-pager',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (always() || total() > sizes[0]) {
      <nav class="pager" [class.compact]="compact()" aria-label="Pages">
        <span class="range">{{ from() }}–{{ to() }} of {{ total() }}</span>
        <span class="grow"></span>
        <label class="per">
          Rows per page
          <select class="input-field is-sm" (change)="setSize(+$any($event.target).value)">
            @for (n of sizes; track n) {
              <option [value]="n" [selected]="n === size()">{{ n || 'All' }}</option>
            }
          </select>
        </label>
        @if (always() || pages() > 1) {
          <button type="button" class="btn btn-secondary btn-sm" [disabled]="current() === 0" (click)="go(current() - 1)" aria-label="Previous page">
            <app-icon name="arrow-left" [size]="14" />
          </button>
          @for (n of pageList(); track $index) {
            @if (n < 0) {
              <span class="gap">…</span>
            } @else {
              <button type="button" class="btn btn-sm pg" [class.btn-primary]="n === current()" [class.btn-plain]="n !== current()" [attr.aria-current]="n === current() ? 'page' : null" (click)="go(n)">
                {{ n + 1 }}
              </button>
            }
          }
          <button type="button" class="btn btn-secondary btn-sm" [disabled]="current() >= pages() - 1" (click)="go(current() + 1)" aria-label="Next page">
            <app-icon name="arrow-left" [size]="14" class="flip" />
          </button>
        }
      </nav>
    }
  `,
  styles: `
    :host { display: block; }
    .pager { display: flex; align-items: center; gap: 6px; padding: 12px 20px; border-top: var(--hairline) solid var(--border); font-size: 0.8125rem; color: var(--text-muted); flex-wrap: wrap; }
    .pager.compact { padding: 10px 0 0; }
    .range { font-variant-numeric: tabular-nums; }
    .grow { flex: 1; }
    .per { display: inline-flex; align-items: center; gap: 8px; margin-right: 10px; }
    .per select { width: auto; }
    .pg { min-width: 32px; font-variant-numeric: tabular-nums; }
    .gap { padding: 0 4px; }
    .flip { display: inline-flex; transform: rotate(180deg); }
  `,
})
export class Pager {
  readonly total = input.required<number>();
  readonly page = model(0);
  readonly size = model(50);
  /** Smaller, for a table inside a card. */
  readonly compact = input(false);
  /** Shown even when everything fits on one page (then it reads "1–7 of 7" and page 1). */
  readonly always = input(false);
  /** The page or the rows per page changed (to scroll back to the top). */
  readonly moved = output<void>();

  readonly sizes = PAGE_SIZES;
  readonly pages = computed(() => (this.size() ? Math.max(1, Math.ceil(this.total() / this.size())) : 1));
  readonly current = computed(() => Math.min(Math.max(0, this.page()), this.pages() - 1));
  readonly from = computed(() => (this.total() ? (this.size() ? this.current() * this.size() + 1 : 1) : 0));
  readonly to = computed(() => (this.size() ? Math.min(this.total(), (this.current() + 1) * this.size()) : this.total()));
  /** Page numbers to show, 0-based, with -1 for a gap. */
  readonly pageList = computed(() => {
    const last = this.pages() - 1;
    const now = this.current();
    const keep = [...new Set([0, last, now - 1, now, now + 1])].filter((n) => n >= 0 && n <= last).sort((a, b) => a - b);
    const list: number[] = [];
    keep.forEach((n, i) => {
      if (i && n - keep[i - 1] > 1) list.push(-1);
      list.push(n);
    });
    return list;
  });

  go(page: number) {
    this.page.set(Math.min(Math.max(0, page), this.pages() - 1));
    this.moved.emit();
  }

  setSize(size: number) {
    this.size.set(size);
    this.page.set(0);
    try {
      localStorage.setItem(SIZE_KEY, String(size));
    } catch {
      /* kept for this run only */
    }
    this.moved.emit();
  }
}
