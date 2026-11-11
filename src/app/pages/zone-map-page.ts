import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Farm3d } from '../components/farm-3d';
import { Icon } from '../components/icon';
import { MacMap3d, type PlotCard, type Reshaped } from '../components/mac-map-3d';
import type { MapShape } from '../components/mac-map';
import { Modal } from '../components/modal';
import { Api } from '../core/api';
import { WorkbookStore } from '../core/workbook-store';
import { formatDate } from '../sheet/columns';
import { formOf, formProblem, newPlotCells, newPlotForm, newPlotProblem, outlineChanges, placeTakenBy, plotChanges, ReshapeHistory, statusNameOf, type PlotForm } from '../zonemap/zone-edit';
import { buildZoneLayout, filterLayout, mapCentre, plotCard, plotShapes, showsPlot, usageWord, type PlotShow, type Usage, type ZoneCell } from '../zonemap/zone-layout';

export type ZoneMapView = 'farm' | 'satellite';

/**
 * Zone Map, as the system's: the farm drawn in 3D (the zones as fields of beds, the plants swaying; the system's Farm look),
 * or every plot at its place on the satellite, planted ones in the stronger shade. One of them is on at a time (each holds a
 * WebGL view); it opens on the satellite.
 */
@Component({
  selector: 'app-zone-map-page',
  imports: [RouterLink, Icon, MacMap3d, Farm3d, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.mac(); as mac) {
      <header class="zm-head">
        <a class="page-back-icon" [routerLink]="['/mac', mac.macId]" title="Back to the dashboard" aria-label="Back"><app-icon name="arrow-left" [size]="16" /></a>
        <h1>Zone Map</h1>
        <span class="badge neutral">{{ mac.macName }}</span>
        <p class="zm-desc">Every plot at its place in its zone. Click a plot for its details, then edit it, or edit its shape on the satellite.</p>
      </header>

      <div class="page">

        <section class="stats" aria-label="Plots">
          <div class="stat"><strong>{{ counts().plots }}</strong><span>Plots</span></div>
          <div class="stat"><strong>{{ counts().planted }}</strong><span>Planted</span></div>
          <div class="stat"><strong>{{ counts().free }}</strong><span>Not planted yet</span></div>
          <div class="stat"><strong>{{ counts().unused }}</strong><span>Not in use</span></div>
          <div class="stat"><strong>{{ counts().water }}</strong><span>Water</span></div>
        </section>

        @if (!layout().cells.length) {
          <div class="card empty">
            <strong>No zone layout yet</strong>
            <p>Fill the Zones table's Zone number, Row and Column to see the plots here.</p>
            @if (zonesLink(); as link) {
              <a class="btn btn-primary" [routerLink]="link">Open Zones</a>
            }
          </div>
        } @else {
          <section class="card layout-card">
            <div class="view-row">
              @if (editing()) {
                <div class="edit-bar" role="group" aria-label="Edit the plot shapes">
                  <span class="edit-hint"><app-icon name="edit" [size]="14" /> {{ editHint() }}</span>
                  @if (drawing()) {
                    <button type="button" class="btn btn-secondary btn-sm" [disabled]="!draft().length" (click)="undoCorner()"><app-icon name="undo" [size]="13" /> Undo corner</button>
                    <button type="button" class="btn btn-secondary btn-sm" (click)="stopDrawing()">Cancel</button>
                    <button type="button" class="btn btn-primary btn-sm" [disabled]="draft().length < 3" (click)="finishDrawing()"><app-icon name="check" [size]="13" /> Finish plot</button>
                  } @else {
                  <button type="button" class="btn btn-secondary btn-sm" title="Draw a new plot on the satellite: click its corners" (click)="startDrawing()"><app-icon name="plus" [size]="13" /> Add plot</button>
                  <button type="button" class="btn btn-secondary btn-sm" [disabled]="!canUndo()" (click)="undo()"><app-icon name="undo" [size]="13" /> Undo</button>
                  <button type="button" class="btn btn-secondary btn-sm" [disabled]="!canRedo()" (click)="redo()"><app-icon name="redo" [size]="13" /> Redo</button>
                  <button type="button" class="btn btn-secondary btn-sm" (click)="cancelEdit()">Cancel</button>
                  <button type="button" class="btn btn-primary btn-sm" [disabled]="!changedCount()" (click)="saveEdit()"><app-icon name="check" [size]="13" /> Save{{ changedCount() ? ' · ' + changedCount() : '' }}</button>
                  }
                </div>
              } @else if (view() === 'satellite') {
                <div class="legend">
                  <span><i class="sw planted"></i> Planted (dark edge)</span>
                  <span><i class="sw pale"></i> Not planted yet</span>
                  <span><i class="sw unused"></i> Not in use</span>
                  <span><i class="sw water"></i> Water</span>
                </div>
              }
              @if (!editing()) {
                <div class="segmented is-sm show-switch" role="group" aria-label="Which plots to show">
                  <button type="button" class="segment" title="Every plot" [attr.aria-pressed]="show() === 'all'" (click)="setShow('all')">All <small>{{ showCounts().all }}</small></button>
                  <button type="button" class="segment" title="The zones: plots in use that have a zone number" [attr.aria-pressed]="show() === 'zones'" (click)="setShow('zones')">Zones <small>{{ showCounts().zones }}</small></button>
                  <button type="button" class="segment" title="Not in use, water, an old chili plot: the rest that is not a zone" [attr.aria-pressed]="show() === 'other'" (click)="setShow('other')">Other <small>{{ showCounts().other }}</small></button>
                </div>
                <div class="segmented is-sm view-switch" role="group" aria-label="How to see the plots">
                  <button type="button" class="segment" [attr.aria-pressed]="view() === 'satellite'" (click)="setView('satellite')"><app-icon name="map" [size]="13" /> Satellite</button>
                  <button type="button" class="segment" [attr.aria-pressed]="view() === 'farm'" (click)="setView('farm')"><app-icon name="sprout" [size]="13" /> Farm</button>
                </div>
                @if (canEdit(mac)) {
                  <button type="button" class="btn btn-secondary btn-sm edit-shapes" title="Drag a plot's corners, move it whole, or draw a new plot, on the satellite" (click)="startEdit()"><app-icon name="edit" [size]="13" /> Edit shapes</button>
                }
              }
            </div>
            <div class="layout-body">
              @if (view() === 'farm') {
                <div class="sat-box">
                  <app-farm-3d [layout]="shown()" [selected]="selectedId()" (picked)="pick($event)" (cleared)="selectedId.set(null)" />
                </div>
              } @else if (hasMap(mac)) {
                <div class="sat-box">
                  <app-mac-map-3d
                    [latitude]="place(mac)!.lat"
                    [longitude]="place(mac)!.lng"
                    [shapes]="shapes()"
                    [selected]="selectedId()"
                    [card]="editing() ? null : card()"
                    [editable]="editing()"
                    [drawing]="drawing()"
                    [draft]="draft()"
                    (drawClick)="addCorner($event)"
                    (reshaped)="reshaped($event)"
                    (picked)="select($event)"
                    (cleared)="selectedId.set(null)"
                  />
                </div>
              } @else {
                <div class="no-place">
                  <app-icon name="pin" [size]="22" />
                  <strong>This MAC has no place on the map yet</strong>
                  <p>Add its latitude and longitude, or plots with their shapes, to see them on the satellite map: on the home page, open the ⋮ on its card and choose Edit. The Farm view doesn't need it.</p>
                  <div class="no-place-actions">
                    <button type="button" class="btn btn-primary" (click)="setView('farm')">Show the Farm</button>
                    <a class="btn btn-secondary" routerLink="/">Open the home page</a>
                  </div>
                </div>
              }
              <!-- Only once a plot is picked; until then the map takes the whole width. -->
              @if (selected(); as cell) {
                <aside class="details" aria-live="polite">
                  <div class="details-head">
                    <h3>{{ cell.usage === 'normal' ? cell.plot : cell.label }}</h3>
                    @if (!editing()) {
                      <button type="button" class="btn btn-secondary btn-sm" (click)="openForm(cell)"><app-icon name="edit" [size]="13" /> Edit plot</button>
                    }
                  </div>
                  @if (editing() && !cell.outline.length) {
                    <p class="muted">This plot has no shape on the map to edit.</p>
                  }
                  <dl>
                    <dt>{{ cell.section !== null ? 'Zone' : 'Area' }}</dt><dd>{{ cell.zone }}{{ cell.section !== null ? ' · ' + cell.section : '' }}</dd>
                    <dt>Place</dt><dd>Row {{ cell.row }}, column {{ cell.column }}</dd>
                    <dt>Use</dt><dd>{{ usageWord(cell) }}</dd>
                    @if (cell.capacity) { <dt>Plant capacity</dt><dd>{{ cell.capacity }}</dd> }
                    @if (cell.note) { <dt>Note</dt><dd>{{ cell.note }}</dd> }
                  </dl>
                  @if (cell.records.length) {
                    <h4>Records · {{ cell.records.length }}</h4>
                    <ul class="records">
                      @for (record of cell.records.slice(0, 5); track $index) {
                        <li>
                          <strong>{{ date(record.date) }}</strong>
                          <span>{{ record.count ? record.count + ' plants' : '' }}{{ record.type ? ' · ' + record.type : '' }}{{ record.status ? ' · ' + record.status : '' }}</span>
                        </li>
                      }
                    </ul>
                  } @else if (cell.usage === 'normal') {
                    <p class="muted">No records yet.</p>
                  }
                </aside>
              }
            </div>
          </section>

        }
      </div>

      @if (formCell() || creating()) {
        <app-modal [open]="true" [title]="formTitle()" [subtitle]="formSubtitle()" (closed)="closeForm()">
          <form id="plot-form" class="form-stack" (submit)="$event.preventDefault(); saveForm()">
            @if (creating()) {
              <label class="form-group">
                <span class="form-label">Plot code *</span>
                <input class="input-field" [value]="form().plot" (input)="set('plot', $event)" placeholder="e.g. A66" />
                <small class="form-hint">The records and the other tables find the plot by this code, so it can't be changed later.</small>
              </label>
            }
            <div class="form-grid">
              <label class="form-group">
                <span class="form-label">Zone *</span>
                <input class="input-field" [value]="form().zone" (input)="set('zone', $event)" />
              </label>
              <label class="form-group">
                <span class="form-label">Zone number</span>
                <input class="input-field" inputmode="numeric" [value]="form().section" (input)="set('section', $event)" placeholder="e.g. 3" />
              </label>
            </div>
            <div class="form-grid">
              <label class="form-group">
                <span class="form-label">Row *</span>
                <input class="input-field" inputmode="numeric" [value]="form().row" (input)="set('row', $event)" />
              </label>
              <label class="form-group">
                <span class="form-label">Column *</span>
                <input class="input-field" inputmode="numeric" [value]="form().column" (input)="set('column', $event)" />
              </label>
            </div>
            @if (taken(); as other) {
              <div class="alert-box warning">{{ other }} is already at this row and column of this zone. You can still save.</div>
            }
            <div class="form-grid">
              <label class="form-group">
                <span class="form-label">Use</span>
                <select class="input-field" [value]="form().usage" (change)="setUsage($event)">
                  <option value="normal">In use (plants)</option>
                  <option value="unused">Not in use</option>
                  <option value="water">Water</option>
                </select>
              </label>
              @if (form().usage === 'normal') {
                <label class="form-group">
                  <span class="form-label">Plant capacity</span>
                  <input class="input-field" inputmode="numeric" [value]="form().capacity" (input)="set('capacity', $event)" />
                </label>
              } @else {
                <label class="form-group">
                  <span class="form-label">Name on the map</span>
                  <input class="input-field" [value]="form().statusName" (input)="set('statusName', $event)" [placeholder]="form().usage === 'water' ? 'Pond, River…' : 'Forest, Town…'" />
                </label>
              }
            </div>
            <label class="form-group">
              <span class="form-label">Note</span>
              <textarea class="input-field" rows="2" [value]="form().note" (input)="set('note', $event)"></textarea>
            </label>
            @if (formCell(); as cell) {
              <small class="form-hint">The plot's code ({{ cell.plot }}) stays: the records and other tables find the plot by it. {{ cell.outline.length ? '' : 'It has no shape on the map yet.' }}</small>
            }
            @if (problem()) {
              <div class="alert-box error">{{ problem() }}</div>
            }
          </form>
          <ng-container footer>
            <button type="button" class="btn btn-secondary" (click)="closeForm()">Cancel</button>
            <button type="submit" form="plot-form" class="btn btn-primary" [disabled]="!!problem()">{{ creating() ? 'Add plot' : 'Save' }}</button>
          </ng-container>
        </app-modal>
      }
    }
  `,
  styles: `
    :host { --cell-w: 52px; --cell-h: 40px; }
    .zm-head { flex: none; display: flex; align-items: center; gap: 12px; padding: 10px 20px; background: var(--surface-solid); border-bottom: var(--hairline) solid var(--border); }
    .zm-head h1 { font-size: 1rem; font-weight: 600; white-space: nowrap; }
    .zm-desc { min-width: 0; margin: 0; font-size: 0.8125rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* The page fits the window: compact tiles, then the map card takes what is left and a free band stays under it. */
    .page { padding: 16px 20px 40px; gap: 14px; }
    .stats { flex: none; display: flex; flex-wrap: wrap; gap: 10px; }
    .stat { flex: 1 1 130px; display: flex; align-items: baseline; gap: 8px; padding: 9px 16px; background: var(--surface); border: var(--hairline) solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-card); }
    .stat strong { font-size: 1.25rem; font-weight: 700; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
    .stat span { font-size: 0.8125rem; color: var(--text-muted); }
    .layout-card { flex: 1 1 auto; min-height: 520px; display: flex; flex-direction: column; margin: 0; padding: 14px 16px; }
    .layout-body { flex: 1; min-height: 0; }
    .empty { flex: none; margin: 0; padding: 18px 20px; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
    .view-row { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 12px; min-height: 28px; }
    .view-switch { margin-left: 0; }
    .legend { display: flex; flex-wrap: wrap; gap: 16px; font-size: 0.8125rem; color: var(--text-muted); }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .sw { width: 14px; height: 14px; border-radius: 4px; border: 1px solid; }
    .sw.planted { background: linear-gradient(90deg, #7BF542, #BF4E33, #FFF04D, #5B86E0); border: 2px solid #5b4a2a; }
    .sw.pale { background: linear-gradient(90deg, #7BF542, #BF4E33, #FFF04D, #5B86E0); border-color: #c9c9c9; }
    .sw.unused { background: #f7f8f7; border-color: #d7dbd8; }
    .sw.water { background: #dbeafe; border-color: #60a5fa; }
    .sat-box { flex: 1; min-width: 0; position: relative; min-height: 420px; border-radius: var(--radius-md); overflow: hidden; }
    .sat-box app-mac-map-3d:not(.m3-expanded), .sat-box app-farm-3d { position: absolute; inset: 0; }
    .layout-body { display: flex; gap: 24px; align-items: stretch; }
    .no-place { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 320px; padding: 24px; text-align: center; color: var(--text-muted); }
    .no-place strong { color: var(--text); font-size: 1rem; }
    .no-place p { max-width: 420px; margin: 0 0 6px; font-size: 0.875rem; line-height: 1.5; }
    .no-place-actions { display: flex; gap: 8px; }
    .details { flex: none; align-self: flex-start; width: 240px; padding: 14px 16px; border: var(--hairline) solid var(--border); border-radius: var(--radius-md); background: var(--surface-solid); }
    .details-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
    .details h3 { font-size: 1.0625rem; font-weight: 700; min-width: 0; overflow-wrap: anywhere; }
    .show-switch { margin-left: auto; }
    .show-switch .segment small { margin-left: 4px; font-size: 0.6875rem; font-weight: 500; opacity: 0.65; }
    .edit-shapes { margin-left: 0; }
    .edit-bar { flex: 1; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
    .edit-hint { display: inline-flex; align-items: center; gap: 6px; margin-right: auto; font-size: 0.8125rem; color: var(--text-muted); }
    .details h4 { margin: 14px 0 6px; font-size: 0.75rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 0.8125rem; }
    dt { color: var(--text-muted); }
    dd { font-weight: 500; text-align: right; }
    .records { display: flex; flex-direction: column; gap: 8px; font-size: 0.8125rem; }
    .records li { display: flex; flex-direction: column; }
    .records span { color: var(--text-muted); }
    .muted { color: var(--text-muted); font-size: 0.8125rem; }
    @media (max-width: 900px) { .layout-body { flex-direction: column; } .details { width: 100%; } }
  `,
})
export class ZoneMapPage {
  readonly store = inject(WorkbookStore);
  readonly selectedId = signal<string | null>(null);
  /** The page opens on the satellite, as the system's does; the farm drawn in 3D is one tap away. */
  readonly view = signal<ZoneMapView>('satellite');
  setView(view: ZoneMapView) {
    this.view.set(view);
  }
  /** Where the satellite looks: the MAC's own place, else the middle of its plots (a MAC opened from a file has no place of its own). */
  place(mac: { latitude: number | null; longitude: number | null }) {
    // Where the map looks does not follow the filter: it is worked out from every plot.
    return mapCentre(mac, plotShapes(this.layout()));
  }
  hasMap(mac: { latitude: number | null; longitude: number | null }) {
    return this.place(mac) !== null;
  }

  private readonly zonesSheet = computed(() => this.store.sheets().find((sheet) => sheet.templateKey === 'zones') ?? null);
  private readonly recordsSheet = computed(() => this.store.sheets().find((sheet) => sheet.templateKey === 'zone-records') ?? null);
  readonly layout = computed(() => buildZoneLayout(this.zonesSheet(), this.recordsSheet()));
  readonly selected = computed(() => this.layout().cells.find((cell) => cell.id === this.selectedId()) ?? null);

  /** Which plots the map shows: all, the zones (in use), or the rest (water, not in use…). */
  readonly show = signal<PlotShow>('zones');
  /** The layout as that shows it. */
  readonly shown = computed(() => filterLayout(this.layout(), this.show()));
  readonly showCounts = computed(() => {
    const cells = this.layout().cells;
    const zones = cells.filter((cell) => cell.usage === 'normal').length;
    return { all: cells.length, zones, other: cells.length - zones };
  });
  setShow(show: PlotShow) {
    this.show.set(show);
    // A plot picked that is not shown now is let go of (its details would point at nothing on the map).
    const picked = this.selected();
    if (picked && !showsPlot(picked, show)) this.selectedId.set(null);
  }

  readonly zonesLink = computed(() => {
    const sheet = this.zonesSheet();
    const mac = this.store.mac();
    return sheet && mac ? ['/mac', mac.macId, 'table', sheet.sheetId] : null;
  });

  readonly counts = computed(() => {
    const cells = this.layout().cells;
    const usable = cells.filter((cell) => cell.usage === 'normal');
    return {
      plots: usable.length,
      planted: usable.filter((cell) => cell.planted).length,
      free: usable.filter((cell) => !cell.planted).length,
      unused: cells.filter((cell) => cell.usage === 'unused').length,
      water: cells.filter((cell) => cell.usage === 'water').length,
    };
  });

  /** The plots as drawn: while editing, each reshaped one at its new outline. */
  readonly shapes = computed<MapShape[]>(() => {
    const shapes = plotShapes(this.shown());
    if (!this.editing()) return shapes;
    this.step();
    const changed = this.history.now;
    return shapes.map((shape) => (changed[shape.id] ? { ...shape, points: changed[shape.id] } : shape));
  });

  /** The picked plot's card on the map (the open map covers the details beside it): its zone, its use, its latest record. */
  readonly card = computed<PlotCard | null>(() => {
    const cell = this.selected();
    return cell ? plotCard(cell) : null;
  });

  pick(id: string) {
    this.selectedId.set(this.selectedId() === id ? null : id);
  }

  // ---- Edit a plot's details (saved into the Zones table) ----
  readonly formCell = signal<ZoneCell | null>(null);
  readonly form = signal<PlotForm>({ plot: '', zone: '', section: '', row: '', column: '', usage: 'normal', statusName: '', capacity: '', note: '' });
  /** A new plot's shape, while its form is open (the corners just drawn). */
  readonly creating = signal<[number, number][] | null>(null);
  readonly problem = computed(() => (this.creating() ? newPlotProblem(this.form(), this.layout().cells) : formProblem(this.form())));
  readonly taken = computed(() => {
    const open = this.formCell() || this.creating();
    return open && !this.problem() ? placeTakenBy(this.layout().cells, this.formCell(), this.form()) : null;
  });
  readonly formTitle = computed(() => {
    const cell = this.formCell();
    return cell ? 'Edit plot ' + (cell.plot || cell.label) : 'New plot';
  });
  readonly formSubtitle = computed(() => {
    const cell = this.formCell();
    return cell ? (cell.section !== null ? 'Zone ' : '') + cell.zone + ' · saved into the Zones table' : 'Drawn on the map · added to the Zones table';
  });
  closeForm() {
    this.formCell.set(null);
    this.creating.set(null);
  }

  openForm(cell: ZoneCell) {
    const sheet = this.zonesSheet();
    if (!sheet) return;
    this.form.set(formOf(cell, statusNameOf(sheet, Number(cell.id))));
    this.formCell.set(cell);
  }
  set(field: keyof PlotForm, event: Event) {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    this.form.update((form) => ({ ...form, [field]: value }));
  }
  setUsage(event: Event) {
    this.form.update((form) => ({ ...form, usage: (event.target as HTMLSelectElement).value as Usage }));
  }
  async saveForm() {
    const sheet = this.zonesSheet();
    if (!sheet || this.problem()) return;
    const cell = this.formCell();
    const outline = this.creating();
    this.closeForm();
    if (cell) {
      await this.store.updateCells(sheet.sheetId, plotChanges(sheet, Number(cell.id), this.form()));
      return;
    }
    const row = outline && newPlotCells(sheet, this.form(), outline);
    if (!row) return;
    const [added] = await this.store.addRows(sheet.sheetId, [row]);
    // The new plot is the one picked, so it can be reshaped or edited straight away.
    if (added) this.selectedId.set(String(added.rowId));
  }

  // ---- Draw a new plot: click its corners on the satellite, then fill in its details ----
  readonly drawing = signal(false);
  readonly draft = signal<[number, number][]>([]);
  startDrawing() {
    this.nearCell = this.selected();
    this.selectedId.set(null);
    this.draft.set([]);
    this.drawing.set(true);
  }
  addCorner(point: [number, number]) {
    this.draft.update((points) => [...points, point]);
  }
  undoCorner() {
    this.draft.update((points) => points.slice(0, -1));
  }
  stopDrawing() {
    this.drawing.set(false);
    this.draft.set([]);
  }
  finishDrawing() {
    const corners = this.draft();
    if (corners.length < 3) return;
    // Beside the plot that was picked before drawing began, else beside the last one.
    this.form.set(newPlotForm(this.layout().cells, this.nearCell));
    this.creating.set(corners);
    this.stopDrawing();
  }
  /** The plot picked when drawing began: the new one's zone and place follow on from it. */
  private nearCell: ZoneCell | null = null;

  // ---- Edit shapes on the satellite: corners and whole plots, then Save ----
  private readonly api = inject(Api);
  readonly editing = signal(false);
  private readonly history = new ReshapeHistory();
  /** Bumped on each step so the shapes, the buttons and the count follow the history. */
  private readonly step = signal(0);
  readonly canUndo = computed(() => (this.step(), this.history.canUndo));
  readonly canRedo = computed(() => (this.step(), this.history.canRedo));
  readonly changedCount = computed(() => (this.step(), Object.keys(this.history.now).length));
  readonly editHint = computed(() => {
    const cell = this.selected();
    if (this.drawing()) {
      const n = this.draft().length;
      return n < 3 ? `Click the plot's corners on the map, one after another (${n} so far, at least 3).` : `${n} corners. Click more, or Finish plot.`;
    }
    if (!cell) return 'Click a plot, then drag a corner, or the round handle to move it. Or Add plot to draw a new one.';
    if (!cell.outline.length) return `${cell.plot || cell.label} has no shape on the map to edit.`;
    return `Editing ${cell.plot || cell.label}: drag a corner, or the round handle to move it whole.`;
  });

  /** Editing the satellite: reshaping the plots there, or drawing a new one (needs the Zones table). */
  canEdit(mac: { latitude: number | null; longitude: number | null }) {
    return this.view() === 'satellite' && this.hasMap(mac) && !!this.zonesSheet();
  }
  startEdit() {
    // Shapes are edited with every plot there.
    this.show.set('all');
    this.history.reset();
    this.step.update((n) => n + 1);
    this.editing.set(true);
  }
  select(id: string) {
    // Editing, a click on another plot picks it for editing; it never lets go of the one picked.
    if (this.editing()) this.selectedId.set(id);
    else this.pick(id);
  }
  reshaped(change: Reshaped) {
    this.history.push(change.id, change.points);
    this.step.update((n) => n + 1);
  }
  undo() {
    this.history.undo();
    this.step.update((n) => n + 1);
  }
  redo() {
    this.history.redo();
    this.step.update((n) => n + 1);
  }
  async cancelEdit() {
    if (this.history.changed && !(await this.api.confirm('Leave without saving the changes to the shapes?', 'Edit shapes', 'Discard'))) return;
    this.stopDrawing();
    this.editing.set(false);
  }
  async saveEdit() {
    const sheet = this.zonesSheet();
    if (!sheet) return;
    const changes = outlineChanges(sheet, this.history.now);
    this.stopDrawing();
    this.editing.set(false);
    await this.store.updateCells(sheet.sheetId, changes);
  }
  /** Leaving the page (the route guard): ask first if shapes were changed and not saved. */
  async canLeave() {
    if (!this.editing() || !this.history.changed) return true;
    return this.api.confirm('You have changes to the shapes that are not saved. Leave and lose them?', 'Edit shapes', 'Leave');
  }

  usageWord(cell: ZoneCell) {
    return usageWord(cell);
  }

  date(iso: string) {
    return iso ? formatDate(iso) : '';
  }
}
