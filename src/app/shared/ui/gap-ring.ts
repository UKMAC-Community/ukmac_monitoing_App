import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** A round gauge: the share filled, drawn as an arc over a track (a partly filled one never reads 0% or 100%). */
@Component({
  selector: 'app-gap-ring',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 36 36" [style.width.px]="size()" [style.height.px]="size()" aria-hidden="true">
      <circle class="track" cx="18" cy="18" r="15.9155" />
      <circle class="arc" [class]="tone()" cx="18" cy="18" r="15.9155" [attr.stroke-dasharray]="share() + ' ' + (100 - share())" />
    </svg>
    <span class="pct" [style.font-size.px]="size() * (label() === '100%' ? 0.22 : 0.27)">{{ label() }}</span>
  `,
  styles: `
    :host { position: relative; display: inline-grid; place-items: center; flex: none; }
    svg { transform: rotate(-90deg); display: block; }
    circle { fill: none; stroke-width: 4; }
    .track { stroke: var(--border); }
    .arc { stroke-linecap: butt; transition: stroke-dasharray var(--dur) var(--ease); }
    .arc.danger { stroke: var(--danger); }
    .arc.warning { stroke: var(--warning); }
    .arc.success { stroke: var(--success); }
    .pct { position: absolute; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text); }
  `,
})
export class GapRing {
  readonly filled = input.required<number>();
  readonly total = input.required<number>();
  readonly tone = input<'danger' | 'warning' | 'success'>('warning');
  readonly size = input(44);
  readonly share = computed(() => (this.total() ? Math.min(100, (this.filled() / this.total()) * 100) : 0));
  readonly label = computed(() => {
    const share = this.share();
    if (share >= 100) return '100%';
    return `${Math.min(99, Math.max(share > 0 ? 1 : 0, Math.round(share)))}%`;
  });
}
