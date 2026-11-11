import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { DashboardStudio } from '../dashboard/dashboard-studio';
import { SheetDashboard } from '../dashboard/sheet-dashboard';
import { type CrossFilter, dashboardOf } from '../dashboard/dashboard-model';
import { Router, RouterLink } from '@angular/router';

import { ColumnDialog } from '../components/column-dialog';
import { ColumnsPanel } from '../components/columns-panel';
import { Icon } from '../components/icon';
import { GoogleImportDialog } from '../components/google-import-dialog';
import { GoogleLinkDialog } from '../components/google-link-dialog';
import { ImportDialog, type ImportDone, type ImportFile } from '../components/import-dialog';
import { Modal } from '../components/modal';
import { SheetTable } from '../components/sheet-table';
import { QaQcAnalysis } from '../qaqc/qa-qc-analysis';
import { QaQcMap } from '../qaqc/qa-qc-map';
import { TableDialog } from '../components/table-dialog';
import { Api, errorText } from '../core/api';
import { Google } from '../core/google';
import { AutoSync } from '../core/auto-sync';
import type { Column, ImportRecord, RetiredColumn, Row, SheetWithRows } from '../core/models';
import { Shell } from '../core/shell';
import { Toasts } from '../core/toast';
import { WorkbookStore } from '../core/workbook-store';
import { buildTemplate } from '../excel/excel-template';
import { safeFileName } from '../excel/exceljs';
import { buildPowerBiWorkbook } from '../excel/powerbi-export';
import { zoneMapPicture } from '../zonemap/zone-image';
import { formatFormulaValue, isFormulaError } from '../formula/evaluate-formula';
import { mappingFromLink } from '../google/sheet-sync';
import { columnLabel, displayCell } from '../sheet/columns';
import { columnsToLimit, columnsToRemove, missingTemplateColumns, retiredColumns, upgradesItself, withTemplateColumns } from '../sheet/template-columns';
import { UniverSheet, type ColumnRequest } from '../univer/univer-sheet';
import { baseName } from '../core/paths';

/** One table: the sheet, and everything done to it. */
@Component({
  selector: 'app-sheet-page',
  imports: [RouterLink, Icon, UniverSheet, SheetTable, QaQcAnalysis, QaQcMap, SheetDashboard, DashboardStudio, ColumnDialog, ColumnsPanel, ImportDialog, GoogleImportDialog, GoogleLinkDialog, TableDialog, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sheet-page.html',
  styleUrl: './sheet-page.css',
})
export class SheetPage {
  readonly store = inject(WorkbookStore);
  readonly google = inject(Google);
  private readonly autoSync = inject(AutoSync);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly router = inject(Router);

  readonly sheetId = input.required<string>();
  /** `?view=dashboard`: the dashboard's editor; `?view=sheet`: the rows as a spreadsheet; else the table's page. */
  readonly view = input<string | undefined>();
  readonly mode = computed<'table' | 'dashboard' | 'sheet'>(() => (this.view() === 'dashboard' ? 'dashboard' : this.view() === 'sheet' ? 'sheet' : 'table'));
  readonly sheet = computed(() => this.store.sheet(Number(this.sheetId())));
  readonly linkOptions = (column: Column) => this.store.linkOptions(column);

  /** What a click on a group in the dashboard keeps in its other visuals (of this table only). */
  private readonly crossFilter = signal<CrossFilter | null>(null);
  readonly activeFilter = computed(() => {
    const filter = this.crossFilter();
    return filter && filter.sheetId === this.sheet()?.sheetId ? filter : null;
  });
  setFilter(filter: CrossFilter | null) {
    this.crossFilter.set(filter);
  }

  readonly search = signal('');
  readonly sort = signal<{ key: string; dir: 1 | -1 } | null>(null);

  // Dialogs.
  readonly columnDialog = signal<{ column: Column | null; insertAt: number; preset: Partial<Column> | null } | null>(null);
  readonly columnsOpen = signal(false);
  readonly settingsOpen = signal(false);
  readonly importFile = signal<ImportFile | null>(null);
  /** The Google Sheet picker, for this table. */
  readonly googleIntoOpen = signal(false);
  /** The editor of the Google Sheet this table is linked to. */
  readonly linkOpen = signal(false);
  readonly importsOpen = signal(false);
  readonly imports = signal<ImportRecord[]>([]);
  /** The Import and Export menus, where they open (null: closed). */
  readonly importMenu = signal<{ x: number; y: number } | null>(null);
  readonly exportMenu = signal<{ x: number; y: number } | null>(null);
  /** The dialog that makes a new table. */
  readonly newTableOpen = signal(false);
  readonly busy = signal(false);
  /** The columns the template this table was made from gives now (none for a table that wasn't), and those it dropped since. */
  readonly templateColumns = signal<Column[]>([]);
  readonly templateRetired = signal<RetiredColumn[]>([]);
  /** Of those, the ones this table doesn't have: what an older table can be brought up to date with. */
  readonly templateMissing = computed(() => {
    const sheet = this.sheet();
    return sheet?.templateKey ? missingTemplateColumns(sheet.columns, this.templateColumns()) : [];
  });
  /** The columns the table has that the template gives allowed values (a range) they don't have yet. */
  readonly templateLimited = computed(() => {
    const sheet = this.sheet();
    return sheet?.templateKey ? columnsToLimit(sheet.columns, this.templateColumns()) : [];
  });
  /** What the template dropped that the table still has: those with no value in any row go; the rest stay. */
  readonly templateRetiredHere = computed(() => {
    const sheet = this.sheet();
    return sheet?.templateKey ? retiredColumns(sheet.columns, this.templateRetired()) : [];
  });
  readonly templateRemovable = computed(() => {
    const sheet = this.sheet();
    return sheet?.templateKey ? columnsToRemove(sheet.columns, this.templateRetired(), (column) => sheet.rows.some((row) => !!row.data[column.key])) : [];
  });
  /** What bringing the table up to date would do, in words (none: nothing to do). */
  readonly templateOffer = computed(() => {
    const missing = this.templateMissing();
    const limited = this.templateLimited();
    const removable = this.templateRemovable();
    const kept = this.templateRetiredHere().length - removable.length;
    if (!missing.length && !limited.length && !removable.length) return null;
    const s = (n: number) => (n === 1 ? '' : 's');
    const parts: string[] = [];
    if (missing.length) {
      const counts = new Map<string, number>();
      for (const column of missing) counts.set(column.box ?? 'No stage', (counts.get(column.box ?? 'No stage') ?? 0) + 1);
      parts.push(`adds ${missing.length} new column${s(missing.length)} (${[...counts].map(([box, n]) => `${n} in “${box}”`).join('; ')}), empty`);
    }
    if (removable.length) {
      parts.push(
        `takes off ${removable.length} empty column${s(removable.length)} the sheet has no column for (each stage's planned Date and Days after transplant, the Plant average columns)${kept > 0 ? `; ${kept} more that hold values stay` : ''}`,
      );
    }
    if (limited.length) {
      parts.push(`sets allowed values or a group heading on ${limited.length} column${s(limited.length)} (a vigor score from 1 to 5, percentages from 0 to 100, counts 0 or more; the group each sits under in the table's header): a value outside is drawn red, not changed`);
    }
    return {
      title: missing.length
        ? `The template has ${missing.length} column${s(missing.length)} this table doesn't.`
        : removable.length
          ? `This table has ${removable.length} column${s(removable.length)} the template no longer has.`
          : `The template gives ${limited.length} of this table's columns allowed values or a group heading.`,
      note: `It ${parts.join(', and ')}. No column that holds a value is removed or moved, and no value in the rows changes.`,
      button: [missing.length, removable.length, limited.length].filter(Boolean).length > 1 ? 'Update from the template' : missing.length ? `Add ${missing.length} column${s(missing.length)}` : removable.length ? 'Take them off' : 'Set allowed values',
    };
  });

  /** The offers the person hid (each is for this table and this many changes, so a new template change shows it again). */
  private readonly hiddenOffers = signal<ReadonlySet<string>>(new Set());
  private readonly offerKey = computed(() => {
    const sheet = this.sheet();
    return sheet && this.templateOffer() ? `ukmac.template-offer.${sheet.sheetId}.${this.templateMissing().length}.${this.templateLimited().length}.${this.templateRemovable().length}` : null;
  });
  /** Whether the offer to bring the table up to date is shown on the table's page. */
  readonly offerShown = computed(() => {
    const key = this.offerKey();
    if (!key || this.hiddenOffers().has(key)) return false;
    try {
      return localStorage.getItem(key) !== 'hidden';
    } catch {
      return true;
    }
  });

  hideOffer() {
    const key = this.offerKey();
    if (!key) return;
    this.hiddenOffers.update((hidden) => new Set(hidden).add(key));
    try {
      localStorage.setItem(key, 'hidden');
    } catch {
      /* hidden until the page is left, then */
    }
  }

  constructor() {
    // The sidebar stays open on the table's page; it folds only for the spreadsheet, as the system's sheet view does.
    const shell = inject(Shell);
    effect(() => (this.mode() === 'sheet' ? shell.enterSheet() : shell.leaveSheet()));
    // A table open as a spreadsheet isn't read from Google meanwhile (its rows would be replaced under the editor); it is once closed.
    effect((onCleanup) => {
      const sheet = this.sheet();
      if (this.mode() === 'sheet' && sheet) onCleanup(this.autoSync.hold(sheet.sheetId));
    });
    inject(DestroyRef).onDestroy(() => shell.leaveSheet());
    // The template this table was made from, so the columns it has gained since can be offered (a table that wasn't: none).
    effect(() => {
      const key = this.sheet()?.templateKey ?? null;
      untracked(() => {
        if (!key) {
          this.templateColumns.set([]);
          this.templateRetired.set([]);
          return;
        }
        void this.api
          .templateColumns(key)
          .then((found) => {
            this.templateColumns.set(Array.isArray(found?.columns) ? found.columns : []);
            this.templateRetired.set(Array.isArray(found?.retired) ? found.retired : []);
          })
          .catch(() => {
            this.templateColumns.set([]);
            this.templateRetired.set([]);
          });
      });
    });
    // A table with no rows that is still the template's older layout, and nothing of the person's own, is brought up to date at
    // once: there is nothing in it to lose or to keep. It then has none of the old columns, so this never runs for it again and
    // whatever is deleted or changed after stays so. A table with rows, or one the person changed, gets the offer instead.
    const upgraded = new Set<number>();
    effect(() => {
      const sheet = this.sheet();
      const offer = this.templateOffer();
      if (!sheet?.templateKey || !offer || upgraded.has(sheet.sheetId) || this.store.loading() || this.mode() !== 'table') return;
      if (!upgradesItself(sheet.columns, sheet.rows.length, this.templateColumns(), this.templateRetired())) return;
      upgraded.add(sheet.sheetId);
      untracked(() => void this.addTemplateColumns({ ask: false }));
    });
    void this.api
      .getSetting('sheet.kpiPanel')
      .then((value) => this.panelHidden.set(value === 'hidden'))
      .catch(() => undefined);
  }

  /** The KPI panel over the rows folded away (kept for next time, for every table). */
  readonly panelHidden = signal(false);
  readonly hasSummaries = computed(() => {
    const sheet = this.sheet();
    return !!sheet && dashboardOf(sheet).dashboard.summaries.length > 0;
  });

  togglePanel() {
    this.panelHidden.update((hidden) => !hidden);
    void this.api.setSetting('sheet.kpiPanel', this.panelHidden() ? 'hidden' : 'shown').catch(() => undefined);
  }

  setMode(mode: 'table' | 'dashboard' | 'sheet') {
    void this.router.navigate([], { queryParams: { view: mode === 'table' ? null : mode }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  /** A column's header clicked in the table: A → Z, Z → A, then off. */
  sortBy(key: string) {
    const sort = this.sort();
    this.sort.set(!sort || sort.key !== key ? { key, dir: 1 } : sort.dir === 1 ? { key, dir: -1 } : null);
  }

  toggleImport(event: MouseEvent) {
    if (this.importMenu()) return this.importMenu.set(null);
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.importMenu.set({ x: Math.min(box.right - 260, window.innerWidth - 280), y: box.bottom + 6 });
  }

  toggleExport(event: MouseEvent) {
    if (this.exportMenu()) return this.exportMenu.set(null);
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.exportMenu.set({ x: Math.min(box.right - 260, window.innerWidth - 280), y: box.bottom + 6 });
  }

  tableCreated(sheet: SheetWithRows) {
    this.newTableOpen.set(false);
    void this.router.navigate(['/mac', sheet.macId, 'table', sheet.sheetId]);
  }

  readonly sortColumn = computed(() => {
    const sort = this.sort();
    return sort ? (this.sheet()?.columns.find((column) => column.key === sort.key) ?? null) : null;
  });

  /** The rows shown: those the search finds, in the chosen order. */
  readonly rows = computed<Row[]>(() => {
    const sheet = this.sheet();
    if (!sheet) return [];
    let rows = sheet.rows;
    const words = this.search().trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length) {
      rows = rows.filter((row) => {
        const text = sheet.columns.map((column) => this.cellText(sheet, row, column)).join(' ').toLowerCase();
        return words.every((word) => text.includes(word));
      });
    }
    const sort = this.sort();
    const column = this.sortColumn();
    if (sort && column) {
      const value = (row: Row) => {
        const raw = this.store.formulas().cell(sheet, row, column);
        if (raw === null || raw === '' || isFormulaError(raw)) return null;
        return raw;
      };
      rows = [...rows].sort((a, b) => {
        const x = value(a);
        const y = value(b);
        if (x === null && y === null) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * sort.dir;
        return String(x).localeCompare(String(y), 'en', { numeric: true, sensitivity: 'base' }) * sort.dir;
      });
    }
    return rows;
  });

  readonly filtered = computed(() => !!this.search().trim());
  readonly formulaCount = computed(() => this.sheet()?.columns.filter((column) => column.type === 'formula').length ?? 0);
  readonly problemCount = computed(() => {
    const sheet = this.sheet();
    if (!sheet) return 0;
    const formulas = this.store.formulas();
    const options = new Map(sheet.columns.filter((c) => c.type === 'link').map((c) => [c.key, this.store.linkOptions(c)]));
    let count = 0;
    for (const row of sheet.rows) for (const column of sheet.columns) if (formulas.problem(sheet, row, column, options.get(column.key))) count += 1;
    return count;
  });

  private cellText(sheet: SheetWithRows, row: Row, column: Column) {
    if (column.type === 'formula') {
      const value = this.store.formulas().value(sheet, row, column);
      return isFormulaError(value) ? '' : formatFormulaValue(value);
    }
    return displayCell(column, row.data[column.key]);
  }

  label(column: Column) {
    return columnLabel(column);
  }

  // ------------------------------------------------------------- columns

  openNewColumn(insertAt?: number, neighbour?: Column) {
    const sheet = this.sheet();
    if (!sheet) return;
    this.columnDialog.set({
      column: null,
      insertAt: insertAt ?? sheet.columns.length,
      preset: neighbour ? { box: neighbour.box, group: neighbour.group } : null,
    });
  }

  async saveColumn(column: Column) {
    const sheet = this.sheet();
    const dialog = this.columnDialog();
    if (!sheet || !dialog) return;
    const columns = [...sheet.columns];
    if (dialog.column) {
      const at = columns.findIndex((item) => item.key === dialog.column!.key);
      columns[at] = column;
    } else {
      columns.splice(dialog.insertAt, 0, column);
    }
    if (await this.saveColumns(columns)) {
      this.columnDialog.set(null);
      this.toasts.show(dialog.column ? `${column.name} saved` : `${column.name} added`);
    }
  }

  private async saveColumns(columns: Column[]) {
    const sheet = this.sheet();
    if (!sheet) return false;
    try {
      await this.store.saveColumns(sheet.sheetId, columns);
      return true;
    } catch (error) {
      this.toasts.error(errorText(error));
      return false;
    }
  }

  /** The formula columns (here and in the other tables) that name this one. */
  private usedBy(column: Column): string[] {
    const sheet = this.sheet();
    if (!sheet) return [];
    const names = [`[${column.name}]`, `› ${column.name}]`];
    const here = sheet.columns
      .filter((other) => other.key !== column.key && other.formula && names.some((name) => other.formula!.includes(name)))
      .map((other) => other.name);
    const elsewhere = this.store
      .sheets()
      .filter((other) => other.sheetId !== sheet.sheetId)
      .flatMap((other) =>
        other.columns
          .filter((item) => `${item.formula ?? ''}${item.source ?? ''}`.includes(`${sheet.title}'[${column.name}]`))
          .map((item) => `${other.title} › ${item.name}`),
      );
    return [...here, ...elsewhere];
  }

  /**
   * Adds the columns the table's template has gained, each in its own stage, after one question. Nothing the table has
   * is removed or changed; the new columns start empty.
   */
  async addTemplateColumns(options: { ask?: boolean } = {}) {
    const sheet = this.sheet();
    const offer = this.templateOffer();
    const missing = this.templateMissing();
    const removable = this.templateRemovable();
    if (!sheet || !offer || this.busy()) return;
    if (options.ask !== false && !(await this.api.confirm(`Update “${sheet.title}” from the template?\n\n${offer.note}`, 'Update from the template', 'Update'))) return;
    const columns = withTemplateColumns(sheet.columns, this.templateColumns(), removable);
    // Saving columns deletes any that are left out, with their cells: be sure the only ones that go are the empty ones
    // the template dropped, and every other one the table has is still there, once.
    const kept = new Set(columns.map((column) => column.key));
    const going = new Set(removable.map((column) => column.key));
    const hasValue = (key: string) => sheet.rows.some((row) => !!row.data[key]);
    if (
      columns.length !== sheet.columns.length + missing.length - removable.length ||
      !sheet.columns.every((column) => (going.has(column.key) ? !hasValue(column.key) && !kept.has(column.key) : kept.has(column.key)))
    ) {
      this.toasts.error("The table couldn't be updated safely, so nothing was changed.");
      return;
    }
    this.busy.set(true);
    try {
      if (await this.saveColumns(columns)) {
        this.settingsOpen.set(false);
        const said = [missing.length ? `${missing.length} column${missing.length === 1 ? '' : 's'} added` : '', removable.length ? `${removable.length} empty one${removable.length === 1 ? '' : 's'} taken off` : ''].filter(Boolean);
        this.toasts.show(said.length ? `${sheet.title}: ${said.join(', ')} (from the template)` : 'Updated from the template');
      }
    } finally {
      this.busy.set(false);
    }
  }

  async deleteColumn(column: Column) {
    const sheet = this.sheet();
    if (!sheet) return;
    const filled = sheet.rows.filter((row) => row.data[column.key]).length;
    const used = this.usedBy(column);
    const text = [
      `Delete the column “${columnLabel(column)}”${filled ? ` and its ${filled} filled cells` : ''}?`,
      used.length ? `These use it and will show #NAME? or #REF!: ${used.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    if (!(await this.api.confirm(text, 'Delete column', 'Delete'))) return;
    if (await this.saveColumns(sheet.columns.filter((item) => item.key !== column.key))) {
      this.toasts.show(`${column.name} deleted`);
    }
  }

  /** Several columns deleted at once (picked together in the sheet): one question for them all. */
  async deleteColumns(columns: Column[]) {
    const sheet = this.sheet();
    if (!sheet || !columns.length) return;
    if (columns.length === 1) return this.deleteColumn(columns[0]);
    const keys = new Set(columns.map((column) => column.key));
    const filled = sheet.rows.reduce((count, row) => count + columns.filter((column) => row.data[column.key]).length, 0);
    const used = columns.flatMap((column) => this.usedBy(column)).filter((name) => !columns.some((column) => name.endsWith(column.name)));
    const text = [
      `Delete these ${columns.length} columns (${columns.map(columnLabel).join(', ')})${filled ? ` and their ${filled} filled cells` : ''}?`,
      used.length ? `These use them and will show #NAME? or #REF!: ${[...new Set(used)].join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    if (!(await this.api.confirm(text, 'Delete columns', 'Delete'))) return;
    if (await this.saveColumns(sheet.columns.filter((item) => !keys.has(item.key)))) {
      this.toasts.show(`${columns.length} columns deleted`);
    }
  }

  /** The sheet's column menus and header cells: the column's own dialogs do the change. */
  columnRequest(request: ColumnRequest) {
    const sheet = this.sheet();
    if (!sheet) return;
    switch (request.action) {
      case 'edit': {
        const column = sheet.columns[request.index];
        if (column) this.columnDialog.set({ column, insertAt: request.index, preset: null });
        return;
      }
      case 'insert':
        return this.openNewColumn(request.index, request.beside === null ? undefined : sheet.columns[request.beside]);
      case 'delete':
        return void this.deleteColumns(request.indexes.map((index) => sheet.columns[index]).filter((column) => !!column));
      case 'move':
        return void this.reorderColumns(request.order.map((index) => sheet.columns[index]).filter((column) => !!column));
    }
  }

  async reorderColumns(columns: Column[]) {
    if (await this.saveColumns(columns)) {
      this.toasts.show('Column order saved');
      this.columnsOpen.set(false);
    }
  }

  // --------------------------------------------------------------- Excel

  async downloadTemplate() {
    const sheet = this.sheet();
    if (!sheet) return;
    const path = await this.api.pickSavePath(`${safeFileName(sheet.title)} template.xlsx`);
    if (!path) return;
    this.busy.set(true);
    try {
      const bytes = await buildTemplate(sheet, { linkOptions: this.linkOptions });
      await this.api.writeFile(path, bytes);
      this.toasts.show(`Template saved: ${baseName(path)}`);
    } catch (error) {
      this.toasts.error(errorText(error));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Starts the import again for a table that's read from a Google tab: the tab is downloaded and the wizard opens
   * on "Define the file", with the rows and matches the table has now, to point at the right ones. Importing then
   * replaces the rows and the link keeps the new matches and layout.
   */
  async redefineGoogle(startStep?: 1 | 2) {
    const sheet = this.sheet();
    const link = sheet ? this.google.linkOf(sheet.sheetId) : null;
    if (!sheet || !link || this.busy()) return;
    this.linkOpen.set(false);
    this.busy.set(true);
    try {
      // The tab as the table reads it now (its saved rows, if any), so the matches it has can be found again.
      const opened = await this.google.open(link.spreadsheetId, link.layout ? { tab: link.tabTitle, layout: link.layout } : undefined);
      const same = (name: string) => name.trim().toLowerCase() === link.tabTitle.trim().toLowerCase();
      const tab = opened.tabs.find((item) => item.name === link.tabTitle) ?? opened.tabs.find((item) => same(item.name));
      if (!tab) throw new Error(`The tab “${link.tabTitle}” isn't in the Google Sheet any more. Its tabs: ${opened.tabs.map((item) => item.name).join(', ')}.`);
      this.importFile.set({
        fileName: `${opened.file.name} › ${tab.name}.xlsx`,
        bytes: opened.bytes,
        tab: tab.name,
        headerRow: tab.auto.headerFrom,
        layout: link.layout ?? undefined,
        matches: mappingFromLink(sheet.columns, tab.headers, tab.positions ?? tab.headers.map((_, index) => index + 1), link.headerMap),
        connect: { spreadsheetId: opened.file.id, spreadsheetTitle: opened.file.name, tabTitle: tab.name },
        startStep,
      });
    } catch (error) {
      this.toasts.error(errorText(error));
    } finally {
      this.busy.set(false);
    }
  }

  /** One click to see how a file's columns connect to this table's: the import opened on its Match step. */
  async seeConnections() {
    const sheet = this.sheet();
    if (!sheet || this.busy()) return;
    if (this.google.linkOf(sheet.sheetId)) return this.redefineGoogle(2);
    // The Google sheet and tab last used for this table, if there is one: no picking again.
    let saved: { spreadsheetId: string; tabTitle: string } | null = null;
    try {
      saved = JSON.parse((await this.api.getSetting(`sheet.${sheet.sheetId}.lastGoogleSource`)) ?? 'null');
    } catch {
      saved = null;
    }
    if (saved?.spreadsheetId && saved.tabTitle && this.google.signedIn()) {
      this.busy.set(true);
      try {
        const opened = await this.google.open(saved.spreadsheetId);
        const tab = opened.tabs.find((item) => item.name === saved!.tabTitle);
        if (tab) {
          this.importFile.set({
            fileName: `${opened.file.name} › ${tab.name}.xlsx`,
            bytes: opened.bytes,
            tab: tab.name,
            headerRow: tab.auto.headerFrom,
            connect: { spreadsheetId: opened.file.id, spreadsheetTitle: opened.file.name, tabTitle: tab.name },
            startStep: 2,
          });
          return;
        }
      } catch (error) {
        this.toasts.error(errorText(error));
        return;
      } finally {
        this.busy.set(false);
      }
    }
    // Nothing remembered: the picker, and then straight to the matching.
    this.matchFirst = true;
    this.googleIntoOpen.set(true);
  }

  private matchFirst = false;

  closeGooglePicker() {
    this.googleIntoOpen.set(false);
    this.matchFirst = false;
  }

  /** A tab picked from a Google Sheet: it goes to the same preview as an Excel file. */
  googlePicked(file: ImportFile) {
    this.googleIntoOpen.set(false);
    const sheet = this.sheet();
    if (sheet && file.connect) {
      // Remembered for this table, so seeing the connections again is one click.
      void this.api
        .setSetting(`sheet.${sheet.sheetId}.lastGoogleSource`, JSON.stringify({ spreadsheetId: file.connect.spreadsheetId, tabTitle: file.connect.tabTitle }))
        .catch(() => undefined);
    }
    this.importFile.set(this.matchFirst ? { ...file, startStep: 2 } : file);
    this.matchFirst = false;
  }

  async pickImport() {
    const path = await this.api.pickExcelFile();
    if (!path) return;
    try {
      const bytes = await this.api.readFile(path);
      this.importFile.set({ fileName: baseName(path), bytes });
    } catch (error) {
      this.toasts.error(errorText(error));
    }
  }

  imported({ count, headerMap, layout }: ImportDone) {
    const connect = this.importFile()?.connect;
    const sheet = this.sheet();
    this.importFile.set(null);
    this.search.set('');
    this.toasts.show(`${count} row${count === 1 ? '' : 's'} imported and saved`, 'ok', {
      label: 'Undo',
      run: () => void this.undoLastImport(),
    });
    // Imported from a Google Sheet tab and asked to stay connected: the link keeps the column matches.
    if (connect && headerMap && sheet) {
      this.google
        .connectTable(sheet.sheetId, { spreadsheetId: connect.spreadsheetId, spreadsheetTitle: connect.spreadsheetTitle, tabTitle: connect.tabTitle, headerMap, layout }, count)
        .then(() => this.toasts.show(`Connected to “${connect.spreadsheetTitle} › ${connect.tabTitle}”. Press Sync to read it again.`))
        .catch((error) => this.toasts.error(`The rows are in, but the table couldn't be connected to Google: ${errorText(error)}`));
    }
  }

  private async undoLastImport() {
    const sheet = this.sheet();
    if (!sheet) return;
    const [last] = await this.api.listImports(sheet.sheetId);
    if (last) await this.undoImport(last, false);
  }

  async openImports() {
    const sheet = this.sheet();
    if (!sheet) return;
    this.imports.set(await this.api.listImports(sheet.sheetId));
    this.importsOpen.set(true);
  }

  async undoImport(record: ImportRecord, ask = true) {
    const sheet = this.sheet();
    if (!sheet) return;
    if (ask && !(await this.api.confirm(`Take out the ${record.rowsLeft} rows ${record.fileName} brought in?`, 'Undo import', 'Take them out'))) return;
    try {
      const removed = await this.store.undoImport(sheet.sheetId, record.importId);
      this.toasts.show(`${removed} imported row${removed === 1 ? '' : 's'} taken out`);
      if (this.importsOpen()) this.imports.set(await this.api.listImports(sheet.sheetId));
    } catch (error) {
      this.toasts.error(errorText(error));
    }
  }

  async exportTable() {
    const sheet = this.sheet();
    const book = this.store.workbook();
    if (!sheet || !book) return;
    const path = await this.api.pickSavePath(`${safeFileName(sheet.title)} - ${safeFileName(book.mac.macCode)}.xlsx`);
    if (!path) return;
    try {
      // The Zones table also gets a sheet with the map as the Zone Map draws it.
      const picture = sheet.templateKey === 'zones' ? (zoneMapPicture(sheet) ?? undefined) : undefined;
      await this.api.writeFile(path, await buildPowerBiWorkbook([{ mac: book.mac, sheets: [sheet] }], { single: true, picture }));
      this.toasts.show(`Saved ${baseName(path)}`);
    } catch (error) {
      this.toasts.error(errorText(error));
    }
  }

  // --------------------------------------------------------------- table

  async deleteTable(sheet: SheetWithRows) {
    const links = this.store
      .sheets()
      .filter((other) => other.sheetId !== sheet.sheetId)
      .filter((other) => other.columns.some((column) => `${column.source ?? ''}${column.formula ?? ''}`.includes(`'${sheet.title}'[`)))
      .map((other) => other.title);
    const text = [
      `Delete the table “${sheet.title}” and its ${sheet.rows.length} rows? This can't be undone.`,
      links.length ? `These tables pick values from it: ${links.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    if (!(await this.api.confirm(text, 'Delete table', 'Delete'))) return;
    try {
      await this.store.deleteSheet(sheet.sheetId);
      this.settingsOpen.set(false);
      this.toasts.show(`${sheet.title} deleted`);
      void this.router.navigate(['/mac', sheet.macId]);
    } catch (error) {
      this.toasts.error(errorText(error));
    }
  }

  when(at: string) {
    // SQLite keeps UTC: show it in Cambodia time.
    const date = new Date(`${at.replace(' ', 'T')}Z`);
    return Number.isNaN(date.getTime())
      ? at
      : date.toLocaleString('en-GB', { timeZone: 'Asia/Phnom_Penh', dateStyle: 'medium', timeStyle: 'short' });
  }
}
