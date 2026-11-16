import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface SparkPoint {
  label: string;
  value: number;
}

/**
 * A mini bar graph for a table cell: one thin bar for each point, the tallest filling the height. Pointing at a bar says what it
 * is (the day and its amount). It has no axes: it shows the shape (when, and how much), the table beside it gives the numbers.
 */
@Component({
  selector: 'app-spark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg class="spark" [attr.viewBox]="'0 0 ' + width() + ' ' + height()" [style.width.px]="width()" [style.height.px]="height()" role="img" [attr.aria-label]="summary()">
      <line class="base" x1="0" [attr.x2]="width()" [attr.y1]="height() - 0.5" [attr.y2]="height() - 0.5" />
      @for (bar of bars(); track bar.label) {
        <g class="bar">
          <rect class="slot" [attr.x]="bar.x" y="0" [attr.width]="bar.slot" [attr.height]="height()" />
          <rect class="mark" [attr.x]="bar.x + bar.gap" [attr.y]="bar.y" [attr.width]="bar.w" [attr.height]="bar.h" rx="1.5" />
          <title>{{ bar.label }}: {{ bar.text }}</title>
        </g>
      }
    </svg>
  `,
  styles: `
    :host { display: inline-block; vertical-align: middle; line-height: 0; }
    .base { stroke: var(--border); stroke-width: 1; }
    .slot { fill: transparent; }
    .mark { fill: var(--accent); opacity: 0.78; transition: opacity var(--dur-fast) var(--ease); }
    .bar:hover .mark { opacity: 1; }
    .bar:hover .slot { fill: color-mix(in srgb, var(--accent) 8%, transparent); }
  `,
})
export class Spark {
  readonly points = input.required<readonly SparkPoint[]>();
  readonly width = input(200);
  readonly height = input(36);

  readonly bars = computed(() => {
    const points = this.points();
    const height = this.height();
    if (!points.length) return [];
    const max = Math.max(...points.map((point) => point.value), 0) || 1;
    const slot = this.width() / points.length;
    const gap = Math.min(1, slot * 0.2);
    const w = Math.max(1.5, slot - gap * 2);
    return points.map((point, index) => {
      // A bar is at least 2px (a small value is still seen), none for zero.
      const h = point.value > 0 ? Math.max(2, (point.value / max) * (height - 3)) : 0;
      return { label: point.label, text: format(point.value), x: index * slot, slot, gap, w, h, y: height - 1 - h };
    });
  });

  readonly summary = computed(() => {
    const points = this.points();
    if (!points.length) return 'No readings';
    return `${points.length} reading${points.length === 1 ? '' : 's'}, from ${points[0].label} to ${points[points.length - 1].label}`;
  });
}

function format(value: number) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
}
