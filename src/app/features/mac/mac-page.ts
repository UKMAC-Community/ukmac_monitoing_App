import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { Icon } from '@shared/ui/icon';
import { MacMap3d } from '@shared/map/mac-map-3d';
import { plantStage } from '@features/zone-map/farm/farm-scene';
import type { MapShape } from '@shared/map/mac-map';
import { buildZoneLayout, filterLayout, mapCentre, plotCard, plotShapes, plotShowOptions, showsPlot, type PlotShow } from '@shared/map/zone-layout';
import { ChiliDashboardExport } from '@features/dashboard/chili-dashboard-export';
import { ChiliDashboardVersions } from '@features/dashboard/chili-dashboard-versions';
import { ChiliKpiEditor } from '@features/dashboard/chili-kpi-editor';
import { ChiliKpiStore } from '@features/dashboard/chili-kpi-store';
import { ChiliVersionStore, importMessage } from '@features/dashboard/chili-version-store';
import { MacAttention } from './mac-attention';
import { MacDialog } from './mac-dialog';
import { JOURNEY_WIDE, JOURNEY_WIDTH, PlotJourney } from './plot-journey';
import { Api, errorText } from '@core/api';
import { MacList } from '@core/mac-list';
import type { Mac } from '@core/models';
import { Toasts } from '@core/toast';
import { WorkbookStore } from '@core/workbook-store';
import { buildPowerBiWorkbook } from '@shared/excel/powerbi-export';
import { safeFileName } from '@shared/excel/exceljs';
import { baseName } from '@core/paths';

const HEADING_ICONS: Record<string, string> = {
  Setup: 'map',
  Nursery: 'seedling',
  Planting: 'sprout',
  'QA/QC': 'check',
  Inventory: 'package',
  Operational: 'wallet',
};


/** A MAC: where it is, and its tables under their headings. */
@Component({
  selector: 'app-mac-page',
  imports: [RouterLink, Icon, MacDialog, ChiliDashboardExport, ChiliDashboardVersions, ChiliKpiEditor, MacMap3d, PlotJourney, MacAttention],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.mac(); as mac) {
      <div class="page" #page [class.is-full]="full()">
        <header class="page-header">
          <a class="page-back-icon" routerLink="/" title="Back to UKMAC" aria-label="Back"><app-icon name="arrow-left" [size]="16" /></a>
          <div class="page-header-text">
            <h1 class="page-title">{{ mac.macName }} Dashboard <span class="badge neutral">{{ mac.macCode }}</span></h1>
            <p class="page-desc facts">
              <span><app-icon name="pin" [size]="13" /> {{ mac.macLocation || 'Review this MAC.' }}</span>
              @if (mac.latitude !== null && mac.longitude !== null) {
                <span>{{ mac.latitude }}, {{ mac.longitude }}</span>
              }
              <span class="chip crop"><app-icon name="sprout" [size]="13" /> Chili</span>
            </p>
          </div>
          <!-- The chili tools, beside the title (they were at the foot of the page). -->
          <div class="page-actions">
            <button type="button" class="btn btn-secondary" (click)="exportMac(mac)"><app-icon name="download" [size]="15" /> Export for Power BI</button>
            <button type="button" class="icon-btn" aria-label="More" [attr.aria-expanded]="menuAt() !== null" (click)="openMenu($event)">
              <app-icon name="more" />
            </button>
          </div>
        </header>

        @if (place(mac); as at) {
          <section class="card map-card" [class.is-full]="full()" aria-label="The farm and how far each plot has come">
            <app-mac-map-3d
              [latitude]="at.lat"
              [longitude]="at.lng"
              [name]="mac.macName"
              [shapes]="shapes()"
              [farm]="true"
              [selected]="pickedPlot()"
              [card]="plotCard()"
              [openable]="!journeyShown()"
              (opened)="openJourney()"
              [coverRight]="journeyCover()"
              [filters]="shows()"
              [filter]="show()"
              (filterChange)="setShow($any($event))"
              (picked)="pickPlot($event)"
              (cleared)="pickedPlot.set(null)"
            >
            <!-- The picked plot's whole story, from planting to harvest, down the map's right side (its card's ⤢ opens it). Inside the
                 map, so it is there too when the map is opened big, wider. -->
            <app-plot-journey
              [open]="journeyShown()"
              [big]="mapBig() || full()"
              [fillable]="!mapBig()"
              [full]="full()"
              (fullChange)="setFull($event)"
              [cell]="pickedCell()"
              [sheets]="store.sheets()"
              (closed)="closeJourney()"
            />
            </app-mac-map-3d>
          </section>
        }

        <!-- On the left how the tables read their Google Sheets and when each was last read; on the right what still needs filling in. -->
        <app-mac-attention [sheets]="store.sheets()" [macId]="mac.macId" />

        <section class="card shortcuts" aria-labelledby="shortcuts-title">
          <h2 class="card-title" id="shortcuts-title">Shortcuts</h2>
          <ul class="groups">
            @for (group of store.headings(); track group.heading) {
              <li class="group-row">
                <h3>{{ group.heading }}</h3>
                <ul class="pills" [attr.aria-label]="group.heading">
                  @for (sheet of group.sheets; track sheet.sheetId) {
                    <li>
                      <a class="pill" [routerLink]="['table', sheet.sheetId]" [title]="sheet.about">
                        <app-icon [name]="sheet.icon || headingIcon(group.heading)" [size]="16" />
                        <span>{{ sheet.title }}</span>
                      </a>
                    </li>
                  }
                </ul>
              </li>
            } @empty {
              <li class="muted none">No tables yet.</li>
            }
          </ul>
        </section>

      </div>

      @if (menuAt(); as at) {
        <div class="menu-scrim" (mousedown)="menuAt.set(null)"></div>
        <div class="menu-panel floating" [style.left.px]="at.x" [style.top.px]="at.y">
          <button type="button" class="menu-item" (click)="menuAt.set(null); editing.set(true)"><app-icon name="edit" /> Edit MAC</button>
          <button type="button" class="menu-item" (click)="menuAt.set(null); editingKpis.set(true)"><app-icon name="gauge" /> Edit dashboard</button>
          <button type="button" class="menu-item" (click)="menuAt.set(null); exportingKpis.set(true)"><app-icon name="download" /> Export dashboard…</button>
          <button type="button" class="menu-item" (click)="menuAt.set(null); importDashboard()"><app-icon name="upload" /> Import dashboard…</button>
          <button type="button" class="menu-item" (click)="menuAt.set(null); versionsOpen.set(true)"><app-icon name="rotate-ccw" /> Dashboard versions…</button>
          <div class="menu-divider"></div>
          <button type="button" class="menu-item danger" (click)="menuAt.set(null); remove(mac)"><app-icon name="trash" /> Delete MAC</button>
        </div>
      }

      @if (editingKpis()) {
        <app-chili-kpi-editor (closed)="editingKpis.set(false)" />
      }
      @if (exportingKpis()) {
        <app-chili-dashboard-export (closed)="exportingKpis.set(false)" />
      }
      @if (versionsOpen()) {
        <app-chili-dashboard-versions (closed)="versionsOpen.set(false)" />
      }
      <app-mac-dialog [open]="editing()" [mac]="mac" (closed)="editing.set(false)" (saved)="saved($event)" />
    }
  `,
  styles: `
    /* The tools stay on one line beside the title; in a narrow window they go under it, to the right. */
    .page-header { flex-wrap: wrap; }
    .page-actions { flex-wrap: nowrap; margin-left: auto; }
    .page-back-icon { margin-top: 2px; }
    .facts { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; }
    .facts span { display: inline-flex; align-items: center; gap: 4px; }
    .chip.crop { padding: 2px 9px; font-size: 0.75rem; color: var(--text); cursor: default; }
    .map-card { flex: none; height: clamp(440px, 62vh, 680px); padding: 0; overflow: hidden; margin: 14px 0 0; position: relative; }
    /* The story's ⤢: the map and the story over the whole page (the menu and the top bar stay). */
    .page.is-full { position: relative; overflow: hidden; }
    .map-card.is-full { position: absolute; inset: 0; z-index: 20; height: auto; margin: 0; border-radius: 0; border: 0; }
    /* In its card, unless opened bigger (then it fills the window, as on the Zone Map). */
    .map-card app-mac-map-3d:not(.m3-expanded) { position: absolute; inset: 0; }
    .sw { width: 14px; height: 14px; border-radius: 4px; border: 1px solid; }
    .sw.tilled { background: #a37650; border-color: #8a6040; }
    .sw.sprout { background: #7cc35f; border-color: #4f9e3f; }
    .sw.ripe { background: linear-gradient(90deg, #4f9e3f 50%, #e5432f 50%); border-color: #4f9e3f; }
    .shortcuts { padding: 18px 20px; }
    .groups { margin-top: 6px; }
    .group-row { display: grid; grid-template-columns: 8.5rem minmax(0, 1fr); gap: 12px; align-items: start; padding: 12px 0; }
    .group-row + .group-row { border-top: var(--hairline) solid var(--border); }
    .group-row:last-child { padding-bottom: 0; }
    .group-row h3 { font-size: 0.75rem; font-weight: 600; color: var(--text-muted); padding-top: 9px; letter-spacing: 0; }
    .pills { display: flex; flex-wrap: wrap; gap: 8px; min-width: 0; }
    .pill {
      display: inline-flex; align-items: center; gap: 8px; height: 36px; max-width: 100%; padding: 0 14px;
      border-radius: 999px; border: var(--hairline) solid var(--border); background: var(--surface-solid);
      font: inherit; font-size: 0.875rem; font-weight: 500; color: var(--text); text-decoration: none; cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
    }
    .pill:hover { border-color: var(--accent); color: var(--accent); }
    .pill app-icon { color: var(--accent); }
    .pill span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .none { padding: 12px 0 0; font-size: 0.875rem; }
  `,
})
export class MacPage {
  readonly store = inject(WorkbookStore);
  private readonly macs = inject(MacList);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly router = inject(Router);

  readonly editing = signal(false);
  readonly kpiStore = inject(ChiliKpiStore);
  /** The dashboard's own Edit dashboard (⋯ menu, the button over the tiles, or the empty page's). */
  readonly editingKpis = signal(false);
  readonly exportingKpis = signal(false);
  readonly versionsOpen = signal(false);
  private readonly versionStore = inject(ChiliVersionStore);

  constructor() {
    void this.kpiStore.load();
    void this.versionStore.load();
  }

  /** A dashboard file from someone else: a newer version replaces this one (which is kept as a version first). */
  async importDashboard() {
    try {
      const result = await this.versionStore.importFromFile();
      if (result) this.toasts.show(importMessage(result));
    } catch (error) {
      this.toasts.error(errorText(error));
    }
  }
  /** The plots, as the Zone Map lays them out: a plot with records is growing, one with a picking in Harvest is harvesting. */
  private readonly allPlots = computed(() =>
    buildZoneLayout(
      this.store.sheets().find((sheet) => sheet.templateKey === 'zones') ?? null,
      this.store.sheets().find((sheet) => sheet.templateKey === 'zone-records') ?? null,
      this.store.sheets().find((sheet) => sheet.templateKey === 'harvest') ?? null,
    ),
  );
  /** Which plots the map shows: the zones to begin with, or all, or the rest (water, not in use…). */
  readonly show = signal<PlotShow>('zones');
  readonly shows = computed(() => plotShowOptions(this.allPlots()));
  readonly layout = computed(() => filterLayout(this.allPlots(), this.show()));
  /** The plots drawn on the satellite with the farm's beds: tilled where not planted, young plants, bushes with red once harvest has begun. */
  readonly shapes = computed(() => {
    const cells = new Map(this.layout().cells.map((cell) => [cell.id, cell]));
    return plotShapes(this.layout()).map((shape): MapShape => {
      const cell = cells.get(shape.id);
      if (!cell) return shape;
      return { ...shape, bed: cell.usage === 'water' ? 'water' : cell.usage !== 'normal' ? 'unused' : (plantStage(cell) ?? 'tilled') };
    });
  });
  setShow(show: PlotShow) {
    this.show.set(show);
    // A plot picked that is not shown now is let go of.
    const picked = this.allPlots().cells.find((cell) => cell.id === this.pickedPlot());
    if (picked && !showsPlot(picked, show)) this.pickedPlot.set(null);
  }
  /** Where the map looks: the MAC's own place, else the middle of its plots. It does not follow the filter. */
  place(mac: { latitude: number | null; longitude: number | null }) {
    return mapCentre(mac, plotShapes(this.allPlots()));
  }
  /** The plot picked on the map: the camera goes to it, its card over it (as on the Zone Map). */
  readonly pickedPlot = signal<string | null>(null);
  readonly plotCard = computed(() => {
    const cell = this.layout().cells.find((item) => item.id === this.pickedPlot());
    return cell ? plotCard(cell) : null;
  });

  /** The plot picked, whatever the map shows now. */
  readonly pickedCell = computed(() => this.allPlots().cells.find((item) => item.id === this.pickedPlot()) ?? null);
  readonly journeyOpen = signal(false);
  readonly journeyShown = computed(() => this.journeyOpen() && !!this.pickedCell());
  private readonly map = viewChild(MacMap3d);
  /** The map opened big (its Open): the satellite over the whole window, the story wider beside it. */
  readonly mapBig = computed(() => this.map()?.expanded() ?? false);
  /** The story's ⤢: the map and the story fill the page (beside the menu, under the top bar), until it is closed or let go. */
  private readonly storyFull = signal(false);
  readonly full = computed(() => this.storyFull() && this.journeyShown());
  private readonly pageEl = viewChild<ElementRef<HTMLElement>>('page');
  /** How much of the map's right side the story takes: the map keeps its buttons and the picked plot clear of it. */
  readonly journeyCover = computed(() => (this.journeyShown() ? (this.mapBig() || this.full() ? JOURNEY_WIDE : JOURNEY_WIDTH) : 0));

  /** The plot card's ⤢: the story down the map's right side, at the map's size. */
  openJourney() {
    this.storyFull.set(false);
    this.journeyOpen.set(true);
  }

  closeJourney() {
    this.journeyOpen.set(false);
    this.storyFull.set(false);
  }

  setFull(on: boolean) {
    // From the top of the page, which it then covers (and doesn't scroll) until it is let go.
    if (on) this.pageEl()?.nativeElement.scrollTo({ top: 0 });
    this.storyFull.set(on);
  }

  /** A plot clicked on the map: its card over it (its ⤢ opens the story); clicked again, let go. */
  pickPlot(id: string) {
    this.pickedPlot.set(this.pickedPlot() === id ? null : id);
  }
  readonly menuAt = signal<{ x: number; y: number } | null>(null);

  openMenu(event: MouseEvent) {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.menuAt.set({ x: Math.min(box.right - 210, window.innerWidth - 230), y: box.bottom + 6 });
  }
  readonly totalRows = computed(() => this.store.sheets().reduce((sum, sheet) => sum + sheet.rows.length, 0));

  headingIcon(heading: string) {
    return HEADING_ICONS[heading] ?? 'table';
  }

  saved(mac: Mac) {
    this.editing.set(false);
    this.store.workbook.update((book) => (book ? { ...book, mac } : book));
    this.toasts.show('MAC saved');
  }

  async remove(mac: Mac) {
    const rows = this.totalRows();
    const ok = await this.api.confirm(
      `Delete ${mac.macName}, its ${this.store.sheets().length} tables and ${rows} rows? This can't be undone.`,
      'Delete MAC',
      'Delete',
    );
    if (!ok) return;
    try {
      await this.macs.remove(mac.macId);
      this.store.workbook.set(null);
      this.toasts.show(`${mac.macName} deleted`);
      void this.router.navigate(['/']);
    } catch (error) {
      this.toasts.error(errorText(error));
    }
  }

  async exportMac(mac: Mac) {
    const book = this.store.workbook();
    if (!book) return;
    const path = await this.api.pickSavePath(`${safeFileName(mac.macName)} - Power BI.xlsx`);
    if (!path) return;
    try {
      await this.api.writeFile(path, await buildPowerBiWorkbook([book]));
      this.toasts.show(`Saved ${baseName(path)}`);
    } catch (error) {
      this.toasts.error(errorText(error));
    }
  }
}
