import {
  afterNextRender,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';

import type { CellChange, Cells, Column, Row, SheetWithRows } from '../../core/models';
import { formatFormulaValue, isFormulaError } from '../../formula/evaluate-formula';
import type { WorkbookFormulas } from '../../formula/sheet-formulas';
import {
  alignsRight,
  checkCell,
  columnLabel,
  defaultWidth,
  displayCell,
  formatDate,
  isIsoDate,
  typeLabel,
} from '../../sheet/columns';
import { Icon } from '../icon';
import { parseTsv, toTsv } from './tsv';

export type ColumnAction =
  | 'edit'
  | 'insert-left'
  | 'insert-right'
  | 'move-left'
  | 'move-right'
  | 'delete'
  | 'sort-asc'
  | 'sort-desc'
  | 'resize';

export type RowAction = 'insert-above' | 'insert-below' | 'delete';

interface Cell {
  r: number;
  c: number;
}

interface Span {
  label: string;
  span: number;
  start: number;
}

const ROW_H = 30;
const ROW_HEAD_W = 56;
const LETTER_H = 22;
const BOX_H = 28;
const GROUP_H = 24;
const NAME_H = 40;
const OVERSCAN = 10;

function columnLetter(index: number) {
  let n = index;
  let letters = '';
  while (n > 0) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** A key that types a character (named keys are words: "Shift", "F5", "Dead"). */
function isCharacter(event: KeyboardEvent) {
  return !event.metaKey && !event.ctrlKey && !event.altKey && event.key.length > 0 && !/^[A-Z][A-Za-z0-9]+$/.test(event.key);
}

const TYPE_MARK: Record<string, string> = {
  number: '#',
  percentage: '%',
  date: '▦',
  choice: '▾',
  yesno: '✓',
  link: '↗',
  formula: 'ƒ',
  text: '',
};

/**
 * A table as a sheet: click a cell and type, Enter or Tab to move on,
 * arrows to get around, shift for a block, ⌘C / ⌘V with Excel or Google
 * Sheets, Delete to empty cells. The last row is always blank: type in it
 * to add a row. Formula columns are worked out, not typed.
 */
@Component({
  selector: 'app-sheet-grid',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sheet-grid.html',
  styleUrl: './sheet-grid.css',
  host: { '(document:mouseup)': 'dragging = false; endResize()', '(document:mousemove)': 'moveResize($event)' },
})
export class SheetGrid {
  readonly sheet = input.required<SheetWithRows>();
  /** The rows to show, in order (the page sorts and filters) — read live, so
   * a row added by one keystroke is there for the next one. */
  readonly rowsSource = input.required<() => Row[]>();
  readonly rows = computed(() => this.rowsSource()());
  readonly formulas = input.required<WorkbookFormulas>();
  readonly linkOptions = input.required<(column: Column) => string[]>();
  readonly allowAdd = input(true);

  readonly edit = output<CellChange[]>();
  readonly addRows = output<Cells[]>();
  readonly columnAction = output<{ action: ColumnAction; column: Column; index: number; width?: number }>();
  readonly rowAction = output<{ action: RowAction; rowIds: number[]; row: Row | null }>();

  private readonly scroller = viewChild.required<ElementRef<HTMLDivElement>>('scroller');
  private readonly clip = viewChild.required<ElementRef<HTMLTextAreaElement>>('clip');
  private readonly editor = viewChild<ElementRef<HTMLInputElement>>('editor');

  private readonly changes = inject(ChangeDetectorRef);
  readonly rowHeight = ROW_H;
  readonly rowHeadWidth = ROW_HEAD_W;

  readonly columns = computed(() => this.sheet().columns);
  readonly options = computed(() => {
    const options = new Map<string, string[]>();
    for (const column of this.columns()) {
      if (column.type === 'link') options.set(column.key, this.linkOptions()(column));
    }
    return options;
  });

  // ---------------------------------------------------------- layout
  readonly widthOverride = signal<{ key: string; width: number } | null>(null);
  readonly widths = computed(() => {
    const override = this.widthOverride();
    return this.columns().map((column) =>
      override && override.key === column.key ? override.width : defaultWidth(column),
    );
  });
  readonly offsets = computed(() => {
    const offsets: number[] = [];
    let left = ROW_HEAD_W;
    for (const width of this.widths()) {
      offsets.push(left);
      left += width;
    }
    return offsets;
  });
  readonly totalWidth = computed(() => this.widths().reduce((sum, width) => sum + width, ROW_HEAD_W));

  readonly boxSpans = computed(() => this.spans((column) => column.box ?? ''));
  readonly groupSpans = computed(() => this.spans((column) => `${column.box ?? ''}\u0000${column.group ?? ''}`, (column) => column.group ?? ''));
  readonly showBoxes = computed(() => this.columns().some((column) => column.box));
  readonly showGroups = computed(() => this.columns().some((column) => column.group));
  readonly letterHeight = LETTER_H;
  readonly boxTop = LETTER_H;
  readonly groupTop = computed(() => LETTER_H + (this.showBoxes() ? BOX_H : 0));
  readonly nameTop = computed(() => this.groupTop() + (this.showGroups() ? GROUP_H : 0));
  /** Each column's letter, as a sheet heads them: A … Z, AA … */
  readonly letters = computed(() => this.columns().map((_, index) => columnLetter(index + 1)));
  readonly headerHeight = computed(() => this.nameTop() + NAME_H);

  private spans(key: (column: Column) => string, label: (column: Column) => string = key): Span[] {
    const spans: Span[] = [];
    this.columns().forEach((column, index) => {
      const last = spans.at(-1);
      const previous = index > 0 ? this.columns()[index - 1] : null;
      if (last && previous && key(previous) === key(column)) last.span += 1;
      else spans.push({ label: label(column), span: 1, start: index });
    });
    return spans;
  }

  // ------------------------------------------------------- windowing
  readonly scrollTop = signal(0);
  readonly viewHeight = signal(600);
  readonly rowTotal = computed(() => this.rows().length + (this.allowAdd() ? 1 : 0));
  readonly first = computed(() => Math.max(0, Math.floor(this.scrollTop() / ROW_H) - OVERSCAN));
  readonly last = computed(() =>
    Math.min(this.rowTotal(), Math.ceil((this.scrollTop() + this.viewHeight()) / ROW_H) + OVERSCAN),
  );
  readonly visible = computed(() => {
    const rows = this.rows();
    const out: { r: number; row: Row | null }[] = [];
    for (let r = this.first(); r < this.last(); r += 1) out.push({ r, row: rows[r] ?? null });
    return out;
  });
  readonly topPad = computed(() => this.first() * ROW_H);
  readonly bottomPad = computed(() => Math.max(0, (this.rowTotal() - this.last()) * ROW_H));

  // ------------------------------------------------------- selection
  readonly active = signal<Cell>({ r: 0, c: 0 });
  readonly anchor = signal<Cell>({ r: 0, c: 0 });
  readonly editing = signal(false);
  readonly draft = signal('');
  private typedEdit = false;
  dragging = false;

  readonly range = computed(() => {
    const a = this.anchor();
    const b = this.active();
    return {
      top: Math.min(a.r, b.r),
      bottom: Math.max(a.r, b.r),
      left: Math.min(a.c, b.c),
      right: Math.max(a.c, b.c),
    };
  });

  /** The saved rows the selection covers (for Delete rows). */
  readonly selectedRows = computed(() => {
    const { top, bottom } = this.range();
    const rows = this.rows();
    const ids: number[] = [];
    for (let r = top; r <= bottom && r < rows.length; r += 1) ids.push(rows[r].rowId);
    return ids;
  });

  readonly activeColumn = computed(() => this.columns()[this.active().c] ?? null);
  readonly activeRow = computed(() => this.rows()[this.active().r] ?? null);

  // ---------------------------------------------------------- menu
  readonly menu = signal<{ kind: 'column' | 'row'; x: number; y: number; index: number } | null>(null);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const element = this.scroller().nativeElement;
      this.viewHeight.set(element.clientHeight);
      const observer = new ResizeObserver(() => this.viewHeight.set(element.clientHeight));
      observer.observe(element);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  // ------------------------------------------------------- display

  typeMark(column: Column) {
    return TYPE_MARK[column.type] ?? '';
  }

  typeName(column: Column) {
    return typeLabel(column.type);
  }

  label(column: Column) {
    return columnLabel(column);
  }

  right(column: Column) {
    return alignsRight(column) || column.type === 'formula';
  }

  text(row: Row | null, column: Column): string {
    if (!row) return '';
    if (column.type === 'formula') {
      const value = this.formulas().value(this.sheet(), row, column);
      if (isFormulaError(value)) return value.code;
      if (typeof value === 'number' && !Number.isInteger(value)) return String(Number(value.toFixed(3)));
      const text = formatFormulaValue(value);
      return isIsoDate(text) ? formatDate(text) : text;
    }
    return displayCell(column, row.data[column.key]);
  }

  problem(row: Row | null, column: Column): string | null {
    return row ? this.formulas().problem(this.sheet(), row, column, this.options().get(column.key)) : null;
  }

  isActive(r: number, c: number) {
    const active = this.active();
    return active.r === r && active.c === c;
  }

  inRange(r: number, c: number) {
    const { top, bottom, left, right } = this.range();
    return r >= top && r <= bottom && c >= left && c <= right && (top !== bottom || left !== right);
  }

  rowSelected(r: number) {
    const { top, bottom } = this.range();
    return r >= top && r <= bottom;
  }

  columnSelected(c: number) {
    const { left, right } = this.range();
    return c >= left && c <= right;
  }

  listFor(column: Column): string[] {
    if (column.type === 'choice') return column.options ?? [];
    if (column.type === 'yesno') return ['Yes', 'No'];
    if (column.type === 'link') return this.options().get(column.key) ?? [];
    return [];
  }

  placeholder(column: Column) {
    if (column.type === 'date') return 'dd/mm/yyyy';
    if (column.type === 'yesno') return 'Yes / No';
    return '';
  }

  // ------------------------------------------------------- focus

  focus() {
    this.clip().nativeElement.focus({ preventScroll: true });
  }

  onScroll() {
    this.scrollTop.set(this.scroller().nativeElement.scrollTop);
    this.menu.set(null);
  }

  private clamp(cell: Cell): Cell {
    return {
      r: Math.max(0, Math.min(this.rowTotal() - 1, cell.r)),
      c: Math.max(0, Math.min(this.columns().length - 1, cell.c)),
    };
  }

  select(cell: Cell, extend = false) {
    const next = this.clamp(cell);
    this.active.set(next);
    if (!extend) this.anchor.set(next);
    this.ensureVisible(next);
  }

  private ensureVisible(cell: Cell) {
    const element = this.scroller().nativeElement;
    const top = cell.r * ROW_H;
    const bottom = top + ROW_H;
    const space = element.clientHeight - this.headerHeight();
    if (top < element.scrollTop) element.scrollTop = top;
    else if (bottom > element.scrollTop + space) element.scrollTop = bottom - space;
    const left = (this.offsets()[cell.c] ?? ROW_HEAD_W) - ROW_HEAD_W;
    const right = left + (this.widths()[cell.c] ?? 0);
    const room = element.clientWidth - ROW_HEAD_W;
    if (left < element.scrollLeft) element.scrollLeft = left;
    else if (right > element.scrollLeft + room) element.scrollLeft = right - room;
  }

  // ------------------------------------------------------- mouse

  cellDown(event: MouseEvent, r: number, c: number) {
    if (event.button !== 0) return;
    if (this.editing() && this.isActive(r, c)) return;
    event.preventDefault();
    if (this.editing()) this.commit();
    this.menu.set(null);
    this.select({ r, c }, event.shiftKey);
    this.dragging = true;
    this.focus();
  }

  cellEnter(r: number, c: number) {
    if (!this.dragging || this.editing()) return;
    this.active.set(this.clamp({ r, c }));
  }

  cellDouble(r: number, c: number) {
    this.select({ r, c });
    this.startEdit();
  }

  rowHeadDown(event: MouseEvent, r: number) {
    if (event.button !== 0) return;
    event.preventDefault();
    if (this.editing()) this.commit();
    const last = this.columns().length - 1;
    if (event.shiftKey) {
      this.anchor.update((anchor) => ({ r: anchor.r, c: 0 }));
      this.active.set(this.clamp({ r, c: last }));
    } else {
      this.anchor.set(this.clamp({ r, c: 0 }));
      this.active.set(this.clamp({ r, c: last }));
    }
    this.focus();
  }

  columnHeadDown(event: MouseEvent, c: number) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.col-menu-btn, .resize')) return;
    event.preventDefault();
    if (this.editing()) this.commit();
    const last = Math.max(0, this.rows().length - 1);
    if (event.shiftKey) this.anchor.update((anchor) => ({ r: 0, c: anchor.c }));
    else this.anchor.set({ r: 0, c });
    this.active.set({ r: last, c });
    this.focus();
  }

  openColumnMenu(event: MouseEvent, index: number) {
    event.preventDefault();
    event.stopPropagation();
    const target = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.type === 'contextmenu' ? event.clientX : target.left;
    const y = event.type === 'contextmenu' ? event.clientY : target.bottom + 4;
    this.menu.set({ kind: 'column', x: Math.min(x, window.innerWidth - 230), y: Math.min(y, window.innerHeight - 330), index });
  }

  openRowMenu(event: MouseEvent, r: number) {
    event.preventDefault();
    if (this.editing()) this.commit();
    if (!this.rowSelected(r)) this.select({ r, c: this.active().c });
    this.menu.set({ kind: 'row', x: Math.min(event.clientX, window.innerWidth - 230), y: Math.min(event.clientY, window.innerHeight - 200), index: r });
  }

  closeMenu() {
    this.menu.set(null);
  }

  columnMenu(action: ColumnAction) {
    const menu = this.menu();
    this.menu.set(null);
    if (!menu) return;
    const column = this.columns()[menu.index];
    if (column) this.columnAction.emit({ action, column, index: menu.index });
  }

  rowMenu(action: RowAction) {
    const menu = this.menu();
    this.menu.set(null);
    if (!menu) return;
    const row = this.rows()[menu.index] ?? null;
    this.rowAction.emit({ action, rowIds: this.selectedRows(), row });
    this.focus();
  }

  // ------------------------------------------------------- resizing
  private resizing: { key: string; startX: number; startWidth: number; index: number } | null = null;

  startResize(event: MouseEvent, index: number) {
    event.preventDefault();
    event.stopPropagation();
    const column = this.columns()[index];
    this.resizing = { key: column.key, startX: event.clientX, startWidth: this.widths()[index], index };
  }

  moveResize(event: MouseEvent) {
    if (!this.resizing) return;
    const width = Math.max(56, Math.min(600, this.resizing.startWidth + event.clientX - this.resizing.startX));
    this.widthOverride.set({ key: this.resizing.key, width });
  }

  endResize() {
    const resizing = this.resizing;
    this.resizing = null;
    const override = this.widthOverride();
    if (!resizing || !override) return;
    const column = this.columns()[resizing.index];
    if (column && override.width !== resizing.startWidth) {
      this.columnAction.emit({ action: 'resize', column, index: resizing.index, width: override.width });
    }
    // The saved width comes back with the column; until then, keep ours.
    setTimeout(() => this.widthOverride.set(null), 400);
  }

  // ------------------------------------------------------- editing

  startEdit(initial?: string) {
    const column = this.activeColumn();
    if (!column) return;
    if (column.type === 'formula') return;
    const row = this.activeRow();
    this.typedEdit = initial !== undefined;
    if (initial !== undefined) this.draft.set(initial);
    else {
      const raw = row?.data[column.key] ?? '';
      this.draft.set(displayCell(column, raw).replace(/%$/, ''));
    }
    this.anchor.set(this.active());
    this.editing.set(true);
    // The editor drawn and focused now, so the next key typed lands in it.
    this.changes.detectChanges();
    this.focusEditor();
    setTimeout(() => this.focusEditor());
  }

  private focusEditor() {
    const editor = this.editor()?.nativeElement;
    if (!editor || document.activeElement === editor) return;
    editor.focus({ preventScroll: true });
    const end = editor.value.length;
    editor.setSelectionRange(end, end);
  }

  cancelEdit() {
    this.editing.set(false);
    this.focus();
  }

  /** Saves what's typed into the active cell. */
  commit() {
    if (!this.editing()) return;
    this.editing.set(false);
    const column = this.activeColumn();
    if (!column) return;
    const { r } = this.active();
    const row = this.rows()[r] ?? null;
    const typed = this.draft();
    const value = typed.trim() ? checkCell(column, typed, this.options().get(column.key) ?? []).value : '';
    if (row) {
      if ((row.data[column.key] ?? '') !== value) this.edit.emit([{ rowId: row.rowId, key: column.key, value: value || null }]);
    } else if (value && this.allowAdd()) {
      this.addRows.emit([{ [column.key]: value }]);
    }
  }

  editorKey(event: KeyboardEvent) {
    if (event.isComposing) return;
    const { r, c } = this.active();
    switch (event.key) {
      case 'Enter':
        event.preventDefault();
        this.commit();
        this.select({ r: event.shiftKey ? r - 1 : r + 1, c });
        this.focus();
        break;
      case 'Tab':
        event.preventDefault();
        this.commit();
        this.select({ r, c: event.shiftKey ? c - 1 : c + 1 });
        this.focus();
        break;
      case 'Escape':
        event.preventDefault();
        this.cancelEdit();
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        if (!this.typedEdit) return;
        event.preventDefault();
        this.commit();
        this.select({ r: r + (event.key === 'ArrowUp' ? -1 : 1), c });
        this.focus();
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        if (!this.typedEdit) return;
        event.preventDefault();
        this.commit();
        this.select({ r, c: c + (event.key === 'ArrowLeft' ? -1 : 1) });
        this.focus();
        break;
    }
  }

  editorBlur() {
    // Clicking another cell commits through cellDown; anywhere else, here.
    setTimeout(() => {
      if (this.editing() && document.activeElement !== this.editor()?.nativeElement) this.commit();
    });
  }

  // ------------------------------------------------------- keyboard

  key(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (this.editing()) {
      // Typed before the cell's editor had the focus: still the cell's.
      if (isCharacter(event)) {
        event.preventDefault();
        this.draft.update((draft) => draft + event.key);
        this.focusEditor();
      } else this.editorKey(event);
      return;
    }
    const { r, c } = this.active();
    const meta = event.metaKey || event.ctrlKey;
    const move = (dr: number, dc: number) => {
      event.preventDefault();
      if (meta) {
        // To the edge, as a sheet does.
        const target = { r: dr ? (dr < 0 ? 0 : this.rowTotal() - 1) : r, c: dc ? (dc < 0 ? 0 : this.columns().length - 1) : c };
        this.select(target, event.shiftKey);
      } else this.select({ r: r + dr, c: c + dc }, event.shiftKey);
    };
    switch (event.key) {
      case 'ArrowUp':
        return move(-1, 0);
      case 'ArrowDown':
        return move(1, 0);
      case 'ArrowLeft':
        return move(0, -1);
      case 'ArrowRight':
        return move(0, 1);
      case 'Tab':
        event.preventDefault();
        return this.select({ r, c: c + (event.shiftKey ? -1 : 1) });
      case 'Enter':
        event.preventDefault();
        if (event.shiftKey) return this.select({ r: r - 1, c });
        return this.startEdit();
      case 'F2':
        event.preventDefault();
        return this.startEdit();
      case 'Escape':
        this.menu.set(null);
        return this.anchor.set(this.active());
      case 'Backspace':
      case 'Delete':
        event.preventDefault();
        return this.clearRange();
      case 'PageDown':
      case 'PageUp': {
        event.preventDefault();
        const page = Math.max(1, Math.floor((this.viewHeight() - this.headerHeight()) / ROW_H) - 1);
        return this.select({ r: r + (event.key === 'PageDown' ? page : -page), c }, event.shiftKey);
      }
      case 'Home':
        event.preventDefault();
        return this.select({ r: meta ? 0 : r, c: 0 }, event.shiftKey);
      case 'End':
        event.preventDefault();
        return this.select({ r: meta ? this.rowTotal() - 1 : r, c: this.columns().length - 1 }, event.shiftKey);
    }
    if (meta) {
      const letter = event.key.toLowerCase();
      if (letter === 'a') {
        event.preventDefault();
        this.anchor.set({ r: 0, c: 0 });
        this.active.set(this.clamp({ r: this.rows().length - 1, c: this.columns().length - 1 }));
      } else if (letter === 'c' || letter === 'x') {
        // The native copy reads the hidden box's selected text.
        const clip = this.clip().nativeElement;
        clip.value = this.selectionTsv();
        clip.select();
      }
      return;
    }
    // A character starts typing over the cell.
    if (isCharacter(event)) {
      event.preventDefault();
      this.startEdit(event.key);
    }
  }

  /** Text typed by an input method (Khmer, Thai…) into the hidden box. */
  clipInput(event: Event) {
    const clip = event.target as HTMLTextAreaElement;
    if ((event as InputEvent).isComposing || this.editing()) return;
    const text = clip.value;
    clip.value = '';
    if (text) this.startEdit(text);
  }

  compositionEnd(event: CompositionEvent) {
    const clip = event.target as HTMLTextAreaElement;
    const text = clip.value || event.data;
    clip.value = '';
    if (text && !this.editing()) this.startEdit(text);
  }

  private selectionTsv(): string {
    const { top, bottom, left, right } = this.range();
    const columns = this.columns();
    const out: string[][] = [];
    for (let r = top; r <= bottom; r += 1) {
      const row = this.rows()[r] ?? null;
      if (!row) continue;
      const cells: string[] = [];
      for (let c = left; c <= right; c += 1) cells.push(this.text(row, columns[c]));
      out.push(cells);
    }
    return toTsv(out);
  }

  copied(event: ClipboardEvent) {
    if (this.editing()) return;
    event.preventDefault();
    event.clipboardData?.setData('text/plain', this.selectionTsv());
  }

  cut(event: ClipboardEvent) {
    if (this.editing()) return;
    this.copied(event);
    this.clearRange();
  }

  private clearRange() {
    const { top, bottom, left, right } = this.range();
    const changes: CellChange[] = [];
    for (let r = top; r <= bottom; r += 1) {
      const row = this.rows()[r];
      if (!row) continue;
      for (let c = left; c <= right; c += 1) {
        const column = this.columns()[c];
        if (column && column.type !== 'formula' && row.data[column.key]) changes.push({ rowId: row.rowId, key: column.key, value: null });
      }
    }
    if (changes.length) this.edit.emit(changes);
  }

  pasted(event: ClipboardEvent) {
    if (this.editing()) return;
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!text) return;
    let block = parseTsv(text);
    if (!block.length) return;
    const { top, bottom, left, right } = this.range();
    // One value over a block: every cell of the block gets it.
    if (block.length === 1 && block[0].length === 1 && (top !== bottom || left !== right)) {
      const value = block[0][0];
      const height = Math.min(bottom, this.rows().length - 1) - top + 1;
      block = Array.from({ length: Math.max(1, height) }, () => Array.from({ length: right - left + 1 }, () => value));
    }
    const columns = this.columns();
    const changes: CellChange[] = [];
    const added: Cells[] = [];
    block.forEach((cells, i) => {
      const r = top + i;
      const row = this.rows()[r] ?? null;
      const fresh: Cells = {};
      cells.forEach((raw, j) => {
        const column = columns[left + j];
        if (!column || column.type === 'formula') return;
        const value = raw.trim() ? checkCell(column, raw, this.options().get(column.key) ?? []).value : '';
        if (row) {
          if ((row.data[column.key] ?? '') !== value) changes.push({ rowId: row.rowId, key: column.key, value: value || null });
        } else if (value) fresh[column.key] = value;
      });
      if (!row && Object.keys(fresh).length) added.push(fresh);
    });
    if (changes.length) this.edit.emit(changes);
    if (added.length && this.allowAdd()) this.addRows.emit(added);
    const width = Math.max(...block.map((cells) => cells.length));
    this.anchor.set({ r: top, c: left });
    this.active.set(this.clamp({ r: top + block.length - 1, c: left + width - 1 }));
  }
}
