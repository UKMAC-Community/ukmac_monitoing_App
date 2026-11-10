import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { fixLayout, MAX_HEADER_ROWS, sameLayout, type FileLayout, type FilePeek } from '../excel/file-layout';
import { Icon } from './icon';

type Mark = 'names' | 'data';

/** A spreadsheet's column letters: 1 → A, 27 → AA. */
function letters(column: number) {
  let out = '';
  for (let at = column; at > 0; at = Math.floor((at - 1) / 26)) out = String.fromCharCode(65 + ((at - 1) % 26)) + out;
  return out;
}

/**
 * The file's first rows as they are, and which of them name the columns and where the raw data starts.
 * It's what the import guessed (a group's name merged over its columns makes the names two rows); the
 * rows can be set by typing a row number, or by clicking a row's number.
 */
@Component({
  selector: 'app-import-layout',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="layout">
      <header class="bar">
        <label class="field">
          <span>Column names: from row</span>
          <input class="input-field is-sm" type="number" min="1" [max]="most()" [value]="layout().headerFrom" (change)="typed('headerFrom', $event)" aria-label="First row of column names" />
        </label>
        <label class="field">
          <span>to row</span>
          <input class="input-field is-sm" type="number" min="1" [max]="most()" [value]="layout().headerTo" (change)="typed('headerTo', $event)" aria-label="Last row of column names" />
        </label>
        <label class="field">
          <span>Raw data starts on row</span>
          <input class="input-field is-sm" type="number" min="1" [max]="most() + 1" [value]="layout().dataFrom" (change)="typed('dataFrom', $event)" aria-label="First row of data" />
        </label>
        <span class="grow"></span>
        <button type="button" class="btn btn-plain btn-sm" [disabled]="isDetected()" (click)="layoutChange.emit(detected())" title="Go back to the rows the file's own layout points at">
          <app-icon name="refresh" /> Find them again
        </button>
      </header>

      <div class="pick">
        <span class="muted">Click a row number to mark it as</span>
        <div class="segmented is-sm" role="group" aria-label="What a click on a row number marks">
          <button type="button" class="segment" [attr.aria-pressed]="mark() === 'names'" (click)="mark.set('names')">Column names</button>
          <button type="button" class="segment" [attr.aria-pressed]="mark() === 'data'" (click)="mark.set('data')">First row of data</button>
        </div>
        <span class="muted tip">Shift-click on a row after the names makes them take more rows (a group's name over the names).</span>
      </div>

      <p class="found" [class.is-bad]="!!problem()">
        @if (problem(); as why) {
          <app-icon name="alert" [size]="14" /> {{ why }}
        } @else {
          <strong>{{ columns() }}</strong> column{{ columns() === 1 ? '' : 's' }} named · <strong>{{ rows() }}</strong> row{{ rows() === 1 ? '' : 's' }} of data
        }
      </p>

      <div class="wrap">
        <table class="grid">
          <thead>
            <tr>
              <th class="rn"></th>
              <th class="role"></th>
              @for (letter of heads(); track $index) {
                <th>{{ letter }}</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of peek().rows; track row.row) {
              <tr [class]="kind(row.row)" [attr.data-row]="row.row">
                <th class="rn" scope="row">
                  <button type="button" class="num" (click)="click(row.row, $event)" [title]="mark() === 'names' ? 'This row holds the column names' : 'The raw data starts on this row'">{{ row.row }}</button>
                </th>
                <th class="role" scope="row">{{ role(row.row) }}</th>
                @for (cell of row.cells; track $index) {
                  <td [title]="cell">{{ cell }}</td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (peek().total > peek().rows.length) {
        <p class="muted more">The first {{ peek().rows.length }} of {{ peek().total }} rows are shown.</p>
      }
    </section>
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 0; }
    .layout { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px; border: var(--hairline) solid var(--border); border-radius: var(--radius-md); background: var(--surface-solid); padding: 10px 14px 12px; }
    .bar { display: flex; align-items: flex-end; gap: 14px; flex-wrap: wrap; }
    .field { display: flex; flex-direction: column; gap: 3px; font-size: 0.75rem; color: var(--text-muted); }
    .field input { width: 92px; }
    .grow { flex: 1; }
    .pick { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 0.8125rem; }
    .tip { font-size: 0.75rem; }
    .found { margin: 0; font-size: 0.8125rem; display: flex; align-items: center; gap: 6px; }
    .found.is-bad { color: var(--danger); }
    .wrap { flex: 1; min-height: 120px; overflow: auto; border: var(--hairline) solid var(--border-strong); border-radius: var(--radius-sm); }
    .grid { border-collapse: separate; border-spacing: 0; font-size: 0.8125rem; line-height: 1.3; min-width: 100%; }
    .grid th, .grid td { padding: 3px 10px; border-bottom: var(--hairline) solid var(--border); border-right: var(--hairline) solid var(--border); white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; text-align: left; font-weight: 400; }
    .grid thead th { position: sticky; top: 0; z-index: 2; background: var(--fill); color: var(--text-muted); font-size: 0.75rem; font-weight: 600; text-align: center; }
    .grid .rn { position: sticky; left: 0; z-index: 1; background: var(--fill); padding: 0; width: 44px; min-width: 44px; text-align: center; }
    .grid thead .rn { z-index: 3; }
    .grid .role { position: sticky; left: 44px; z-index: 1; background: var(--fill); width: 96px; min-width: 96px; font-size: 0.6875rem; color: var(--text-muted); text-align: left; }
    .grid thead .role { z-index: 3; }
    .num { display: block; width: 100%; padding: 3px 8px; border: 0; background: none; color: var(--text-muted); font: inherit; font-variant-numeric: tabular-nums; cursor: pointer; }
    .num:hover { background: var(--surface-hover); color: var(--text); }
    tr.names td { background: var(--accent-soft); font-weight: 600; }
    tr.names .role { color: var(--accent); font-weight: 600; background: var(--accent-soft); }
    tr.names .rn { background: var(--accent-soft); }
    tr.names .num { color: var(--accent); font-weight: 600; }
    tr.skip td, tr.skip .role { color: var(--text-muted); opacity: 0.6; }
    tr.start td { border-top: 2px solid var(--accent); }
    tr.start .role { color: var(--accent); font-weight: 600; }
    .more { margin: 0; font-size: 0.75rem; }
  `,
})
export class ImportLayout {
  readonly peek = input.required<FilePeek>();
  readonly layout = input.required<FileLayout>();
  /** The rows the file's own layout points at (what "Find them again" goes back to). */
  readonly detected = input.required<FileLayout>();
  /** What the layout gives: the columns it names and the rows of data under it. */
  readonly columns = input(0);
  readonly rows = input(0);
  readonly layoutChange = output<FileLayout>();

  /** What a click on a row's number marks it as. */
  readonly mark = signal<Mark>('names');

  /** The last row a layout can point at. */
  readonly most = computed(() => Math.max(1, this.peek().total));
  readonly heads = computed(() => Array.from({ length: this.peek().columns }, (_, index) => letters(index + 1)));
  readonly isDetected = computed(() => sameLayout(this.layout(), this.detected()));
  /** What's wrong with the layout (the import can't go on), if anything. */
  readonly problem = computed(() => {
    if (!this.columns()) return 'No column names are in those rows. Move the names to the row that holds them.';
    if (!this.rows()) return `There is no data from row ${this.layout().dataFrom}. Move the start of the data up to the first row of data.`;
    return '';
  });

  kind(row: number) {
    const { headerFrom, headerTo, dataFrom } = this.layout();
    if (row >= headerFrom && row <= headerTo) return 'names';
    if (row < headerFrom || row < dataFrom) return 'skip';
    return row === dataFrom ? 'start' : 'data';
  }

  role(row: number) {
    switch (this.kind(row)) {
      case 'names':
        return 'Column names';
      case 'skip':
        return 'Not used';
      case 'start':
        return 'Data starts';
      default:
        return '';
    }
  }

  /** A row number typed: the names that move take the data under them along when it was right below. */
  typed(field: keyof FileLayout, event: Event) {
    const box = event.target as HTMLInputElement;
    const value = Math.floor(box.valueAsNumber);
    const now = this.layout();
    // Not a number (cleared): the box shows what the layout is again. A number that doesn't fit shows the one that was used.
    const fixed = Number.isFinite(value) ? fixLayout(this.change(now, field, value), this.most()) : now;
    box.value = String(fixed[field]);
    this.apply(fixed);
  }

  /** A click on a row's number: it's the names, or where the data starts. Shift-click gives the names more rows. */
  click(row: number, event: MouseEvent) {
    const now = this.layout();
    if (this.mark() === 'data') return this.apply(fixLayout(this.change(now, 'dataFrom', row), this.most()));
    if (event.shiftKey && row > now.headerFrom) return this.apply(fixLayout(this.change(now, 'headerTo', row), this.most()));
    return this.apply(fixLayout(this.change(now, 'headerFrom', row, true), this.most()));
  }

  private change(now: FileLayout, field: keyof FileLayout, value: number, single = false): FileLayout {
    const joined = now.dataFrom === now.headerTo + 1;
    if (field === 'headerFrom') {
      const span = single ? 0 : now.headerTo - now.headerFrom;
      const headerTo = value + Math.min(span, MAX_HEADER_ROWS - 1);
      return { headerFrom: value, headerTo, dataFrom: joined || single ? headerTo + 1 : now.dataFrom };
    }
    if (field === 'headerTo') {
      const headerTo = Math.max(value, now.headerFrom);
      return { ...now, headerTo, dataFrom: joined ? headerTo + 1 : now.dataFrom };
    }
    return { ...now, dataFrom: value };
  }

  private apply(fixed: FileLayout) {
    if (!sameLayout(fixed, this.layout())) this.layoutChange.emit(fixed);
  }
}
