import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, effect, ElementRef, input, OnDestroy, output, signal, viewChild, ViewEncapsulation } from '@angular/core';
import * as maplibregl from 'maplibre-gl';
import { getVersion, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent } from 'maplibre-gl';

import { Icon } from './icon';
import type { MapShape } from './mac-map';

// MapLibre draws its tiles in a worker, served from the app's own files (copied there at build).
setWorkerUrl(`/vendor/maplibre-gl-worker.mjs?v=${getVersion()}`);

const ESRI_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
/** As the system's web map: tipped back and a little turned for 3D, straight above and north up for the top view. */
const TIPPED = { pitch: 55, bearing: -20 };
const ON_TOP = { pitch: 0, bearing: 0 };
/** As the web's map comes on: flat and north up first, then, once the imagery's in, it tips back over this long (ms)... */
const TILT_IN = 1600;
/** ...but shown by this time (ms) though some of the imagery is still coming. */
const SHOW_BY = 3000;
/** What a fit keeps clear: room at the sides for the section names, under the buttons and over the legend. */
const FIT_PADDING = { top: 70, bottom: 80, left: 130, right: 130 };
/** The move tools' width and clearance: a section name over their end of the foot sits above them. */
const TOOLS_ROOM = 12 + 230;
/** The tour: round the farm once a minute (as the web's 3D tour goes), rising into 3D over its first moments (ms). */
const TOUR_DEG_PER_MS = 360 / 60000;
const TOUR_RISE = 1400;
/** How high a plot stands (m), and the picked one, raised out of the rest. */
const PLOT_HEIGHT = 3;
const PICKED_HEIGHT = 14;
/** The picked plot's card, named over it on the map: what it is and its latest record. */
export interface PlotCard {
  title: string;
  lines: string[];
  /** Its use's colour, in the card's dot. */
  color: string;
}

/** The plots on satellite imagery that can be seen from above or tipped back in 3D (MapLibre, as the system's web map). */
@Component({
  selector: 'app-mac-map-3d',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { '[class.m3-expanded]': 'expanded()', '(document:keydown.escape)': 'expanded.set(false)', '(document:keydown)': 'stopTour()' },
  template: `
    <div class="m3-map" [class.m3-in]="shown()" #box role="img" aria-label="Satellite view of the plots"></div>
    @if (!shown()) {
      <span class="m3-wait" aria-hidden="true"><span class="spinner-sm"></span></span>
    }
    @if (groups().length) {
      <div class="m3-legend" aria-label="Sections">
        @for (group of groups(); track group.name) {
          <span><i [style.background]="group.color"></i>{{ group.name }}</span>
        }
      </div>
    }
    @if (card(); as card) {
      <!-- Over the picked plot, following it as the map moves (placed by placeCard). -->
      <div class="m3-card" #cardEl role="status" aria-live="polite">
        <span class="m3-card-dot" [style.background]="card.color"><app-icon name="sprout" [size]="13" /></span>
        <span class="m3-card-text">
          <strong>{{ card.title }}</strong>
          @for (line of card.lines; track $index) {
            <span>{{ line }}</span>
          }
        </span>
        <button type="button" class="m3-card-x" title="Close" aria-label="Close the plot" (click)="cleared.emit()"><app-icon name="x" [size]="12" /></button>
      </div>
    }
    <div class="m3-view" role="group" aria-label="Camera">
      <button type="button" [class.on]="!tilted()" (click)="setTilt(false)"><app-icon name="grid" [size]="13" /> Top</button>
      <button type="button" [class.on]="tilted()" (click)="setTilt(true)"><app-icon name="cube" [size]="13" /> 3D</button>
      <span class="m3-sep"></span>
      <button
        type="button"
        [class.on]="touring()"
        [attr.aria-pressed]="touring()"
        [disabled]="!shown() || still || !shapes().length"
        [title]="still ? 'Off: your Mac is set to reduce motion' : touring() ? 'Stop the tour' : 'Play the 3D tour: the camera goes round the farm'"
        (click)="toggleTour()"
      ><app-icon [name]="touring() ? 'pause' : 'play'" [size]="13" /> {{ touring() ? 'Stop' : 'Tour' }}</button>
      <span class="m3-sep"></span>
      <button type="button" (click)="expanded.set(!expanded())" [attr.aria-label]="expanded() ? 'Close the big map' : 'Open the map bigger'"><app-icon [name]="expanded() ? 'x' : 'expand'" [size]="13" /> {{ expanded() ? 'Close' : 'Open' }}</button>
    </div>
    <!-- Move tools, as the web map's: zoom, turn and Fit along the foot's right. -->
    <div class="m3-tools" role="group" aria-label="Zoom and turn">
      <button type="button" class="m3-icon" title="Zoom out" aria-label="Zoom out" (click)="zoom(-1)"><app-icon name="minus" [size]="14" /></button>
      <button type="button" class="m3-icon" title="Zoom in" aria-label="Zoom in" (click)="zoom(1)"><app-icon name="plus" [size]="14" /></button>
      <span class="m3-sep"></span>
      <button type="button" class="m3-icon" title="Turn left" aria-label="Turn left" (click)="turn(-45)"><app-icon name="rotate-ccw" [size]="14" /></button>
      <button type="button" class="m3-icon" title="Turn right" aria-label="Turn right" (click)="turn(45)"><app-icon name="rotate-cw" [size]="14" /></button>
      <span class="m3-sep"></span>
      <button type="button" title="Bring the whole farm into view" (click)="fit()"><app-icon name="scan" [size]="13" /> Fit</button>
    </div>
  `,
  styles: `
    app-mac-map-3d { display: block; position: relative; background: #1c1c1e; }
    /* Open: the map fills the whole window, over the menu and the top bar. */
    app-mac-map-3d.m3-expanded.m3-expanded { position: fixed; inset: 0; z-index: 100; border-radius: 0; overflow: hidden; }
    /* Faded in once its imagery's in, as the tipping back starts (so no half-tiled map pops in). */
    .m3-map { position: absolute; inset: 0; background: #1c1c1e; opacity: 0; transition: opacity 0.45s ease; }
    .m3-map.m3-in { opacity: 1; }
    .m3-wait { position: absolute; inset: 0; z-index: 4; display: grid; place-items: center; pointer-events: none; }
    .m3-wait .spinner-sm { width: 22px; height: 22px; border-color: rgba(255, 255, 255, 0.25); border-top-color: #fff; }
    .m3-map .maplibregl-ctrl-attrib { font-size: 10px; }
    .m3-view, .m3-tools { position: absolute; z-index: 5; display: inline-flex; align-items: center; gap: 2px; padding: 3px; background: var(--surface-solid); border: var(--hairline) solid var(--border); border-radius: 999px; box-shadow: var(--shadow-card); }
    .m3-view { top: 12px; right: 12px; }
    /* Along the foot's right; the legend sits on the same line (same foot, same height) and keeps clear of it. */
    .m3-tools { right: 12px; bottom: 16px; height: 38px; box-sizing: border-box; }
    .m3-view button, .m3-tools button { display: inline-flex; align-items: center; gap: 5px; padding: 5px 12px; border: 0; border-radius: 999px; background: transparent; color: var(--text-muted); font: inherit; font-size: 0.8125rem; font-weight: 500; cursor: pointer; }
    .m3-view button:hover:not(.on):not(:disabled), .m3-tools button:hover { background: var(--surface-hover, #f2f2f4); color: var(--text, #1d1d1f); }
    .m3-view button.on { background: var(--accent); color: #fff; }
    .m3-view button:disabled { opacity: 0.45; cursor: default; }
    .m3-view button.m3-icon, .m3-tools button.m3-icon { padding: 5px 8px; }
    .m3-legend { position: absolute; left: 12px; bottom: 16px; z-index: 5; display: flex; align-items: center; gap: 14px; height: 38px; box-sizing: border-box; padding: 0 14px; overflow-x: auto; scrollbar-width: none; background: rgba(255, 255, 255, 0.92); border-radius: 999px; font-size: 12px; font-weight: 500; width: fit-content; max-width: calc(100% - 12px - 250px); }
    .m3-legend span { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
    .m3-legend i { width: 12px; height: 12px; border-radius: 3px; }
    .m3-sep { width: 1px; height: 16px; background: var(--border); margin: 0 4px; }
    .plot-tag { pointer-events: none; font-weight: 700; font-size: 12px; line-height: 1.25; letter-spacing: 0.01em; color: #fff; background: rgba(48, 48, 52, 0.82); padding: 2px 6px; border-radius: 5px; white-space: nowrap; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); }
    /* A section's name, as the web map's: white, its colour round the edge and in its dot and text, easy to read over the imagery. */
    .plot-tag.section-tag { display: inline-flex; align-items: center; gap: 7px; background: #fff; border: 2px solid var(--tag-edge, #ccc); border-radius: 999px; padding: 5px 13px 5px 11px; font-size: 14px; font-weight: 600; letter-spacing: 0; box-shadow: 0 3px 10px rgba(0, 0, 0, 0.35); }
    .plot-tag.section-tag i { width: 9px; height: 9px; border-radius: 50%; }
    .m3-pin { display: flex; flex-direction: column; align-items: center; gap: 4px; pointer-events: none; }
    .m3-pin span { background: #fff; color: #111; font-size: 12px; padding: 4px 9px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35); }
    .m3-pin i { width: 16px; height: 16px; border-radius: 50%; background: #0066d9; border: 3px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.4); }
    .plot-tag.hide { display: none; }
    /* The picked plot's name, lit, shown whatever the zoom. */
    .plot-tag.is-picked { background: var(--accent-solid, #0066d9); font-size: 13px; padding: 3px 8px; box-shadow: 0 0 0 2px #fff, 0 3px 10px rgba(0, 0, 0, 0.4); }
    /* The picked plot's card, as the web map's: a pill over the plot, its dot, its name, its latest. */
    .m3-card { position: absolute; top: 0; left: 0; z-index: 6; display: flex; align-items: center; gap: 9px; max-width: 360px; padding: 5px 6px 5px 5px; background: var(--surface-solid, #fff); border: var(--hairline, 1px) solid var(--border, #e5e5ea); border-radius: 999px; box-shadow: 0 6px 16px rgba(15, 23, 42, 0.18); visibility: hidden; transition: opacity 0.2s; will-change: transform; }
    .m3-card-dot { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; color: #fff; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12); }
    .m3-card-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.3; }
    .m3-card-text strong { font-size: 13px; font-weight: 700; color: var(--text, #1d1d1f); }
    .m3-card-text span { font-size: 11.5px; color: var(--text-muted, #6e6e73); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
    .m3-card-x { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border: 0; border-radius: 50%; background: transparent; color: var(--text-muted, #6e6e73); cursor: pointer; }
    .m3-card-x:hover { background: var(--surface-hover, #f2f2f4); color: var(--text, #1d1d1f); }
    @media (prefers-reduced-motion: reduce) { .m3-card, .m3-map { transition: none; } }
  `,
})
export class MacMap3d implements OnDestroy {
  readonly latitude = input.required<number>();
  readonly longitude = input.required<number>();
  readonly name = input('MAC');
  readonly shapes = input<MapShape[]>([]);
  readonly selected = input<string | null>(null);
  /** The picked plot's card (none: no card). */
  readonly card = input<PlotCard | null>(null);
  readonly picked = output<string>();
  /** The picked plot let go: its card closed, or the map clicked off the plots. */
  readonly cleared = output<void>();
  private readonly cardEl = viewChild<ElementRef<HTMLElement>>('cardEl');
  private readonly selectedShape = computed(() => this.shapes().find((shape) => shape.id === this.selected()) ?? null);
  /** The plot the camera last went to (picked again, it doesn't go again). */
  private focused: string | null = null;
  readonly tilted = signal(true);
  readonly expanded = signal(false);
  /** The 3D tour is playing: the camera goes round the farm. */
  readonly touring = signal(false);
  private tourFrame = 0;
  /** The Mac asks for less motion: no tour. */
  readonly still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** The sections on the map, named once each, in order. */
  readonly groups = computed(() => {
    const seen = new Map<string, string>();
    this.shapes().forEach((shape) => shape.group && !seen.has(shape.group) && seen.set(shape.group, shape.groupColor ?? '#888'));
    return [...seen].map(([name, color]) => ({ name, color })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  });
  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');
  private map: maplibregl.Map | null = null;
  private tags: maplibregl.Marker[] = [];
  private pin: maplibregl.Marker | null = null;
  private ready = false;
  private fitted = false;
  /** The imagery's in and the map is shown: from now on the camera is the user's to move. */
  readonly shown = signal(false);

  private revealed = false;
  /** 3D (tipped back) or the top view, as picked: what the opening settles on. Not the `tilted` signal, which follows the camera while it's still flat. */
  private wantTilt = true;
  /** Where the first fit settled (3D as it should be seen): the camera the opening glides to from the flat start. */
  private goal: { center: maplibregl.LngLat; zoom: number; pitch: number; bearing: number } | null = null;

  constructor() {
    effect(() => {
      const el = this.box().nativeElement;
      if (this.map) return;
      const map = new maplibregl.Map({
        container: el,
        center: [this.longitude(), this.latitude()],
        zoom: 16,
        // Flat and facing north at first, as the web's map is; it tips back once shown (see reveal).
        ...ON_TOP,
        maxPitch: 75,
        maxZoom: 21,
        // The imagery credit (ⓘ) goes to the top left, not over the foot's corner (where it was clipped by the card's rounding).
        attributionControl: false,
        style: {
          version: 8,
          sources: {
            sat: { type: 'raster', tiles: [ESRI_TILES], tileSize: 256, maxzoom: 18, attribution: 'Tiles © Esri' },
            places: { type: 'raster', tiles: [ESRI_LABELS], tileSize: 256, maxzoom: 18 },
            plots: { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' },
          },
          layers: [
            { id: 'sat', type: 'raster', source: 'sat' },
            { id: 'places', type: 'raster', source: 'places' },
            {
              id: 'plots',
              type: 'fill-extrusion',
              source: 'plots',
              paint: { 'fill-extrusion-color': ['to-color', ['get', 'fill']], 'fill-extrusion-base': 0, 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-opacity': 0.82 },
            },
            {
              id: 'plot-lines',
              type: 'line',
              source: 'plots',
              paint: {
                'line-color': ['to-color', ['get', 'stroke']],
                'line-width': ['case', ['get', 'sel'], 4, 1.2],
              },
            },
          ],
        },
      });
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-left');
      // Draw as soon as the style is in (not waiting for every tile, as 'load' does).
      const start = () => {
        if (this.ready || !map.getSource('plots')) return;
        this.ready = true;
        this.draw();
      };
      map.on('styledata', start);
      map.on('load', start);
      map.on('click', 'plots', (event: MapLayerMouseEvent) => {
        const id = event.features?.[0]?.properties?.['id'];
        if (id) this.picked.emit(String(id));
      });
      // A click off the plots lets the picked one go.
      map.on('click', (event) => {
        if (this.selected() && !map.queryRenderedFeatures(event.point, { layers: ['plots'] }).length) this.cleared.emit();
      });
      // The picked plot's card follows it as the map moves.
      map.on('move', () => this.placeCard());
      map.on('resize', () => this.placeCard());
      // The camera is the user's again the moment they touch the map.
      for (const gesture of ['mousedown', 'touchstart', 'wheel'] as const) map.on(gesture, () => this.stopTour());
      // The pointer shows a hand over a plot.
      map.on('mousemove', 'plots', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'plots', () => {
        map.getCanvas().style.cursor = '';
      });
      map.on('zoom', () => this.tagVisibility());
      map.on('rotateend', () => this.tagVisibility());
      map.on('pitchend', () => this.tagVisibility());
      map.on('zoomend', () => this.tagVisibility());
      // The camera's tilt shows in the buttons once it's shown (before, it's the flat start).
      map.on('pitchend', () => this.revealed && this.tilted.set(map.getPitch() > 5));
      this.map = map;
      this.awaitImagery(map);
      new ResizeObserver(() => {
        map.resize();
        if (this.ready && !this.fitted) this.draw();
      }).observe(el);
    });

    effect(() => {
      this.shapes();
      this.selected();
      if (this.ready) this.draw();
    });

    // The card drawn (or its text changed): put over its plot.
    afterRenderEffect(() => {
      this.card();
      this.cardEl();
      this.placeCard();
    });
  }

  /**
   * A plot picked: the camera goes to it, as the system's map does (the user
   * there, 2026-10-22: "when i select on the zone plot move it to that plot")
   * — in the middle, close enough to see it, the tilt and turn kept.
   */
  private focusPlot(shape: MapShape, tilt?: { pitch: number; bearing: number; duration: number }) {
    const map = this.map;
    if (!map) return;
    const bounds = new maplibregl.LngLatBounds();
    shape.points.forEach(([lat, lng]) => bounds.extend([lng, lat]));
    const camera = map.cameraForBounds(bounds, { padding: 24 });
    const zoom = Math.min(20, Math.max(map.getZoom(), (camera?.zoom ?? map.getZoom()) - 1.5));
    map.easeTo({ center: bounds.getCenter(), zoom, duration: 700, ...tilt });
  }

  /** Waits for the flat map's imagery (it's "idle" once the tiles are in), or a few seconds at most, then shows it. */
  private awaitImagery(map: maplibregl.Map) {
    let timer = 0;
    const onIdle = () => {
      if (this.fitted || !this.shapes().length) go();
    };
    const go = () => {
      window.clearTimeout(timer);
      map.off('idle', onIdle);
      this.reveal();
    };
    map.on('idle', onIdle);
    timer = window.setTimeout(go, SHOW_BY);
  }

  /**
   * The map faded in and tipped back into 3D, the farm kept in view as it goes: as the system's map comes on (the user there,
   * 2026-10-21: "give animation when i go to 3d"). A plot already picked: it tips back on to that plot instead. Reduced motion: there at once.
   */
  private reveal() {
    const map = this.map;
    if (!map || this.revealed) return;
    this.revealed = true;
    this.shown.set(true);
    const tip = this.wantTilt ? TIPPED : ON_TOP;
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : TILT_IN;
    const shape = this.selectedShape();
    if (shape && this.fitted) {
      this.focused = shape.id;
      this.focusPlot(shape, { ...tip, duration });
    } else {
      // Not fitted yet (no plots, or they come later): tips back where it is; the first fit then settles it.
      const goal = this.goal ?? { center: map.getCenter(), zoom: map.getZoom(), ...tip };
      map.easeTo({ ...goal, duration });
    }
  }

  /** The picked plot's card centred over the plot as it is on screen; hidden while the plot's out of view. */
  private placeCard() {
    const map = this.map;
    const el = this.cardEl()?.nativeElement;
    if (!map || !el) return;
    const shape = this.selectedShape();
    if (!shape) {
      el.style.visibility = 'hidden';
      return;
    }
    const at = shape.points.map(([lat, lng]) => map.project([lng, lat]));
    const left = Math.min(...at.map((p) => p.x));
    const right = Math.max(...at.map((p) => p.x));
    const upper = Math.min(...at.map((p) => p.y));
    const lower = Math.max(...at.map((p) => p.y));
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    const onScreen = right > 0 && left < width && lower > 0 && upper < height;
    el.style.visibility = onScreen ? 'visible' : 'hidden';
    el.style.opacity = onScreen ? '1' : '0';
    // Above the plot (raised, its top a little over its outline on the ground), kept inside the map's sides.
    const x = Math.min(Math.max((left + right) / 2, el.offsetWidth / 2 + 8), width - el.offsetWidth / 2 - 8);
    el.style.transform = `translate(${x}px, ${upper - 18}px) translate(-50%, -100%)`;
  }

  private draw() {
    const map = this.map;
    if (!map) return;
    const selected = this.selected();
    const shapes = this.shapes();
    const features = shapes.map((shape) => ({
      type: 'Feature' as const,
      // The picked plot stands out of the rest, outlined in white.
      properties: { id: shape.id, fill: shape.fill, stroke: shape.id === selected ? '#ffffff' : shape.stroke, sel: shape.id === selected, top: shape.id === selected ? PICKED_HEIGHT : PLOT_HEIGHT },
      geometry: { type: 'Polygon' as const, coordinates: [[...shape.points.map(([lat, lng]) => [lng, lat]), [shape.points[0][1], shape.points[0][0]]]] },
    }));
    (map.getSource('plots') as GeoJSONSource).setData({ type: 'FeatureCollection', features });

    this.tags.forEach((tag) => tag.remove());
    this.pin?.remove();
    this.pin = null;
    if (!shapes.length) {
      const el = document.createElement('div');
      el.className = 'm3-pin';
      el.innerHTML = `<span>${this.name().replace(/[<>&]/g, '')}</span><i></i>`;
      this.pin = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([this.longitude(), this.latitude()]).addTo(map);
    }

    // One name for each section, beside its plots: on the west side of the farm's west half, the east side of its east half.
    const sections = new Map<string, MapShape[]>();
    shapes.forEach((shape) => shape.group && sections.set(shape.group, [...(sections.get(shape.group) ?? []), shape]));
    const all = shapes.flatMap((shape) => shape.points);
    const midLng = all.length ? all.reduce((sum, p) => sum + p[1], 0) / all.length : 0;
    const pills = [...sections].map(([group, members]) => {
      const pts = members.flatMap((m) => m.points);
      const lngs = pts.map((p) => p[1]);
      const lat = pts.reduce((sum, p) => sum + p[0], 0) / pts.length;
      const centre = lngs.reduce((a, b) => a + b, 0) / lngs.length;
      const west = centre < midLng;
      const el = document.createElement('div');
      el.className = 'plot-tag section-tag';
      const text = members[0].groupText ?? '#111';
      el.style.color = text;
      el.style.setProperty('--tag-edge', members[0].groupColor ?? '#ccc');
      el.innerHTML = `<i style="background:${text}"></i>${group}`;
      return new maplibregl.Marker({ element: el, anchor: west ? 'right' : 'left', offset: [west ? -10 : 10, 0] })
        .setLngLat([west ? Math.min(...lngs) : Math.max(...lngs), lat])
        .addTo(map);
    });

    this.tags = [...shapes.map((shape) => {
      const lat = shape.points.reduce((sum, p) => sum + p[0], 0) / shape.points.length;
      const lng = shape.points.reduce((sum, p) => sum + p[1], 0) / shape.points.length;
      const el = document.createElement('div');
      el.className = shape.id === selected ? 'plot-tag is-picked' : 'plot-tag';
      el.textContent = shape.label;
      return new maplibregl.Marker({ element: el, pitchAlignment: 'viewport' }).setLngLat([lng, lat]).addTo(map);
    }), ...pills];
    this.tagVisibility();

    if (shapes.length && !this.fitted && map.getContainer().clientWidth > 0) {
      map.resize();
      const bounds = new maplibregl.LngLatBounds();
      shapes.forEach((shape) => shape.points.forEach(([lat, lng]) => bounds.extend([lng, lat])));
      // Fitted as seen from above (room at the sides for the section names, under the buttons and over the legend), then tipped back
      // round the same centre, so in 3D the farm fills the view as on the web rather than shrinking to fit the far side.
      // Before it's shown it's still the flat start: the 3D view is worked out here, and reveal() glides to it.
      const camera = this.revealed ? { pitch: map.getPitch(), bearing: map.getBearing() } : this.wantTilt ? TIPPED : ON_TOP;
      map.jumpTo(ON_TOP);
      map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: 18.5, duration: 0 });
      const flat = { center: map.getCenter(), zoom: map.getZoom() };
      map.jumpTo(camera);
      // Tipped back, the near side grows: step out a little until every section's name is inside the map.
      for (let step = 0; step < 10 && !this.sectionTagsFit(map); step++) map.jumpTo({ zoom: map.getZoom() - 0.15 });
      this.goal = { center: map.getCenter(), zoom: map.getZoom(), ...camera };
      this.fitted = true;
      // Not shown yet: back to the flat view of the whole farm, to tip back from once its imagery's in.
      if (!this.revealed) map.jumpTo({ ...flat, ...ON_TOP });
    }
    this.tagVisibility();

    // A plot just picked (here, or on the page's grid): the camera to it.
    const shape = this.selectedShape();
    if (!shape) this.focused = null;
    else if (this.fitted && this.revealed && shape.id !== this.focused) {
      this.focused = shape.id;
      this.stopTour();
      this.focusPlot(shape);
    }
    this.placeCard();
  }

  private sectionTagsFit(map: maplibregl.Map) {
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    return this.tags
      .filter((tag) => tag.getElement().classList.contains('section-tag'))
      .every((tag) => {
        const at = map.project(tag.getLngLat());
        const el = tag.getElement();
        const left = el.classList.contains('maplibregl-marker-anchor-right') ? at.x - 10 - el.offsetWidth : at.x + 10;
        const overTools = left + el.offsetWidth > width - TOOLS_ROOM;
        return left >= 8 && left + el.offsetWidth <= width - 8 && at.y >= 60 && at.y <= height - (overTools ? 100 : 50);
      });
  }

  /** Plot names show once a plot is wide enough on screen to hold one (whatever the zoom, tilt or window size). */
  private tagVisibility() {
    const map = this.map;
    const sample = this.shapes()[0];
    let show = false;
    if (map && sample) {
      const xs = sample.points.map(([lat, lng]) => map.project([lng, lat]).x);
      show = Math.max(...xs) - Math.min(...xs) >= 26;
    }
    this.tags.forEach((tag) => {
      const el = tag.getElement();
      el.classList.toggle('hide', !show && !el.classList.contains('section-tag') && !el.classList.contains('is-picked'));
    });
  }

  setTilt(on: boolean) {
    this.stopTour();
    this.wantTilt = on;
    this.tilted.set(on);
    this.map?.easeTo({ ...(on ? TIPPED : ON_TOP), duration: 900 });
  }

  turn(by: number) {
    const map = this.map;
    if (!map) return;
    this.stopTour();
    map.easeTo({ bearing: map.getBearing() + by, duration: 400 });
  }

  zoom(direction: 1 | -1) {
    const map = this.map;
    if (!map) return;
    this.stopTour();
    if (direction > 0) map.zoomIn({ duration: 300 });
    else map.zoomOut({ duration: 300 });
  }

  /** Every plot brought into view as the map is turned and tipped now (as the web's Fit). */
  fit() {
    const map = this.map;
    if (!map) return;
    this.stopTour();
    const camera = this.cameraFor(map.getPitch(), map.getBearing());
    if (camera) map.easeTo({ ...camera, duration: 700 });
  }

  /**
   * Where the camera must be to hold every plot at this tilt and turn, stepping out until `fits` (by default every section's name
   * inside the map, as the first fit): found by putting the camera there and then back — nothing is drawn in between.
   */
  private cameraFor(pitch: number, bearing: number, fits: (map: maplibregl.Map) => boolean = (map) => this.sectionTagsFit(map), grow = false) {
    const map = this.map;
    const shapes = this.shapes();
    if (!map || !shapes.length) return null;
    const bounds = new maplibregl.LngLatBounds();
    shapes.forEach((shape) => shape.points.forEach(([lat, lng]) => bounds.extend([lng, lat])));
    const keep = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
    map.jumpTo({ pitch: 0, bearing });
    const fitted = map.cameraForBounds(bounds, { padding: FIT_PADDING, maxZoom: 18.5, bearing });
    let found: { center: maplibregl.LngLat; zoom: number; pitch: number; bearing: number } | null = null;
    if (fitted?.center && fitted.zoom !== undefined) {
      map.jumpTo({ center: fitted.center, zoom: fitted.zoom, pitch, bearing });
      for (let step = 0; step < 10 && !fits(map); step++) map.jumpTo({ zoom: map.getZoom() - 0.15 });
      // Tipped back the farm is shorter than the flat fit reckoned: come back in while it all still fits.
      for (let step = 0; grow && step < 20 && map.getZoom() < 19; step++) {
        const zoom = map.getZoom();
        map.jumpTo({ zoom: zoom + 0.1 });
        if (!fits(map)) {
          map.jumpTo({ zoom });
          break;
        }
      }
      found = { center: map.getCenter(), zoom: map.getZoom(), pitch, bearing };
    }
    map.jumpTo(keep);
    return found;
  }

  /** Every plot's corners inside the map, clear of the buttons over and under it. */
  private plotsFit(map: maplibregl.Map) {
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    return this.shapes().every((shape) =>
      shape.points.every(([lat, lng]) => {
        const at = map.project([lng, lat]);
        // Room at the sides for the section names, over and under for the buttons and the legend.
        return at.x >= 110 && at.x <= width - 110 && at.y >= 70 && at.y <= height - 70;
      }),
    );
  }

  toggleTour() {
    if (this.touring()) this.stopTour();
    else this.startTour();
  }

  /**
   * The 3D tour: the camera rises into 3D over the whole farm, then goes round it once a minute (the web's 3D tour, which plays
   * left alone). Any touch of the map, a key, a plot picked or a tool stops it where it is.
   */
  private startTour() {
    const map = this.map;
    if (!map || !this.shown() || this.still || this.touring()) return;
    // Where the camera holds the whole farm at each of eight headings; it eases between them as it goes round, so the farm fills
    // the view whichever way it faces (and never swings out of it).
    const holds = (m: maplibregl.Map) => this.plotsFit(m);
    const views = Array.from({ length: 8 }, (_, k) => this.cameraFor(TIPPED.pitch, k * 45, holds, true));
    if (views.some((view) => !view)) return;
    const around = views.map((view) => ({ lng: view!.center.lng, lat: view!.center.lat, zoom: view!.zoom }));
    const goalAt = (heading: number) => {
      const place = ((((heading % 360) + 360) % 360) / 45);
      const i = Math.floor(place) % 8;
      const f = place - Math.floor(place);
      const k = f * f * (3 - 2 * f);
      const [a, b] = [around[i], around[(i + 1) % 8]];
      return { lng: a.lng + (b.lng - a.lng) * k, lat: a.lat + (b.lat - a.lat) * k, zoom: a.zoom + (b.zoom - a.zoom) * k };
    };
    const from = { lng: map.getCenter().lng, lat: map.getCenter().lat, zoom: map.getZoom(), pitch: map.getPitch() };
    this.wantTilt = true;
    this.touring.set(true);
    const began = performance.now();
    let last = began;
    let bearing = map.getBearing();
    const frame = (now: number) => {
      if (!this.touring() || !this.map) return;
      bearing += Math.min(100, now - last) * TOUR_DEG_PER_MS;
      last = now;
      const k = Math.min(1, (now - began) / TOUR_RISE);
      const e = k * k * (3 - 2 * k);
      const to = goalAt(bearing);
      const at = (a: number, b: number) => a + (b - a) * e;
      this.map.jumpTo({ center: [at(from.lng, to.lng), at(from.lat, to.lat)], zoom: at(from.zoom, to.zoom), pitch: at(from.pitch, TIPPED.pitch), bearing });
      this.tourFrame = requestAnimationFrame(frame);
    };
    this.tourFrame = requestAnimationFrame(frame);
  }

  stopTour() {
    if (!this.touring()) return;
    cancelAnimationFrame(this.tourFrame);
    this.touring.set(false);
    const map = this.map;
    if (map) {
      this.tilted.set(map.getPitch() > 5);
      this.tagVisibility();
    }
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.tourFrame);
    this.map?.remove();
    this.map = null;
  }
}
