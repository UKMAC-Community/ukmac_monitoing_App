import { computed, inject, Injectable, signal } from '@angular/core';

import { WorkbookFormulas } from '../formula/sheet-formulas';
import { parseLinkSource, todayIso } from '../sheet/columns';
import { Api, errorText } from './api';
import type { CellChange, Cells, Column, Dashboard, Row, Sheet, SheetWithRows, Workbook } from './models';
import { Toasts } from './toast';

/**
 * The open MAC: its tables and their rows, kept in memory while it's open.
 * Every change goes to the database on this Mac straight away (like a
 * Google Sheet: there's no Save button) and shows here at once.
 */
@Injectable({ providedIn: 'root' })
export class WorkbookStore {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);

  readonly workbook = signal<Workbook | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(0);
  /** Goes up on every saved change (the Power BI file follows it). */
  readonly version = signal(0);

  readonly mac = computed(() => this.workbook()?.mac ?? null);
  readonly sheets = computed(() => this.workbook()?.sheets ?? []);
  readonly formulas = computed(() => new WorkbookFormulas(this.sheets(), todayIso()));

  /** The tables under their headings, in order. */
  readonly headings = computed(() => {
    const groups = new Map<string, SheetWithRows[]>();
    for (const sheet of this.sheets()) {
      const list = groups.get(sheet.heading) ?? [];
      list.push(sheet);
      groups.set(sheet.heading, list);
    }
    return [...groups.entries()].map(([heading, sheets]) => ({ heading, sheets }));
  });

  async load(macId: number) {
    if (this.workbook()?.mac.macId !== macId) this.workbook.set(null);
    this.loading.set(true);
    try {
      this.workbook.set(await this.api.getWorkbook(macId));
    } catch (error) {
      this.toasts.error(errorText(error));
      this.workbook.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  async reload() {
    const mac = this.mac();
    if (mac) await this.load(mac.macId);
  }

  sheet(sheetId: number) {
    return this.sheets().find((sheet) => sheet.sheetId === sheetId) ?? null;
  }

  linkOptions(column: Column): string[] {
    return column.type === 'link' ? this.formulas().linkOptions(parseLinkSource(column.source)) : [];
  }

  // ------------------------------------------------------------ helpers

  private async run<T>(work: () => Promise<T>): Promise<T> {
    this.saving.update((n) => n + 1);
    try {
      const result = await work();
      this.version.update((n) => n + 1);
      return result;
    } finally {
      this.saving.update((n) => n - 1);
    }
  }

  private patchSheets(update: (sheets: SheetWithRows[]) => SheetWithRows[]) {
    this.workbook.update((book) => (book ? { ...book, sheets: update(book.sheets) } : book));
  }

  private patchSheet(sheetId: number, update: (sheet: SheetWithRows) => SheetWithRows) {
    this.patchSheets((sheets) => sheets.map((sheet) => (sheet.sheetId === sheetId ? update(sheet) : sheet)));
  }

  private withMeta(sheet: SheetWithRows, meta: Sheet): SheetWithRows {
    return { ...sheet, ...meta, rows: sheet.rows, rowCount: sheet.rows.length };
  }

  // ------------------------------------------------------------- tables

  async createSheet(input: { title: string; heading?: string; about?: string; columns?: Column[]; rows?: Cells[] }) {
    const mac = this.mac();
    if (!mac) throw new Error('No MAC is open');
    const sheet = await this.run(() => this.api.createSheet(mac.macId, input));
    this.patchSheets((sheets) => [...sheets, sheet]);
    return sheet;
  }

  async updateSheet(sheetId: number, input: { title: string; heading?: string; about?: string }) {
    const before = this.sheet(sheetId);
    const meta = await this.run(() => this.api.updateSheet(sheetId, input));
    this.patchSheet(sheetId, (sheet) => this.withMeta(sheet, meta));
    // A rename rewrites other tables' formulas and links: read them again.
    if (before && before.title !== meta.title) await this.reload();
    return meta;
  }

  async saveColumns(sheetId: number, columns: Column[]) {
    const before = this.sheet(sheetId);
    const meta = await this.run(() => this.api.saveColumns(sheetId, columns));
    const removed = (before?.columns ?? []).filter((old) => !meta.columns.some((column) => column.key === old.key));
    const renamed = (before?.columns ?? []).some((old) =>
      meta.columns.some((column) => column.key === old.key && column.name !== old.name),
    );
    if (renamed) {
      await this.reload();
    } else {
      this.patchSheet(sheetId, (sheet) => {
        const rows = removed.length
          ? sheet.rows.map((row) => {
              const data = { ...row.data };
              for (const column of removed) delete data[column.key];
              return { ...row, data };
            })
          : sheet.rows;
        return { ...this.withMeta(sheet, meta), rows };
      });
    }
    return meta;
  }

  async saveDashboard(sheetId: number, dashboard: Dashboard | null) {
    const meta = await this.run(() => this.api.saveDashboard(sheetId, dashboard));
    this.patchSheet(sheetId, (sheet) => this.withMeta(sheet, meta));
    return meta;
  }

  async deleteSheet(sheetId: number) {
    await this.run(() => this.api.deleteSheet(sheetId));
    this.patchSheets((sheets) => sheets.filter((sheet) => sheet.sheetId !== sheetId));
  }

  async reorderSheets(sheetIds: number[]) {
    const mac = this.mac();
    if (!mac) return;
    this.patchSheets((sheets) =>
      sheetIds
        .map((id, order) => {
          const sheet = sheets.find((item) => item.sheetId === id);
          return sheet ? { ...sheet, displayOrder: order } : null;
        })
        .filter((sheet): sheet is SheetWithRows => sheet !== null),
    );
    await this.run(() => this.api.reorderSheets(mac.macId, sheetIds));
  }

  // --------------------------------------------------------------- rows

  /** A new row's stand-in id (below 0) until it's saved. */
  private nextTempId = -1;
  /** Edits and deletes made to a row before it was saved, sent once it is. */
  private readonly heldEdits = new Map<number, CellChange[]>();
  private readonly heldDeletes = new Set<number>();

  async addRows(
    sheetId: number,
    rows: Cells[],
    options: { afterRowId?: number | null; import?: { fileName: string; mode: 'append' | 'replace' } } = {},
  ): Promise<Row[]> {
    if (options.import || (options.afterRowId !== undefined && options.afterRowId !== null)) {
      const added = await this.run(() => this.api.addRows(sheetId, rows, options));
      this.patchSheet(sheetId, (sheet) => {
        const kept = options.import?.mode === 'replace' ? [] : sheet.rows;
        const all = [...kept, ...added].sort((a, b) => a.position - b.position || a.rowId - b.rowId);
        return { ...sheet, rows: all, rowCount: all.length };
      });
      return added;
    }
    // Rows added at the end show at once (as a sheet's do), so what's typed
    // next lands in them; they get their real ids when saved.
    const sheet = this.sheet(sheetId);
    if (!sheet) return [];
    const last = sheet.rows.reduce((max, row) => Math.max(max, row.position), 0);
    const temps: Row[] = rows.map((data, index) => ({
      rowId: this.nextTempId--,
      sheetId,
      position: last + index + 1,
      data: Object.fromEntries(Object.entries(data).filter(([, value]) => value.trim())),
      importId: null,
      createdAt: '',
      updatedAt: '',
    }));
    this.patchSheet(sheetId, (current) => {
      const all = [...current.rows, ...temps];
      return { ...current, rows: all, rowCount: all.length };
    });
    try {
      const saved = await this.run(() => this.api.addRows(sheetId, rows));
      const real = new Map(temps.map((temp, index) => [temp.rowId, saved[index]]));
      // The real ids in; what was typed meanwhile stays (and is sent below).
      this.patchSheet(sheetId, (current) => ({
        ...current,
        rows: current.rows.map((row) => {
          const savedRow = real.get(row.rowId);
          return savedRow ? { ...savedRow, data: row.data } : row;
        }),
      }));
      const edits: CellChange[] = [];
      const deletes: number[] = [];
      for (const temp of temps) {
        const id = real.get(temp.rowId)!.rowId;
        for (const edit of this.heldEdits.get(temp.rowId) ?? []) edits.push({ ...edit, rowId: id });
        if (this.heldDeletes.has(temp.rowId)) deletes.push(id);
        this.heldEdits.delete(temp.rowId);
        this.heldDeletes.delete(temp.rowId);
      }
      if (edits.length) await this.updateCells(sheetId, edits);
      if (deletes.length) await this.deleteRows(sheetId, deletes);
      return saved;
    } catch (error) {
      const gone = new Set(temps.map((temp) => temp.rowId));
      for (const id of gone) {
        this.heldEdits.delete(id);
        this.heldDeletes.delete(id);
      }
      this.patchSheet(sheetId, (current) => {
        const kept = current.rows.filter((row) => !gone.has(row.rowId));
        return { ...current, rows: kept, rowCount: kept.length };
      });
      throw error;
    }
  }

  /** Cell edits: shown at once, saved behind; put back if saving fails. */
  async updateCells(sheetId: number, changes: CellChange[]) {
    if (!changes.length) return;
    const sheet = this.sheet(sheetId);
    if (!sheet) return;
    const before = sheet.rows;
    const byRow = new Map<number, CellChange[]>();
    for (const change of changes) byRow.set(change.rowId, [...(byRow.get(change.rowId) ?? []), change]);
    this.patchSheet(sheetId, (current) => ({
      ...current,
      rows: current.rows.map((row) => {
        const edits = byRow.get(row.rowId);
        if (!edits) return row;
        const data = { ...row.data };
        for (const edit of edits) {
          const value = (edit.value ?? '').trim();
          if (value) data[edit.key] = value;
          else delete data[edit.key];
        }
        return { ...row, data };
      }),
    }));
    // A row still being saved: its edits wait for its real id.
    const held = changes.filter((change) => change.rowId < 0);
    for (const change of held) this.heldEdits.set(change.rowId, [...(this.heldEdits.get(change.rowId) ?? []), change]);
    const sending = changes.filter((change) => change.rowId > 0);
    if (!sending.length) return;
    try {
      const saved = await this.run(() => this.api.updateCells(sheetId, sending));
      const byId = new Map(saved.map((row) => [row.rowId, row]));
      this.patchSheet(sheetId, (current) => ({
        ...current,
        rows: current.rows.map((row) => byId.get(row.rowId) ?? row),
      }));
    } catch (error) {
      this.patchSheet(sheetId, (current) => ({ ...current, rows: before }));
      this.toasts.error(`Not saved: ${errorText(error)}`);
    }
  }

  async deleteRows(sheetId: number, rowIds: number[]) {
    if (!rowIds.length) return;
    for (const id of rowIds) if (id < 0) this.heldDeletes.add(id);
    const saved = rowIds.filter((id) => id > 0);
    if (saved.length) await this.run(() => this.api.deleteRows(sheetId, saved));
    const gone = new Set(rowIds);
    this.patchSheet(sheetId, (sheet) => {
      const rows = sheet.rows.filter((row) => !gone.has(row.rowId));
      return { ...sheet, rows, rowCount: rows.length };
    });
  }

  /** The rows in the order given (sorted or moved in the sheet): shown so at once, saved behind. */
  async reorderRows(sheetId: number, rowIds: number[]) {
    const sheet = this.sheet(sheetId);
    if (!sheet) return;
    const at = new Map(rowIds.map((id, index) => [id, index]));
    const named = sheet.rows.filter((row) => at.has(row.rowId)).sort((a, b) => at.get(a.rowId)! - at.get(b.rowId)!);
    const rest = sheet.rows.filter((row) => !at.has(row.rowId));
    const rows = [...named, ...rest].map((row, index) => ({ ...row, position: index + 1 }));
    this.patchSheet(sheetId, (current) => ({ ...current, rows }));
    const saved = rowIds.filter((id) => id > 0);
    if (saved.length) await this.run(() => this.api.reorderRows(sheetId, saved));
  }

  async undoImport(sheetId: number, importId: number) {
    const removed = await this.run(() => this.api.undoImport(importId));
    this.patchSheet(sheetId, (sheet) => {
      const rows = sheet.rows.filter((row) => row.importId !== importId);
      return { ...sheet, rows, rowCount: rows.length };
    });
    return removed;
  }
}
