import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { Icon } from '../components/icon';
import { MacMap3d } from '../components/mac-map-3d';
import { buildZoneLayout, plotCard, plotShapes } from '../zonemap/zone-layout';
import { ChiliDashboard } from '../dashboard/chili-dashboard';
import { ChiliDashboardExport } from '../dashboard/chili-dashboard-export';
import { ChiliDashboardVersions } from '../dashboard/chili-dashboard-versions';
import { ChiliKpiEditor } from '../dashboard/chili-kpi-editor';
import { ChiliKpiStore } from '../dashboard/chili-kpi-store';
import { ChiliVersionStore, importMessage } from '../dashboard/chili-version-store';
import { GoogleImportDialog } from '../components/google-import-dialog';
import { MacDialog } from '../components/mac-dialog';
import { Api, errorText } from '../core/api';
import { MacList } from '../core/mac-list';
import type { Mac, SheetWithRows } from '../core/models';
import { Toasts } from '../core/toast';
import { WorkbookStore } from '../core/workbook-store';
import { buildPowerBiWorkbook } from '../excel/powerbi-export';
import { safeFileName } from '../excel/exceljs';
import { formatDate } from '../sheet/columns';
import { baseName } from '../core/paths';

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
  imports: [RouterLink, Icon, MacDialog, ChiliDashboard, ChiliDashboardExport, ChiliDashboardVersions, ChiliKpiEditor, MacMap3d, GoogleImportDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.mac(); as mac) {
      <div class="page">
        <header class="page-header">
          <a class="page-back-icon" routerLink="/" title="Back to UKMAC" aria-label="Back"><app-icon name="arrow-left" [size]="16" /></a>
          <div class="page-header-text">
            <h1 class="page-title">{{ mac.macName }} Dashboard <span class="badge neutral">{{ mac.macCode }}</span></h1>
            <p class="page-desc facts">
              <span><app-icon name="pin" [size]="13" /> {{ mac.macLocation || 'Review this MAC.' }}</span>
              @if (mac.latitude !== null && mac.longitude !== null) {
                <span>{{ mac.latitude }}, {{ mac.longitude }}</span>
              }
              @if (mac.startDate) {
                <span><app-icon name="calendar" [size]="13" /> {{ date(mac.startDate) }}{{ mac.endDate ? ' – ' + date(mac.endDate) : '' }}</span>
              }
              <span class="chip crop"><app-icon name="sprout" [size]="13" /> Chili</span>
            </p>
          </div>
          <div class="page-actions">
            <button type="button" class="icon-btn" aria-label="More" [attr.aria-expanded]="menuAt() !== null" (click)="openMenu($event)">
              <app-icon name="more" />
            </button>
          </div>
        </header>

        @if (mac.latitude !== null && mac.longitude !== null) {
          <section class="card map-card" aria-label="Where this MAC is">
            <app-mac-map-3d
              [latitude]="mac.latitude"
              [longitude]="mac.longitude"
              [name]="mac.macName"
              [shapes]="shapes()"
              [selected]="pickedPlot()"
              [card]="plotCard()"
              (picked)="pickPlot($event)"
              (cleared)="pickedPlot.set(null)"
            />
          </section>
        }

        @if (kpiStore.loaded()) {
          <div class="kpi-bar">
            <button type="button" class="btn btn-plain btn-sm" (click)="editingKpis.set(true)" title="Choose the numbers and charts on this dashboard"><app-icon name="gauge" [size]="14" /> Edit dashboard</button>
          </div>
          <app-chili-dashboard [sheets]="store.sheets()" [formulas]="store.formulas()" [kpis]="kpiStore.kpis()" (edit)="editingKpis.set(true)" />
        }

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

        <section class="tools" aria-label="Chili tools">
          <span class="tools-label"><app-icon name="sprout" [size]="14" /> Chili</span>
          <button type="button" class="pill" (click)="googleOpen.set(true)"><app-icon name="table" [size]="16" /> <span>Import from Google Sheets</span></button>
          <a class="pill" routerLink="/settings"><app-icon name="chart" [size]="16" /> <span>Connections & backup</span></a>
          <button type="button" class="pill" (click)="exportMac(mac)"><app-icon name="download" [size]="16" /> <span>Export for Power BI</span></button>
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
      <app-google-import-dialog [open]="googleOpen()" (closed)="googleOpen.set(false)" (imported)="googleImported($event)" />
    }
  `,
  styles: `
    .page-header { flex-wrap: nowrap; }
    .page-back-icon { margin-top: 2px; }
    .facts { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; }
    .facts span { display: inline-flex; align-items: center; gap: 4px; }
    .chip.crop { padding: 2px 9px; font-size: 0.75rem; color: var(--text); cursor: default; }
    .map-card { flex: none; height: clamp(440px, 62vh, 680px); padding: 0; overflow: hidden; margin: 14px 0 0; position: relative; }
    /* In its card, unless opened bigger (then it fills the window, as on the Zone Map). */
    .map-card app-mac-map-3d:not(.m3-expanded) { position: absolute; inset: 0; }
    .kpi-bar { display: flex; justify-content: flex-end; margin: 14px 0 -2px; }
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
    .tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding-top: 20px; border-top: var(--hairline) solid var(--border); }
    .tools-label { display: inline-flex; align-items: center; gap: 6px; margin-right: 4px; font-size: 0.75rem; font-weight: 600; color: var(--text-muted); }
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
  /** The plots, as the Zone Map lays them out. */
  private readonly layout = computed(() =>
    buildZoneLayout(
      this.store.sheets().find((sheet) => sheet.templateKey === 'zones') ?? null,
      this.store.sheets().find((sheet) => sheet.templateKey === 'zone-records') ?? null,
    ),
  );
  /** The plots drawn on the satellite, as the Zone Map shows them. */
  readonly shapes = computed(() => plotShapes(this.layout()));
  /** The plot picked on the map: the camera goes to it, its card over it (as on the Zone Map). */
  readonly pickedPlot = signal<string | null>(null);
  readonly plotCard = computed(() => {
    const cell = this.layout().cells.find((item) => item.id === this.pickedPlot());
    return cell ? plotCard(cell) : null;
  });

  pickPlot(id: string) {
    this.pickedPlot.set(this.pickedPlot() === id ? null : id);
  }
  readonly menuAt = signal<{ x: number; y: number } | null>(null);
  readonly googleOpen = signal(false);

  openMenu(event: MouseEvent) {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.menuAt.set({ x: Math.min(box.right - 210, window.innerWidth - 230), y: box.bottom + 6 });
  }
  readonly totalRows = computed(() => this.store.sheets().reduce((sum, sheet) => sum + sheet.rows.length, 0));

  date(iso: string) {
    return formatDate(iso);
  }

  headingIcon(heading: string) {
    return HEADING_ICONS[heading] ?? 'table';
  }

  /** Tables made from a Google Sheet: the first is opened, to see its charts. */
  googleImported(sheets: SheetWithRows[]) {
    this.googleOpen.set(false);
    const first = sheets[0];
    if (first) void this.router.navigate(['/mac', first.macId, 'table', first.sheetId]);
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
