// The spreadsheet itself: Univer, set up as the system's sheet view has it
// (Staff_Attention_UI/src/modules/sheet/UniverSheetClient). Loaded with the
// sheet only (`import()` from UniverSheet): it is large.
import './fixes/selection-fill';
import './fixes/freeze-line';
import { UniverSheetsConditionalFormattingPreset } from '@univerjs/preset-sheets-conditional-formatting';
import sheetsConditionalFormattingEnUS from '@univerjs/preset-sheets-conditional-formatting/locales/en-US';
import {
  AFTER_CELL_EDIT,
  INTERCEPTOR_POINT,
  ISheetClipboardService,
  SheetInterceptorService,
  UniverSheetsCorePreset,
} from '@univerjs/preset-sheets-core';
import sheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US';
import { UniverSheetsDataValidationPreset } from '@univerjs/preset-sheets-data-validation';
import sheetsDataValidationEnUS from '@univerjs/preset-sheets-data-validation/locales/en-US';
import { UniverSheetsFilterPreset } from '@univerjs/preset-sheets-filter';
import sheetsFilterEnUS from '@univerjs/preset-sheets-filter/locales/en-US';
import { UniverSheetsSortPreset } from '@univerjs/preset-sheets-sort';
import sheetsSortEnUS from '@univerjs/preset-sheets-sort/locales/en-US';
import {
  createUniver,
  InterceptorEffectEnum,
  LifecycleStages,
  LocaleType,
  mergeLocales,
  type FUniver,
  type IDisposable,
  type Univer,
} from '@univerjs/presets';

import type { Column } from '../core/models';
import { checkCell } from '../sheet/columns';
import { installBarFocusHandback } from './fixes/bar-focus-handback';
import { installBarNoScroll } from './fixes/bar-no-scroll';
import { installCaretMirror } from './fixes/caret-mirror';
import { installFormulaBarSync } from './fixes/formula-bar-sync';
import { installFreezeMenus } from './fixes/freeze-menus';
import { HIDDEN_TOOLBAR_MENU } from './fixes/toolbar-items';
import { installUndoKeys } from './fixes/undo-keys';
import {
  buildWorkbookData,
  DATA_SHEET_ID,
  ERROR_TEXT,
  fromGridCell,
  HEADER_LABEL_COLOR,
  HEADER_LABEL_SIZE,
  INVALID_BACKGROUND,
  recordCells,
  SPARE_ROWS,
  toGridCell,
  type CellRange,
  type GridCell,
  type GridPlan,
  type GridRecord,
  type WorkbookInput,
} from './univer-layout';

type FWorkbook = ReturnType<FUniver['createWorkbook']>;

/** What the grid asks of the page around it. */
export type ColumnRequest =
  | { action: 'edit'; index: number }
  | { action: 'insert'; index: number; beside: number | null }
  | { action: 'delete'; indexes: number[] }
  | { action: 'move'; order: number[] };

export interface EngineHooks {
  /** A value, a row or the rows' order changed in the table's tab (typing, paste, fill, undo, sort…). */
  changed(): void;
  /** Something that can't be done here was tried: why, and what to do instead. */
  blocked(message: string): void;
  column(request: ColumnRequest): void;
  /** A table column's width dragged. */
  resized(index: number, width: number): void;
  /** The leading columns kept in view (the column header's Freeze). */
  frozen(columns: number): void;
  /** The colour rules (Conditional Formatting) as they are now. */
  formatsChanged(rules: unknown[]): void;
}

// Univer's commands this grid stands in front of: a table's columns are the
// app's (their types and formulas live there), a record's cells stay in its
// row, and the header stays put.
const COLUMN_INSERTS = new Set([
  'sheet.command.insert-col-before',
  'sheet.command.insert-col-after',
  'sheet.command.insert-multi-cols-before',
  'sheet.command.insert-multi-cols-right',
]);
const COLUMN_REMOVES = new Set([
  'sheet.command.remove-col-confirm',
  'sheet.command.remove-col-by-range',
  'sheet.command.remove-col',
]);
const COLUMN_MOVE = 'sheet.command.move-cols';
const SHIFTS = new Set([
  'sheet.command.delete-range-move-left-confirm',
  'sheet.command.delete-range-move-up-confirm',
  'sheet.command.insert-range-move-down-confirm',
  'sheet.command.insert-range-move-right-confirm',
  'sheet.command.delete-range-move-left',
  'sheet.command.delete-range-move-up',
  'sheet.command.insert-range-move-down',
  'sheet.command.insert-range-move-right',
]);
const MERGES = new Set([
  'sheet.command.add-worksheet-merge',
  'sheet.command.add-worksheet-merge-all',
  'sheet.command.add-worksheet-merge-horizontal',
  'sheet.command.add-worksheet-merge-vertical',
  'sheet.command.remove-worksheet-merge',
]);
const ROW_INSERTS = new Set([
  'sheet.command.insert-row-before',
  'sheet.command.insert-row-after',
  'sheet.command.insert-multi-rows-above',
  'sheet.command.insert-multi-rows-after',
  'sheet.command.insert-row-by-range',
  'sheet.command.insert-row',
]);
const ROW_REMOVES = new Set([
  'sheet.command.remove-row-confirm',
  'sheet.command.remove-row-by-range',
  'sheet.command.remove-row',
]);
const ROW_MOVE = 'sheet.command.move-rows';
const SORT = 'sheet.command.sort-range';
const FILTER_RANGE = 'sheet.command.set-filter-range';
const CLEARS = new Set([
  'sheet.command.clear-selection-content',
  'sheet.command.clear-selection-all',
]);
/** Univer's own list editor (a list's Edit): a column's list is its type's, changed in Edit column. */
const VALIDATION_PANELS = new Set([
  'data-validation.operation.open-validation-panel',
  'data-validation.operation.toggle-validation-panel',
  'data-validation.command.addRuleAndOpen',
]);
/** What changes the records: their values, and which rows they're in. */
const RECORD_MUTATIONS = new Set([
  'sheet.mutation.set-range-values',
  'sheet.mutation.insert-row',
  'sheet.mutation.remove-rows',
  'sheet.mutation.move-rows',
  'sheet.mutation.reorder-range',
  'sheet.mutation.move-range',
]);
const COLUMN_WIDTH = 'sheet.mutation.set-worksheet-col-width';
const FROZEN = 'sheet.mutation.set-frozen';
const ROW_COUNT = 'sheet.mutation.set-worksheet-row-count';
const SET_VALUES = 'sheet.mutation.set-range-values';
const CONDITIONAL_FORMATS = new Set([
  'sheet.mutation.add-conditional-rule',
  'sheet.mutation.delete-conditional-rule',
  'sheet.mutation.set-conditional-rule',
  'sheet.mutation.move-conditional-rule',
]);
/**
 * The system's toolbar (HIDDEN_TOOLBAR_MENU): merging left out too — a table's
 * rows aren't merged (the header's merges are its boxes) — and the data
 * validation tools: a column's list comes from its type (Edit column).
 */
const APP_HIDDEN_MENU = {
  ...HIDDEN_TOOLBAR_MENU,
  'sheet.command.add-worksheet-merge': { hidden: true },
  'sheet.command.insert-quick-data-validation': { hidden: true },
  'data-validation.command.insert-quick-rule': { hidden: true },
  'sheet.menu.quick-dropdown': { hidden: true },
  'sheet.menu.quick-date': { hidden: true },
  'sheet.menu.data-validation': { hidden: true },
};

/** The text a cell was given in its editor. */
function typedText(cell: GridCell | null | undefined): string | null {
  const stream = (cell?.p as { body?: { dataStream?: string } } | undefined)?.body?.dataStream;
  if (typeof stream === 'string') return stream.replace(/\r?\n$/, '').replace(/\r$/, '');
  if (cell?.v === null || cell?.v === undefined) return null;
  return String(cell.v);
}

export class SheetEngine {
  private readonly univer: Univer;
  private readonly api: FUniver;
  private workbook: FWorkbook | null = null;
  private input: WorkbookInput | null = null;
  private plan: GridPlan | null = null;
  private units = 0;
  /** Writes of our own (loading, results, IDs): not the person's changes. */
  private writing = 0;
  private labelsStyled = false;
  /** The rows given the columns' look (number formats): those built, and added since. */
  private styledRows = 0;
  /** Univer starts its sheet services with the first workbook: our hooks go in then. */
  private installed = false;
  private readonly disposables: IDisposable[] = [];
  private readonly invalidCache = new Map<string, boolean>();

  constructor(
    container: HTMLElement,
    private readonly hooks: EngineHooks,
  ) {
    const { univer, univerAPI } = createUniver({
      locale: LocaleType.EN_US,
      locales: {
        [LocaleType.EN_US]: mergeLocales(
          sheetsCoreEnUS,
          sheetsFilterEnUS,
          sheetsSortEnUS,
          sheetsConditionalFormattingEnUS,
          sheetsDataValidationEnUS,
        ),
      },
      presets: [
        // Google Sheets' layout: one row of tools, the app's own tabs under the grid.
        UniverSheetsCorePreset({
          container,
          footer: { sheetBar: false, statisticBar: true, menus: false, zoomSlider: true },
          menu: APP_HIDDEN_MENU,
          ribbonType: 'simple',
        }),
        UniverSheetsFilterPreset(),
        UniverSheetsSortPreset(),
        UniverSheetsConditionalFormattingPreset(),
        UniverSheetsDataValidationPreset(),
      ],
    });
    this.univer = univer;
    this.api = univerAPI;
  }

  // ------------------------------------------------------------ workbook

  /** Opens a table: its workbook built afresh (the one shown before goes, with its Undo). */
  open(input: WorkbookInput) {
    const old = this.workbook;
    this.input = input;
    this.invalidCache.clear();
    this.units += 1;
    const { plan, data } = buildWorkbookData({ ...input, unitId: `${input.unitId}-${this.units}` });
    this.plan = plan;
    this.styledRows = (data.sheets[DATA_SHEET_ID] as { rowCount: number }).rowCount;
    this.writing += 1;
    try {
      if (old) this.api.disposeUnit(old.getId());
      this.workbook = this.api.createWorkbook(data as never);
    } finally {
      this.writing -= 1;
    }
    if (!this.installed) {
      this.installed = true;
      this.install();
    }
    this.labelsStyled = this.styleLabels();
  }

  get gridPlan() {
    return this.plan;
  }

  private sheet() {
    return this.workbook?.getSheetBySheetId(DATA_SHEET_ID) ?? null;
  }

  private worksheet() {
    return this.sheet()?.getSheet() ?? null;
  }

  private isOurs(params: { unitId?: string; subUnitId?: string } | undefined) {
    return (
      !!this.workbook &&
      (!params?.unitId || params.unitId === this.workbook.getId()) &&
      (!params?.subUnitId || params.subUnitId === DATA_SHEET_ID)
    );
  }

  /** The column letters and row numbers small and grey, as the system's. */
  private styleLabels() {
    const workbook = this.workbook;
    if (!workbook || !this.input) return false;
    const labels = {
      headerStyle: {
        fontColor: HEADER_LABEL_COLOR,
        fontFamily: this.input.fontFamily,
        fontSize: HEADER_LABEL_SIZE,
      },
    };
    try {
      workbook.customizeColumnHeader(labels);
      workbook.customizeRowHeader(labels);
      return true;
    } catch {
      return false;
    }
  }

  /** Commits a cell still being typed in, as Enter would. */
  async finishEditing() {
    try {
      if (this.workbook?.isCellEditing()) await this.workbook.endEditingAsync(true);
    } catch {
      // Nothing being typed.
    }
  }

  // ----------------------------------------------------------- reading

  /** Every row under the header with anything in it: its ID cell and its typed-in columns' cells. */
  readRecords(): GridRecord[] {
    const sheet = this.worksheet();
    const plan = this.plan;
    if (!sheet || !plan) return [];
    const entry = plan.columns
      .map((column, index) => ({ column, index }))
      .filter(({ column }) => column.type !== 'formula');
    const records: GridRecord[] = [];
    const last = sheet.getMaxRows();
    for (let row = plan.recordsFrom; row < last; row += 1) {
      const idText = String(sheet.getCellRaw(row, plan.idColumn)?.v ?? '').trim();
      const cells: Record<string, GridCell | null> = {};
      let any = idText !== '';
      for (const { column, index } of entry) {
        const raw = sheet.getCellRaw(row, index) as GridCell | null | undefined;
        const filled = raw && raw.v !== null && raw.v !== undefined && raw.v !== '';
        cells[column.key] = filled || raw?.f ? { v: raw!.v, t: raw!.t, f: raw!.f } : null;
        if (filled) any = true;
      }
      if (any) records.push({ row, idText, cells });
    }
    return records;
  }

  /** Each row under the header whose ID cell names a record, in the grid's order. */
  recordRows(): { row: number; id: number }[] {
    const sheet = this.worksheet();
    const plan = this.plan;
    if (!sheet || !plan) return [];
    const rows: { row: number; id: number }[] = [];
    const last = sheet.getMaxRows();
    for (let row = plan.recordsFrom; row < last; row += 1) {
      const text = String(sheet.getCellRaw(row, plan.idColumn)?.v ?? '').trim();
      if (/^\d+$/.test(text)) rows.push({ row, id: Number(text) });
    }
    return rows;
  }

  cellAt(row: number, column: number): GridCell | null {
    return (this.worksheet()?.getCellRaw(row, column) as GridCell | null | undefined) ?? null;
  }

  /** The rows whose ID cell says each text. */
  rowsWithId(texts: Set<string>): Map<string, number> {
    const sheet = this.worksheet();
    const plan = this.plan;
    const found = new Map<string, number>();
    if (!sheet || !plan) return found;
    const last = sheet.getMaxRows();
    for (let row = plan.recordsFrom; row < last; row += 1) {
      const text = String(sheet.getCellRaw(row, plan.idColumn)?.v ?? '').trim();
      if (texts.has(text) && !found.has(text)) found.set(text, row);
    }
    return found;
  }

  /** The cells in spare columns, under the header, with something in them. */
  spareCells(): { row: number; column: number }[] {
    const sheet = this.worksheet();
    const plan = this.plan;
    if (!sheet || !plan) return [];
    const cells: { row: number; column: number }[] = [];
    const last = sheet.getMaxRows();
    for (let row = plan.recordsFrom; row < last; row += 1) {
      for (let column = plan.spareFrom; column < plan.idColumn; column += 1) {
        const raw = sheet.getCellRaw(row, column);
        if (raw && raw.v !== null && raw.v !== undefined && raw.v !== '')
          cells.push({ row, column });
      }
    }
    return cells;
  }

  // ----------------------------------------------------------- writing

  /** Puts cells in, outside Undo: the app's own values, IDs and results, not the person's edits. */
  write(cells: { row: number; column: number; cell: GridCell | null }[], overrideStyle = false) {
    const workbook = this.workbook;
    if (!workbook || !cells.length) return;
    const matrix: Record<number, Record<number, GridCell | null>> = {};
    for (const { row, column, cell } of cells) (matrix[row] ??= {})[column] = cell;
    this.writing += 1;
    try {
      this.api.syncExecuteCommand(SET_VALUES, {
        unitId: workbook.getId(),
        subUnitId: DATA_SHEET_ID,
        cellValue: matrix,
        isOverrideStyle: overrideStyle,
      });
    } finally {
      this.writing -= 1;
    }
    this.invalidCache.clear();
  }

  /**
   * Room under the records kept: more empty rows once they run low. Rows
   * Univer added itself (a long paste past the end) get the columns' look,
   * and the lists (choice, Yes/No, link columns) reach the last row.
   */
  keepSpareRows(lastUsed: number, minimum: number) {
    const workbook = this.workbook;
    const sheet = this.worksheet();
    const plan = this.plan;
    if (!workbook || !sheet || !plan || !this.input) return;
    let rows = sheet.getMaxRows();
    if (rows - 1 - lastUsed < minimum) {
      this.writing += 1;
      try {
        this.api.syncExecuteCommand(ROW_COUNT, {
          unitId: workbook.getId(),
          subUnitId: DATA_SHEET_ID,
          rowCount: rows + SPARE_ROWS,
        });
      } finally {
        this.writing -= 1;
      }
      rows += SPARE_ROWS;
    }
    if (rows > this.styledRows) {
      const cells: { row: number; column: number; cell: GridCell | null }[] = [];
      for (let row = this.styledRows; row < rows; row += 1) {
        for (const [column, cell] of Object.entries(recordCells(plan, null, this.input, null))) {
          // A formula's result already there keeps its own look (a date's, an error's).
          const now = sheet.getCellRaw(row, Number(column)) as GridCell | null | undefined;
          if (plan.columns[Number(column)]?.type === 'formula' && now?.s) continue;
          cells.push({ row, column: Number(column), cell });
        }
      }
      this.write(cells);
      this.styledRows = rows;
    }
    this.extendLists(rows - 1);
  }

  /** Each list down to the grid's last row (outside Undo). */
  private extendLists(lastRow: number) {
    const workbook = this.workbook;
    if (!workbook) return;
    let rules: { rule: { uid: string; ranges: CellRange[] } }[] = [];
    try {
      rules =
        (
          this.sheet() as unknown as { getDataValidations(): typeof rules } | null
        )?.getDataValidations() ?? [];
    } catch {
      return;
    }
    for (const { rule } of rules) {
      if (!rule.uid.startsWith('ukmac-') || !rule.ranges.length) continue;
      const end = Math.max(...rule.ranges.map((range) => range.endRow));
      if (end >= lastRow) continue;
      const ranges = rule.ranges.map((range) =>
        range.endRow === end ? { ...range, endRow: lastRow } : range,
      );
      this.writing += 1;
      try {
        // UpdateRuleType.RANGE
        this.api.syncExecuteCommand('data-validation.mutation.updateRule', {
          unitId: workbook.getId(),
          subUnitId: DATA_SHEET_ID,
          ruleId: rule.uid,
          payload: { type: 1, payload: ranges },
        });
      } finally {
        this.writing -= 1;
      }
    }
  }

  /** Draws the cells again (a value's check changed). */
  redraw() {
    this.invalidCache.clear();
    try {
      (this.sheet() as unknown as { refreshCanvas?: () => void } | null)?.refreshCanvas?.();
    } catch {
      // Drawn on the next change.
    }
  }

  // ------------------------------------------------------------- guards

  private linkOptions(column: Column) {
    return this.input?.linkOptions(column) ?? [];
  }

  /** A typed-in cell whose value doesn't fit its column (drawn red, as the app's table marks it). */
  private invalid(row: number, col: number, cell: GridCell | null | undefined) {
    const plan = this.plan;
    if (!plan || row < plan.recordsFrom || col >= plan.spareFrom || !cell || cell.f) return false;
    const column = plan.columns[col];
    if (
      !column ||
      column.type === 'formula' ||
      cell.v === null ||
      cell.v === undefined ||
      cell.v === ''
    )
      return false;
    const key = `${col}\u0000${typeof cell.v}\u0000${String(cell.v)}`;
    let known = this.invalidCache.get(key);
    if (known === undefined) {
      known = !!fromGridCell(column, cell, this.linkOptions(column)).error;
      this.invalidCache.set(key, known);
    }
    return known;
  }

  /** The selection's ranges (or a command's own). */
  private selectedRanges(): CellRange[] {
    try {
      const list = this.sheet()?.getSelection()?.getActiveRangeList() ?? [];
      return list.map((range) => range.getRange() as CellRange);
    } catch {
      return [];
    }
  }

  private selectedColumns(): number[] {
    const columns = new Set<number>();
    for (const range of this.selectedRanges())
      for (let c = range.startColumn; c <= range.endColumn; c += 1) columns.add(c);
    return [...columns].sort((a, b) => a - b);
  }

  /** A clear (Delete) limited to what's typed in: the records' cells, not the header, the formula row, a formula's results or the row IDs. */
  private clearableRanges(ranges: CellRange[]): CellRange[] {
    const plan = this.plan;
    if (!plan) return [];
    const out: CellRange[] = [];
    for (const range of ranges) {
      const startRow = Math.max(range.startRow, plan.recordsFrom);
      if (range.endRow < startRow) continue;
      let start = -1;
      const end = Math.min(range.endColumn, plan.idColumn - 1);
      for (let c = range.startColumn; c <= end + 1; c += 1) {
        const ok = c <= end && (c >= plan.spareFrom || plan.columns[c]?.type !== 'formula');
        if (ok && start < 0) start = c;
        if (!ok && start >= 0) {
          out.push({ startRow, endRow: range.endRow, startColumn: start, endColumn: c - 1 });
          start = -1;
        }
      }
    }
    return out;
  }

  private install() {
    const api = this.api;
    const injector = this.univer.__getInjector();
    const interceptors = injector.get(SheetInterceptorService);
    const plan = () => this.plan;
    const block = (event: { cancel?: boolean }, message: string) => {
      event.cancel = true;
      this.hooks.blocked(message);
    };

    // A copy is of the table's own columns: never the hidden row IDs (pasted
    // over other records, they'd take those records' place; pasted in Excel,
    // a column of numbers) nor the empty spare columns. And a paste wide
    // enough to reach the row IDs leaves them as they were.
    const clipboard = injector.get(ISheetClipboardService);
    let trimmed: { range: CellRange; endColumn: number } | null = null;
    const none = { redos: [], undos: [] };
    this.disposables.push(
      clipboard.addClipboardHook({
        id: 'ukmac-row-ids',
        priority: 1000,
        onBeforeCopy: (unitId, subUnitId, range) => {
          const p = plan();
          if (!p || unitId !== this.workbook?.getId() || subUnitId !== DATA_SHEET_ID) return;
          const end = range.startColumn < p.spareFrom ? p.spareFrom - 1 : p.idColumn - 1;
          if (range.startColumn > end || range.endColumn <= end) return;
          // The copy reads this very range (the selection's): put back once copied.
          trimmed = { range: range as CellRange, endColumn: range.endColumn };
          range.endColumn = end;
        },
        onAfterCopy: () => {
          if (trimmed) trimmed.range.endColumn = trimmed.endColumn;
          trimmed = null;
        },
        onPasteCells: (_from, to) => {
          const p = plan();
          const sheet = this.worksheet();
          if (
            !p ||
            !sheet ||
            to.unitId !== this.workbook?.getId() ||
            to.subUnitId !== DATA_SHEET_ID
          )
            return none;
          if (!to.range.cols.includes(p.idColumn)) return none;
          const cellValue: Record<number, Record<number, GridCell>> = {};
          for (const row of to.range.rows)
            cellValue[row] = {
              [p.idColumn]: (sheet.getCellRaw(row, p.idColumn) as GridCell | null) ?? { v: null },
            };
          return {
            redos: [
              { id: SET_VALUES, params: { unitId: to.unitId, subUnitId: to.subUnitId, cellValue } },
            ],
            undos: [],
          };
        },
      }),
    );

    this.disposables.push(
      // Typed in: read as the app reads it — a date day first (16/06/2026), a
      // percent out of 100 (86.4 is 86.4%), Yes/No, a choice in its own
      // spelling — before Univer's own reading (US dates) has it.
      {
        dispose: (() => {
          const remove = interceptors.writeCellInterceptor.intercept(AFTER_CELL_EDIT, {
            priority: 100,
            handler: (cell, context, next) => {
              const p = plan();
              if (
                !p ||
                context.unitId !== this.workbook?.getId() ||
                context.subUnitId !== DATA_SHEET_ID
              )
                return next(cell);
              if (context.row < p.recordsFrom || context.col >= p.spareFrom) return next(cell);
              const column = p.columns[context.col];
              const value = cell as GridCell | null;
              if (!column || column.type === 'formula' || value?.f) return next(cell);
              const text = typedText(value);
              if (text === null || !text.trim() || text.trim().startsWith('=')) return next(cell);
              const checked = checkCell(column, text, this.linkOptions(column));
              const grid = toGridCell(column, checked.error ? text.trim() : checked.value);
              if (!grid) return next(cell);
              // Its text as the value (null: no rich text left behind over it).
              return next({ ...(cell ?? {}), p: null, v: grid.v, t: grid.t } as never);
            },
          });
          return () => void remove();
        })(),
      },
      // A value that doesn't fit its column drawn red (the app's table marks it so).
      interceptors.intercept(INTERCEPTOR_POINT.CELL_CONTENT, {
        effect: InterceptorEffectEnum.Style,
        priority: 10,
        handler: (cell, context, next) => {
          if (context.unitId !== this.workbook?.getId() || context.subUnitId !== DATA_SHEET_ID)
            return next(cell);
          if (!this.invalid(context.row, context.col, cell as GridCell)) return next(cell);
          const styles = context.workbook.getStyles();
          const own = cell?.s;
          const base = (typeof own === 'string' ? styles.get(own) : own) ?? {};
          const clone = (cell === context.rawData ? { ...context.rawData } : { ...cell }) as Record<
            string,
            unknown
          >;
          clone['s'] = { ...base, cl: { rgb: ERROR_TEXT }, bg: { rgb: INVALID_BACKGROUND } };
          return next(clone as never);
        },
      }),

      api.addEvent(api.Event.BeforeSheetEditStart, (params) => {
        const p = plan();
        if (
          !p ||
          params.workbook.getId() !== this.workbook?.getId() ||
          params.worksheet.getSheetId() !== DATA_SHEET_ID
        )
          return;
        const { row, column } = params;
        if (column >= p.idColumn) {
          params.cancel = true;
          return;
        }
        if (row < p.recordsFrom) {
          // The header and the formula row are the columns': changed in the column's own dialog.
          params.cancel = true;
          if (column < p.spareFrom) this.hooks.column({ action: 'edit', index: column });
          else this.hooks.column({ action: 'insert', index: p.spareFrom, beside: null });
          return;
        }
        if (column >= p.spareFrom) {
          block(
            params,
            'This column isn’t part of the table yet: click its header cell to add it.',
          );
          return;
        }
        const target = p.columns[column];
        if (target?.type === 'formula') {
          block(
            params,
            `${target.name} is worked out by its formula. Double-click its name to change the formula.`,
          );
        }
      }),

      api.addEvent(api.Event.BeforeCommandExecute, (event) => {
        const p = plan();
        if (!p || !this.workbook) return;
        const params = (event.params ?? {}) as Record<string, unknown> & {
          unitId?: string;
          subUnitId?: string;
        };
        if (params.unitId && params.unitId !== this.workbook.getId()) return;
        if (params.subUnitId && params.subUnitId !== DATA_SHEET_ID) return;
        const id = event.id;

        if (VALIDATION_PANELS.has(id)) {
          event.cancel = true;
          const column = this.selectedRanges()[0]?.startColumn ?? -1;
          if (column >= 0 && column < p.spareFrom)
            this.hooks.column({ action: 'edit', index: column });
          return;
        }
        if (COLUMN_INSERTS.has(id)) {
          event.cancel = true;
          const selected = this.selectedColumns().filter((c) => c < p.spareFrom);
          const after = id.endsWith('after') || id.endsWith('right');
          if (!selected.length)
            this.hooks.column({ action: 'insert', index: p.spareFrom, beside: null });
          else {
            const at = after ? selected[selected.length - 1] : selected[0];
            this.hooks.column({ action: 'insert', index: after ? at + 1 : at, beside: at });
          }
          return;
        }
        if (COLUMN_REMOVES.has(id)) {
          event.cancel = true;
          const range = (params['range'] as CellRange | undefined) ?? null;
          const columns = range
            ? Array.from(
                { length: range.endColumn - range.startColumn + 1 },
                (_, i) => range.startColumn + i,
              )
            : this.selectedColumns();
          const indexes = columns.filter((c) => c < p.spareFrom);
          if (indexes.length) this.hooks.column({ action: 'delete', indexes });
          return;
        }
        if (id === COLUMN_MOVE) {
          event.cancel = true;
          const from = params['fromRange'] as CellRange | undefined;
          const to = params['toRange'] as CellRange | undefined;
          const count = p.columns.length;
          if (!from || !to || from.endColumn >= count || to.startColumn > count) {
            this.hooks.blocked(
              'Move the table’s own columns among themselves: Columns lists them in order.',
            );
            return;
          }
          const moving = Array.from(
            { length: from.endColumn - from.startColumn + 1 },
            (_, i) => from.startColumn + i,
          );
          const rest = Array.from({ length: count }, (_, i) => i).filter(
            (i) => !moving.includes(i),
          );
          const at = rest.filter((i) => i < to.startColumn).length;
          rest.splice(at, 0, ...moving);
          if (rest.some((column, index) => column !== index))
            this.hooks.column({ action: 'move', order: rest });
          return;
        }
        if (SHIFTS.has(id)) {
          block(event, 'A record’s cells stay in its row: insert or delete whole rows instead.');
          return;
        }
        if (MERGES.has(id)) {
          block(event, 'Cells can’t be merged in a table: each row is one record.');
          return;
        }
        if (ROW_INSERTS.has(id)) {
          const range = (params['range'] as CellRange | undefined) ?? this.selectedRanges()[0];
          if (!range) return;
          const before = id.includes('before') || id.includes('above');
          const at =
            id === 'sheet.command.insert-row' || id === 'sheet.command.insert-row-by-range'
              ? range.startRow
              : before
                ? range.startRow
                : range.endRow + 1;
          if (at < p.recordsFrom)
            block(event, 'Rows go under the header: pick a record’s row to insert beside it.');
          return;
        }
        if (ROW_REMOVES.has(id)) {
          const range = (params['range'] as CellRange | undefined) ?? this.selectedRanges()[0];
          if (range && range.startRow < p.recordsFrom)
            block(event, 'The header stays: pick the records’ rows to delete.');
          return;
        }
        if (id === ROW_MOVE) {
          const from = params['fromRange'] as CellRange | undefined;
          const to = params['toRange'] as CellRange | undefined;
          if ((from && from.startRow < p.recordsFrom) || (to && to.startRow < p.recordsFrom)) {
            block(event, 'The header stays at the top: records move among themselves.');
          }
          return;
        }
        if (id === SORT) {
          // A sort moves whole records under the header (every column, the row
          // ID too), never one column's cells alone — as the system's sheet.
          const range = params['range'] as CellRange | undefined;
          const sheet = this.worksheet();
          if (!range || !sheet) return;
          if (range.endRow < p.recordsFrom) {
            block(event, 'Sort the records: pick a cell under the header.');
            return;
          }
          if (range.startRow < p.recordsFrom) params['hasTitle'] = false;
          params['range'] = {
            ...range,
            startRow: Math.max(range.startRow, p.recordsFrom),
            startColumn: 0,
            endColumn: sheet.getMaxColumns() - 1,
          };
          return;
        }
        if (id === FILTER_RANGE) {
          // The whole table, its buttons on the formula row (under the names).
          const sheet = this.worksheet();
          if (!sheet) return;
          params['range'] = {
            startRow: p.formulaRow,
            endRow: sheet.getMaxRows() - 1,
            startColumn: 0,
            endColumn: Math.max(0, p.spareFrom - 1),
          };
          return;
        }
        if (CLEARS.has(id) && !params['ranges']) {
          const ranges = this.selectedRanges();
          const allowed = this.clearableRanges(ranges);
          const same =
            allowed.length === ranges.length &&
            allowed.every(
              (range, i) =>
                range.startRow === ranges[i].startRow &&
                range.endRow === ranges[i].endRow &&
                range.startColumn === ranges[i].startColumn &&
                range.endColumn === ranges[i].endColumn,
            );
          if (same) return;
          event.cancel = true;
          if (allowed.length)
            void api.executeCommand(id, {
              unitId: this.workbook.getId(),
              subUnitId: DATA_SHEET_ID,
              ranges: allowed,
            });
        }
      }),

      api.addEvent(api.Event.CommandExecuted, (event) => {
        if (this.writing) return;
        const params = event.params as
          { unitId?: string; subUnitId?: string; ranges?: CellRange[] } | undefined;
        if (!params || !this.isOurs(params) || !params.unitId) return;
        if (RECORD_MUTATIONS.has(event.id)) {
          this.invalidCache.clear();
          this.hooks.changed();
          return;
        }
        const p = plan();
        const sheet = this.worksheet();
        if (!p || !sheet) return;
        if (event.id === COLUMN_WIDTH) {
          for (const range of params.ranges ?? []) {
            for (let c = range.startColumn; c <= range.endColumn && c < p.spareFrom; c += 1) {
              this.hooks.resized(c, Math.round(sheet.getColumnWidth(c)));
            }
          }
          return;
        }
        if (event.id === FROZEN) {
          setTimeout(() =>
            this.hooks.frozen(Math.max(0, this.worksheet()?.getFreeze()?.xSplit ?? 0)),
          );
          return;
        }
        if (CONDITIONAL_FORMATS.has(event.id)) {
          setTimeout(() => {
            try {
              const rules =
                (
                  this.sheet() as unknown as { getConditionalFormattingRules(): unknown[] } | null
                )?.getConditionalFormattingRules() ?? [];
              this.hooks.formatsChanged(JSON.parse(JSON.stringify(rules)));
            } catch {
              // Saved with the next change.
            }
          });
        }
      }),

      api.addEvent(api.Event.LifeCycleChanged, ({ stage }) => {
        if (!this.labelsStyled && stage >= LifecycleStages.Rendered)
          this.labelsStyled = this.styleLabels();
      }),

      // The system's own fixes to Univer's editing (see each).
      installFreezeMenus(api, () => 0),
      installFormulaBarSync(this.univer),
      installCaretMirror(this.univer),
      installBarFocusHandback(this.univer),
      installBarNoScroll(this.univer),
      installUndoKeys(this.univer),
    );
  }

  dispose() {
    for (const disposable of this.disposables.splice(0)) {
      try {
        disposable.dispose();
      } catch {
        // Gone with Univer below.
      }
    }
    this.workbook = null;
    this.univer.dispose();
  }
}
