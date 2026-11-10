import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';

import type { Column, ColumnType, SheetWithRows } from '../core/models';
import { FORMULA_FUNCTIONS, formatFormulaValue, isFormulaError } from '../formula/evaluate-formula';
import type { WorkbookFormulas } from '../formula/sheet-formulas';
import { COLUMN_TYPES, columnLabel, linkSourceText, parseLinkSource, PATH_SEPARATOR } from '../sheet/columns';
import { Icon } from './icon';
import { Modal } from './modal';

/** Adds a column or changes one: its name, type, unit, box and group, and a choice's list, a link's table or a formula. */
@Component({
  selector: 'app-column-dialog',
  imports: [Modal, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [open]="open()"
      [title]="column() ? 'Edit column' : 'New column'"
      [subtitle]="sheet().title"
      size="xwide"
      (closed)="closed.emit()"
    >
      <form id="column-form" class="layout" (submit)="$event.preventDefault(); save()">
        <div class="main form-stack">
          <div class="form-grid">
            <label class="form-group">
              <span class="form-label">Name *</span>
              <input class="input-field" [value]="name()" (input)="name.set(value($event))" placeholder="Live plant" autofocus />
            </label>
            <label class="form-group">
              <span class="form-label">Type</span>
              <select class="input-field" [value]="type()" (change)="type.set($any(value($event)))">
                @for (item of types; track item.value) {
                  <option [value]="item.value">{{ item.label }}</option>
                }
              </select>
              <small class="form-hint">{{ typeHint() }}</small>
            </label>
          </div>

          @if (type() === 'choice') {
            <label class="form-group">
              <span class="form-label">The list *</span>
              <textarea class="input-field" rows="4" [value]="optionsText()" (input)="optionsText.set(value($event))" placeholder="One per line&#10;Good&#10;Medium&#10;Poor"></textarea>
              <small class="form-hint">One value per line.</small>
            </label>
          }

          @if (type() === 'link') {
            <div class="form-grid">
              <label class="form-group">
                <span class="form-label">From table *</span>
                <select class="input-field" [value]="linkTable()" (change)="linkTable.set(value($event)); linkColumn.set('')">
                  <option value="">Choose…</option>
                  @for (other of otherSheets(); track other.sheetId) {
                    <option [value]="other.title">{{ other.title }}</option>
                  }
                </select>
              </label>
              <label class="form-group">
                <span class="form-label">Its column *</span>
                <select class="input-field" [value]="linkColumn()" (change)="linkColumn.set(value($event))" [disabled]="!linkTable()">
                  <option value="">Choose…</option>
                  @for (name of linkColumns(); track name) {
                    <option [value]="name">{{ name }}</option>
                  }
                </select>
              </label>
            </div>
            <p class="muted small">A cell picks one of that column's values, e.g. a Zone picks a Plot from the Zones table.</p>
          }

          @if (type() === 'formula') {
            <label class="form-group">
              <span class="form-label">Formula *</span>
              <textarea
                #formulaBox
                class="input-field mono"
                rows="4"
                [value]="formula()"
                (input)="formula.set(value($event))"
                placeholder="=[Healthy] / [Total number] * 100"
              ></textarea>
              @if (formulaProblem()) {
                <small class="bad">{{ formulaProblem() }}</small>
              } @else if (preview() !== null) {
                <small class="good">First row: <strong>{{ preview() }}</strong></small>
              }
            </label>
            <div class="help">
              <div>
                <p class="form-label">Columns (click to add)</p>
                <div class="chips">
                  @for (ref of columnRefs(); track ref) {
                    <button type="button" class="chip" (click)="insert('[' + ref + ']', formulaBox)">{{ ref }}</button>
                  }
                </div>
              </div>
              <div>
                <p class="form-label">Functions</p>
                <div class="chips">
                  @for (fn of functions; track fn) {
                    <button type="button" class="chip fn" (click)="insert(fn + '(', formulaBox)">{{ fn }}</button>
                  }
                </div>
              </div>
              <p class="muted small">
                Like Excel: <code>=IF([Live plant]="","",20-[Live plant])</code>. A column of another table:
                <code>'Zones'[Plant capacity]</code>, e.g. <code>=LOOKUP('Zones'[Plant capacity], 'Zones'[Plot], [Zone])</code>.
                Where boxes share a name, put the box in front: <code>[2 · Establishment (7 DAT) › Date]</code>.
              </p>
            </div>
          }
        </div>

        <aside class="side form-stack">
          @if (type() === 'number' || type() === 'percentage' || type() === 'formula') {
            <label class="form-group">
              <span class="form-label">Unit</span>
              <input class="input-field" [value]="unit()" (input)="unit.set(value($event))" placeholder="kg, cm, plants…" />
            </label>
          }
          @if (type() === 'number' || type() === 'percentage') {
            <div class="form-group">
              <span class="form-label">Allowed values</span>
              <span class="range">
                <input class="input-field" type="number" step="any" [value]="min()" (input)="min.set(value($event))" placeholder="Least" aria-label="Least value" />
                <span class="muted">to</span>
                <input class="input-field" type="number" step="any" [value]="max()" (input)="max.set(value($event))" placeholder="Most" aria-label="Most value" />
              </span>
              <small class="form-hint">A value outside is drawn red, to check. Leave empty for no limit.</small>
            </div>
          }
          <label class="form-group">
            <span class="form-label">Box</span>
            <input class="input-field" list="box-names" [value]="box()" (input)="box.set(value($event))" placeholder="None" />
            <datalist id="box-names">
              @for (name of boxNames(); track name) {
                <option [value]="name"></option>
              }
            </datalist>
            <small class="form-hint">A heading over several columns, e.g. "1 · Transplant (0 DAT)".</small>
          </label>
          <label class="form-group">
            <span class="form-label">Group</span>
            <input class="input-field" list="group-names" [value]="group()" (input)="group.set(value($event))" placeholder="None" />
            <datalist id="group-names">
              @for (name of groupNames(); track name) {
                <option [value]="name"></option>
              }
            </datalist>
            <small class="form-hint">A smaller heading under the box, e.g. "Plant Survival (No.)".</small>
          </label>
          @if (type() !== 'formula') {
            <label class="check-label">
              <input type="checkbox" class="checkbox" [checked]="required()" (change)="required.set(checked($event))" />
              Every row needs a value
            </label>
          }
          <label class="form-group note">
            <span class="form-label">Help text</span>
            <input class="input-field" [value]="note()" (input)="note.set(value($event))" placeholder="Shown in the Excel template" />
          </label>
        </aside>
      </form>
      @if (error()) {
        <div class="alert-box error"><app-icon name="alert" /> {{ error() }}</div>
      }
      <ng-container footer>
        <button type="button" class="btn btn-secondary" (click)="closed.emit()">Cancel</button>
        <button type="submit" form="column-form" class="btn btn-primary">{{ column() ? 'Save column' : 'Add column' }}</button>
      </ng-container>
    </app-modal>
  `,
  styles: `
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 250px; gap: 22px; }
    .side { min-width: 0; }
    .range { display: flex; align-items: center; gap: 8px; }
    .range .input-field { min-width: 0; flex: 1; }
    .side { border-left: var(--hairline) solid var(--border); padding-left: 20px; }
    .small { font-size: 12px; margin: 0 0 12px; line-height: 1.5; }
    .help { display: flex; flex-direction: column; gap: 10px; }
    .help .field-label { margin: 0 0 6px; }
    .chips { display: flex; flex-wrap: wrap; gap: 5px; max-height: 120px; overflow: auto; }
    .chip { padding: 3px 10px; font-size: 0.75rem; color: var(--text); }
    .chip.fn { font-family: var(--mono); font-size: 0.6875rem; }
    code { background: var(--fill); padding: 1px 5px; border-radius: 5px; font-size: 0.75rem; font-family: var(--mono); }
    .bad { color: var(--danger) !important; }
    .good { color: var(--success) !important; }
    .alert { margin-top: 12px; }
  `,
})
export class ColumnDialog {
  readonly open = input(false);
  /** The column to change; none: a new one. */
  readonly column = input<Column | null>(null);
  /** A new column's box and group to start with (the neighbour's). */
  readonly preset = input<Partial<Column> | null>(null);
  readonly sheet = input.required<SheetWithRows>();
  readonly sheets = input.required<readonly SheetWithRows[]>();
  readonly formulas = input.required<WorkbookFormulas>();
  readonly closed = output<void>();
  readonly saved = output<Column>();

  readonly types = COLUMN_TYPES;
  readonly functions = FORMULA_FUNCTIONS;

  readonly name = signal('');
  readonly type = signal<ColumnType>('text');
  readonly unit = signal('');
  /** The limits a number may have, as typed (empty: none). */
  readonly min = signal('');
  readonly max = signal('');
  readonly box = signal('');
  readonly group = signal('');
  readonly required = signal(false);
  readonly optionsText = signal('');
  readonly formula = signal('');
  readonly linkTable = signal('');
  readonly linkColumn = signal('');
  readonly note = signal('');
  readonly error = signal('');

  readonly typeHint = computed(() => COLUMN_TYPES.find((item) => item.value === this.type())?.hint ?? '');
  readonly otherSheets = computed(() => this.sheets().filter((sheet) => sheet.sheetId !== this.sheet().sheetId));
  readonly linkColumns = computed(() => {
    const table = this.sheets().find((sheet) => sheet.title === this.linkTable());
    return [...new Set((table?.columns ?? []).map((column) => column.name))];
  });
  readonly boxNames = computed(() => [...new Set(this.sheet().columns.map((column) => column.box).filter(Boolean))] as string[]);
  readonly groupNames = computed(
    () =>
      [
        ...new Set(
          this.sheet()
            .columns.filter((column) => !this.box().trim() || column.box === this.box().trim())
            .map((column) => column.group)
            .filter(Boolean),
        ),
      ] as string[],
  );

  /** How each of the table's columns is named in a formula. */
  readonly columnRefs = computed(() => {
    const columns = this.sheet().columns.filter((column) => column.key !== this.column()?.key);
    const counts = new Map<string, number>();
    for (const column of columns) counts.set(column.name, (counts.get(column.name) ?? 0) + 1);
    return columns.map((column) =>
      (counts.get(column.name) ?? 0) > 1 && column.box ? `${column.box}${PATH_SEPARATOR}${column.name}` : column.name,
    );
  });

  readonly formulaProblem = computed(() => {
    if (this.type() !== 'formula' || !this.formula().trim()) return null;
    return this.formulas().check(this.formula());
  });

  readonly preview = computed(() => {
    if (this.type() !== 'formula' || !this.formula().trim() || this.formulaProblem()) return null;
    const sheet = this.sheet();
    const row = sheet.rows[0];
    if (!row) return null;
    const draft: Column = { key: this.column()?.key ?? '__draft__', name: this.name() || 'Formula', type: 'formula', formula: this.formula(), box: this.box() || undefined };
    const value = this.formulas().value(sheet, row, draft);
    return isFormulaError(value) ? `${value.code} — ${value.reason}` : formatFormulaValue(value) || '(blank)';
  });

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const column = this.column();
      const preset = this.preset();
      const start = column ?? preset ?? {};
      this.name.set(column?.name ?? '');
      this.type.set(column?.type ?? 'text');
      this.unit.set(start.unit ?? '');
      this.min.set(column?.min === undefined ? '' : String(column.min));
      this.max.set(column?.max === undefined ? '' : String(column.max));
      this.box.set(start.box ?? '');
      this.group.set(start.group ?? '');
      this.required.set(column?.required ?? false);
      this.optionsText.set((column?.options ?? []).join('\n'));
      this.formula.set(column?.formula ?? '');
      const source = parseLinkSource(column?.source);
      this.linkTable.set(source?.table ?? '');
      this.linkColumn.set(source?.column ?? '');
      this.note.set(column?.note ?? '');
      this.error.set('');
    });
  }

  /** A limit typed: the number, undefined for none, null if it isn't a number. */
  private limit(text: string): number | undefined | null {
    const typed = text.trim();
    if (!typed) return undefined;
    const number = Number(typed);
    return Number.isFinite(number) ? number : null;
  }

  value(event: Event) {
    return (event.target as HTMLInputElement).value;
  }

  checked(event: Event) {
    return (event.target as HTMLInputElement).checked;
  }

  insert(text: string, box: HTMLTextAreaElement) {
    const start = box.selectionStart ?? this.formula().length;
    const end = box.selectionEnd ?? start;
    let current = this.formula();
    if (!current.trim()) current = '=';
    const at = current === '=' ? 1 : start;
    const next = current.slice(0, at) + text + current.slice(current === '=' ? 1 : end);
    this.formula.set(next);
    setTimeout(() => {
      box.focus();
      const caret = at + text.length;
      box.setSelectionRange(caret, caret);
    });
  }

  save() {
    const name = this.name().trim();
    if (!name) return this.error.set('Give the column a name.');
    if (/[[\]›]/.test(name)) return this.error.set("A column's name can't have [ ] or › in it.");
    const box = this.box().trim();
    const group = this.group().trim();
    const clash = this.sheet().columns.find(
      (other) =>
        other.key !== this.column()?.key &&
        other.name.trim().toLowerCase() === name.toLowerCase() &&
        (other.box ?? '').trim().toLowerCase() === box.toLowerCase() &&
        (other.group ?? '').trim().toLowerCase() === group.toLowerCase(),
    );
    if (clash) return this.error.set(`There's already a column “${columnLabel(clash)}” here. Give this one another name, box or group.`);
    const type = this.type();
    const column: Column = {
      ...(this.column() ?? {}),
      key: this.column()?.key ?? '',
      name,
      type,
      unit: ['number', 'percentage', 'formula'].includes(type) ? this.unit().trim() || undefined : undefined,
      box: box || undefined,
      group: group || undefined,
      required: type === 'formula' ? false : this.required(),
      min: undefined,
      max: undefined,
      note: this.note().trim() || undefined,
      options: undefined,
      formula: undefined,
      source: undefined,
    };
    if (type === 'number' || type === 'percentage') {
      const least = this.limit(this.min());
      const most = this.limit(this.max());
      if (least === null || most === null) return this.error.set('The least and the most are numbers, or empty.');
      if (least !== undefined && most !== undefined && least > most) return this.error.set('The least can not be more than the most.');
      column.min = least;
      column.max = most;
    }
    if (type === 'choice') {
      const options = [...new Set(this.optionsText().split('\n').map((line) => line.trim()).filter(Boolean))];
      if (!options.length) return this.error.set('Write the list: one value per line.');
      column.options = options;
    }
    if (type === 'link') {
      if (!this.linkTable() || !this.linkColumn()) return this.error.set('Choose the table and its column to pick from.');
      column.source = linkSourceText(this.linkTable(), this.linkColumn());
    }
    if (type === 'formula') {
      let formula = this.formula().trim();
      if (!formula) return this.error.set('Write the formula.');
      if (!formula.startsWith('=')) formula = `=${formula}`;
      const problem = this.formulas().check(formula);
      if (problem) return this.error.set(`The formula: ${problem}`);
      column.formula = formula;
    }
    this.saved.emit(column);
  }
}
