import { ChangeDetectionStrategy, ViewEncapsulation, Component, effect, ElementRef, input, OnDestroy, output, viewChild } from '@angular/core';
import * as L from 'leaflet';

const ESRI_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

/** One layer of a plot's stack: the colour it shows (none: nothing to show yet, so only an empty frame) and what it stands for. */
export interface StackPane {
  fill: string | null;
  label: string;
  /** What it says of the plot, in a word or two (a status): told on the map where it is pointed at. */
  note?: string;
}

/** A plot (or any area) drawn on the map. */
export interface MapShape {
  id: string;
  points: [number, number][];
  fill: string;
  stroke: string;
  label: string;
  /** The section it belongs to, e.g. "Zone A · 7", named once on the map; its colours for that name. */
  group?: string;
  groupColor?: string;
  groupText?: string;
  /** Layers stacked on the plot in 3D, the first at the bottom (the 3D map only; the flat map leaves them out). */
  stack?: StackPane[];
  /** A dot of this colour before the plot's name on the 3D map (what the plot comes to as a whole). */
  badge?: string;
  /** A few words told beside the pointer on the 3D map when the plot is pointed at (what the plot is, when its name is not shown). */
  hint?: string;
}

/** Where a MAC is, on satellite imagery (Esri's, as the system's maps show when there is no Google key); optionally its plots drawn on it. Needs the internet for the tiles. */
@Component({
  selector: 'app-mac-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="map" #box role="img" [attr.aria-label]="'Satellite view of ' + name()"></div>`,
  encapsulation: ViewEncapsulation.None,
  styles: `
    .plot-label { background: transparent; border: 0; box-shadow: none; padding: 0; font-weight: 700; font-size: 11px; color: #fff; text-shadow: 0 0 3px #000, 0 0 2px #000, 0 1px 2px #000; pointer-events: none; }
    .plot-label::before { display: none; }
    .map.zoom-low .plot-label { display: none; }
    .map.zoom-high .plot-label { font-size: 14px; }
    :host { display: block; position: relative; }
    .map { cursor: grab; touch-action: none; position: absolute; inset: 0; isolation: isolate; background: #1c1c1e; }
  `,
})
export class MacMap implements OnDestroy {
  readonly latitude = input.required<number>();
  readonly longitude = input.required<number>();
  readonly name = input('MAC');
  readonly shapes = input<MapShape[]>([]);
  readonly selected = input<string | null>(null);
  readonly picked = output<string>();
  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');
  private map: L.Map | null = null;
  private marker: L.CircleMarker | null = null;
  private layer = L.featureGroup();
  private polygons = new Map<string, L.Polygon>();
  private strokes = new Map<string, string>();
  private fitted = false;

  constructor() {
    effect(() => {
      const target = L.latLng(this.latitude(), this.longitude());
      if (!this.map) {
        const map = L.map(this.box().nativeElement, { zoomControl: true, scrollWheelZoom: false }).setView(target, 16);
        map.attributionControl.setPrefix(false);
        L.tileLayer(ESRI_TILES, { maxZoom: 19, attribution: 'Tiles &copy; Esri' }).addTo(map);
        L.tileLayer(ESRI_LABELS, { maxZoom: 19 }).addTo(map);
        this.layer.addTo(map);
        // Drag to move and use the buttons any time; the wheel zooms once the map is clicked, so the page still scrolls past it.
        map.dragging.enable();
        map.on('mousedown', () => map.scrollWheelZoom.enable());
        map.on('mouseout', () => map.scrollWheelZoom.disable());
        this.map = map;
        const zoomClass = () => {
          const z = map.getZoom();
          const el = this.box().nativeElement;
          el.classList.toggle('zoom-low', z < 17);
          el.classList.toggle('zoom-high', z >= 19);
        };
        map.on('zoomend', zoomClass);
        zoomClass();
        new ResizeObserver(() => map.invalidateSize()).observe(this.box().nativeElement);
      } else if (!this.shapes().length) {
        this.map.setView(target, this.map.getZoom());
      }
      this.marker?.remove();
      this.marker = L.circleMarker(target, { radius: 9, color: '#fff', weight: 3, fillColor: '#0066d9', fillOpacity: 1 })
        .bindTooltip(this.name(), { permanent: true, direction: 'top', offset: [0, -10] })
        .addTo(this.map);
      if (this.shapes().length) this.marker.remove();
    });

    effect(() => {
      const shapes = this.shapes();
      const map = this.map;
      if (!map) return;
      this.layer.clearLayers();
      this.polygons.clear();
      this.strokes.clear();
      for (const shape of shapes) {
        const polygon = L.polygon(shape.points, { color: shape.stroke, weight: 1.5, fillColor: shape.fill, fillOpacity: 0.55 })
          .bindTooltip(shape.label, { permanent: true, direction: 'center', className: 'plot-label' })
          .on('click', () => this.picked.emit(shape.id))
          .addTo(this.layer);
        this.polygons.set(shape.id, polygon);
        this.strokes.set(shape.id, shape.stroke);
      }
      if (shapes.length && !this.fitted) {
        map.fitBounds(this.layer.getBounds(), { padding: [20, 20], maxZoom: 18 });
        this.fitted = true;
      }
    });

    effect(() => {
      this.shapes();
      const id = this.selected();
      for (const [key, polygon] of this.polygons) {
        const on = key === id;
        polygon.setStyle({ weight: on ? 4 : 1.5, color: on ? '#ffffff' : (this.strokes.get(key) ?? '#fff') });
        if (on) polygon.bringToFront();
      }
    });
  }

  ngOnDestroy() {
    this.map?.remove();
    this.map = null;
  }
}
