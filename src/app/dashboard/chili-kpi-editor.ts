import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';

import { Icon } from '../components/icon';
import { Modal } from '../components/modal';
import { Api } from '../core/api';
import type { KpiAggregate, SheetWithRows } from '../core/models';
import { WorkbookStore } from '../core/workbook-store';
import { ChiliDashboard } from './chili-dashboard';
import { ChiliKpiStore } from './chili-kpi-store';
import { ChiliVersionStore } from './chili-version-store';
import { blankKpi, columnRef, findColumn, kpiAvailable, KPI_SHOWS, MAX_KPIS, sheetOf, tableRef, type ChiliKpi, type KpiShow } from './chili-kpis';
import { dashboardColumnName, newId } from './dashboard-model';
import { aggregatesFor, studioFields, type StudioField } from './studio-model';

const DECIMALS: { value: number | null; label: string }[] = [
  { value: null, label: 'Automatic' },
  { value: 0, label: '0' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
];
const SHOW_ICON: Record<KpiShow, string> = { card: 'hash', column: 'chart-column', line: 'chart-line' };

interface ColumnOption { key: string; label: string; field: StudioField }

/**
 * Edit dashboard for the chili MAC's KPIs, as the web's ⋯ → Edit dashboard
 * is: the list of cards and charts on the left, the one picked on the right
 * (its title, how it is drawn, which table and column it works out, and from
 * which date column its years come), and what it shows. Changes show on the
 * page at once and are saved as they're made. They apply to every chili MAC.
 */
@Component({
  selector: 'app-chili-kpi-editor',
  imports: [Icon, Modal, ChiliDashboard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [open]="true" title="Edit dashboard" subtitle="Every chili MAC shows these. Changes are saved as you make them." size="xwide" (closed)="closed.emit()">
      <div class="layout">
        <section class="list" aria-label="KPIs on the dashboard">
          <ul>
            @for (item of kpis(); track item.id) {
              <li [class.active]="item.id === selected()?.id">
                <button type="button" class="row" [attr.aria-pressed]="item.id === selected()?.id" (click)="selectedId.set(item.id)">
                  <app-icon [name]="icon(item.show)" [size]="16" />
                  <span class="name"><strong>{{ item.title || 'Untitled' }}</strong><small>{{ summary(item) }}</small></span>
                  @if (!available(item)) { <span class="badge neutral" title="This MAC has no such table or column, so the KPI is left out here.">Not in this MAC</span> }
                </button>
              </li>
            } @empty {
              <li class="none">Nothing on the dashboard yet.</li>
            }
          </ul>
          <button type="button" class="btn btn-secondary btn-sm add" [disabled]="!sheets().length || kpis().length >= max" [title]="kpis().length >= max ? 'A dashboard holds up to ' + max + ' KPIs' : ''" (click)="add()"><app-icon name="plus" /> Add KPI</button>
        </section>

        <section class="detail" aria-label="The picked KPI">
          @if (selected(); as kpi) {
            <div class="detail-head">
              <h3>{{ kpi.title || 'Untitled' }}</h3>
              <div class="tools">
                <button type="button" class="icon-btn" aria-label="Move up" title="Move up" [disabled]="index() === 0" (click)="move(-1)"><app-icon name="arrow-up" [size]="15" /></button>
                <button type="button" class="icon-btn" aria-label="Move down" title="Move down" [disabled]="index() === kpis().length - 1" (click)="move(1)"><app-icon name="arrow-down" [size]="15" /></button>
                <button type="button" class="icon-btn danger" aria-label="Delete this KPI" title="Delete this KPI" (click)="remove()"><app-icon name="trash" [size]="15" /></button>
              </div>
            </div>

            <div class="form">
              <label class="form-group wide"><span class="form-label">Title</span>
                <input class="input-field" maxlength="120" [value]="kpi.title" (input)="patch({ title: $any($event.target).value })" />
              </label>
              <div class="form-group wide"><span class="form-label">Show as</span>
                <div class="segmented" role="group" aria-label="Show as">
                  @for (show of shows; track show.value) {
                    <button type="button" class="segment" [attr.aria-pressed]="kpi.show === show.value" (click)="patch({ show: show.value })"><app-icon [name]="icon(show.value)" [size]="14" /> {{ show.label }}</button>
                  }
                </div>
              </div>
              <label class="form-group"><span class="form-label">Table</span>
                <select class="input-field" (change)="chooseTable($any($event.target).value)">
                  @if (!sheet()) { <option [value]="kpi.table" selected>{{ kpi.table }} (not in this MAC)</option> }
                  @for (item of sheets(); track item.sheetId) { <option [value]="ref(item)" [selected]="ref(item) === kpi.table">{{ item.title }}</option> }
                </select>
              </label>
              <label class="form-group"><span class="form-label">Column</span>
                <select class="input-field" [disabled]="!sheet()" (change)="chooseColumn($any($event.target).value)">
                  <option value="" [selected]="!kpi.column">Rows of the table</option>
                  @if (kpi.column && sheet() && !columnKey()) { <option [value]="'?'" selected>{{ kpi.column }} (not in this table)</option> }
                  @for (option of columns(); track option.key) { <option [value]="option.key" [selected]="option.key === columnKey()">{{ option.label }}</option> }
                </select>
              </label>
              <label class="form-group"><span class="form-label">Calculation</span>
                <select class="input-field" [disabled]="!kpi.column" (change)="patch({ aggregate: $any($event.target).value })">
                  @for (item of calculations(); track item.value) { <option [value]="item.value" [selected]="item.value === kpi.aggregate">{{ item.label }}</option> }
                </select>
              </label>
              <label class="form-group"><span class="form-label">Years from</span>
                <select class="input-field" [disabled]="!sheet()" (change)="chooseYear($any($event.target).value)">
                  <option value="" [selected]="!kpi.year">None (one number)</option>
                  @if (kpi.year && sheet() && !yearKey()) { <option [value]="'?'" selected>{{ kpi.year }} (not in this table)</option> }
                  @for (option of dateColumns(); track option.key) { <option [value]="option.key" [selected]="option.key === yearKey()">{{ option.label }}</option> }
                </select>
              </label>
              <label class="form-group"><span class="form-label">Decimals</span>
                <select class="input-field" (change)="patch({ decimals: decimalsOf($any($event.target).value) })">
                  @for (item of decimals; track item.label) { <option [value]="item.value ?? ''" [selected]="item.value === kpi.decimals">{{ item.label }}</option> }
                </select>
              </label>
            </div>

            <div class="preview" [class.wide]="kpi.show !== 'card'" aria-label="Preview">
              @if (available(kpi)) {
                <app-chili-dashboard [kpis]="[kpi]" [sheets]="store.sheets()" [formulas]="store.formulas()" />
              } @else {
                <p class="note">This MAC has no {{ kpi.table }} table or no such column, so nothing shows here. It still shows in a chili MAC that has them.</p>
              }
            </div>
          } @else {
            <div class="blank">
              <strong>Pick a KPI to change it</strong>
              <p>Or add one: choose a table and what to work out, and it appears on the dashboard.</p>
            </div>
          }
        </section>
      </div>
      <ng-container footer>
        <span class="status">{{ status() }}</span>
        @if (kpiStore.custom()) { <button type="button" class="btn btn-plain" (click)="reset()"><app-icon name="refresh" /> Back to suggested</button> }
        <button type="button" class="btn btn-primary" (click)="closed.emit()">Done</button>
      </ng-container>
    </app-modal>
  `,
  styles: `
    .layout { display: grid; grid-template-columns: minmax(240px, 0.8fr) minmax(0, 1.5fr); gap: 24px; min-height: 440px; }
    .list { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .list ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; max-height: 52vh; overflow-y: auto; }
    .list li { border: var(--hairline) solid transparent; border-radius: 10px; }
    .list li.active { background: var(--accent-soft); border-color: var(--accent); }
    .row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border: 0; background: none; text-align: left; font: inherit; color: var(--text); cursor: pointer; border-radius: 10px; }
    .row:hover { background: var(--fill); }
    .list li.active .row:hover { background: none; }
    .row app-icon { flex: none; color: var(--accent); }
    .name { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .name strong { font-size: 0.8125rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .name small { font-size: 0.75rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .none { padding: 12px 10px; font-size: 0.8125rem; color: var(--text-muted); }
    .add { align-self: flex-start; }
    .detail { min-width: 0; border-left: var(--hairline) solid var(--border); padding-left: 24px; display: flex; flex-direction: column; gap: 16px; }
    .detail-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .detail-head h3 { font-size: 0.9375rem; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tools { display: flex; gap: 2px; flex: none; }
    .tools button:disabled { opacity: 0.4; cursor: default; }
    .form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 14px; }
    .form-group { display: grid; gap: 4px; min-width: 0; }
    .form-group.wide { grid-column: 1 / -1; }
    .form .input-field { width: 100%; min-width: 0; }
    .preview { padding: 14px; border-radius: 12px; background: var(--fill); max-width: 340px; }
    .preview.wide { max-width: 100%; }
    .preview .note { margin: 0; font-size: 0.8125rem; color: var(--text-muted); line-height: 1.5; }
    /* One tile, as wide as the preview. */
    .preview app-chili-dashboard { display: block; --kpi-cols: 1; --chart-cols: 1; }
    .blank { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 6px; padding: 28px; color: var(--text-muted); }
    .blank strong { color: var(--text); }
    .blank p { margin: 0; font-size: 0.8125rem; max-width: 280px; line-height: 1.5; }
    .status { flex: 1; min-width: 0; font-size: 0.75rem; color: var(--text-muted); }
    @media (max-width: 800px) {
      .layout { grid-template-columns: 1fr; }
      .detail { border-left: 0; padding-left: 0; border-top: var(--hairline) solid var(--border); padding-top: 18px; }
    }
  `,
})
export class ChiliKpiEditor {
  readonly closed = output<void>();
  readonly store = inject(WorkbookStore);
  readonly kpiStore = inject(ChiliKpiStore);
  private readonly api = inject(Api);
  private readonly versions = inject(ChiliVersionStore);
  /** Which dashboard this is: the suggested one, a version, or a version with changes made since. */
  readonly status = computed(() => {
    if (!this.kpiStore.custom()) return 'The suggested dashboard';
    const version = this.versions.inUse();
    return version ? `Version ${version.number}` : 'Your dashboard · changes not saved as a version yet (Export dashboard saves them)';
  });

  readonly shows = KPI_SHOWS;
  readonly max = MAX_KPIS;
  readonly decimals = DECIMALS;
  readonly ref = tableRef;
  readonly kpis = this.kpiStore.kpis;
  readonly sheets = this.store.sheets;
  readonly selectedId = signal<string | null>(this.kpiStore.kpis()[0]?.id ?? null);
  readonly selected = computed(() => this.kpis().find((item) => item.id === this.selectedId()) ?? null);
  readonly index = computed(() => this.kpis().findIndex((item) => item.id === this.selectedId()));
  /** The table the picked KPI reads, in this MAC; undefined: this MAC has no such table. */
  readonly sheet = computed(() => {
    const kpi = this.selected();
    return kpi ? sheetOf(this.sheets(), kpi.table) : undefined;
  });
  private readonly fields = computed(() => {
    const sheet = this.sheet();
    return sheet ? studioFields(this.store.formulas(), sheet) : [];
  });
  readonly columns = computed<ColumnOption[]>(() => {
    const sheet = this.sheet();
    return sheet ? sheet.columns.map((column, i) => ({ key: column.key, label: dashboardColumnName(sheet.columns, column), field: this.fields()[i] })) : [];
  });
  readonly dateColumns = computed(() => this.columns().filter((option) => option.field.kind === 'date'));
  /** The key of the column the KPI works out in this table ('' the rows, or it isn't there). */
  readonly columnKey = computed(() => {
    const kpi = this.selected(), sheet = this.sheet();
    return kpi && sheet && kpi.column ? (findColumn(sheet, kpi.column, kpi.box)?.key ?? '') : '';
  });
  readonly yearKey = computed(() => {
    const kpi = this.selected(), sheet = this.sheet();
    return kpi && sheet && kpi.year ? (findColumn(sheet, kpi.year, kpi.yearBox)?.key ?? '') : '';
  });
  readonly calculations = computed(() => {
    const kpi = this.selected();
    if (!kpi?.column) return [{ value: 'count' as KpiAggregate, label: 'Count of rows' }];
    const kind = this.columns().find((option) => option.key === this.columnKey())?.field.kind ?? 'text';
    return aggregatesFor(kind);
  });

  icon(show: KpiShow) {
    return SHOW_ICON[show];
  }

  available(kpi: ChiliKpi) {
    return kpiAvailable(kpi, this.sheets(), this.store.formulas());
  }

  summary(kpi: ChiliKpi) {
    const sheet = sheetOf(this.sheets(), kpi.table);
    const show = KPI_SHOWS.find((item) => item.value === kpi.show)?.label ?? kpi.show;
    return `${show} · ${sheet?.title ?? kpi.table}`;
  }

  decimalsOf(value: string) {
    return value === '' ? null : Number(value);
  }

  /** Changes the picked KPI and keeps the list. */
  patch(change: Partial<ChiliKpi>) {
    const id = this.selectedId();
    if (!id) return;
    void this.kpiStore.save(this.kpis().map((item) => (item.id === id ? { ...item, ...change } : item)));
  }

  chooseTable(table: string) {
    const sheet = sheetOf(this.sheets(), table);
    // A new table: its rows counted, over its first date column.
    this.patch({ table, column: '', box: undefined, aggregate: 'count', ...this.yearsOf(sheet) });
  }

  chooseColumn(key: string) {
    const sheet = this.sheet();
    if (key === '?' || !sheet) return;
    const column = sheet.columns.find((item) => item.key === key);
    if (!column) return this.patch({ column: '', box: undefined, aggregate: 'count' });
    const kind = this.columns().find((option) => option.key === key)?.field.kind ?? 'text';
    const allowed = aggregatesFor(kind).map((item) => item.value);
    const current = this.selected()?.aggregate;
    const aggregate: KpiAggregate = current && allowed.includes(current) ? current : kind === 'number' ? 'sum' : 'count_values';
    const ref = columnRef(sheet, column);
    this.patch({ column: ref.column, box: ref.box, aggregate });
  }

  chooseYear(key: string) {
    const sheet = this.sheet();
    if (key === '?' || !sheet) return;
    const column = sheet.columns.find((item) => item.key === key);
    if (!column) return this.patch({ year: '', yearBox: undefined });
    const ref = columnRef(sheet, column);
    this.patch({ year: ref.column, yearBox: ref.box });
  }

  /** The years of a table's first date column (none: no years). */
  private yearsOf(sheet: SheetWithRows | undefined): Pick<ChiliKpi, 'year' | 'yearBox'> {
    if (!sheet) return { year: '', yearBox: undefined };
    const fields = studioFields(this.store.formulas(), sheet);
    const date = sheet.columns.find((_, i) => fields[i].kind === 'date');
    return date ? { year: columnRef(sheet, date).column, yearBox: columnRef(sheet, date).box } : { year: '', yearBox: undefined };
  }

  add() {
    const sheet = this.sheet() ?? this.sheets()[0];
    if (!sheet || this.kpis().length >= MAX_KPIS) return;
    const kpi = { ...blankKpi(newId(), sheet), ...this.yearsOf(sheet) };
    void this.kpiStore.save([...this.kpis(), kpi]);
    this.selectedId.set(kpi.id);
  }

  move(by: -1 | 1) {
    const list = [...this.kpis()], at = this.index(), to = at + by;
    if (at < 0 || to < 0 || to >= list.length) return;
    [list[at], list[to]] = [list[to], list[at]];
    void this.kpiStore.save(list);
  }

  remove() {
    const list = this.kpis(), at = this.index();
    if (at < 0) return;
    const rest = list.filter((_, i) => i !== at);
    this.selectedId.set(rest[Math.min(at, rest.length - 1)]?.id ?? null);
    void this.kpiStore.save(rest);
  }

  async reset() {
    if (!(await this.api.confirm('Go back to the suggested KPIs? Your dashboard is kept in Dashboard versions, so you can return to it.', 'Back to suggested', 'Go back'))) return;
    await this.versions.useSuggested();
    this.selectedId.set(this.kpiStore.kpis()[0]?.id ?? null);
  }
}
