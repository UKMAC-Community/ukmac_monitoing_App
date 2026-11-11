import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, effect, ElementRef, input, OnDestroy, output, signal, untracked, viewChild, ViewEncapsulation } from '@angular/core';
import * as maplibregl from 'maplibre-gl';
import { getVersion, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';

import { Icon } from './icon';
import type { MapShape } from './mac-map';
import { flatFeatures, glassFeatures, stackLevels, stackSizes, stackTop } from './plot-stack';

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
/** Edited from above, the plots lie flat (as the web turns its 3D off while editing). */
const FLAT_HEIGHT = 0.3;
/** What a click or a hover lands on, the top of a plot's stack first: its flat bands (from above), its panes (tipped back), the plot's own bed. */
const PICKABLE = ['glass-flat', 'glass', 'plots'];
/** Seen from less than this far over straight down (degrees) a plot's stack is drawn flat, as bands: the panes, a few metres apart, cannot be told apart from straight over them. */
const FLAT_BELOW = 18;
const NOTHING = { type: 'FeatureCollection' as const, features: [] };
/** A plot's name shows once the plot is this wide on the screen (px); in a map of stacks the names of the plots without one wait for this. */
const LABEL_WIDTH = 26;
const QUIET_WIDTH = 64;
/** The numbers beside a stack's layers are kept at least this far apart on the screen (px): closer, only some are numbered. */
const RUNG_ROOM = 15;

/** What a layer of a stack says where it is pointed at: the plot, the layer (its place from the bottom, and how many there are), and where the pointer is. */
interface Tip {
  plot: string;
  /** Which layer (none: the plot itself, its bed). */
  level: number | null;
  of: number;
  label: string;
  note: string;
  fill: string | null;
  x: number;
  y: number;
  /** Near the right edge: the tip goes to the left of the pointer. */
  flip: boolean;
}

/** A number beside one layer of a plot's stack. */
interface Rung {
  marker: maplibregl.Marker;
  chip: HTMLElement;
  shape: MapShape;
  level: number;
  mid: number;
}
/** The picked plot's card, named over it on the map: what it is and its latest record. */
interface PlotFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: { type: 'Polygon'; coordinates: number[][][] };
}

export interface Reshaped {
  id: string;
  points: [number, number][];
}

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
    @if (tip(); as tip) {
      <!-- A layer of a stack pointed at (or a plot): which plot, which layer, what it says. -->
      <div class="m3-tip" role="tooltip" [style.transform]="'translate(' + tip.x + 'px, ' + tip.y + 'px) translate(' + (tip.flip ? 'calc(-100% - 16px)' : '16px') + ', 18px)'">
        <span><strong>{{ tip.plot }}</strong>@if (tip.level !== null) { <span class="m3-tip-where"> · layer {{ tip.level + 1 }} of {{ tip.of }}</span> }</span>
        @if (tip.label) {
          <span class="m3-tip-line">@if (tip.level !== null) { <i [class.empty]="!tip.fill" [style.background]="tip.fill"></i> }{{ tip.label }}@if (tip.note) { <b> · {{ tip.note }}</b> }</span>
        }
      </div>
    }
    <!-- Along the top's right: which plots show (when the page has a switch), then the camera buttons next to it. -->
    <div class="m3-top">
      @if (filters().length) {
        <div class="m3-view m3-filter" role="group" aria-label="Which plots to show">
          @for (item of filters(); track item.value) {
            <button type="button" [class.on]="filter() === item.value" [title]="item.title ?? ''" [attr.aria-pressed]="filter() === item.value" (click)="filterChange.emit(item.value)">{{ item.label }} <small>{{ item.count }}</small></button>
          }
        </div>
      }
      <div class="m3-view" role="group" aria-label="Camera">
        @if (!editable()) {
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
        }
        <button type="button" (click)="expanded.set(!expanded())" [attr.aria-label]="expanded() ? 'Close the big map' : 'Open the map bigger'"><app-icon [name]="expanded() ? 'x' : 'expand'" [size]="13" /> {{ expanded() ? 'Close' : 'Open' }}</button>
      </div>
    </div>
    <!-- Move tools, as the web map's: zoom, turn and Fit along the foot's right. -->
    <div class="m3-tools" role="group" aria-label="Zoom and turn">
      <button type="button" class="m3-icon" title="Zoom out" aria-label="Zoom out" (click)="zoom(-1)"><app-icon name="minus" [size]="14" /></button>
      <button type="button" class="m3-icon" title="Zoom in" aria-label="Zoom in" (click)="zoom(1)"><app-icon name="plus" [size]="14" /></button>
      <span class="m3-sep"></span>
      <button type="button" class="m3-icon" title="Turn left" aria-label="Turn left" (click)="turn(-45)"><app-icon name="rotate-ccw" [size]="14" /></button>
      <button type="button" class="m3-icon" title="Turn right" aria-label="Turn right" (click)="turn(45)"><app-icon name="rotate-cw" [size]="14" /></button>
      <span class="m3-sep"></span>
      <button type="button" [title]="focus()?.length ? 'Bring the plots with a record into view' : 'Bring the whole farm into view'" (click)="fit()"><app-icon name="scan" [size]="13" /> Fit</button>
    </div>
    <!-- Whatever the page lays over the map (a key, a plot's details): inside it, so it stays when the map is opened big. -->
    <ng-content />
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
    /* The top's right: the plots switch (a white pill like the camera bar, the pick in the accent) and the camera bar next to it. */
    .m3-top { position: absolute; top: 12px; right: 12px; z-index: 5; display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 8px; max-width: calc(100% - 24px); }
    .m3-top > .m3-view { position: static; }
    .m3-filter small { margin-left: 4px; font-size: 0.6875rem; font-weight: 500; opacity: 0.7; }
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
    /* Editing a plot: a square at each corner to drag, and a round one in the middle to move the whole plot (as the web's). */
    .m3-handle { display: block; width: 14px; height: 14px; box-sizing: border-box; border: 2px solid var(--accent-solid, #0066d9); border-radius: 3px; background: #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35); cursor: move; }
    .m3-handle:hover { background: #e6f0ff; }
    .m3-handle.m3-move { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; color: var(--accent-solid, #0066d9); }
    .m3-sep { width: 1px; height: 16px; background: var(--border); margin: 0 4px; }
    .plot-tag { pointer-events: none; font-weight: 700; font-size: 12px; line-height: 1.25; letter-spacing: 0.01em; color: #fff; background: rgba(48, 48, 52, 0.82); padding: 2px 6px; border-radius: 5px; white-space: nowrap; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); }
    /* A section's name, as the web map's: white, its colour round the edge and in its dot and text, easy to read over the imagery. */
    .plot-tag.section-tag { display: inline-flex; align-items: center; gap: 7px; background: #fff; border: 2px solid var(--tag-edge, #ccc); border-radius: 999px; padding: 5px 13px 5px 11px; font-size: 14px; font-weight: 600; letter-spacing: 0; box-shadow: 0 3px 10px rgba(0, 0, 0, 0.35); }
    .plot-tag.section-tag i { width: 9px; height: 9px; border-radius: 50%; }
    .m3-pin { display: flex; flex-direction: column; align-items: center; gap: 4px; pointer-events: none; }
    .m3-pin span { background: #fff; color: #111; font-size: 12px; padding: 4px 9px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35); }
    .m3-pin i { width: 16px; height: 16px; border-radius: 50%; background: #0066d9; border: 3px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.4); }
    .plot-tag.hide { display: none; }
    /* A dot before a plot's name: what the plot comes to as a whole (set by the page). */
    .plot-tag .plot-dot { display: inline-block; width: 9px; height: 9px; margin-right: 5px; border-radius: 50%; vertical-align: -1px; box-shadow: 0 0 0 1.5px #fff; }
    /* A layer pointed at: beside the pointer, naming it. */
    .m3-tip { position: absolute; top: 0; left: 0; z-index: 7; pointer-events: none; display: flex; flex-direction: column; gap: 3px; max-width: 300px; padding: 7px 11px; background: var(--surface-solid, #fff); border: var(--hairline, 1px) solid var(--border, #e5e5ea); border-radius: 10px; box-shadow: 0 6px 16px rgba(15, 23, 42, 0.22); font-size: 12px; line-height: 1.35; color: var(--text, #1d1d1f); will-change: transform; }
    .m3-tip strong { font-size: 13px; }
    .m3-tip-where { color: var(--text-muted, #6e6e73); }
    .m3-tip-line { display: flex; align-items: center; gap: 6px; font-weight: 500; }
    .m3-tip-line i { width: 11px; height: 11px; flex: none; box-sizing: border-box; border-radius: 3px; }
    .m3-tip-line i.empty { border: 2px solid #94a3b8; }
    .m3-tip-line b { font-weight: 600; }
    /* The numbers beside a stack's layers (its picked plot's, and the one pointed at): in the layer's colour, as the page's key numbers them. */
    .m3-rung { pointer-events: none; display: grid; place-items: center; min-width: 18px; height: 18px; padding: 0 3px; box-sizing: border-box; border: 2px solid #fff; border-radius: 6px; font-size: 10px; font-weight: 700; line-height: 1; color: rgba(0, 0, 0, 0.78); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5); transition: transform 0.12s; }
    .m3-rung.empty { background: #fff; border-color: #94a3b8; color: #64748b; }
    .m3-rung.on { transform: scale(1.3); box-shadow: 0 0 0 2px var(--accent-solid, #0066d9), 0 2px 6px rgba(0, 0, 0, 0.5); }
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
  /** Reshape the picked plot: flat from above, a handle at each corner and one to move it whole. Off, the map is as the dashboard's. */
  readonly editable = input(false);
  /** A switch over the map for which plots show (the page filters `shapes` by it): each choice, its count. None: no switch. */
  readonly filters = input<{ value: string; label: string; count: number; title?: string }[]>([]);
  readonly filter = input('');
  readonly filterChange = output<string>();
  /** The plots the camera is brought to (their ids) when the map opens, on Fit and on the tour, the rest staying in view round them. None: all of them. */
  readonly focus = input<readonly string[] | null>(null);
  /** What a fit keeps clear (px): room for what the page lays over the map (a key down the left, say). Default: room for the section names. */
  readonly fitPadding = input<{ top: number; bottom: number; left: number; right: number }>(FIT_PADDING);
  /** The stacked layer picked out, by its place from the bottom (0 the first): the other layers fade. None: every layer as it is. */
  readonly highlight = input<number | null>(null);
  /** A plot's corner or the plot itself was let go: its new outline (nothing is saved here). */
  readonly reshaped = output<Reshaped>();
  /** Drawing a new plot (editing): each click on the map is a corner, sent up as [lat, lng]; the page keeps them and gives them back as `draft`. */
  readonly drawing = input(false);
  readonly draft = input<[number, number][]>([]);
  readonly drawClick = output<[number, number]>();
  readonly picked = output<string>();
  /** The picked plot let go: its card closed, or the map clicked off the plots. */
  readonly cleared = output<void>();
  /** The pointer is over a layer of a plot's stack (the plot, and the layer by its place from the bottom), or has left the stacks. */
  readonly layerHover = output<{ id: string; level: number } | null>();
  private readonly cardEl = viewChild<ElementRef<HTMLElement>>('cardEl');
  private readonly selectedShape = computed(() => this.shapes().find((shape) => shape.id === this.selected()) ?? null);
  /** The plot the camera last went to (picked again, it doesn't go again). */
  private focused: string | null = null;
  readonly tilted = signal(true);
  /** The camera is over the plots (or nearly): their stacks are drawn flat. It starts flat and tips back once shown. */
  private readonly flatNow = signal(true);
  readonly expanded = signal(false);
  /** Brought back into view each time it is opened big or closed (a small map and a big one want the plots at another size). */
  readonly fitOnOpen = input(false);
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
  private handles: maplibregl.Marker[] = [];
  /** What the plots source holds now, so a drag can redraw just the plot being edited. */
  private features: PlotFeature[] = [];
  /** What the pointer is over, if it is a layer of a stack: shown beside it, and its plot's layers are numbered. */
  readonly tip = signal<Tip | null>(null);
  private readonly pointedPlot = signal<string | null>(null);
  private pointedAt: { id: string; level: number | null } | null = null;
  private pendingMove: { point: { x: number; y: number }; originalEvent: MouseEvent } | null = null;
  private eyeNow: { lng: number; lat: number; altitude: number } | null = null;
  private moveFrame = 0;
  /** The numbers beside the layers of the picked plot's stack, and of the one pointed at. */
  private rungs: Rung[] = [];
  /** The plots' names (not the section names), and whether the plot has a stack. */
  private plotTags: { marker: maplibregl.Marker; stacked: boolean }[] = [];
  /** The names of the plots with a stack: each hangs over the top of its stack, so it follows the camera (see liftTags). */
  private lifted: { marker: maplibregl.Marker; lng: number; lat: number; height: number }[] = [];
  /** The camera the map had before editing (3D or from above), to go back to. */
  private tiltBeforeEdit: boolean | null = null;
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
            // The layers stacked on a plot (see plot-stack): tipped back, panes (sheets and their edges); from above, flat bands.
            glass: { type: 'geojson', data: NOTHING },
            'glass-flat': { type: 'geojson', data: NOTHING },
            // A plot being drawn (editing): its corners so far.
            draft: { type: 'geojson', data: NOTHING },
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
            // Near-solid colour with no shading by the side, so a layer's colour is the same from every angle.
            {
              id: 'glass',
              type: 'fill-extrusion',
              source: 'glass',
              paint: { 'fill-extrusion-color': ['to-color', ['get', 'colour']], 'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-height': ['get', 'top'], 'fill-extrusion-opacity': 0.92, 'fill-extrusion-vertical-gradient': false },
            },
            // From above: each layer's band, the later ones over the earlier (so the last is in the middle), a line in a darker shade round each.
            {
              id: 'glass-flat',
              type: 'fill',
              source: 'glass-flat',
              layout: { 'fill-sort-key': ['get', 'level'] },
              paint: { 'fill-color': ['to-color', ['get', 'colour']], 'fill-opacity': ['case', ['==', ['get', 'empty'], 1], 0, 0.92] },
            },
            {
              id: 'glass-flat-lines',
              type: 'line',
              source: 'glass-flat',
              layout: { 'line-sort-key': ['get', 'level'] },
              paint: { 'line-color': ['to-color', ['get', 'edge']], 'line-width': 1.2 },
            },
            { id: 'draft-fill', type: 'fill', source: 'draft', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#0a84ff', 'fill-opacity': 0.3 } },
            { id: 'draft-line', type: 'line', source: 'draft', filter: ['!=', ['geometry-type'], 'Point'], paint: { 'line-color': '#ffffff', 'line-width': 3, 'line-dasharray': [2, 1.5] } },
            { id: 'draft-pts', type: 'circle', source: 'draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': '#0a84ff', 'circle-stroke-width': 3 } },
          ],
        },
      });
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-left');
      // Draw as soon as the style is in (not waiting for every tile, as 'load' does).
      const start = () => {
        if (this.ready || !map.getSource('plots')) return;
        this.ready = true;
        this.draw();
        this.paintHighlight(untracked(() => this.highlight()));
      };
      map.on('styledata', start);
      map.on('load', start);
      // A click on a plot picks it (once, though its bed and its panes are both under the click); off the plots it lets the picked one go.
      map.on('click', (event) => {
        // Drawing a new plot: a click is a corner, never a pick.
        if (this.drawing()) {
          this.drawClick.emit([event.lngLat.lat, event.lngLat.lng]);
          return;
        }
        const id = map.queryRenderedFeatures(event.point, { layers: PICKABLE })[0]?.properties?.['id'];
        if (id) this.picked.emit(String(id));
        else if (this.selected()) this.cleared.emit();
      });
      // The picked plot's card, and the names hung over stacks, follow the plots as the map moves.
      map.on('move', () => {
        this.eyeNow = null;
        this.placeCard();
        this.liftTags();
        this.placeRungs();
      });
      map.on('resize', () => this.placeCard());
      // The camera is the user's again the moment they touch the map.
      for (const gesture of ['mousedown', 'touchstart', 'wheel'] as const) map.on(gesture, () => this.stopTour());
      // The pointer shows a hand over a plot (its bed or its stack), and names a layer of a stack it is over (once a frame at most).
      map.on('mousemove', (event) => {
        this.pendingMove = event;
        if (this.moveFrame) return;
        this.moveFrame = requestAnimationFrame(() => {
          this.moveFrame = 0;
          const moved = this.pendingMove;
          this.pendingMove = null;
          if (moved) this.point(moved);
        });
      });
      map.on('mouseout', () => {
        this.pendingMove = null;
        map.getCanvas().style.cursor = '';
        this.setPointed(null);
      });
      map.on('zoom', () => this.tagVisibility());
      map.on('rotateend', () => this.tagVisibility());
      map.on('pitchend', () => this.tagVisibility());
      map.on('zoomend', () => this.tagVisibility());
      // Where the camera comes to rest the names that give way to the names over stacks are worked out again.
      map.on('moveend', () => this.tagVisibility());
      // The camera's tilt shows in the buttons once it's shown (before, it's the flat start).
      map.on('pitchend', () => this.revealed && this.tilted.set(map.getPitch() > 5));
      map.on('pitch', () => {
        const flat = map.getPitch() < FLAT_BELOW;
        if (flat !== this.flatNow()) this.flatNow.set(flat);
      });
      this.map = map;
      this.awaitImagery(map);
      new ResizeObserver(() => {
        map.resize();
        if (this.ready && !this.fitted) this.draw();
      }).observe(el);
    });

    let openedBefore = false;
    effect(() => {
      const open = this.expanded();
      if (!openedBefore) {
        openedBefore = true;
        return;
      }
      if (!untracked(() => this.fitOnOpen())) return;
      // Once the box has its new size.
      setTimeout(() => {
        this.map?.resize();
        this.fit();
      }, 120);
      void open;
    });

    effect(() => {
      this.shapes();
      this.selected();
      this.editable();
      this.drawing();
      if (this.ready) this.draw();
    });

    // The plot being drawn, and the map's own gestures while drawing (a double click is two corners, not a zoom).
    effect(() => {
      const points = this.draft();
      const drawing = this.drawing();
      untracked(() => {
        const map = this.map;
        if (!map) return;
        if (drawing) map.doubleClickZoom.disable();
        else map.doubleClickZoom.enable();
        map.getCanvas().style.cursor = drawing ? 'crosshair' : '';
        const source = map.getSource('draft') as GeoJSONSource | undefined;
        if (!source) return;
        const at = points.map(([lat, lng]) => [lng, lat]);
        const features: object[] = at.map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates } }));
        if (at.length >= 3) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...at, at[0]]] } });
        else if (at.length === 2) features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: at } });
        source.setData({ type: 'FeatureCollection', features } as never);
      });
    });

    // A stack is panes tipped back and flat bands seen from above (see plot-stack): redrawn as the camera goes between the two.
    effect(() => {
      this.flatNow();
      untracked(() => this.ready && this.drawGlass());
    });

    // The numbers beside the layers of the plot picked and the plot pointed at.
    effect(() => {
      this.shapes();
      this.selected();
      this.editable();
      this.flatNow();
      this.pointedPlot();
      untracked(() => this.ready && this.drawRungs());
    });

    // The layer picked out on the page's key: the others fade.
    effect(() => {
      const level = this.highlight();
      untracked(() => this.paintHighlight(level));
    });

    // Editing is done from above: the camera goes flat and the tour stops; on leaving it goes back as it was.
    effect(() => {
      const editing = this.editable();
      untracked(() => {
        if (editing) {
          this.stopTour();
          this.tiltBeforeEdit = this.wantTilt;
          if (this.map && this.revealed) this.setTilt(false);
          else this.wantTilt = false;
        } else if (this.tiltBeforeEdit !== null) {
          const back = this.tiltBeforeEdit;
          this.tiltBeforeEdit = null;
          if (this.map && this.revealed) this.setTilt(back);
          else this.wantTilt = back;
        }
      });
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
    // A plot with a stack is looked at closer (its layers are what is to be read), set a little low so the top of the tower is in view.
    const tower = !!shape.stack?.length && !this.editable();
    const zoom = Math.min(20, Math.max(map.getZoom(), (camera?.zoom ?? map.getZoom()) - (tower ? 0.3 : 1.5)));
    map.easeTo({ center: bounds.getCenter(), zoom, duration: 700, ...(tower ? { offset: [0, 70] as [number, number] } : {}), ...tilt });
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
    // A plot with a stack: the card goes over the top of the stack, not over the plot's foot.
    const lift = this.flatNow() ? 0 : stackTop(shape);
    const at = shape.points.map(([lat, lng]) => map.project(this.elevated(lng, lat, lift)));
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
    const editing = this.editable();
    // The picked plot stands out of the rest, outlined in white (edited from above, every plot lies flat). A plot with a stack stays a low
    // bed under its layers, and is outlined alone: raised, it would swallow them.
    const heightOf = (shape: MapShape) =>
      editing ? FLAT_HEIGHT : shape.stack?.length && shape.points.length >= 3 ? stackSizes(shape.points, shape.stack.length).bed : shape.id === selected ? PICKED_HEIGHT : PLOT_HEIGHT;
    const features = shapes.map((shape) => ({
      type: 'Feature' as const,
      properties: { id: shape.id, fill: shape.fill, stroke: shape.id === selected ? '#ffffff' : shape.stroke, sel: shape.id === selected, top: heightOf(shape) },
      geometry: { type: 'Polygon' as const, coordinates: [[...shape.points.map(([lat, lng]) => [lng, lat]), [shape.points[0][1], shape.points[0][0]]]] },
    }));
    this.features = features;
    (map.getSource('plots') as GeoJSONSource).setData({ type: 'FeatureCollection', features });
    untracked(() => this.drawGlass());
    this.drawHandles(editing && !this.drawing() ? this.selectedShape() : null);

    this.tags.forEach((tag) => tag.remove());
    this.lifted = [];
    this.plotTags = [];
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

    const named = shapes.map((shape) => {
      const lat = shape.points.reduce((sum, p) => sum + p[0], 0) / shape.points.length;
      const lng = shape.points.reduce((sum, p) => sum + p[1], 0) / shape.points.length;
      const el = document.createElement('div');
      el.className = shape.id === selected ? 'plot-tag is-picked' : 'plot-tag';
      if (shape.badge) {
        const dot = document.createElement('i');
        dot.className = 'plot-dot';
        dot.style.background = shape.badge;
        el.append(dot, shape.label);
      } else {
        el.textContent = shape.label;
      }
      // A plot with a stack has its name hung over the top of the stack (so the layers under it are seen), like a flag.
      const height = editing ? 0 : stackTop(shape);
      const marker = new maplibregl.Marker({ element: el, pitchAlignment: 'viewport', ...(height ? { anchor: 'bottom' as const, offset: [0, -4] as [number, number] } : {}) }).setLngLat([lng, lat]).addTo(map);
      if (height) this.lifted.push({ marker, lng, lat, height });
      this.plotTags.push({ marker, stacked: !!shape.stack?.length });
      return marker;
    });
    this.tags = [...named, ...pills];
    this.liftTags();
    this.tagVisibility();

    if (shapes.length && !this.fitted && map.getContainer().clientWidth > 0) {
      map.resize();
      const bounds = new maplibregl.LngLatBounds();
      this.aimedShapes().forEach((shape) => shape.points.forEach(([lat, lng]) => bounds.extend([lng, lat])));
      // Fitted as seen from above (room at the sides for the section names, under the buttons and over the legend), then tipped back
      // round the same centre, so in 3D the farm fills the view as on the web rather than shrinking to fit the far side.
      // Before it's shown it's still the flat start: the 3D view is worked out here, and reveal() glides to it.
      const camera = this.revealed ? { pitch: map.getPitch(), bearing: map.getBearing() } : this.wantTilt ? TIPPED : ON_TOP;
      map.jumpTo(ON_TOP);
      map.fitBounds(bounds, { padding: this.padding(), maxZoom: 18.5, duration: 0 });
      const flat = { center: map.getCenter(), zoom: map.getZoom() };
      map.jumpTo(camera);
      // Tipped back, the near side grows: step out a little until every section's name is inside the map (and, on a map brought to chosen plots, each of them with its stack).
      for (let step = 0; step < 12 && !this.fitsAll(map); step++) map.jumpTo({ zoom: map.getZoom() - 0.15 });
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

  /** The layers stacked on the plots drawn: panes tipped back, bands from above (none while a plot is edited: that is done flat, from above). */
  private drawGlass() {
    const map = this.map;
    if (!map) return;
    const flat = this.flatNow();
    const shapes = this.editable() ? [] : this.shapes();
    (map.getSource('glass') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: flat ? [] : glassFeatures(shapes) });
    (map.getSource('glass-flat') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: flat ? flatFeatures(shapes) : [] });
    this.liftTags();
  }

  /** One layer shown as it is and the rest faded paler (none: all as they are), so a layer named on the key can be found on every plot. */
  private paintHighlight(level: number | null) {
    const map = this.map;
    if (!map || !map.getLayer('glass')) return;
    // MapLibre checks a colour expression as it takes it; its types cannot follow one put together from parts.
    const by = (own: string, dim: string) => (level === null ? ['to-color', ['get', own]] : ['case', ['==', ['get', 'level'], level], ['to-color', ['get', own]], ['to-color', ['get', dim]]]) as never;
    map.setPaintProperty('glass', 'fill-extrusion-color', by('colour', 'dim'));
    map.setPaintProperty('glass-flat', 'fill-color', by('colour', 'dim'));
    map.setPaintProperty('glass-flat-lines', 'line-color', by('edge', 'edgeDim'));
  }

  /**
   * Where the camera is as the map is now: the spot on the ground under it and how high it is (m), worked out from where the map looks
   * (its middle, zoom, tilt and turn) and how wide the camera sees. Once for each move of the map.
   */
  private eye(): { lng: number; lat: number; altitude: number } | null {
    if (this.eyeNow) return this.eyeNow;
    const map = this.map;
    if (!map) return null;
    const middle = map.getCenter();
    const pitch = (map.getPitch() * Math.PI) / 180;
    const bearing = (map.getBearing() * Math.PI) / 180;
    const cosLat = Math.cos((middle.lat * Math.PI) / 180);
    // The camera is as far from the middle of the map as the map's height needs for the field of view it sees through.
    const perPixel = (40075016.686 * cosLat) / (512 * 2 ** map.getZoom());
    const distance = (0.5 / Math.tan((map.getVerticalFieldOfView() * Math.PI) / 360)) * map.getContainer().clientHeight * perPixel;
    const back = distance * Math.sin(pitch);
    return (this.eyeNow = {
      lng: middle.lng - (back * Math.sin(bearing)) / (111320 * cosLat),
      lat: middle.lat - (back * Math.cos(bearing)) / 110574,
      altitude: distance * Math.cos(pitch),
    });
  }

  /**
   * Where a point `height` metres up is seen, as the point on the ground that is seen in the same place (to put on the screen with
   * `project`): from the camera, a point in the air lies on the same line of sight as the ground further out, `height / (the camera's
   * height − height)` of the way on from the camera's own spot.
   */
  private elevated(lng: number, lat: number, height: number): [number, number] {
    const eye = this.eye();
    if (!height || !eye) return [lng, lat];
    const k = height / Math.max(eye.altitude - height, eye.altitude * 0.2);
    return [lng + (lng - eye.lng) * k, lat + (lat - eye.lat) * k];
  }

  /** What the pointer is over: a layer of a stack (the plot and the layer, its place from the bottom), or a plot's own bed (the plot alone). */
  private layerAt(hits: maplibregl.MapGeoJSONFeature[]): { id: string; level: number | null } | null {
    const first = hits[0];
    const id = first?.properties?.['id'];
    if (!first || !id) return null;
    // Tipped back, what is nearest the pointer comes first (MapLibre sorts what stands up by its distance).
    if (first.layer.id === 'glass') return { id: String(id), level: Number(first.properties['level']) };
    if (first.layer.id === 'plots') return { id: String(id), level: null };
    if (first.layer.id !== 'glass-flat') return null;
    // From above the bands lie one inside another: the layer seen is the last one drawn there that has a colour.
    const here = hits.filter((hit) => hit.layer.id === 'glass-flat');
    const seen = here.filter((hit) => !Number(hit.properties['empty']));
    const top = (seen.length ? seen : here).reduce((a, b) => (Number(b.properties['level']) > Number(a.properties['level']) ? b : a));
    return { id: String(id), level: Number(top.properties['level']) };
  }

  /** The pointer moved: a hand over a plot, and what it is over named beside it. */
  private point(event: { point: { x: number; y: number }; originalEvent: MouseEvent }) {
    const map = this.map;
    if (!map) return;
    // Dragging the map is not pointing at anything.
    if (event.originalEvent.buttons) {
      this.setPointed(null);
      return;
    }
    const hits = map.queryRenderedFeatures([event.point.x, event.point.y], { layers: PICKABLE });
    map.getCanvas().style.cursor = this.drawing() ? 'crosshair' : hits.length ? 'pointer' : '';
    this.setPointed(this.layerAt(hits), event.point);
  }

  private setPointed(hit: { id: string; level: number | null } | null, point?: { x: number; y: number }) {
    const was = this.pointedAt;
    const shape = hit ? this.shapes().find((item) => item.id === hit.id) : undefined;
    const pane = hit?.level != null ? shape?.stack?.[hit.level] : undefined;
    // A layer of a stack is named; a plot's own bed is named when it has a hint to give (what it is, though its name may not show).
    const named = !!hit && !!shape && !!point && !this.editable() && (hit.level === null ? !!shape.hint : !!pane);
    if (!named || !hit || !shape || !point) {
      this.pointedAt = null;
      if (this.tip()) this.tip.set(null);
      // A stack's own bed pointed at still numbers its layers.
      const bed = !!hit && !!shape?.stack?.length && !this.editable() ? hit.id : null;
      if (this.pointedPlot() !== bed) this.pointedPlot.set(bed);
      if (was?.level != null) this.layerHover.emit(null);
      this.markRungs();
      return;
    }
    this.pointedAt = hit;
    const width = this.map?.getContainer().clientWidth ?? 0;
    this.tip.set({
      plot: shape.label,
      level: hit.level,
      of: shape.stack?.length ?? 0,
      label: pane ? pane.label : (shape.hint ?? ''),
      note: pane?.note ?? '',
      fill: pane ? pane.fill : null,
      x: point.x,
      y: point.y,
      flip: point.x > width - 320,
    });
    const stackId = shape.stack?.length ? hit.id : null;
    if (stackId !== this.pointedPlot()) this.pointedPlot.set(stackId);
    if (hit.id !== was?.id || hit.level !== was.level) {
      this.layerHover.emit(hit.level === null ? null : { id: hit.id, level: hit.level });
      this.markRungs();
    }
  }

  /** Numbers beside the layers of the plot picked and of the plot pointed at (tipped back only: from above the layers are bands). */
  private drawRungs() {
    this.rungs.forEach((rung) => rung.marker.remove());
    this.rungs = [];
    const map = this.map;
    if (!map || this.editable() || this.flatNow()) return;
    const ids = [...new Set([this.selected(), this.pointedPlot()].filter((id): id is string => !!id))];
    for (const id of ids) {
      const shape = this.shapes().find((item) => item.id === id);
      if (!shape?.stack?.length || shape.points.length < 3) continue;
      const levels = stackLevels(shape.points, shape.stack.length);
      shape.stack.forEach((pane, level) => {
        const element = document.createElement('div');
        const chip = document.createElement('span');
        chip.className = pane.fill ? 'm3-rung' : 'm3-rung empty';
        chip.textContent = String(level + 1);
        if (pane.fill) chip.style.background = pane.fill;
        element.append(chip);
        const marker = new maplibregl.Marker({ element }).setLngLat([shape.points[0][1], shape.points[0][0]]).addTo(map);
        this.rungs.push({ marker, chip, shape, level, mid: levels[level].mid });
      });
    }
    this.markRungs();
    this.placeRungs();
  }

  /** The number of the layer pointed at is shown larger. */
  private markRungs() {
    for (const rung of this.rungs) rung.chip.classList.toggle('on', rung.shape.id === this.pointedAt?.id && rung.level === this.pointedAt.level);
  }

  /**
   * Each stack's numbers put beside its layers, up the corner nearest the camera (its edge is the tallest on the screen, so the numbers
   * are furthest apart) and out to the side that corner is on, as the camera is now; where the layers are still close together on the
   * screen only some are numbered.
   */
  private placeRungs() {
    const map = this.map;
    if (!map || !this.rungs.length) return;
    const byShape = new Map<string, Rung[]>();
    for (const rung of this.rungs) byShape.set(rung.shape.id, [...(byShape.get(rung.shape.id) ?? []), rung]);
    for (const list of byShape.values()) {
      const points = list[0].shape.points;
      const screen = points.map((point) => map.project([point[1], point[0]]));
      const nearest = screen.reduce((best, point, index) => (point.y > screen[best].y ? index : best), 0);
      const middle = screen.reduce((sum, point) => sum + point.x, 0) / screen.length;
      const side = screen[nearest].x >= middle ? 1 : -1;
      const corner = points[nearest];
      const at = (height: number) => this.elevated(corner[1], corner[0], height);
      const gap = list.length > 1 ? Math.abs(map.project(at(list[1].mid)).y - map.project(at(list[0].mid)).y) : RUNG_ROOM;
      const every = gap >= RUNG_ROOM ? 1 : Math.ceil(RUNG_ROOM / Math.max(gap, 0.5));
      list.forEach((rung, index) => {
        rung.marker.setLngLat(at(rung.mid));
        rung.marker.setOffset([side * 17, 0]);
        const shown = gap >= 2 && (index % every === 0 || index === list.length - 1);
        rung.marker.getElement().style.display = shown ? '' : 'none';
      });
    }
  }

  /** The names hung over stacks put over their tops for the camera as it is now. */
  private liftTags() {
    // Drawn flat from above there is no stack standing up: the names rest on the plots.
    const flat = this.flatNow();
    for (const item of this.lifted) {
      const [lng, lat] = this.elevated(item.lng, item.lat, flat ? 0 : item.height);
      item.marker.setLngLat([lng, lat]);
    }
  }

  /** The plots the camera is brought to: those asked for (`focus`) that are drawn, else all of them. */
  private aimedShapes(): MapShape[] {
    const shapes = this.shapes();
    const focus = untracked(() => this.focus());
    const aimed = focus?.length ? shapes.filter((shape) => focus.includes(shape.id)) : [];
    return aimed.length ? aimed : shapes;
  }

  /** One plot's outline redrawn while it is dragged (the page hears of it only once it is let go). */
  private preview(id: string, ring: [number, number][]) {
    const map = this.map;
    const feature = this.features.find((item) => item.properties?.['id'] === id);
    if (!map || !feature) return;
    feature.geometry = { type: 'Polygon' as const, coordinates: [[...ring.map(([lat, lng]) => [lng, lat]), [ring[0][1], ring[0][0]]]] };
    (map.getSource('plots') as GeoJSONSource).setData({ type: 'FeatureCollection', features: this.features });
  }

  /** The picked plot's handles: a square at each corner (one moves that corner), a round one in the middle (moves the plot whole). */
  private drawHandles(shape: MapShape | null) {
    this.handles.forEach((handle) => handle.remove());
    this.handles = [];
    const map = this.map;
    if (!map || !shape) return;
    const id = shape.id;
    let ring: [number, number][] = shape.points.map(([lat, lng]) => [lat, lng]);
    const centreOf = (points: [number, number][]) => [points.reduce((sum, p) => sum + p[0], 0) / points.length, points.reduce((sum, p) => sum + p[1], 0) / points.length] as [number, number];
    const handle = (className: string, title: string, at: [number, number]) => {
      const el = document.createElement('span');
      el.className = className;
      el.title = title;
      return new maplibregl.Marker({ element: el, draggable: true }).setLngLat([at[1], at[0]]).addTo(map);
    };

    const middle = handle('m3-handle m3-move', 'Drag to move the whole plot', centreOf(ring));
    middle.getElement().innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="M2 12h20"/><path d="m15 19-3 3-3-3"/><path d="m19 9 3 3-3 3"/><path d="m5 9-3 3 3 3"/><path d="m9 5 3-3 3 3"/></svg>';
    const corners = ring.map((point) => handle('m3-handle', 'Drag this corner', point));
    this.handles = [middle, ...corners];

    let moved = false;
    const done = () => {
      if (!moved) return;
      moved = false;
      this.reshaped.emit({ id, points: ring.map(([lat, lng]) => [lat, lng]) });
    };
    corners.forEach((corner, index) => {
      corner.on('drag', () => {
        moved = true;
        const at = corner.getLngLat();
        ring = ring.map((point, i) => (i === index ? ([at.lat, at.lng] as [number, number]) : point));
        const centre = centreOf(ring);
        middle.setLngLat([centre[1], centre[0]]);
        this.preview(id, ring);
      });
      corner.on('dragend', done);
    });
    let start = ring;
    let from = centreOf(ring);
    middle.on('dragstart', () => {
      start = ring;
      from = centreOf(ring);
    });
    middle.on('drag', () => {
      moved = true;
      const at = middle.getLngLat();
      const [dLat, dLng] = [at.lat - from[0], at.lng - from[1]];
      ring = start.map(([lat, lng]) => [lat + dLat, lng + dLng] as [number, number]);
      corners.forEach((corner, i) => corner.setLngLat([ring[i][1], ring[i][0]]));
      this.preview(id, ring);
    });
    middle.on('dragend', done);
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

  /**
   * Plot names show once a plot is wide enough on screen to hold one (whatever the zoom, tilt or window size). In a map of stacks the
   * stacks are what is looked at: the names of the plots without one wait until the plots are bigger, and give way to a name that lies
   * over them.
   */
  private tagVisibility() {
    const map = this.map;
    const shapes = this.shapes();
    const sample = shapes[0];
    let wide = 0;
    if (map && sample) {
      const xs = sample.points.map(([lat, lng]) => map.project([lng, lat]).x);
      wide = Math.max(...xs) - Math.min(...xs);
    }
    const quiet = shapes.some((shape) => shape.stack?.length);
    for (const tag of this.plotTags) {
      const el = tag.marker.getElement();
      el.classList.toggle('hide', wide < (quiet && !tag.stacked ? QUIET_WIDTH : LABEL_WIDTH) && !el.classList.contains('is-picked'));
    }
    if (quiet) this.declutter();
  }

  /** A name that would lie over the name of a plot with a stack (or the plot picked) gives way to it. */
  private declutter() {
    const keep: DOMRect[] = [];
    const others: HTMLElement[] = [];
    for (const tag of this.plotTags) {
      const el = tag.marker.getElement();
      if (el.classList.contains('hide')) continue;
      if (tag.stacked || el.classList.contains('is-picked')) keep.push(el.getBoundingClientRect());
      else others.push(el);
    }
    for (const el of others) {
      const box = el.getBoundingClientRect();
      if (keep.some((other) => box.left < other.right + 3 && box.right > other.left - 3 && box.top < other.bottom + 3 && box.bottom > other.top - 3)) el.classList.add('hide');
    }
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
  private cameraFor(pitch: number, bearing: number, fits: (map: maplibregl.Map) => boolean = (map) => this.fitsAll(map), grow = false) {
    const map = this.map;
    const shapes = this.aimedShapes();
    if (!map || !shapes.length) return null;
    const bounds = new maplibregl.LngLatBounds();
    shapes.forEach((shape) => shape.points.forEach(([lat, lng]) => bounds.extend([lng, lat])));
    const keep = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
    map.jumpTo({ pitch: 0, bearing });
    const fitted = map.cameraForBounds(bounds, { padding: this.padding(), maxZoom: 18.5, bearing });
    let found: { center: maplibregl.LngLat; zoom: number; pitch: number; bearing: number } | null = null;
    if (fitted?.center && fitted.zoom !== undefined) {
      map.jumpTo({ center: fitted.center, zoom: fitted.zoom, pitch, bearing });
      for (let step = 0; step < 12 && !fits(map); step++) map.jumpTo({ zoom: map.getZoom() - 0.15 });
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

  /**
   * What a fit keeps clear (px), as it is asked for but never more than the map can spare: a small map gives up part of the room it was
   * asked to keep (the key down its side), so that the plots still have most of it.
   */
  private padding() {
    const asked = untracked(() => this.fitPadding());
    const { clientWidth: width, clientHeight: height } = this.map?.getContainer() ?? { clientWidth: 0, clientHeight: 0 };
    const across = asked.left + asked.right;
    const down = asked.top + asked.bottom;
    const x = width && across > width * 0.5 ? (width * 0.5) / across : 1;
    const y = height && down > height * 0.4 ? (height * 0.4) / down : 1;
    return { top: asked.top * y, bottom: asked.bottom * y, left: asked.left * x, right: asked.right * x };
  }

  /** Every section's name inside the map and, on a map brought to chosen plots, those plots with their stacks. */
  private fitsAll(map: maplibregl.Map) {
    return this.sectionTagsFit(map) && (!untracked(() => this.focus())?.length || this.plotsFit(map));
  }

  /** Every plot's corners (and the tops of their stacks) inside the map, clear of the buttons over and under it. */
  private plotsFit(map: maplibregl.Map) {
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    const pad = this.padding();
    return this.aimedShapes().every((shape) => {
      const top = stackTop(shape);
      return shape.points.every(([lat, lng]) =>
        [0, top].every((up) => {
          const at = map.project(up ? this.elevated(lng, lat, up) : [lng, lat]);
          // Room at the sides for the section names (or the key), over and under for the buttons and the legend.
          return at.x >= Math.max(pad.left - 20, 40) && at.x <= width - Math.max(pad.right - 20, 40) && at.y >= 70 && at.y <= height - 70;
        }),
      );
    });
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
    cancelAnimationFrame(this.moveFrame);
    this.rungs.forEach((rung) => rung.marker.remove());
    this.handles.forEach((handle) => handle.remove());
    this.map?.remove();
    this.map = null;
  }
}
