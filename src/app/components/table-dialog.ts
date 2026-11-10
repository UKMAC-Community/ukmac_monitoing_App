import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';

import { Api, errorText } from '../core/api';
import type { Column, SheetWithRows } from '../core/models';
import { WorkbookStore } from '../core/workbook-store';
import { readExcelSheets, tableFromSheet, type ExcelSheetData } from '../excel/sheet-from-excel';
import { typeLabel } from '../sheet/columns';
import { Icon } from './icon';
import { Modal } from './modal';
import { baseName } from '../core/paths';

type Start = 'blank' | 'copy' | 'excel';

/** Makes a table (blank, a copy of another's columns, or straight from an Excel sheet), or changes one's name, heading and note. */
@Component({
  selector: 'app-table-dialog',
  imports: [Modal, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [open]="open()"
      [title]="sheet() ? 'Table settings' : 'New table'"
      [subtitle]="sheet() ? sheet()!.title : 'Like a sheet: add, rename and move its columns whenever you like.'"
      [size]="!sheet() && start() === 'excel' ? 'wide' : 'normal'"
      (closed)="closed.emit()"
    >
      <form id="table-form" class="form-stack" (submit)="$event.preventDefault(); save()">
        @if (!sheet()) {
          <div class="starts">
            <button type="button" class="start" [class.on]="start() === 'blank'" (click)="start.set('blank')">
              <app-icon name="table" [size]="18" /> <strong>Blank</strong><small class="form-hint">Date and Note to begin</small>
            </button>
            <button type="button" class="start" [class.on]="start() === 'copy'" (click)="start.set('copy')">
              <app-icon name="copy" [size]="18" /> <strong>Copy a table</strong><small class="form-hint">Its columns, no rows</small>
            </button>
            <button type="button" class="start" [class.on]="start() === 'excel'" (click)="start.set('excel')">
              <app-icon name="upload" [size]="18" /> <strong>From Excel</strong><small class="form-hint">Its headers and rows</small>
            </button>
          </div>
        }

        @if (!sheet() && start() === 'copy') {
          <label class="form-group">
            <span class="form-label">Copy the columns of</span>
            <select class="input-field" [value]="copyFrom()" (change)="copyFrom.set(value($event))">
              <option value="">Choose a table…</option>
              @for (other of sheets(); track other.sheetId) {
                <option [value]="other.sheetId">{{ other.title }} ({{ other.columns.length }} columns)</option>
              }
            </select>
          </label>
        }

        @if (!sheet() && start() === 'excel') {
          <div class="excel">
            <button type="button" class="btn btn-secondary" (click)="pickExcel()" [disabled]="busy()">
              <app-icon name="file" /> {{ excelName() ? 'Choose another file' : 'Choose an Excel file…' }}
            </button>
            @if (excelName()) {
              <span class="muted">{{ excelName() }}</span>
            }
          </div>
          @if (excelSheets().length > 1) {
            <label class="form-group">
              <span class="form-label">Sheet</span>
              <select class="input-field" [value]="excelIndex()" (change)="pickSheet(+value($event))">
                @for (item of excelSheets(); track item.name; let i = $index) {
                  <option [value]="i">{{ item.name }} ({{ item.rows.length }} rows)</option>
                }
              </select>
            </label>
          }
          @if (excelSheet(); as data) {
            <p class="muted small">
              Headers on row {{ data.headerRow }}: {{ data.headers.length }} columns, {{ data.rows.length }} rows. The types are a guess; change any later.
            </p>
            <div class="guess">
              @for (column of guessed(); track column.key) {
                <span class="badge neutral">{{ column.name }} · {{ type(column) }}</span>
              }
            </div>
          }
        }

        <label class="form-group">
          <span class="form-label">Name *</span>
          <input class="input-field" [value]="title()" (input)="title.set(value($event))" placeholder="Harvest by zone" />
        </label>
        <label class="form-group">
          <span class="form-label">Heading</span>
          <input class="input-field" list="headings" [value]="heading()" (input)="heading.set(value($event))" placeholder="My tables" />
          <datalist id="headings">
            @for (name of headings(); track name) {
              <option [value]="name"></option>
            }
          </datalist>
          <small class="form-hint">The sidebar groups tables under it: Nursery, Planting, QA/QC…</small>
        </label>
        <label class="form-group">
          <span class="form-label">What it's for</span>
          <textarea class="input-field" rows="2" [value]="about()" (input)="about.set(value($event))"></textarea>
        </label>
        @if (sheet() && templateOffer(); as offer) {
          <div class="alert-box info update">
            <app-icon name="refresh" />
            <div class="update-text">
              <strong>{{ offer.title }}</strong>
              <span>{{ offer.note }}</span>
            </div>
            <button type="button" class="btn btn-secondary btn-sm" [disabled]="busy() || working()" (click)="templateUpdate.emit()">{{ offer.button }}</button>
          </div>
        }
        @if (error()) {
          <div class="alert-box error">{{ error() }}</div>
        }
      </form>
      <ng-container footer>
        @if (sheet()) {
          <button type="button" class="btn btn-danger-soft" (click)="remove.emit(sheet()!)"><app-icon name="trash" /> Delete table</button>
          <span class="spacer"></span>
        }
        <button type="button" class="btn btn-secondary" (click)="closed.emit()">Cancel</button>
        <button type="submit" form="table-form" class="btn btn-primary" [disabled]="busy()">{{ sheet() ? 'Save' : 'Create table' }}</button>
      </ng-container>
    </app-modal>
  `,
  styles: `
    .starts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px; }
    .start {
      display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 12px; border-radius: 10px;
      border: 1px solid var(--line-strong); background: #fff; cursor: pointer; text-align: left; font: inherit; color: var(--text);
    }
    .start small { color: var(--muted); font-size: 12px; }
    .start.on { border-color: var(--accent); background: var(--accent-soft); box-shadow: 0 0 0 1px var(--accent) inset; }
    .start app-icon { color: var(--accent); }
    .excel { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
    .small { font-size: 12px; margin: 0 0 8px; }
    .guess { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 14px; max-height: 110px; overflow: auto; }
    .spacer { flex: 1; }
    .update { align-items: center; }
    .update-text { flex: 1; display: flex; flex-direction: column; gap: 2px; font-size: 0.8125rem; }
  `,
})
export class TableDialog {
  private readonly api = inject(Api);
  private readonly store = inject(WorkbookStore);

  readonly open = input(false);
  /** The table to change; none: a new one. */
  readonly sheet = input<SheetWithRows | null>(null);
  readonly closed = output<void>();
  readonly created = output<SheetWithRows>();
  readonly updated = output<void>();
  readonly remove = output<SheetWithRows>();
  /** For a table made from the template earlier: what the template has gained since that it doesn't (none: it is up to date). */
  readonly templateOffer = input<{ title: string; note: string; button: string } | null>(null);
  /** The page is busy (saving columns). */
  readonly working = input(false);
  /** The person asks for those columns to be added. */
  readonly templateUpdate = output<void>();

  readonly sheets = computed(() => this.store.sheets());
  readonly headings = computed(() => [...new Set(this.store.sheets().map((sheet) => sheet.heading))]);

  readonly start = signal<Start>('blank');
  readonly title = signal('');
  readonly heading = signal('');
  readonly about = signal('');
  readonly copyFrom = signal('');
  readonly excelName = signal('');
  readonly excelSheets = signal<ExcelSheetData[]>([]);
  readonly excelIndex = signal(0);
  readonly error = signal('');
  readonly busy = signal(false);

  readonly excelSheet = computed(() => this.excelSheets()[this.excelIndex()] ?? null);
  readonly guessed = computed(() => {
    const data = this.excelSheet();
    return data ? tableFromSheet(data).columns : [];
  });

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const sheet = this.sheet();
      this.start.set('blank');
      this.title.set(sheet?.title ?? '');
      this.heading.set(sheet?.heading ?? 'My tables');
      this.about.set(sheet?.about ?? '');
      this.copyFrom.set('');
      this.excelName.set('');
      this.excelSheets.set([]);
      this.excelIndex.set(0);
      this.error.set('');
    });
  }

  value(event: Event) {
    return (event.target as HTMLInputElement).value;
  }

  type(column: Column) {
    return typeLabel(column.type);
  }

  async pickExcel() {
    this.error.set('');
    const path = await this.api.pickExcelFile();
    if (!path) return;
    this.busy.set(true);
    try {
      const bytes = await this.api.readFile(path);
      const sheets = await readExcelSheets(bytes);
      const name = baseName(path);
      this.excelName.set(name);
      this.excelSheets.set(sheets);
      this.pickSheet(0);
    } catch (error) {
      this.error.set(errorText(error));
    } finally {
      this.busy.set(false);
    }
  }

  pickSheet(index: number) {
    this.excelIndex.set(index);
    const data = this.excelSheets()[index];
    const fileTitle = this.excelName().replace(/\.xlsx$/i, '');
    if (data && (!this.title().trim() || this.excelSheets().some((item) => item.name === this.title()) || this.title() === fileTitle)) {
      this.title.set(this.excelSheets().length > 1 ? data.name : fileTitle);
    }
  }

  async save() {
    this.error.set('');
    const title = this.title().trim();
    if (!title) return this.error.set('Give the table a name.');
    this.busy.set(true);
    try {
      const sheet = this.sheet();
      if (sheet) {
        await this.store.updateSheet(sheet.sheetId, { title, heading: this.heading(), about: this.about() });
        this.updated.emit();
        return;
      }
      let columns: Column[] | undefined;
      let rows: Record<string, string>[] | undefined;
      if (this.start() === 'copy') {
        const from = this.store.sheet(Number(this.copyFrom()));
        if (!from) return this.error.set('Choose the table to copy.');
        columns = from.columns.map((column) => ({ ...column }));
      } else if (this.start() === 'excel') {
        const data = this.excelSheet();
        if (!data) return this.error.set('Choose the Excel file.');
        ({ columns, rows } = tableFromSheet(data));
      }
      const created = await this.store.createSheet({ title, heading: this.heading(), about: this.about(), columns, rows });
      this.created.emit(created);
    } catch (error) {
      this.error.set(errorText(error));
    } finally {
      this.busy.set(false);
    }
  }
}
