import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import { plantStage } from './farm/farm-scene';
import { Farm3d } from './farm-3d';
import { JourneyView, journeyKindOf } from '@features/mac/plot-journey';
import { GoogleLinkDialog } from '@features/google/google-link-dialog';
import { Icon } from '@shared/ui/icon';
import { MacMap3d, type PlotCard, type Reshaped } from '@shared/map/mac-map-3d';
import type { MapShape } from '@shared/map/mac-map';
import { paler } from '@shared/map/plot-stack';
import { Modal } from '@shared/ui/modal';
import { Api, errorText } from '@core/api';
import { Google } from '@core/google/google';
import { Toasts } from '@core/toast';
import { baseName } from '@core/paths';
import { safeFileName } from '@shared/excel/exceljs';
import { buildPowerBiWorkbook } from '@shared/excel/powerbi-export';
import { zoneMapPicture } from '@shared/map/zone-image';
import { WorkbookStore } from '@core/workbook-store';
import { formatDate } from '@shared/sheet/columns';
import { formOf, formProblem, newPlotCells, newPlotForm, newPlotProblem, newShapeForm, outlineChanges, placeTakenBy, plotChanges, ReshapeHistory, startOutline, statusNameOf, type NewKind, type PlotForm } from './zone-edit';
import { missingPlots, NO_DATA, plotViews, sayOf } from './plot-views';
import { buildZoneLayout, filterLayout, isGreenhouseZone, mapCentre, notInUseKinds, plotCard, plotShapes, plotShowOptions, showsPlot, usageWord, type PlotShow, type Usage, type ZoneCell } from '@shared/map/zone-layout';

export type ZoneMapView = 'farm' | 'satellite';

/** The Show list over the map's left: its width, and what it last showed (kept between visits). */
const LIST_WIDTH = 264;
/** A plot left out of what the list picked: pale, flat. */
const VIEW_KEY = 'ukmac.zone-map.show';
const LIST_KEY = 'ukmac.zone-map.show-list';
/** The name this MAC's Zone Map page is given (a key for each MAC). */
const NAME_KEY = 'ukmac.zone-map.name.';
function readSaved(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* not kept: it still works for now */
  }
}

/** A thing to drag out of the Edit sidebar onto the map. */
interface PaletteItem {
  kind: NewKind;
  label: string;
  about: string;
  icon: string;
  fill: string;
  edge: string;
}

/**
 * Zone Map, as the system's: the farm drawn in 3D (the zones as fields of beds, the plants swaying; the system's Farm look),
 * or every plot at its place on the satellite, planted ones in the stronger shade. One of them is on at a time (each holds a
 * WebGL view); it opens on the satellite.
 */
@Component({
  selector: 'app-zone-map-page',
  imports: [RouterLink, Icon, MacMap3d, Farm3d, Modal, GoogleLinkDialog, JourneyView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.mac(); as mac) {
      <header class="zm-head">
        <a class="page-back-icon" [routerLink]="['/mac', mac.macId]" [title]="'Back to ' + mac.macName" aria-label="Back"><app-icon name="arrow-left" [size]="16" /></a>
        <div class="zm-title">
          <h1>{{ pageName() }}</h1>
          <span class="muted">· {{ mac.macName }}</span>
          <button type="button" class="icon-btn is-quiet is-sm" title="Zone Map settings: its name" aria-label="Zone Map settings" (click)="openSettings()"><app-icon name="settings" [size]="15" /></button>
        </div>
        <div class="zm-actions">
        @if (zonesSheet() && layout().cells.length) {
          <button type="button" class="btn btn-secondary btn-sm" (click)="toggleExport($event)" [attr.aria-expanded]="exportMenu() !== null">
            <app-icon name="file" [size]="14" /> Export <app-icon name="chevron-down" [size]="14" />
          </button>
        }
        </div>
      </header>

      <div class="page">

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
            @if (editing() || view() === 'farm' || selected()) {
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
              } @else if (view() === 'farm') {
                <div class="legend">
                  <span><i class="sw tilled"></i> Not planted yet</span>
                  <span><i class="sw sprout"></i> Planting</span>
                  <span><i class="sw ripe"></i> Harvest</span>
                  <span><i class="sw unused"></i> Not in use ({{ kindsShort() }})</span>
                  <span><i class="sw water"></i> Water</span>
                </div>
              }
              @if (!editing() && selected(); as cell) {
                <button
                  type="button"
                  class="btn btn-secondary btn-sm details-toggle"
                  [attr.aria-pressed]="detailsOpen()"
                  [title]="detailsOpen() ? 'Hide the plot details: the map takes the whole width' : 'Show the plot details: its zone, its use, and everything recorded from planting to harvest'"
                  (click)="detailsOpen.set(!detailsOpen())"
                >
                  <app-icon name="panel-left" [size]="13" /> {{ detailsOpen() ? 'Hide details' : (cell.usage === 'normal' ? cell.plot : cell.label) + ' details' }}
                </button>
              }
            </div>
            }
            <div class="layout-body" [class.is-editing]="editing()">
              @if (view() === 'farm') {
                <div class="sat-box">
                  <app-farm-3d [layout]="shown()" [selected]="selectedId()" [filters]="shows()" [filter]="show()" (filterChange)="setShow($any($event))" (leave)="leaveFarm($event)" (picked)="pick($event)" (cleared)="selectedId.set(null)" />
                </div>
              } @else if (hasMap(mac)) {
                <div class="sat-box">
                  <app-mac-map-3d
                    [latitude]="place(mac)!.lat"
                    [longitude]="place(mac)!.lng"
                    [shapes]="shapes()"
                    [farm]="false"
                    [farmButton]="!editing()"
                    (farmPicked)="setView('farm')"
                    [startTilted]="tiltBack()"
                    [selected]="selectedId()"
                    [filters]="editing() ? [] : shows()"
                    [filter]="show()"
                    (filterChange)="setShow($any($event))"
                    [card]="editing() ? null : card()"
                    [openable]="!editing()"
                    (opened)="detailsOpen.set(true)"
                    [editable]="editing()"
                    [drawing]="drawing()"
                    [draft]="draft()"
                    (drawClick)="addCorner($event)"
                    (reshaped)="reshaped($event)"
                    (picked)="select($event)"
                    (cleared)="selectedId.set(null)"
                    [cover]="editing() ? 0 : viewCover()"
                  >
                    <!-- Down the map's left (also when it is opened big): what to colour the plots by, one at a time, and the plots with no data in it. -->
                    @if (!editing()) {
                      @if (listOpen()) {
                        <aside class="show-list" aria-label="Colour the plots by">
                          <header class="sl-head">
                            <div>
                              <strong>Show</strong>
                              <span>One at a time · {{ inUse().length }} plots in use</span>
                            </div>
                            <button type="button" class="icon-btn is-quiet is-sm" title="Fold the list" aria-label="Fold the list" (click)="setListOpen(false)"><app-icon name="chevron-left" [size]="15" /></button>
                          </header>
                          <div class="sl-body">
                            <button type="button" class="sl-row" [class.on]="!plotView()" (click)="pickView('zones')">
                              <span class="sl-icon"><app-icon name="map" [size]="15" /></span>
                              <span class="sl-text"><span class="sl-name">Zone colours</span><span class="sl-sub">Each plot its zone's colour</span></span>
                            </button>
                            @for (item of viewRows(); track item.view.key) {
                              <button type="button" class="sl-row" [class.on]="plotView()?.key === item.view.key" [title]="item.view.label + ': ' + item.view.summary + (item.missing ? ' · ' + item.missing + ' plots with no data' : '')" (click)="pickView(item.view.key)">
                                <span class="sl-icon"><app-icon [name]="item.view.icon" [size]="15" /></span>
                                <span class="sl-text">
                                  <span class="sl-name">{{ item.view.label }}</span>
                                  <span class="sl-sub">{{ item.has }} of {{ inUse().length }} plots · {{ item.view.summary }}</span>
                                </span>
                              </button>
                              @if (plotView()?.key === item.view.key) {
                                <div class="sl-detail">
                                  @if (item.view.legend.length) {
                                    <ul class="sl-legend">
                                      @for (entry of item.view.legend; track entry.label) {
                                        <li class="pick" role="button" tabindex="0" [class.on]="focus()?.colour === entry.colour" title="Pick out these plots on the map" (click)="focusColour(entry.colour)" (keydown.enter)="focusColour(entry.colour)"><i [style.background]="entry.colour"></i><span>{{ entry.label }}@if (entry.note) {<em class="note"> · {{ entry.note }}</em>}</span><b>{{ entry.count }}</b></li>
                                      }
                                      @if (item.missing) {
                                        <li class="pick" role="button" tabindex="0" [class.on]="focus()?.colour === noData" title="Pick out these plots on the map" (click)="focusColour(noData)" (keydown.enter)="focusColour(noData)"><i class="none"></i><span>No data</span><b>{{ item.missing }}</b></li>
                                      }
                                    </ul>
                                  }
                                  @if (focus()) {
                                    <button type="button" class="btn btn-secondary btn-sm sl-clear" (click)="clearFocus()"><app-icon name="layers" [size]="13" /> Clear</button>
                                  }
                                  @if (missingNow().length) {
                                    <p class="sl-cap">No data ({{ missingNow().length }})</p>
                                    <div class="sl-missing">
                                      @for (cell of missingNow(); track cell.id) {
                                        <button type="button" class="sl-plot" [class.on]="selectedId() === cell.id" [title]="'Open ' + cell.plot" (click)="pick(cell.id)">{{ cell.plot }}</button>
                                      }
                                    </div>
                                  } @else {
                                    <p class="sl-all"><app-icon name="check" [size]="13" /> Every plot in use has data</p>
                                  }
                                </div>
                              }
                            }
                          </div>
                        </aside>
                      } @else {
                        <button type="button" class="show-open" title="Colour the plots by variety, batch or a table" (click)="setListOpen(true)">
                          <app-icon name="layers" [size]="14" /> Show: {{ plotView()?.label ?? 'Zone colours' }} <app-icon name="chevron-right" [size]="13" />
                        </button>
                      }
                    }
                  </app-mac-map-3d>
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
              <!-- Editing: the things to add (and the plot picked); else a plot's details only when asked for (Details, or its card on the map). Until then the map takes the whole width. -->
              @if (editing() || shownDetails()) {
              <div class="side">
              @if (editing()) {
                <aside class="palette" aria-label="Add to the map">
                  <h3>Add to the map</h3>
                  <p class="muted">Drag one onto the satellite (or click it to put it in the middle), then drag its corners to fit the real one.</p>
                  @for (item of palette; track item.kind) {
                    <button type="button" class="tool" [disabled]="drawing()" [title]="item.about" (pointerdown)="startDrag(item.kind, $event)">
                      <span class="tool-icon" [style.background]="item.fill" [style.border-color]="item.edge"><app-icon [name]="item.icon" [size]="editing() ? 24 : 16" /></span>
                      <span class="tool-text"><strong>{{ item.label }}</strong><small>{{ item.about }}</small></span>
                      <app-icon class="tool-grip" name="grip" [size]="14" />
                    </button>
                  }
                </aside>
              }
              @if (shownDetails(); as cell) {
                <aside class="details" aria-live="polite">
                  <div class="details-head">
                    <h3>{{ cell.usage === 'normal' ? cell.plot : cell.label }}</h3>
                    @if (!editing()) {
                      <button type="button" class="btn btn-secondary btn-sm" (click)="openForm(cell)"><app-icon name="edit" [size]="13" /> Edit plot</button>
                      <button type="button" class="icon-btn details-x" title="Hide the details" aria-label="Hide the details" (click)="detailsOpen.set(false)"><app-icon name="x" [size]="14" /></button>
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
                  @if (cell.usage === 'normal') {
                    <!-- Everything recorded for the plot, planting to harvest, each with its date. -->
                    <h4>From planting to harvest</h4>
                    <app-journey-view [cell]="cell" [sheets]="store.sheets()" [compact]="true" [scrollTo]="viewKind()" />
                  }
                </aside>
              }
              </div>
              }
            </div>
          </section>
          @if (dragging(); as drag) {
            <div class="drag-ghost" [style.left.px]="drag.x" [style.top.px]="drag.y" aria-hidden="true">
              <span class="tool-icon" [style.background]="drag.item.fill" [style.border-color]="drag.item.edge"><app-icon [name]="drag.item.icon" [size]="16" /></span>
              {{ drag.item.label }}
            </div>
          }

        }
      </div>

      @if (formCell() || creating()) {
        <app-modal [open]="true" [title]="formTitle()" [subtitle]="formSubtitle()" (closed)="closeForm()">
          <form id="plot-form" class="form-stack" (submit)="$event.preventDefault(); saveForm()">
            @if (creating() && (form().usage === 'normal' || isGreenhouse(form().zone))) {
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
                  <input class="input-field" [value]="form().statusName" (input)="set('statusName', $event)" [placeholder]="form().usage === 'water' ? 'Pond, River…' : 'Forest, Road…'" />
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
            <button type="submit" form="plot-form" class="btn btn-primary" [disabled]="!!problem()">{{ creating() ? 'Add' : 'Save' }}</button>
          </ng-container>
        </app-modal>
      }
    }

    @if (zonesSheet(); as zones) {
      <app-google-link-dialog [open]="linkOpen()" [sheet]="zones" (closed)="linkOpen.set(false)" />
    }

    <app-modal [open]="settingsOpen()" title="Zone Map settings" subtitle="What this page is called" (closed)="settingsOpen.set(false)">
      <form class="form-stack" (submit)="$event.preventDefault(); saveName()">
        <label class="form-group">
          <span class="form-label">Name</span>
          <input class="input-field" [value]="nameDraft()" (input)="nameDraft.set($any($event.target).value)" placeholder="Zone Map" />
          <small class="form-hint">Shown at the top of this page. Leave it empty to call it Zone Map again.</small>
        </label>
      </form>
      <div footer>
        <button type="button" class="btn btn-plain" (click)="settingsOpen.set(false)">Cancel</button>
        <button type="button" class="btn btn-primary" (click)="saveName()">Save</button>
      </div>
    </app-modal>

    @if (exportMenu(); as menu) {
      <div class="menu-scrim" (mousedown)="exportMenu.set(null)"></div>
      <div class="menu-panel floating" [style.left.px]="menu.x" [style.top.px]="menu.y">
        <button type="button" class="menu-item" (click)="exportMenu.set(null); exportZones()">
          <app-icon name="file" />
          <span class="menu-item-text">Zone map to Excel<span class="menu-item-sub">The Zones table, and a sheet with the map as it is drawn here</span></span>
        </button>
      </div>
    }
  `,
  styles: `
    :host { --cell-w: 52px; --cell-h: 40px; }
    /* A bar of its own with room around it, then the map in a rounded frame under it, a margin on each side. */
    .zm-head { flex: none; display: flex; align-items: center; gap: 12px; margin: 4px 20px 14px; padding: 10px 16px; background: var(--surface-solid); border: var(--hairline) solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-xs); }
    .zm-head h1 { font-size: 1rem; font-weight: 600; line-height: 1.25; white-space: nowrap; }
    .zm-title { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; }
    .zm-title .muted { font-size: 0.9375rem; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* Edit shapes and the Google Sheet link, together at the header's right. */
    .zm-actions { flex: none; margin-left: auto; display: flex; align-items: center; gap: 8px; }
    .zm-actions .btn { white-space: nowrap; }
    /* The page fits the window: compact tiles, then the map card takes what is left and a free band stays under it. */
    /* The map takes the whole page: no box around it. */
    .page { padding: 0 20px 20px; gap: 0; overflow: hidden; }
    /* What is behind a tile (the kinds of plot not in use, what "not planted yet" means) shows only while it is pointed at or focused, over the page, so the tiles never change size. */
    /* So the pointer can travel from the tile to what it shows without leaving both. */
    .layout-card { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; margin: 0; padding: 0; border: 0; border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-sm); background: transparent; backdrop-filter: none; }
    .layout-body { flex: 1; min-height: 0; }
    .empty { flex: none; margin: 20px; padding: 18px 20px; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
    .view-row { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 8px 20px; min-height: 28px; background: var(--surface-solid); border-bottom: var(--hairline) solid var(--border); }
    .legend { display: flex; flex-wrap: wrap; gap: 16px; font-size: 0.8125rem; color: var(--text-muted); }
    .legend span { display: inline-flex; align-items: center; gap: 6px; }
    .sw { width: 14px; height: 14px; border-radius: 4px; border: 1px solid; }
    .sw.tilled { background: #a37650; border-color: #8a6040; }
    .sw.sprout { background: #7cc35f; border-color: #4f9e3f; }
    .sw.ripe { background: linear-gradient(90deg, #4f9e3f 50%, #e5432f 50%); border-color: #4f9e3f; }
    .sw.unused { background: #f7f8f7; border-color: #d7dbd8; }
    .sw.water { background: #dbeafe; border-color: #60a5fa; }
    .sat-box { flex: 1; min-width: 0; position: relative; min-height: 420px; overflow: hidden; }
    .sat-box app-mac-map-3d:not(.m3-expanded), .sat-box app-farm-3d { position: absolute; inset: 0; }
    /* The Show list down the map's left, as the QA/QC map's list of checks: a row for each thing, the picked one lit, its colours and its plots with no data under it. */
    .show-list { position: absolute; z-index: 5; left: 12px; top: 12px; bottom: 16px; width: 264px; display: flex; flex-direction: column; background: var(--surface-solid); border: var(--hairline) solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-card); overflow: hidden; font-size: 0.8125rem; color: var(--text); }
    .sl-head { display: flex; align-items: flex-start; gap: 8px; padding: 12px 10px 10px 14px; border-bottom: var(--hairline) solid var(--border); }
    .sl-head > div { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .sl-head strong { font-size: 0.875rem; }
    .sl-head span { color: var(--text-muted); font-size: 0.75rem; }
    .sl-body { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; padding: 4px 0 8px; }
    .sl-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 12px 7px 14px; border: 0; background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; box-shadow: inset 3px 0 0 transparent; }
    .sl-row:hover { background: var(--surface-hover); }
    .sl-row.on { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); }
    .sl-icon { flex: none; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: var(--fill); color: var(--text-muted); }
    .sl-row.on .sl-icon { background: var(--surface-solid); color: var(--accent); }
    .sl-text { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.3; }
    .sl-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .sl-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-muted); font-size: 0.75rem; font-variant-numeric: tabular-nums; }
    .sl-detail { padding: 4px 14px 10px 52px; }
    .sl-legend { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 3px; }
    .sl-legend li { display: flex; align-items: center; gap: 8px; font-size: 0.75rem; }
    .sl-legend i { flex: none; width: 12px; height: 12px; border-radius: 3px; box-shadow: inset 0 0 0 var(--hairline) rgb(0 0 0 / 0.15); }
    .sl-legend i.none { background: #c9cec9; }
    .sl-legend span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sl-legend .note { font-style: normal; color: var(--text-muted); }
    .sl-legend b { font-weight: 600; font-variant-numeric: tabular-nums; }
    .sl-legend li.pick { margin: 0 -6px; padding: 3px 6px; border-radius: var(--radius-sm); cursor: pointer; }
    .sl-legend li.pick:hover { background: var(--surface-hover); }
    .sl-legend li.pick.on { background: var(--accent-soft, rgb(0 102 217 / 0.12)); box-shadow: inset 0 0 0 var(--hairline) var(--accent, #0066d9); }
    .sl-clear { margin-top: 10px; }
    .sl-cap { margin: 10px 0 5px; color: var(--text-muted); font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }
    .sl-missing { display: flex; flex-wrap: wrap; gap: 4px; }
    .sl-plot { padding: 2px 7px; border: var(--hairline) solid var(--border-strong); border-radius: 6px; background: var(--surface-solid); font: inherit; font-size: 0.6875rem; font-weight: 600; color: var(--text); cursor: pointer; }
    .sl-plot:hover { background: var(--surface-hover); }
    .sl-plot.on { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
    .sl-all { display: flex; align-items: center; gap: 6px; margin: 8px 0 0; color: var(--success); font-size: 0.75rem; font-weight: 500; }
    /* Folded: a pill at the map's top left that opens it again. */
    /* Right of the map's credit (i), which keeps the corner. */
    .show-open { position: absolute; z-index: 5; left: 44px; top: 12px; display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border: var(--hairline) solid var(--border); border-radius: 999px; background: var(--surface-solid); box-shadow: var(--shadow-card); font: inherit; font-size: 0.8125rem; font-weight: 600; color: var(--text); cursor: pointer; }
    .show-open:hover { background: var(--surface-hover); }
    .layout-body { display: flex; gap: 0; align-items: stretch; }
    .no-place { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 320px; padding: 24px; text-align: center; color: var(--text-muted); }
    .no-place strong { color: var(--text); font-size: 1rem; }
    .no-place p { max-width: 420px; margin: 0 0 6px; font-size: 0.875rem; line-height: 1.5; }
    .no-place-actions { display: flex; gap: 8px; }
    /* Editing: the sidebar goes to the left of the map and is larger, its items easy to grab. */
    .layout-body.is-editing { flex-direction: row-reverse; }
    .layout-body.is-editing .side { width: 340px; align-self: stretch; overflow-y: auto; }
    .layout-body.is-editing .palette { padding: 18px 18px 20px; gap: 12px; }
    .layout-body.is-editing .palette h3 { font-size: 1.25rem; }
    .layout-body.is-editing .palette .muted { font-size: 0.875rem; line-height: 1.45; }
    .layout-body.is-editing .tool { gap: 14px; padding: 14px 16px; }
    .layout-body.is-editing .tool-icon { width: 52px; height: 52px; border-radius: 12px; }
    .layout-body.is-editing .tool-text strong { font-size: 1.0625rem; }
    .layout-body.is-editing .tool-text small { font-size: 0.8125rem; }
    .layout-body.is-editing .details { padding: 16px 18px; }
    /* A plot picked: its details and its whole story, planting to harvest, in a panel that scrolls on its own when it is long. */
    .layout-body:not(.is-editing) .side { width: 340px; max-height: none; align-self: stretch; overflow-y: auto; padding: 12px; }
    .side { flex: none; align-self: flex-start; width: 240px; display: flex; flex-direction: column; gap: 12px; }
    .palette { padding: 14px 16px; border: var(--hairline) solid var(--border); border-radius: var(--radius-md); background: var(--surface-solid); display: flex; flex-direction: column; gap: 8px; }
    .palette h3 { font-size: 1.0625rem; font-weight: 700; }
    .palette .muted { margin: 0; }
    .tool { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border: var(--hairline) solid var(--border); border-radius: var(--radius-md); background: var(--surface-solid); font: inherit; text-align: left; cursor: grab; touch-action: none; user-select: none; }
    .tool:hover:not(:disabled) { border-color: var(--accent); }
    .tool:disabled { opacity: 0.5; cursor: not-allowed; }
    .tool-icon { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border: 2px solid; border-radius: 8px; color: #1d1d1f; }
    .tool-text { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.25; }
    .tool-text strong { font-size: 0.875rem; }
    .tool-text small { font-size: 0.75rem; color: var(--text-muted); }
    .tool-grip { flex: none; color: var(--text-muted); }
    .drag-ghost { position: fixed; z-index: 1000; display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px 6px 6px; transform: translate(-50%, -50%); background: var(--surface-solid); border: var(--hairline) solid var(--border); border-radius: 999px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.3); font-size: 0.8125rem; font-weight: 600; pointer-events: none; }
    .details { align-self: stretch; width: 100%; padding: 14px 16px; border: var(--hairline) solid var(--border); border-radius: var(--radius-md); background: var(--surface-solid); }
    .details-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
    .details-head h3 { flex: 1; }
    .details-x { flex: none; }
    .details-toggle { flex: none; margin-left: auto; white-space: nowrap; }
    .details-toggle[aria-pressed='true'] { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); box-shadow: none; }
    .details h3 { font-size: 1.0625rem; font-weight: 700; min-width: 0; overflow-wrap: anywhere; }
    .edit-bar { flex: 1; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
    .edit-hint { display: inline-flex; align-items: center; gap: 6px; margin-right: auto; font-size: 0.8125rem; color: var(--text-muted); }
    .details h4 { margin: 14px 0 6px; font-size: 0.75rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 0.8125rem; }
    dt { color: var(--text-muted); }
    dd { font-weight: 500; text-align: right; }
    .muted { color: var(--text-muted); font-size: 0.8125rem; }
    @media (max-width: 900px) { .layout-body, .layout-body.is-editing { flex-direction: column; } .side, .layout-body.is-editing .side, .layout-body:not(.is-editing) .side { width: 100%; max-height: none; } }
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
  /** How the satellite map opens when coming back from the Farm: from above, or in 3D. */
  readonly tiltBack = signal(true);
  leaveFarm(tilted: boolean) {
    this.tiltBack.set(tilted);
    this.view.set('satellite');
  }
  /** Where the satellite looks: the MAC's own place, else the middle of its plots (a MAC opened from a file has no place of its own). */
  place(mac: { latitude: number | null; longitude: number | null }) {
    // Where the map looks does not follow the filter: it is worked out from every plot.
    return mapCentre(mac, plotShapes(this.layout()));
  }
  hasMap(mac: { latitude: number | null; longitude: number | null }) {
    return this.place(mac) !== null;
  }

  readonly zonesSheet = computed(() => this.store.sheets().find((sheet) => sheet.templateKey === 'zones') ?? null);
  private readonly recordsSheet = computed(() => this.store.sheets().find((sheet) => sheet.templateKey === 'zone-records') ?? null);
  private readonly harvestSheet = computed(() => this.store.sheets().find((sheet) => sheet.templateKey === 'harvest') ?? null);
  readonly layout = computed(() => buildZoneLayout(this.zonesSheet(), this.recordsSheet(), this.harvestSheet()));
  readonly selected = computed(() => this.layout().cells.find((cell) => cell.id === this.selectedId()) ?? null);
  /**
   * The picked plot's details beside the map: closed until asked for (the Details button, or the plot's card on the map), so a
   * click on a plot leaves the map its whole width. Open, they follow the plot picked; letting the plot go closes them.
   */
  readonly detailsOpen = signal(false);
  /** The plot whose details show: the one picked, while editing or once its details are asked for. */
  readonly shownDetails = computed(() => (this.editing() || this.detailsOpen() ? this.selected() : null));
  private readonly closeDetails = effect(() => {
    if (!this.selectedId()) untracked(() => this.detailsOpen.set(false));
  });

  /** Which plots the map shows: all, the zones (in use), or the rest (water, not in use…). */
  readonly show = signal<PlotShow>('zones');
  /** The layout as that shows it. */
  readonly shown = computed(() => filterLayout(this.layout(), this.show()));
  /** The All / Zones / Other switch over the map, each with how many plots it shows. */
  readonly shows = computed(() => plotShowOptions(this.layout()));
  setShow(show: PlotShow) {
    this.show.set(show);
    // A plot picked that is not shown now is let go of (its details would point at nothing on the map).
    const picked = this.selected();
    if (picked && !showsPlot(picked, show)) this.selectedId.set(null);
  }

  readonly google = inject(Google);
  /** What the page is called: the name given in its settings, else Zone Map. */
  private readonly nameVersion = signal(0);
  readonly pageName = computed(() => {
    this.nameVersion();
    const mac = this.store.mac();
    return (mac && readSaved(NAME_KEY + mac.macId)?.trim()) || 'Zone Map';
  });
  readonly settingsOpen = signal(false);
  readonly nameDraft = signal('');

  openSettings() {
    this.nameDraft.set(this.pageName() === 'Zone Map' ? '' : this.pageName());
    this.settingsOpen.set(true);
  }

  saveName() {
    const mac = this.store.mac();
    if (mac) save(NAME_KEY + mac.macId, this.nameDraft().trim());
    this.nameVersion.update((n) => n + 1);
    this.settingsOpen.set(false);
  }
  private readonly toasts = inject(Toasts);
  /** The Export menu, where it opens (null: closed). */
  readonly exportMenu = signal<{ x: number; y: number } | null>(null);

  toggleExport(event: MouseEvent) {
    if (this.exportMenu()) return this.exportMenu.set(null);
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.exportMenu.set({ x: Math.min(box.right - 280, window.innerWidth - 300), y: box.bottom + 6 });
  }

  /** The Zones table to Excel, with the map as this page draws it on a sheet of its own (as the Zones table's own Export does). */
  async exportZones() {
    const sheet = this.zonesSheet();
    const book = this.store.workbook();
    if (!sheet || !book) return;
    const path = await this.api.pickSavePath(`${safeFileName(sheet.title)} - ${safeFileName(book.mac.macCode)}.xlsx`);
    if (!path) return;
    try {
      await this.api.writeFile(path, await buildPowerBiWorkbook([{ mac: book.mac, sheets: [sheet] }], { single: true, picture: zoneMapPicture(sheet) ?? undefined }));
      this.toasts.show(`Saved ${baseName(path)}`);
    } catch (error) {
      this.toasts.error(errorText(error));
    }
  }
  readonly linkOpen = signal(false);
  // The top bar's pencil (its Google Sheet chip): the link's dialog (only a request made after this page opened counts).
  private seenLinkRequest = this.google.editLinkRequest();
  private readonly linkAsk = effect(() => {
    const asked = this.google.editLinkRequest();
    if (asked === this.seenLinkRequest) return;
    this.seenLinkRequest = asked;
    if (untracked(() => this.zonesSheet())) this.linkOpen.set(true);
  });
  /** The Google Sheet the Zones table is read from, when it is. */
  readonly googleLink = computed(() => {
    const sheet = this.zonesSheet();
    return sheet ? this.google.linkOf(sheet.sheetId) : null;
  });
  readonly zonesLink = computed(() => {
    const sheet = this.zonesSheet();
    const mac = this.store.mac();
    return sheet && mac ? ['/mac', mac.macId, 'table', sheet.sheetId] : null;
  });

  /** What the not-in-use plots are: greenhouses, chicken farm, forest…, with how many of each. */
  readonly kinds = computed(() => notInUseKinds(this.layout().cells));
  /** The first few kinds, for the legend. */
  readonly kindsShort = computed(() => {
    const names = this.kinds().filter((kind) => !kind.kind.includes('empty land') && kind.kind !== 'Greenhouse').map((kind) => kind.kind.toLowerCase());
    return names.length > 3 ? `${names.slice(0, 3).join(', ')}…` : names.join(', ') || 'none';
  });

  /** The plots as drawn: while editing, each reshaped one at its new outline. */
  readonly shapes = computed<MapShape[]>(() => {
    const cells = new Map(this.shown().cells.map((cell) => [cell.id, cell]));
    const shapes = plotShapes(this.shown()).map((shape): MapShape => {
      const cell = cells.get(shape.id);
      if (!cell) return shape;
      const stage = plantStage(cell);
      const base: MapShape = { ...shape, bed: cell.usage === 'water' ? 'water' : cell.usage !== 'normal' ? 'unused' : stage ?? 'tilled' };
      // Coloured by what the Show list picks: what it says of the plot (its tag says it too), grey where it has nothing.
      const view = this.plotView();
      if (!view || cell.usage !== 'normal' || this.editing()) return base;
      const say = sayOf(view, cell.plot);
      // A legend line or a zone picked in the list: those plots stand up in their colours, the rest lie under them in the same colours, faded.
      const focus = this.focus();
      const picked = !focus || (focus.zone != null ? cell.section === focus.zone : (say?.colour ?? NO_DATA) === focus.colour);
      if (!picked) return { ...base, fill: paler(say?.colour ?? NO_DATA), label: cell.plot };
      return {
        ...base,
        lift: !!focus,
        fill: say?.colour ?? NO_DATA,
        label: say ? `${cell.plot} · ${say.short}` : cell.plot,
        hint: `${view.label}: ${say ? [say.text, ...(say.details?.length ? say.details : [say.more])].filter(Boolean).join(' · ') : 'no data'}`,
      };
    });
    if (!this.editing()) return shapes;
    this.step();
    const changed = this.history.now;
    return shapes.map((shape) => (changed[shape.id] ? { ...shape, points: changed[shape.id] } : shape));
  });

  /** The picked plot's card on the map (the open map covers the details beside it): its zone, its use, its latest record. */
  readonly card = computed<PlotCard | null>(() => {
    const cell = this.selected();
    if (!cell) return null;
    const card = plotCard(cell);
    const view = this.plotView();
    if (!view || cell.usage !== 'normal') return card;
    const say = sayOf(view, cell.plot);
    return { ...card, lines: [`${say?.details?.length ? `${view.label} total` : view.label}: ${say ? (say.details?.length ? say.text : [say.text, say.more].filter(Boolean).join(' · ')) : 'no data'}`, ...(say?.details ?? []), ...card.lines], color: say?.colour ?? NO_DATA };
  });

  // ---- Show: the plots coloured by their variety, batch or a table's latest, one at a time ----
  /** What the plots are coloured by: 'zones' (their zone's colour, as before), 'variety', 'batch', or a table ('table:7'). */
  readonly viewKey = signal(readSaved(VIEW_KEY) ?? 'zones');
  readonly listOpen = signal(readSaved(LIST_KEY) !== 'folded');
  /** Everything the list offers, from the MAC's tables as they are now. */
  readonly views = computed(() => plotViews(this.store.sheets()));
  /** The part of a plot's story the picked Show view is (Harvest: 'harvest'): the details panel scrolls to it. */
  readonly viewKind = computed(() => {
    const key = this.viewKey();
    if (key === 'variety' || key === 'batch') return journeyKindOf('zone-records');
    const id = key.startsWith('table:') ? Number(key.slice(6)) : null;
    return id === null ? null : journeyKindOf(this.store.sheets().find((sheet) => sheet.sheetId === id)?.templateKey);
  });
  readonly plotView = computed(() => this.views().find((view) => view.key === this.viewKey()) ?? null);
  /** The plots in use, in the map's order: what a view can have data for. */
  readonly inUse = computed(() => this.layout().cells.filter((cell) => cell.usage === 'normal'));
  /** Each view in the list, with how many plots in use it has data for and how many none. */
  readonly viewRows = computed(() => {
    const codes = this.inUse().map((cell) => cell.plot);
    // A table with nothing in it for any plot is left out of the list: there is nothing to show.
    return this.views()
      .map((view) => {
        const missing = missingPlots(view, codes).length;
        return { view, missing, has: codes.length - missing };
      })
      .filter((item) => item.has > 0 || item.view.key === this.viewKey());
  });
  /** The plots in use the picked view has nothing for: listed under it, each a click away. */
  readonly missingNow = computed(() => {
    const view = this.plotView();
    return view ? this.inUse().filter((cell) => !sayOf(view, cell.plot)) : [];
  });
  /** The map keeps its left clear for the list. */
  readonly viewCover = computed(() => (this.listOpen() ? LIST_WIDTH + 12 : 0));
  /** Some plots picked out on the map (they stand up, the rest are pale): a zone's, or those of one colour of the list's legend (none: all). */
  readonly focus = signal<{ zone?: number; colour?: string } | null>(null);
  readonly noData = NO_DATA;
  focusZone(section: number) {
    this.setFocus(this.focus()?.zone === section ? null : { zone: section });
  }
  focusColour(colour: string) {
    this.setFocus(this.focus()?.colour === colour ? null : { colour });
  }
  clearFocus() {
    this.setFocus(null);
  }
  private setFocus(next: { zone?: number; colour?: string } | null) {
    this.focus.set(next);
  }
  pickView(key: string) {
    this.focus.set(null);
    this.viewKey.set(key);
    save(VIEW_KEY, key);
  }
  setListOpen(open: boolean) {
    this.listOpen.set(open);
    save(LIST_KEY, open ? 'open' : 'folded');
  }

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
    if (cell) return 'Edit plot ' + (cell.plot || cell.label);
    return isGreenhouseZone(this.form().zone) ? 'New greenhouse' : this.form().usage === 'normal' ? 'New plot' : 'New area';
  });
  readonly formSubtitle = computed(() => {
    const cell = this.formCell();
    return cell ? (cell.section !== null ? 'Zone ' : '') + cell.zone + ' · saved into the Zones table' : 'Placed on the map · added to the Zones table';
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

  // ---- Drag a Plot, Greenhouse or Other from the side onto the satellite, then drag its corners to the real size ----
  readonly palette: PaletteItem[] = [
    { kind: 'plot', label: 'Plot', about: 'A zone plot, for the chili', icon: 'sprout', fill: '#e8f3d8', edge: '#6aa84f' },
    { kind: 'greenhouse', label: 'Greenhouse', about: 'Under cover, with its own name', icon: 'home', fill: '#c9ecdc', edge: '#2f9e77' },
    { kind: 'other', label: 'Other', about: 'A road, a building, forest…', icon: 'pin', fill: '#eef0ee', edge: '#9aa39c' },
  ];
  private readonly satellite = viewChild(MacMap3d);
  /** A tool being dragged from the side: which, and where the pointer is. */
  readonly dragging = signal<{ item: PaletteItem; x: number; y: number } | null>(null);

  startDrag(kind: NewKind, event: PointerEvent) {
    if (this.drawing() || event.button !== 0) return;
    event.preventDefault();
    const item = this.palette.find((entry) => entry.kind === kind)!;
    const from = { x: event.clientX, y: event.clientY };
    let moved = false;
    const move = (e: PointerEvent) => {
      moved = moved || Math.hypot(e.clientX - from.x, e.clientY - from.y) > 6;
      if (moved) this.dragging.set({ item, x: e.clientX, y: e.clientY });
    };
    const up = (e: PointerEvent) => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      this.dragging.set(null);
      // Let go over the map: there. A plain click: the middle of the view.
      const at = moved ? this.satellite()?.pointAt(e.clientX, e.clientY) : this.satellite()?.centre();
      if (at) this.dropShape(kind, at);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  }
  /** The new shape on the map where it was dropped, its details asked for; then it is picked, its corners ready to drag. */
  private dropShape(kind: NewKind, at: [number, number]) {
    const cells = this.layout().cells;
    this.nearCell = null;
    this.form.set(newShapeForm(kind, at, cells));
    this.creating.set(startOutline(kind, at, cells));
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
    if (!cell) return 'Click a plot, then drag a corner, or the round handle to move it. Or drag a Plot, Greenhouse or Other from the side onto the map.';
    if (!cell.outline.length) return `${cell.plot || cell.label} has no shape on the map to edit.`;
    return `Editing ${cell.plot || cell.label}: drag a corner, or the round handle to move it whole.`;
  });

  /** Editing the satellite: reshaping the plots there, or drawing a new one (needs the Zones table). */
  canEdit(mac: { latitude: number | null; longitude: number | null }) {
    return this.hasMap(mac) && !!this.zonesSheet();
  }
  /** The view to go back to when editing ends (shapes are edited on the satellite, whichever view began it). */
  private viewBeforeEdit: ZoneMapView = 'satellite';
  startEdit() {
    this.viewBeforeEdit = this.view();
    this.view.set('satellite');
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
    this.view.set(this.viewBeforeEdit);
  }
  async saveEdit() {
    const sheet = this.zonesSheet();
    if (!sheet) return;
    const changes = outlineChanges(sheet, this.history.now);
    this.stopDrawing();
    this.editing.set(false);
    this.view.set(this.viewBeforeEdit);
    await this.store.updateCells(sheet.sheetId, changes);
  }
  /** Leaving the page (the route guard): ask first if shapes were changed and not saved. */
  async canLeave() {
    if (!this.editing() || !this.history.changed) return true;
    return this.api.confirm('You have changes to the shapes that are not saved. Leave and lose them?', 'Edit shapes', 'Leave');
  }

  isGreenhouse(zone: string) {
    return isGreenhouseZone(zone);
  }

  usageWord(cell: ZoneCell) {
    return usageWord(cell);
  }

  date(iso: string) {
    return iso ? formatDate(iso) : '';
  }
}
