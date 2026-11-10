import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import { Api, errorText } from '../core/api';
import type { Column, Row, SheetWithRows } from '../core/models';
import { Toasts } from '../core/toast';
import { WorkbookStore } from '../core/workbook-store';
import type { ColumnRequest, SheetEngine } from './univer-engine';
import {
  CELL_TEXT,
  columnStyleId,
  computedCell,
  diffRecords,
  fromGridCell,
  headerCells,
  MIN_SPARE_ROWS,
  orderChanged,
  sameCell,
  toGridCell,
  type GridCell,
  type GridRecord,
} from './univer-layout';

export type { ColumnRequest } from './univer-engine';

/** Univer's look, from its packages (copied to vendor/univer by the build): loaded with the first sheet. */
const UNIVER_STYLES = ['core', 'filter', 'sort', 'conditional-formatting', 'data-validation'];
let stylesLoaded: Promise<void> | null = null;

function loadStyles() {
  stylesLoaded ??= Promise.all(
    UNIVER_STYLES.map(
      (name) =>
        new Promise<void>((resolve) => {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = `vendor/univer/${name}/index.css`;
          link.onload = () => resolve();
          link.onerror = () => resolve();
          document.head.appendChild(link);
        }),
    ),
  ).then(() => undefined);
  return stylesLoaded;
}

/** What, changed, makes the grid built again: the columns (their widths aside) and the tab's name. */
function structureKey(sheet: SheetWithRows) {
  return `${sheet.sheetId}\u0000${sheet.title}\u0000${JSON.stringify(sheet.columns.map(({ width: _width, ...column }) => column))}`;
}

/** Saved for each table on this Mac: the columns kept in view, and the colour rules. */
const frozenKey = (sheetId: number) => `sheet.${sheetId}.frozenColumns`;
const formatsKey = (sheetId: number) => `sheet.${sheetId}.conditionalFormats`;

/** After an edit, save once the typing settles (a paste or a fill is many changes at once). */
const SAVE_DELAY_MS = 120;

/**
 * A table as a full spreadsheet — Univer, as the system's sheet view has it:
 * its toolbar, formula bar, filters, sorting, conditional formatting, a list
 * to pick from in a choice or link column. Every change is saved on this Mac
 * as it's made (no Save button): typed, pasted, filled, undone, a row
 * inserted, deleted or sorted. A formula column is worked out by the app, as
 * on the table's page and in Power BI; its cells aren't typed in.
 */
@Component({
  selector: 'app-univer-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #host class="host"></div>
    @if (!ready()) {
      <div class="opening"><span class="spinner" aria-hidden="true"></span> Opening the sheet…</div>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: flex;
      flex: 1;
      min-height: 0;
      background: var(--surface-solid);
    }
    .host {
      flex: 1;
      min-width: 0;
      min-height: 0;
    }
    .opening {
      position: absolute;
      inset: 0;
      display: grid;
      place-content: center;
      grid-auto-flow: column;
      gap: 10px;
      align-items: center;
      color: var(--text-muted);
      font-size: 0.875rem;
      background: var(--surface-solid);
    }
  `,
})
export class UniverSheet {
  readonly sheet = input.required<SheetWithRows>();
  /** A column to edit, add, delete or move: the page's dialogs do it. */
  readonly columnRequest = output<ColumnRequest>();

  private readonly store = inject(WorkbookStore);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');

  readonly ready = signal(false);
  private engine: SheetEngine | null = null;
  private destroyed = false;

  /** The table shown, and what it was built from. */
  private builtSheetId = -1;
  private builtKey = '';
  private knownRows: readonly Row[] | null = null;

  private dirty = false;
  private syncing: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private rebuilding: Promise<void> | null = null;
  private rebuildAgain = false;
  private markers = 0;
  private lastHint = 0;

  constructor() {
    afterNextRender(() => void this.start());
    effect(() => {
      const sheet = this.sheet();
      this.store.formulas();
      untracked(() => this.sheetChanged(sheet));
    });
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  private async start() {
    await loadStyles();
    const { SheetEngine } = await import('./univer-engine');
    if (this.destroyed) return;
    const container = document.createElement('div');
    container.style.width = '100%';
    container.style.height = '100%';
    this.host().nativeElement.appendChild(container);
    this.engine = new SheetEngine(container, {
      changed: () => this.schedule(),
      blocked: (message) => this.hint(message),
      column: (request) => this.columnRequest.emit(request),
      resized: (index, width) => void this.saveWidth(index, width),
      frozen: (columns) =>
        void this.api
          .setSetting(frozenKey(this.builtSheetId), String(columns))
          .catch(() => undefined),
      formatsChanged: (rules) =>
        void this.api
          .setSetting(formatsKey(this.builtSheetId), rules.length ? JSON.stringify(rules) : null)
          .catch(() => undefined),
    });
    await this.build();
    this.ready.set(true);
  }

  private stop() {
    this.destroyed = true;
    clearTimeout(this.timer);
    const engine = this.engine;
    if (!engine) return;
    // What's typed and not yet saved is saved first; then the grid goes.
    void (async () => {
      await engine.finishEditing();
      if (this.dirty || this.syncing) await this.flush();
      engine.dispose();
    })();
  }

  /** Builds the grid from the table as the app keeps it now. */
  private async build() {
    const engine = this.engine;
    if (!engine) return;
    const sheetId = this.sheet().sheetId;
    const [frozen, formats] = await Promise.all([
      this.api.getSetting(frozenKey(sheetId)).catch(() => null),
      this.api.getSetting(formatsKey(sheetId)).catch(() => null),
    ]);
    if (this.destroyed) return;
    const sheet = this.store.sheet(sheetId) ?? this.sheet();
    const formulas = this.store.formulas();
    let conditionalFormats: unknown[] = [];
    try {
      conditionalFormats = formats ? (JSON.parse(formats) as unknown[]) : [];
    } catch {
      conditionalFormats = [];
    }
    engine.open({
      unitId: `table-${sheet.sheetId}`,
      title: sheet.title,
      columns: sheet.columns,
      rows: sheet.rows,
      computed: (row, column) => formulas.value(sheet, row, column),
      linkOptions: (column) => this.store.linkOptions(column),
      fontFamily: getComputedStyle(this.host().nativeElement).fontFamily,
      // The first column (the zone, the variety, the batch) kept in view, unless changed.
      frozenColumns: frozen === null ? 1 : Number(frozen) || 0,
      conditionalFormats,
    });
    this.builtSheetId = sheet.sheetId;
    this.builtKey = structureKey(sheet);
    this.knownRows = sheet.rows;
  }

  /** The table changed in the app: its columns (or another table picked) build the grid again; rows changed elsewhere (an import) too. */
  private sheetChanged(sheet: SheetWithRows) {
    if (!this.ready() || !this.engine) return;
    if (sheet.sheetId !== this.builtSheetId || structureKey(sheet) !== this.builtKey) {
      this.rebuild();
      return;
    }
    // Rows changing while saving are this grid's own saves.
    if (this.syncing || this.dirty || this.rebuilding) return;
    if (sheet.rows !== this.knownRows) this.rebuild();
  }

  private rebuild() {
    if (this.rebuilding) {
      this.rebuildAgain = true;
      return;
    }
    this.rebuilding = (async () => {
      do {
        this.rebuildAgain = false;
        await this.engine?.finishEditing();
        await this.flush();
        if (this.destroyed) return;
        await this.build();
      } while (this.rebuildAgain && !this.destroyed);
    })().finally(() => {
      this.rebuilding = null;
    });
  }

  private hint(message: string) {
    // Once now and then, not on every key.
    const now = Date.now();
    if (now - this.lastHint < 1500) return;
    this.lastHint = now;
    this.toasts.show(message, 'info');
  }

  private async saveWidth(index: number, width: number) {
    const sheet = this.store.sheet(this.builtSheetId);
    const column = sheet?.columns[index];
    if (!sheet || !column || column.width === width) return;
    try {
      await this.store.saveColumns(
        sheet.sheetId,
        sheet.columns.map((item, at) => (at === index ? { ...item, width } : item)),
      );
    } catch (error) {
      this.toasts.error(errorText(error));
    }
  }

  // ------------------------------------------------------------- saving

  private schedule() {
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), SAVE_DELAY_MS);
  }

  /** Saves what changed in the grid; resolves once it's all saved. */
  private flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.syncing) return this.syncing;
    if (!this.dirty) return Promise.resolve();
    let reload = false;
    this.syncing = (async () => {
      try {
        while (this.dirty) {
          this.dirty = false;
          if (!(await this.syncOnce())) {
            reload = true;
            break;
          }
        }
      } catch (error) {
        this.toasts.error(`Not saved: ${errorText(error)}`);
      } finally {
        this.knownRows = this.store.sheet(this.builtSheetId)?.rows ?? null;
        this.syncing = null;
      }
      if (reload && !this.destroyed) this.rebuild();
    })();
    return this.syncing;
  }

  /** One round: the grid read, the differences saved, then the grid tidied as the app keeps it. False: the grid must be built again. */
  private async syncOnce(): Promise<boolean> {
    const engine = this.engine;
    const plan = engine?.gridPlan;
    const sheetId = this.builtSheetId;
    const sheet = this.store.sheet(sheetId);
    if (!engine || !plan || !sheet) return true;
    const options = (column: Column) => this.store.linkOptions(column);
    const records = engine.readRecords();
    const diff = diffRecords(records, sheet.rows, plan.columns, options);

    // Rows that lost their record's ID (pasted or cleared over the hidden
    // column) look like every record deleted and typed again: not saved so.
    if (diff.deletions.length > 3 && diff.additions.length >= diff.deletions.length) {
      this.toasts.show(
        'The sheet was opened again as saved: its rows had lost track of their records.',
        'error',
      );
      return false;
    }

    // New rows marked, so each gets its record's ID wherever it has moved meanwhile.
    const markers = diff.additions.map(() => `new-${++this.markers}`);
    engine.write([
      ...diff.additions.map((addition, index) => ({
        row: addition.row,
        column: plan.idColumn,
        cell: { v: markers[index], t: CELL_TEXT },
      })),
      ...diff.staleIds.map((row) => ({ row, column: plan.idColumn, cell: { v: null } })),
    ]);

    if (diff.changes.length) await this.store.updateCells(sheetId, diff.changes);
    if (diff.deletions.length) await this.store.deleteRows(sheetId, diff.deletions);
    const added = new Map<string, number>();
    if (diff.additions.length) {
      const saved = await this.store.addRows(
        sheetId,
        diff.additions.map((addition) => addition.values),
      );
      const at = engine.rowsWithId(new Set(markers));
      const ids: { row: number; column: number; cell: GridCell }[] = [];
      saved.forEach((row, index) => {
        const gridRow = at.get(markers[index]);
        added.set(markers[index], row.rowId);
        if (gridRow !== undefined)
          ids.push({
            row: gridRow,
            column: plan.idColumn,
            cell: { v: String(row.rowId), t: CELL_TEXT },
          });
      });
      engine.write(ids);
    }

    // The records' order, as they stand in the grid (a sort, a move, rows inserted between).
    const now = this.store.sheet(sheetId);
    if (now) {
      const order = diff.additions.length ? engine.recordRows().map(({ id }) => id) : diff.order;
      if (orderChanged(order, now.rows)) await this.store.reorderRows(sheetId, order);
    }
    const touched = new Set([...diff.changes.map((change) => change.rowId), ...added.values()]);
    // The cells saved this round (the only ones whose text may need its kept form).
    const recordOf = new Map<number, GridRecord>();
    for (const record of records) {
      const id = /^\d+$/.test(record.idText) ? Number(record.idText) : NaN;
      if (!recordOf.has(id)) recordOf.set(id, record);
    }
    const saved: { record: GridRecord; key: string }[] = [];
    for (const change of diff.changes) {
      const record = recordOf.get(change.rowId);
      if (record) saved.push({ record, key: change.key });
    }
    const addedRows = new Set(diff.additions.map((addition) => addition.row));
    for (const record of records) {
      if (!addedRows.has(record.row)) continue;
      for (const [key, cell] of Object.entries(record.cells)) if (cell) saved.push({ record, key });
    }
    this.tidy(saved, touched, records);
    return true;
  }

  /**
   * The grid as the app keeps the table: values in their kept form (a date
   * pasted as text becomes the date), the formula columns worked out, the
   * header put back if pasted over, nothing left in the spare columns, and
   * room for more rows.
   */
  private tidy(
    saved: { record: GridRecord; key: string }[],
    touched: Set<number>,
    records: GridRecord[],
  ) {
    const engine = this.engine;
    const plan = engine?.gridPlan;
    const sheet = this.store.sheet(this.builtSheetId);
    if (!engine || !plan || !sheet) return;
    // Room for more rows first, the columns' look on any Univer added (a long paste).
    const last = records.reduce((max, record) => Math.max(max, record.row), plan.recordsFrom - 1);
    engine.keepSpareRows(last, MIN_SPARE_ROWS);
    const writes: { row: number; column: number; cell: GridCell | null }[] = [];
    const styled: { row: number; column: number; cell: GridCell | null }[] = [];

    // The values saved, in their kept form (a date pasted as text becomes the
    // date), where nothing changed them since they were read.
    const indexOf = new Map(plan.columns.map((column, index) => [column.key, index]));
    for (const { record, key } of saved) {
      const index = indexOf.get(key);
      const column = index === undefined ? undefined : plan.columns[index];
      const cell = record.cells[key];
      if (index === undefined || !column || column.type === 'formula' || !cell || cell.f) continue;
      const now = engine.cellAt(record.row, index);
      if (!sameCell(now, cell)) continue;
      const kept = fromGridCell(column, cell, this.store.linkOptions(column));
      const canonical = toGridCell(column, kept.error ? String(cell.v).trim() : kept.value);
      if (!sameCell(now, canonical))
        writes.push({
          row: record.row,
          column: index,
          cell: { v: canonical?.v ?? null, t: canonical?.t ?? null, p: null, s: columnStyleId(column) },
        });
    }

    // The formula columns, worked out again where the rows changed (every row
    // when a formula reads this table's own columns by its name).
    const formulaColumns = plan.columns
      .map((column, index) => ({ column, index }))
      .filter(({ column }) => column.type === 'formula');
    const title = sheet.title.toLowerCase();
    const readsItself = formulaColumns.some(({ column }) => {
      const formula = (column.formula ?? '').toLowerCase();
      return formula.includes(`${title}'[`) || formula.includes(`${title}[`);
    });
    if (formulaColumns.length && (touched.size || readsItself)) {
      const formulas = this.store.formulas();
      const byId = new Map(sheet.rows.map((row) => [row.rowId, row]));
      for (const { row: gridRow, id } of engine.recordRows()) {
        const row = byId.get(id);
        if (!row || (!readsItself && !touched.has(id))) continue;
        for (const { column, index } of formulaColumns) {
          const cell = computedCell(formulas.value(sheet, row, column));
          if (sameCell(engine.cellAt(gridRow, index), cell)) continue;
          styled.push({
            row: gridRow,
            column: index,
            cell: { v: cell?.v ?? null, t: cell?.t ?? null, s: cell?.s ?? null },
          });
        }
      }
    }

    // The header and the formula row as the columns say (a paste over them undone).
    const header = headerCells(plan);
    for (const [row, cells] of Object.entries(header)) {
      for (const [column, cell] of Object.entries(cells)) {
        const now = engine.cellAt(Number(row), Number(column));
        if (now?.v !== cell.v) styled.push({ row: Number(row), column: Number(column), cell });
      }
    }

    // Nothing kept right of the table's columns (pasted wider than the table).
    const spare = engine.spareCells();
    if (spare.length) {
      for (const { row, column } of spare)
        writes.push({ row, column, cell: { v: null, f: null, p: null } });
      this.toasts.show(
        `${spare.length} cell${spare.length === 1 ? '' : 's'} right of the table weren’t kept: add the column first (click an empty header cell).`,
        'info',
      );
    }

    engine.write(writes);
    engine.write(styled, true);
  }
}
