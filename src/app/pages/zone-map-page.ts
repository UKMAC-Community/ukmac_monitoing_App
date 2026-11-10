import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Farm3d } from '../components/farm-3d';
import { Icon } from '../components/icon';
import { MacMap3d, type PlotCard } from '../components/mac-map-3d';
import type { MapShape } from '../components/mac-map';
import { WorkbookStore } from '../core/workbook-store';
import { formatDate } from '../sheet/columns';
import { buildZoneLayout, plotCard, plotShapes, usageWord, type ZoneCell } from '../zonemap/zone-layout';

export type ZoneMapView = 'farm' | 'satellite';

/**
 * Zone Map, as the system's: the farm drawn in 3D (the zones as fields of beds, the plants swaying; the system's Farm look),
 * or every plot at its place on the satellite, planted ones in the stronger shade. One of them is on at a time (each holds a
 * WebGL view); it opens on the satellite.
 */
@Component({
  selector: 'app-zone-map-page',
  imports: [RouterLink, Icon, MacMap3d, Farm3d],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.mac(); as mac) {
      <header class="zm-head">
        <a class="page-back-icon" [routerLink]="['/mac', mac.macId]" title="Back to the dashboard" aria-label="Back"><app-icon name="arrow-left" [size]="16" /></a>
        <h1>Zone Map</h1>
        <span class="badge neutral">{{ mac.macName }}</span>
        <p class="zm-desc">Every plot at its place in its zone. Click a plot for its details.</p>
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
              @if (view() === 'satellite') {
                <div class="legend">
                  <span><i class="sw planted"></i> Planted</span>
                  <span><i class="sw pale"></i> Not planted yet</span>
                  <span><i class="sw unused"></i> Not in use</span>
                  <span><i class="sw water"></i> Water</span>
                </div>
              }
              <div class="segmented is-sm view-switch" role="group" aria-label="How to see the plots">
                <button type="button" class="segment" [attr.aria-pressed]="view() === 'satellite'" (click)="setView('satellite')"><app-icon name="map" [size]="13" /> Satellite</button>
                <button type="button" class="segment" [attr.aria-pressed]="view() === 'farm'" (click)="setView('farm')"><app-icon name="sprout" [size]="13" /> Farm</button>
              </div>
            </div>
            <div class="layout-body">
              @if (view() === 'farm') {
                <div class="sat-box">
                  <app-farm-3d [layout]="layout()" [selected]="selectedId()" (picked)="pick($event)" (cleared)="selectedId.set(null)" />
                </div>
              } @else if (hasMap(mac)) {
                <div class="sat-box">
                  <app-mac-map-3d
                    [latitude]="mac.latitude!"
                    [longitude]="mac.longitude!"
                    [shapes]="shapes()"
                    [selected]="selectedId()"
                    [card]="card()"
                    (picked)="pick($event)"
                    (cleared)="selectedId.set(null)"
                  />
                </div>
              } @else {
                <div class="no-place">
                  <app-icon name="pin" [size]="22" />
                  <strong>This MAC has no place on the map yet</strong>
                  <p>Add its latitude and longitude to see the plots on the satellite map: on the home page, open the ⋮ on its card and choose Edit. The Farm view doesn't need it.</p>
                  <div class="no-place-actions">
                    <button type="button" class="btn btn-primary" (click)="setView('farm')">Show the Farm</button>
                    <a class="btn btn-secondary" routerLink="/">Open the home page</a>
                  </div>
                </div>
              }
              <!-- Only once a plot is picked; until then the map takes the whole width. -->
              @if (selected(); as cell) {
                <aside class="details" aria-live="polite">
                  <h3>{{ cell.usage === 'normal' ? cell.plot : cell.label }}</h3>
                  <dl>
                    <dt>Zone</dt><dd>{{ cell.zone }}{{ cell.section ? ' · ' + cell.section : '' }}</dd>
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
    .view-switch { margin-left: auto; }
    .legend { display: flex; flex-wrap: wrap; gap: 16px; font-size: 0.8125rem; color: var(--text-muted); }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .sw { width: 14px; height: 14px; border-radius: 4px; border: 1px solid; }
    .sw.planted { background: #B9EFB9; border-color: #6fbf6f; }
    .sw.pale { background: #f4fdf4; border-color: #d7f6d7; }
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
    .details h3 { font-size: 1.0625rem; font-weight: 700; margin-bottom: 8px; }
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
  hasMap(mac: { latitude: number | null; longitude: number | null }) {
    return mac.latitude !== null && mac.longitude !== null;
  }

  private readonly zonesSheet = computed(() => this.store.sheets().find((sheet) => sheet.templateKey === 'zones') ?? null);
  private readonly recordsSheet = computed(() => this.store.sheets().find((sheet) => sheet.templateKey === 'zone-records') ?? null);
  readonly layout = computed(() => buildZoneLayout(this.zonesSheet(), this.recordsSheet()));
  readonly selected = computed(() => this.layout().cells.find((cell) => cell.id === this.selectedId()) ?? null);

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

  readonly shapes = computed<MapShape[]>(() => plotShapes(this.layout()));

  /** The picked plot's card on the map (the open map covers the details beside it): its zone, its use, its latest record. */
  readonly card = computed<PlotCard | null>(() => {
    const cell = this.selected();
    return cell ? plotCard(cell) : null;
  });

  pick(id: string) {
    this.selectedId.set(this.selectedId() === id ? null : id);
  }

  usageWord(cell: ZoneCell) {
    return usageWord(cell);
  }

  date(iso: string) {
    return iso ? formatDate(iso) : '';
  }
}
