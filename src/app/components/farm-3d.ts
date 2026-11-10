import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, input, output, signal, untracked, viewChild, ViewEncapsulation } from '@angular/core';

import type { ZoneCell, ZoneLayout } from '../zonemap/zone-layout';
import { bedState, buildFarm, type BedState } from '../zonemap/farm/farm-build';
import { FarmEngine } from '../zonemap/farm/farm-engine';
import { layFarm } from '../zonemap/farm/farm-scene';
import { Icon } from './icon';

/** What each bed's colour means: the system's drawn-farm legend (Staff_Attention_UI, FARM_LEGEND). */
export const FARM_LEGEND = [
  { fill: '#ddc29c', label: 'Not planted', stroke: '#c8a57a' },
  { fill: '#8fcd77', label: 'Planting', stroke: '#62a64f' },
  { fill: '#f0c95e', label: 'Harvest', stroke: '#d4a434' },
  { fill: '#8fd0f7', label: 'Water', stroke: '#62b0e2' },
  { fill: '#e3ead8', label: 'Not used', stroke: '#c3cdb5' },
] as const;

const STAGE_WORDS: Record<BedState, string> = { harvest: 'Harvest', planting: 'Planting', soil: 'Not planted', unused: 'Not used' };

/**
 * The Zone Map's drawn farm, as the system's (Staff_Attention_UI, zone-map/FarmCanvas): the zones as fields of
 * beds on an endless green land, in 3D, the plants and grass swaying in the wind. It opens looking straight down
 * and tips back into the isometric view while the plants grow up. Drag to move round, scroll or pinch to zoom,
 * shift-drag to turn; point at a bed to see what it is, tap it for its details.
 */
@Component({
  selector: 'app-farm-3d',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="f3-box" #box role="img" aria-label="The farm in 3D: every zone a field of beds"></div>
    <div class="f3-tags" #tags aria-hidden="true"></div>
    @if (tip(); as tip) {
      <div class="f3-tip" [style.transform]="'translate3d(' + (tip.x + 14) + 'px, ' + (tip.y + 14) + 'px, 0)'">
        <strong>{{ tip.name }}</strong><span>{{ tip.stage }}</span>
      </div>
    }
    <div class="f3-legend" aria-label="What the colours mean">
      @for (entry of legend; track entry.label) {
        <span><i [style.background]="entry.fill" [style.border-color]="entry.stroke"></i>{{ entry.label }}</span>
      }
    </div>
    <div class="f3-tools" role="group" aria-label="Zoom and turn">
      <button type="button" class="f3-icon" title="Zoom out" aria-label="Zoom out" (click)="run('zoomOut')"><app-icon name="minus" [size]="14" /></button>
      <span class="f3-zoom" aria-live="off">{{ percent() }}%</span>
      <button type="button" class="f3-icon" title="Zoom in" aria-label="Zoom in" (click)="run('zoomIn')"><app-icon name="plus" [size]="14" /></button>
      <span class="f3-sep"></span>
      <button type="button" class="f3-icon" title="Turn left" aria-label="Turn left" (click)="run('turnLeft')"><app-icon name="rotate-ccw" [size]="14" /></button>
      <button type="button" class="f3-icon" title="Turn right" aria-label="Turn right" (click)="run('turnRight')"><app-icon name="rotate-cw" [size]="14" /></button>
      <span class="f3-sep"></span>
      <button type="button" title="Bring the whole farm into view" (click)="run('fit')"><app-icon name="scan" [size]="13" /> Fit</button>
    </div>
  `,
  styles: `
    app-farm-3d { display: block; position: relative; overflow: hidden; background: #a8d484; }
    .f3-box { position: absolute; inset: 0; }
    .f3-tags { position: absolute; inset: 0; z-index: 2; overflow: hidden; pointer-events: none; }
    /* A zone block's name, as the web's: white, its section's colour round the edge and in its dot and text. */
    .farm-tag { position: absolute; top: 0; left: 0; display: inline-flex; align-items: center; gap: 6px; padding: 3px 11px 3px 9px; background: #fff; border: 2px solid var(--edge, #ccc); border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; box-shadow: 0 3px 10px rgba(15, 23, 42, 0.25); will-change: transform; visibility: hidden; }
    .farm-tag i { width: 8px; height: 8px; border-radius: 50%; }
    .f3-tip { position: absolute; top: 0; left: 0; z-index: 4; display: flex; flex-direction: column; gap: 1px; padding: 5px 10px; background: var(--surface-solid, #fff); border: var(--hairline, 1px) solid var(--border, #e5e5ea); border-radius: 10px; box-shadow: 0 6px 16px rgba(15, 23, 42, 0.18); font-size: 12px; line-height: 1.3; pointer-events: none; white-space: nowrap; }
    .f3-tip strong { font-weight: 700; color: var(--text, #1d1d1f); }
    .f3-tip span { color: var(--text-muted, #6e6e73); }
    .f3-tools { position: absolute; z-index: 5; right: 12px; bottom: 16px; height: 38px; box-sizing: border-box; display: inline-flex; align-items: center; gap: 2px; padding: 3px; background: var(--surface-solid); border: var(--hairline) solid var(--border); border-radius: 999px; box-shadow: var(--shadow-card); }
    .f3-tools button { display: inline-flex; align-items: center; gap: 5px; padding: 5px 12px; border: 0; border-radius: 999px; background: transparent; color: var(--text-muted); font: inherit; font-size: 0.8125rem; font-weight: 500; cursor: pointer; }
    .f3-tools button:hover { background: var(--surface-hover, #f2f2f4); color: var(--text, #1d1d1f); }
    .f3-tools button.f3-icon { padding: 5px 8px; }
    .f3-zoom { min-width: 40px; text-align: center; font-size: 0.8125rem; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text, #1d1d1f); }
    .f3-sep { width: 1px; height: 16px; background: var(--border); margin: 0 4px; }
    /* The legend on the same line as the tools, keeping clear of them. */
    .f3-legend { position: absolute; left: 12px; bottom: 16px; z-index: 5; display: flex; align-items: center; gap: 14px; height: 38px; box-sizing: border-box; padding: 0 14px; overflow-x: auto; scrollbar-width: none; background: rgba(255, 255, 255, 0.92); border-radius: 999px; font-size: 12px; font-weight: 500; width: fit-content; max-width: calc(100% - 12px - 300px); }
    .f3-legend span { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
    .f3-legend i { width: 14px; height: 10px; border-radius: 3px; border: 1px solid; }
  `,
})
export class Farm3d {
  /** The zones' plots (the Zones and Zone Records tables). */
  readonly layout = input.required<ZoneLayout>();
  /** The plot picked (its id), lit on its bed. */
  readonly selected = input<string | null>(null);
  readonly picked = output<string>();
  readonly cleared = output<void>();

  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');
  private readonly tags = viewChild.required<ElementRef<HTMLElement>>('tags');
  private engine: FarmEngine | null = null;
  private readonly ready = signal(false);
  private cells = new Map<string, ZoneCell>();

  readonly legend = FARM_LEGEND;
  private readonly zoom = signal(1);
  readonly percent = computed(() => Math.round(this.zoom() * 100));
  readonly tip = signal<{ name: string; stage: string; x: number; y: number } | null>(null);

  constructor() {
    afterNextRender(() => {
      this.engine = new FarmEngine(this.box().nativeElement, this.tags().nativeElement, {
        onFirstFrame: () => undefined,
        onHover: (id, x, y) => this.hover(id, x, y),
        onPick: (id) => (id ? this.picked.emit(id) : this.cleared.emit()),
        onZoom: (k) => this.zoom.set(k),
      });
      this.ready.set(true);
    });
    effect(() => {
      const layout = this.layout();
      if (!this.ready()) return;
      untracked(() => this.show(layout));
    });
    effect(() => {
      const id = this.selected();
      if (!this.ready()) return;
      untracked(() => this.engine?.setSelected(id));
    });
    inject(DestroyRef).onDestroy(() => {
      this.engine?.dispose();
      this.engine = null;
    });
  }

  run(command: 'zoomIn' | 'zoomOut' | 'fit' | 'turnLeft' | 'turnRight') {
    this.engine?.run(command);
  }

  private show(layout: ZoneLayout) {
    this.cells = new Map(layout.cells.map((cell): [string, ZoneCell] => [cell.id, cell]));
    const { blocks, places } = layFarm(layout);
    this.engine?.setFarm(buildFarm(blocks, places));
    this.engine?.setSelected(this.selected());
    this.tip.set(null);
  }

  private hover(id: string | null, x: number, y: number) {
    const cell = id ? this.cells.get(id) : undefined;
    this.tip.set(cell ? { name: cell.usage === 'normal' ? cell.plot : cell.label, stage: STAGE_WORDS[bedState(cell)], x, y } : null);
  }
}
