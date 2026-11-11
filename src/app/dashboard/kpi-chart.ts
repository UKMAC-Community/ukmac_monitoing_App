import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import type { KpiVisual } from '../core/models';
import { sectionPalette } from '../zonemap/zone-layout';
import { BAD_COLOR, formatNumber, GOOD_COLOR, KPI_PALETTE, seriesColour, type ChartPoint, type ChartSeries } from './dashboard-model';

const HEIGHT = 230;
const MAX_GROUPS = 12;

/** Dark writing on a light colour, white on a dark one. */
function inkOn(hex: string): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return '#252423';
  const value = parseInt(match[1], 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.52 ? '#1f1f1f' : '#ffffff';
}
/** A timeline's room for each day: enough to name it ("05/09/2026"). */
const DAY_SLOT = 76;

/** A nice round top for an axis: 1, 2, 2.5 or 5 × a power of ten. */
function niceMax(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((n) => n * power >= value)!;
  const rounded = step * power;
  return Number.isFinite(rounded) ? rounded : value;
}

function short(label: string, length: number) {
  return label.length > length ? `${label.slice(0, length - 1)}…` : label;
}

/** Charts that read in the order the groups come (a trend), so they keep every group instead of the largest. */
const IN_ORDER: KpiVisual[] = ['line', 'area', 'waterfall'];

interface Tile {
  key?: string;
  label: string;
  value: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Boxes sized by value, each as square as can be (the squarified treemap) inside `w` × `h`. */
function squarify(items: { key?: string; label: string; value: number }[], w: number, h: number): Tile[] {
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
  const nodes = items.map((item) => ({ ...item, area: (item.value / total) * w * h }));
  const out: Tile[] = [];
  let x = 0;
  let y = 0;
  let room = { w, h };
  let row: typeof nodes = [];
  const worst = (cells: typeof nodes, side: number) => {
    const sum = cells.reduce((a, cell) => a + cell.area, 0);
    const big = Math.max(...cells.map((cell) => cell.area));
    const small = Math.min(...cells.map((cell) => cell.area));
    return Math.max((side * side * big) / (sum * sum), (sum * sum) / (side * side * small));
  };
  const place = (cells: typeof nodes) => {
    const sum = cells.reduce((a, cell) => a + cell.area, 0);
    if (room.w >= room.h) {
      const width = sum / room.h;
      let top = y;
      for (const cell of cells) {
        out.push({ key: cell.key, label: cell.label, value: cell.value, x, y: top, w: width, h: cell.area / width });
        top += cell.area / width;
      }
      x += width;
      room = { w: room.w - width, h: room.h };
    } else {
      const height = sum / room.w;
      let left = x;
      for (const cell of cells) {
        out.push({ key: cell.key, label: cell.label, value: cell.value, x: left, y, w: cell.area / height, h: height });
        left += cell.area / height;
      }
      y += height;
      room = { w: room.w, h: room.h - height };
    }
  };
  for (const node of nodes) {
    const side = Math.min(room.w, room.h);
    if (row.length && worst([...row, node], side) > worst(row, side)) {
      place(row);
      row = [node];
    } else {
      row.push(node);
    }
  }
  if (row.length) place(row);
  return out;
}

/** A KPI chart, as Power BI draws its visuals: column, bar, line, pie or donut, in its colours. */
@Component({
  selector: 'app-kpi-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visual() === 'gauge') {
      @if (gaugeData(); as g) {
        <svg [attr.width]="width()" height="170" role="img" [attr.aria-label]="label()">
          <path [attr.d]="g.track" fill="none" stroke="#e1dfdd" stroke-width="20" stroke-linecap="round" />
          @if (g.frac > 0) {
            <path [attr.d]="g.arc" fill="none" [attr.stroke]="g.colour" stroke-width="20" stroke-linecap="round" />
          }
          @if (g.goal) {
            <line [attr.x1]="g.goal.x1" [attr.y1]="g.goal.y1" [attr.x2]="g.goal.x2" [attr.y2]="g.goal.y2" stroke="#252423" stroke-width="2.5" />
          }
          <text class="big-value" [attr.x]="g.cx" [attr.y]="g.cy - 14" text-anchor="middle">{{ g.valueText }}</text>
          @if (g.goal) {
            <text class="axis" [attr.x]="g.cx" [attr.y]="g.cy + 6" text-anchor="middle">Goal: {{ g.goal.text }}</text>
          }
          <text class="axis" [attr.x]="g.cx - g.r" [attr.y]="g.cy + 22" text-anchor="middle">0</text>
          <text class="axis" [attr.x]="g.cx + g.r" [attr.y]="g.cy + 22" text-anchor="middle">{{ g.maxText }}</text>
        </svg>
      }
    } @else if (!points().length) {
      <p class="none">No rows to chart yet.</p>
    } @else if (visual() === 'pie' && labelled()) {
      <!-- A pie as Google's: each slice drawn plain, its name and amount outside on a line to it. -->
      <svg class="pie" [attr.width]="width()" [attr.height]="pie().height" [attr.viewBox]="'0 0 ' + width() + ' ' + pie().height" role="img" [attr.aria-label]="label()">
        <g [attr.transform]="'translate(' + pie().cx + ' ' + pie().cy + ') scale(' + pie().r + ')'">
          @for (item of pie().items; track item.label; let i = $index) {
            <path [attr.d]="item.path" [attr.fill]="sliceColour(item.label, i)" stroke="#fff" stroke-width="0.03" stroke-linejoin="round" [class.hit]="hit(item.key)" [class.dim]="dim(item.key)" (click)="choose(item, $event)">
              <title>{{ sliceName(item.label) }}: {{ format(item.value) }} ({{ item.share }}%)</title>
            </path>
          }
        </g>
        @for (item of pie().items; track item.label; let i = $index) {
          <polyline [attr.points]="item.leader" fill="none" stroke="#c4c8cc" stroke-width="1" [class.dim]="dim(item.key)" />
          <circle [attr.cx]="item.dot.x" [attr.cy]="item.dot.y" r="2" fill="#fff" stroke="#9aa0a6" stroke-width="1.25" [class.dim]="dim(item.key)" />
          <g [class.hit]="hit(item.key)" [class.dim]="dim(item.key)" (click)="choose(item, $event)">
            <text class="pie-name" [attr.x]="item.text.x" [attr.y]="item.text.y - 5" [attr.text-anchor]="item.text.anchor">{{ sliceName(item.label) }}</text>
            <text class="pie-share" [attr.x]="item.text.x" [attr.y]="item.text.y + 13" [attr.text-anchor]="item.text.anchor">{{ format(item.value) }}</text>
          </g>
        }
      </svg>
    } @else if (visual() === 'pie' || visual() === 'donut') {
      <div class="round">
        <svg [attr.width]="pieSize" [attr.height]="pieSize" [attr.viewBox]="'0 0 ' + pieSize + ' ' + pieSize" role="img" [attr.aria-label]="label()">
          <g [attr.transform]="'translate(' + pieSize / 2 + ' ' + pieSize / 2 + ') scale(' + pieSize / 2 + ')'">
            @for (slice of slices(); track slice.label; let i = $index) {
              <path [attr.d]="slice.path" [attr.fill]="sliceColour(slice.label, i)" stroke="#fff" stroke-width="0.012" [class.hit]="hit(slice.key)" [class.dim]="dim(slice.key)" (click)="choose(slice, $event)">
                <title>{{ sliceName(slice.label) }}: {{ format(slice.value) }} ({{ slice.share }}%)</title>
              </path>
            }
            @if (visual() === 'donut') {
              <circle r="0.58" fill="#fff" />
            }
          </g>
          <!-- The share of each big slice, in it (the small ones are in the list). -->
          @if (visual() === 'pie') {
            @for (slice of slices(); track slice.label; let i = $index) {
              @if (slice.fraction >= 0.07) {
                <text class="pie-percent" [attr.x]="pieSize / 2 + cos(slice.mid) * 0.68 * pieSize / 2" [attr.y]="pieSize / 2 + sin(slice.mid) * 0.68 * pieSize / 2" text-anchor="middle" dominant-baseline="middle" [attr.fill]="inkOf(slice.label, i)" [class.dim]="dim(slice.key)">{{ slice.share }}%</text>
              }
            }
          }
        </svg>
        <ul class="legend">
          @for (slice of slices(); track slice.label; let i = $index) {
            <li [class.hit]="hit(slice.key)" [class.dim]="dim(slice.key)" (click)="choose(slice, $event)">
              <span class="dot" [style.background]="sliceColour(slice.label, i)"></span>
              <span class="name">{{ sliceName(slice.label) }}</span>
              <span class="num">{{ format(slice.value) }}</span>
              <span class="share">{{ slice.share }}%</span>
            </li>
          }
        </ul>
      </div>
    } @else {
      @switch (visual()) {
        @case ('stacked') {
          @if (stack(); as s) {
            <svg [attr.width]="width()" [attr.height]="height" role="img" [attr.aria-label]="label()">
              @for (tick of s.ticks; track $index) {
                <line class="grid" [attr.x1]="left" [attr.x2]="width() - 8" [attr.y1]="tick.y" [attr.y2]="tick.y" />
                <text class="axis" [attr.x]="left - 6" [attr.y]="tick.y + 4" text-anchor="end">{{ tick.label }}</text>
              }
              @for (column of s.columns; track column.label) {
                <g [class.hit]="hit(column.key)" [class.dim]="dim(column.key)" (click)="choose(column, $event)">
                @for (part of column.parts; track part.series) {
                  @if (part.h > 0) {
                    <rect [attr.x]="column.x" [attr.y]="part.y" [attr.width]="column.w" [attr.height]="part.h" [attr.fill]="seriesColour(part.name, part.series)">
                      <title>{{ column.label }} · {{ part.name }}: {{ format(part.value) }}</title>
                    </rect>
                    <!-- Each part's amount, written in it when it is big enough to hold it. -->
                    @if (part.h >= 16 && column.w >= 34) {
                      <text class="segment" [attr.x]="column.x + column.w / 2" [attr.y]="part.y + part.h / 2" text-anchor="middle" dominant-baseline="middle">{{ format(part.value) }}</text>
                    }
                  }
                }
                @if (column.w > 22) {
                  <text class="value" [attr.x]="column.x + column.w / 2" [attr.y]="column.top - 5" text-anchor="middle">{{ format(column.total) }}</text>
                }
                <text class="axis" [attr.x]="column.x + column.w / 2" [attr.y]="height - 8" text-anchor="middle">{{ column.short }}</text>
                </g>
              }
              @if (totalLine() && s.columns.length) {
                <polyline class="total-line" [attr.points]="s.line" fill="none" [attr.stroke]="totalColour" stroke-width="2" stroke-dasharray="7 5" stroke-linecap="round" stroke-linejoin="round" />
                @for (column of s.columns; track column.label) {
                  <circle class="total-line" [attr.cx]="column.x + column.w / 2" [attr.cy]="column.top" r="4" fill="#fff" [attr.stroke]="totalColour" stroke-width="2" />
                }
              }
            </svg>
            <ul class="series-legend">
              @for (name of s.names; track $index; let i = $index) {
                <li><span class="dot" [style.background]="seriesColour(name, i)"></span>{{ name }}</li>
              }
              @if (totalLine()) {
                <li><span class="dash" [style.borderColor]="totalColour"></span>Total</li>
              }
            </ul>
          } @else { <p class="none">Nothing to stack yet.</p> }
        }
        @case ('lollipop') {
          @if (comparison(); as c) {
            <svg [attr.width]="width()" [attr.height]="c.height" role="img" [attr.aria-label]="label() || 'Lollipop chart'">
              <line class="zero" [attr.x1]="c.zero" [attr.x2]="c.zero" y1="0" [attr.y2]="c.height - 28" />
              @for (point of c.rows; track $index; let i = $index) {
                <g [attr.transform]="'translate(0,' + (i * 28 + 4) + ')'" [class.hit]="hit(point.key)" [class.dim]="dim(point.key)" (click)="choose(point, $event)">
                  <text class="axis" x="0" y="16">{{ point.short }}</text>
                  <line [attr.x1]="c.zero" [attr.x2]="point.x" y1="12" y2="12" [attr.stroke]="colour(0)" stroke-width="2.5" />
                  <circle class="comparison-point" [attr.cx]="point.x" cy="12" r="5" [attr.fill]="colour(0)"><title>{{ point.label }}: {{ format(point.value) }}</title></circle>
                  <text class="value" [attr.x]="width() - 4" y="16" text-anchor="end">{{ format(point.value) }}</text>
                </g>
              }
              @for (tick of c.ticks; track $index) {
                <text class="axis" [attr.x]="tick.x" [attr.y]="c.height - 6" text-anchor="middle">{{ tick.label }}</text>
              }
            </svg>
            @if (c.omitted) { <p class="chart-note">Showing the {{ c.rows.length }} largest of {{ c.rows.length + c.omitted }} groups.</p> }
          } @else { <p class="none">No finite values to chart.</p> }
        }
        @case ('dot') {
          @if (comparison(); as c) {
            <svg [attr.width]="width()" [attr.height]="c.height" role="img" [attr.aria-label]="label() || 'Dot plot'">
              <line class="zero" [attr.x1]="c.zero" [attr.x2]="c.zero" y1="0" [attr.y2]="c.height - 28" />
              @for (point of c.rows; track $index; let i = $index) {
                <g [attr.transform]="'translate(0,' + (i * 28 + 4) + ')'" [class.hit]="hit(point.key)" [class.dim]="dim(point.key)" (click)="choose(point, $event)">
                  <text class="axis" x="0" y="16">{{ point.short }}</text>
                  <line class="grid" [attr.x1]="c.left" [attr.x2]="c.right" y1="12" y2="12" />
                  <circle class="comparison-point" [attr.cx]="point.x" cy="12" r="5" [attr.fill]="colour(0)"><title>{{ point.label }}: {{ format(point.value) }}</title></circle>
                  <text class="value" [attr.x]="width() - 4" y="16" text-anchor="end">{{ format(point.value) }}</text>
                </g>
              }
              @for (tick of c.ticks; track $index) {
                <text class="axis" [attr.x]="tick.x" [attr.y]="c.height - 6" text-anchor="middle">{{ tick.label }}</text>
              }
            </svg>
            @if (c.omitted) { <p class="chart-note">Showing the {{ c.rows.length }} largest of {{ c.rows.length + c.omitted }} groups.</p> }
          } @else { <p class="none">No finite values to chart.</p> }
        }
        @case ('pareto') {
          @if (pareto(); as p) {
            <svg [attr.width]="width()" [attr.height]="height" role="img" [attr.aria-label]="label() || 'Pareto chart'">
              @for (tick of p.ticks; track $index) {
                <line class="grid" [attr.x1]="left" [attr.x2]="width() - 44" [attr.y1]="tick.y" [attr.y2]="tick.y" />
                <text class="axis" [attr.x]="left - 6" [attr.y]="tick.y + 4" text-anchor="end">{{ tick.label }}</text>
                <text class="axis" [attr.x]="width() - 38" [attr.y]="tick.y + 4">{{ tick.percent }}%</text>
              }
              @for (point of p.rows; track $index) {
                <rect class="pareto-bar" [class.hit]="hit(point.key)" [class.dim]="dim(point.key)" (click)="choose(point, $event)" [attr.x]="point.x" [attr.y]="point.y" [attr.width]="point.w" [attr.height]="point.h" rx="2" [attr.fill]="colour(0)"><title>{{ point.label }}: {{ format(point.value) }}</title></rect>
                <text class="axis" [attr.x]="point.cx" [attr.y]="height - 8" text-anchor="middle">{{ point.short }}</text>
              }
              <polyline class="cumulative-line" [attr.points]="p.path" fill="none" [attr.stroke]="colour(2)" stroke-width="2.5" stroke-linejoin="round" />
              @for (point of p.rows; track $index) {
                <circle class="cumulative-point" [attr.cx]="point.cx" [attr.cy]="point.cy" r="3.5" [attr.fill]="colour(2)"><title>{{ point.label }}: cumulative {{ point.percent }}%</title></circle>
              }
            </svg>
            <p class="chart-note">Bars: value · Line: cumulative share@if (p.combined) { · Remaining groups combined as Other }</p>
          } @else { <p class="none">Pareto needs non-negative values with a positive total.</p> }
        }
        @case ('polar') {
          @if (polar(); as p) {
            <div class="round">
              <svg [attr.width]="pieSize" [attr.height]="pieSize" viewBox="-1.05 -1.05 2.1 2.1" role="img" [attr.aria-label]="label() || 'Polar area chart'">
                @for (sector of p.sectors; track $index; let i = $index) {
                  <path class="polar-sector" [class.hit]="hit(sector.key)" [class.dim]="dim(sector.key)" (click)="choose(sector, $event)" [attr.d]="sector.path" [attr.fill]="colour(i)" stroke="#fff" stroke-width="0.015"><title>{{ sector.label }}: {{ format(sector.value) }} ({{ sector.percent }}%)</title></path>
                }
              </svg>
              <ul class="legend">
                @for (sector of p.sectors; track $index; let i = $index) {
                  <li [class.hit]="hit(sector.key)" [class.dim]="dim(sector.key)" (click)="choose(sector, $event)"><span class="dot" [style.background]="colour(i)"></span><span class="name" [title]="sector.label">{{ sector.label }}</span><span class="num">{{ format(sector.value) }} · {{ sector.percent }}%</span></li>
                }
              </ul>
            </div>
            <p class="chart-note">Each sector has the same angle; its area represents the value.@if (p.combined) { Remaining groups combined as Other. }</p>
          } @else { <p class="none">Polar area needs non-negative values with a positive total.</p> }
        }
        @case ('bar') {
          <svg [attr.width]="width()" [attr.height]="barHeight()" role="img" [attr.aria-label]="label()">
            @for (bar of bars(); track bar.label; let i = $index) {
              <g [attr.transform]="'translate(0,' + (i * 28 + 4) + ')'" [class.hit]="hit(bar.key)" [class.dim]="dim(bar.key)" (click)="choose(bar, $event)">
                <text class="axis" x="0" y="15">{{ bar.short }}</text>
                <rect [attr.x]="labelWidth" y="3" [attr.width]="bar.size" height="18" rx="2" [attr.fill]="zoneColour(bar.label)">
                  <title>{{ bar.label }}: {{ format(bar.value) }}</title>
                </rect>
                <text class="value" [attr.x]="labelWidth + bar.size + 6" y="16">{{ format(bar.value) }}</text>
              </g>
            }
          </svg>
        }
        @case ('funnel') {
          <svg [attr.width]="width()" [attr.height]="stages().length * 30 + 8" role="img" [attr.aria-label]="label()">
            @for (stage of stages(); track stage.label; let i = $index) {
              <g [attr.transform]="'translate(0,' + (i * 30 + 4) + ')'" [class.hit]="hit(stage.key)" [class.dim]="dim(stage.key)" (click)="choose(stage, $event)">
                <text class="axis" x="0" y="17">{{ stage.short }}</text>
                <rect [attr.x]="stage.x" y="2" [attr.width]="stage.size" height="24" rx="2" [attr.fill]="colour(i)">
                  <title>{{ stage.label }}: {{ format(stage.value) }} ({{ stage.pct }}% of the first)</title>
                </rect>
                <text class="value" [attr.x]="labelWidth + (width() - labelWidth - 60) + 8" y="18">{{ format(stage.value) }}</text>
              </g>
            }
          </svg>
        }
        @case ('treemap') {
          <svg [attr.width]="width()" [attr.height]="height" role="img" [attr.aria-label]="label()">
            @for (tile of tiles(); track tile.label; let i = $index) {
              <rect [class.hit]="hit(tile.key)" [class.dim]="dim(tile.key)" (click)="choose(tile, $event)" [attr.x]="tile.x + 1" [attr.y]="tile.y + 1" [attr.width]="tile.w - 2" [attr.height]="tile.h - 2" rx="3" [attr.fill]="colour(i)">
                <title>{{ tile.label }}: {{ format(tile.value) }}</title>
              </rect>
              @if (tile.w > 56 && tile.h > 34) {
                <text class="tile-label" [attr.x]="tile.x + 8" [attr.y]="tile.y + 18">{{ short(tile.label, tile.w / 7) }}</text>
                <text class="tile-value" [attr.x]="tile.x + 8" [attr.y]="tile.y + 33">{{ format(tile.value) }}</text>
              }
            }
          </svg>
        }
        @case ('radar') {
          @if (radar(); as r) {
            <svg [attr.width]="width()" [attr.height]="height" role="img" [attr.aria-label]="label()">
              @for (ring of r.rings; track $index) {
                <polygon [attr.points]="ring" fill="none" stroke="#e1dfdd" />
              }
              @for (spoke of r.spokes; track spoke.label) {
                <line [attr.x1]="r.cx" [attr.y1]="r.cy" [attr.x2]="spoke.x2" [attr.y2]="spoke.y2" stroke="#e1dfdd" />
                <text class="axis" [attr.x]="spoke.lx" [attr.y]="spoke.ly" [attr.text-anchor]="spoke.anchor">{{ spoke.short }}</text>
              }
              <polygon [attr.points]="r.shape" [attr.fill]="colour(0)" fill-opacity="0.25" [attr.stroke]="colour(0)" stroke-width="2.5" stroke-linejoin="round" />
              @for (spoke of r.spokes; track spoke.label) {
                <circle [attr.cx]="spoke.vx" [attr.cy]="spoke.vy" r="3.5" [attr.fill]="colour(0)" [class.dim]="dim(spoke.key)">
                  <title>{{ spoke.label }}: {{ format(spoke.value) }}</title>
                </circle>
                @if (pickable()) {
                <circle class="target" [class.hit]="hit(spoke.key)" [class.dim]="dim(spoke.key)" (click)="choose(spoke, $event)" [attr.cx]="spoke.vx" [attr.cy]="spoke.vy" r="12" />
              }
              }
            </svg>
          } @else {
            <p class="none">A radar needs at least 3 groups.</p>
          }
        }
        @case ('waterfall') {
          <svg [attr.width]="width()" [attr.height]="height" role="img" [attr.aria-label]="label()">
            @for (tick of wfTicks(); track $index) {
              <line class="grid" [attr.x1]="left" [attr.x2]="width() - 8" [attr.y1]="tick.y" [attr.y2]="tick.y" />
              <text class="axis" [attr.x]="left - 6" [attr.y]="tick.y + 4" text-anchor="end">{{ tick.label }}</text>
            }
            @for (step of steps(); track step.label) {
              <rect [class.hit]="hit(step.key)" [class.dim]="dim(step.key)" (click)="choose(step, $event)" [attr.x]="step.x" [attr.y]="step.y" [attr.width]="step.w" [attr.height]="step.h" rx="2" [attr.fill]="step.colour">
                <title>{{ step.label }}: {{ step.total ? '' : step.value >= 0 ? '+' : '' }}{{ format(step.value) }}</title>
              </rect>
              @if (step.w > 22) {
                <text class="value" [attr.x]="step.x + step.w / 2" [attr.y]="step.y - 5" text-anchor="middle">{{ format(step.value) }}</text>
              }
              <text class="axis" [attr.x]="step.x + step.w / 2" [attr.y]="height - 8" text-anchor="middle">{{ step.short }}</text>
            }
          </svg>
        }
        @case ('area') {
          <svg [attr.width]="width()" [attr.height]="height" role="img" [attr.aria-label]="label()">
            @for (tick of ticks(); track $index) {
              <line class="grid" [attr.x1]="left" [attr.x2]="width() - 8" [attr.y1]="tick.y" [attr.y2]="tick.y" />
              <text class="axis" [attr.x]="left - 6" [attr.y]="tick.y + 4" text-anchor="end">{{ tick.label }}</text>
            }
            <polygon [attr.points]="areaPath()" [attr.fill]="colour(0)" fill-opacity="0.22" />
            <polyline [attr.points]="linePath()" fill="none" [attr.stroke]="colour(0)" stroke-width="2.5" stroke-linejoin="round" />
            @for (dot of dots(); track $index) {
              <circle [attr.cx]="dot.x" [attr.cy]="dot.y" r="3.5" [attr.fill]="colour(0)" [class.dim]="dim(dot.key)">
                <title>{{ dot.label }}: {{ format(dot.value) }}</title>
              </circle>
              @if (pickable()) {
                <circle class="target" [class.hit]="hit(dot.key)" [class.dim]="dim(dot.key)" (click)="choose(dot, $event)" [attr.cx]="dot.x" [attr.cy]="dot.y" r="12" />
              }
              @if (dot.showLabel) {
                <text class="axis" [attr.x]="dot.x" [attr.y]="height - 8" text-anchor="middle">{{ dot.short }}</text>
              }
            }
          </svg>
        }
        @case ('line') {
          <svg [attr.width]="width()" [attr.height]="height" role="img" [attr.aria-label]="label()">
            @for (tick of ticks(); track $index) {
              <line class="grid" [attr.x1]="left" [attr.x2]="width() - 8" [attr.y1]="tick.y" [attr.y2]="tick.y" />
              <text class="axis" [attr.x]="left - 6" [attr.y]="tick.y + 4" text-anchor="end">{{ tick.label }}</text>
            }
            <polyline [attr.points]="linePath()" fill="none" [attr.stroke]="colour(0)" stroke-width="2.5" stroke-linejoin="round" />
            @for (dot of dots(); track $index) {
              <circle [attr.cx]="dot.x" [attr.cy]="dot.y" r="3.5" [attr.fill]="colour(0)" [class.dim]="dim(dot.key)">
                <title>{{ dot.label }}: {{ format(dot.value) }}</title>
              </circle>
              @if (pickable()) {
                <circle class="target" [class.hit]="hit(dot.key)" [class.dim]="dim(dot.key)" (click)="choose(dot, $event)" [attr.cx]="dot.x" [attr.cy]="dot.y" r="12" />
              }
              @if (dot.showLabel) {
                <text class="axis" [attr.x]="dot.x" [attr.y]="height - 8" text-anchor="middle">{{ dot.short }}</text>
              }
            }
          </svg>
        }
        @default {
          @if (timeline()) {
            <div class="timeline">
              <svg class="day-axis" [attr.width]="left" [attr.height]="height" aria-hidden="true">
                @for (tick of days().ticks; track $index) {
                  <text class="axis" [attr.x]="left - 6" [attr.y]="tick.y + 4" text-anchor="end">{{ tick.label }}</text>
                }
              </svg>
              <div class="day-scroll">
                <svg [attr.width]="days().width" [attr.height]="height" role="img" [attr.aria-label]="label()">
                  @for (tick of days().ticks; track $index) {
                    <line class="grid" x1="0" [attr.x2]="days().width" [attr.y1]="tick.y" [attr.y2]="tick.y" />
                  }
                  @for (column of days().columns; track column.label) {
                    @if (!column.empty) {
                      <rect [attr.x]="column.x" [attr.y]="column.y" [attr.width]="column.w" [attr.height]="column.h" rx="2" [attr.fill]="colour(0)" [class.hit]="hit(column.key)" [class.dim]="dim(column.key)" (click)="choose(column, $event)">
                        <title>{{ column.label }}: {{ format(column.value) }}</title>
                      </rect>
                      <text class="value" [attr.x]="column.mid" [attr.y]="column.y - 5" text-anchor="middle">{{ format(column.value) }}</text>
                    }
                    <text class="axis" [attr.x]="column.mid" [attr.y]="height - 8" text-anchor="middle">{{ column.name }}</text>
                  }
                </svg>
              </div>
            </div>
          } @else {
            <svg [attr.width]="width()" [attr.height]="height" role="img" [attr.aria-label]="label()">
              @for (tick of ticks(); track $index) {
                <line class="grid" [attr.x1]="left" [attr.x2]="width() - 8" [attr.y1]="tick.y" [attr.y2]="tick.y" />
                <text class="axis" [attr.x]="left - 6" [attr.y]="tick.y + 4" text-anchor="end">{{ tick.label }}</text>
              }
              @for (column of columns(); track column.label) {
                <rect [attr.x]="column.x" [attr.y]="column.y" [attr.width]="column.w" [attr.height]="column.h" rx="2" [attr.fill]="zoneColour(column.label)" [class.hit]="hit(column.key)" [class.dim]="dim(column.key)" (click)="choose(column, $event)">
                  <title>{{ column.label }}: {{ format(column.value) }}</title>
                </rect>
                @if (column.w > 22) {
                  <text class="value" [attr.x]="column.x + column.w / 2" [attr.y]="column.y - 5" text-anchor="middle">{{ format(column.value) }}</text>
                }
                <text class="axis" [attr.x]="column.x + column.w / 2" [attr.y]="height - 8" text-anchor="middle">{{ column.short }}</text>
              }
            </svg>
          }
        }
      }
    }

  `,
  styles: `
    :host { display: block; min-width: 0; }
    svg { display: block; overflow: visible; }
    .total-line { pointer-events: none; }
    .hit { cursor: pointer; }
    .dim { opacity: 0.3; }
    .target { fill: transparent; pointer-events: none; }
    .target.hit { pointer-events: all; }
    .grid { stroke: #e1dfdd; stroke-width: 1; }
    .timeline { display: flex; }
    .day-axis { flex: none; }
    .day-scroll { flex: 1; min-width: 0; overflow-x: auto; overflow-y: hidden; padding-bottom: 6px; }
    .zero { stroke: #8b9390; stroke-width: 1; }
    .chart-note { font-size: 11px; color: #605e5c; line-height: 1.45; margin: 6px 0 0; }
    .axis { font-size: 11px; fill: #605e5c; }
    .value { font-size: 11px; fill: #252423; font-weight: 600; paint-order: stroke; stroke: #fff; stroke-width: 3px; stroke-linejoin: round; }
    .big-value { font-size: 30px; fill: #252423; font-weight: 600; font-variant-numeric: tabular-nums; }
    .tile-label { font-size: 11px; fill: #fff; font-weight: 600; }
    .tile-value { font-size: 11px; fill: #fff; opacity: 0.85; }
    .series-legend { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 8px 0 0 44px; font-size: 12px; color: #252423; }
    .series-legend li { display: inline-flex; align-items: center; gap: 6px; }
    .segment { font-size: 11px; font-weight: 600; fill: #fff; pointer-events: none; }
    .none { font-size: 0.8125rem; color: #605e5c; padding: 40px 0; text-align: center; }
    .pie { display: block; margin: 0 auto; }
    .pie-name { font-size: 13px; font-weight: 500; fill: #252423; letter-spacing: 0.01em; }
    .pie-share { font-size: 12px; fill: #8a8886; font-variant-numeric: tabular-nums; }
    .pie path.hit, .pie g.hit { cursor: pointer; }
    .pie .dim { opacity: 0.35; }
    .pie-percent { font-size: 13px; font-weight: 600; pointer-events: none; }
    .round { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 24px; min-height: 220px; }
    .legend { flex: 1; min-width: 180px; display: flex; flex-direction: column; gap: 4px; max-height: 420px; overflow: auto; }
    .legend li { display: flex; align-items: center; gap: 10px; padding: 3px 4px; border-radius: 6px; font-size: 14px; color: #252423; }
    .legend .share { width: 46px; text-align: right; color: #8a8886; font-variant-numeric: tabular-nums; }
    /* The total line's key: a short dashed line, as it is drawn. */
    .dash { width: 18px; height: 0; border-top: 2px dashed; flex: none; }
    .dot { width: 12px; height: 12px; border-radius: 50%; flex: none; }
    .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .num { color: #605e5c; font-variant-numeric: tabular-nums; white-space: nowrap; }
  `,
})
export class KpiChart {
  readonly points = input.required<ChartPoint[]>();
  /** A stacked column chart's values (each over the same groups): stacked on each other, the first at the bottom. */
  readonly series = input<ChartSeries[]>([]);
  readonly visual = input<KpiVisual>('column');
  /** A column chart of days drawn as a timeline: every day has its place, the days with no rows left empty. */
  readonly timeline = input(false);
  readonly decimals = input<number | null>(null);
  readonly label = input('');
  /** A gauge's number, and the goal it is on its way to. */
  readonly value = input<number | null>(null);
  readonly goal = input<number | null>(null);
  /** The groups lit (their keys): the others are dimmed, as Power BI shows what a click on a group keeps. */
  readonly selected = input<readonly string[]>([]);
  /** Whether a click on a group is heard (off in Edit dashboard, where a click picks the tile). */
  readonly pickable = input(false);
  /** A stacked chart's totals as a line over its columns. */
  readonly totalLine = input(false);
  /** Columns and bars named by a zone number take that zone's colour from the Zone Map. */
  readonly zoneColours = input(false);
  /** The total line over the stacks: a dashed dark line with open dots, apart from the red and green parts it adds up. */
  readonly totalColour = '#323130';
  /** A group was clicked; `additive`: with Ctrl / ⌘ / Shift held, to add it to the ones lit. */
  readonly groupClick = output<{ key: string; label: string; additive: boolean }>();

  readonly height = HEIGHT;
  readonly left = 44;
  readonly labelWidth = 110;
  readonly pieSize = 200;
  readonly width = signal(480);

  constructor() {
    const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const observer = new ResizeObserver(() => this.width.set(Math.max(240, Math.floor(host.clientWidth))));
      observer.observe(host);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  hit(key: string | undefined) {
    return this.pickable() && key !== undefined;
  }

  dim(key: string | undefined) {
    return this.selected().length > 0 && (key === undefined || !this.selected().includes(key));
  }

  choose(point: { key?: string; label: string }, event: Event) {
    if (!this.hit(point.key)) return;
    event.stopPropagation();
    const mouse = event as MouseEvent;
    this.groupClick.emit({ key: point.key!, label: point.label, additive: mouse.ctrlKey || mouse.metaKey || mouse.shiftKey });
  }

  readonly seriesColour = seriesColour;

  /** The chart's colour for a group; a zone number (when the chart is of zones) in its zone's colour. */
  zoneColour(label: string) {
    const section = /^\d+$/.test(label.trim()) ? Number(label) : null;
    return this.zoneColours() && section ? sectionPalette(section).bg : this.colour(0);
  }

  colour(index: number) {
    return KPI_PALETTE[index % KPI_PALETTE.length];
  }

  /** A pie's slice colour: a zone number (when the chart is of zones) in its zone's colour, else the palette's. */
  sliceColour(label: string, index: number) {
    const section = /^\d+$/.test(label.trim()) ? Number(label) : null;
    return this.zoneColours() && section ? sectionPalette(section).bg : this.colour(index);
  }

  readonly cos = Math.cos;
  readonly sin = Math.sin;

  /** The writing on a pie slice: dark on a light colour, white on a dark one. */
  inkOf(label: string, index: number) {
    return inkOn(this.sliceColour(label, index));
  }

  /** A pie's slice name: a zone number is "Zone 3". */
  sliceName(label: string) {
    return this.zoneColours() && /^\d+$/.test(label.trim()) ? `Zone ${label.trim()}` : label;
  }

  format(value: number) {
    return formatNumber(value, this.decimals());
  }

  /** `short` for the template. */
  readonly short = short;

  /** At most 12 groups: the largest, then the rest as Other (a trend keeps every one: it's in order). */
  private readonly grouped = computed(() => {
    const points = this.points();
    if (points.length <= MAX_GROUPS || IN_ORDER.includes(this.visual())) return points;
    const sorted = [...points].sort((a, b) => b.value - a.value);
    const rest = sorted.slice(MAX_GROUPS - 1).reduce((sum, point) => sum + point.value, 0);
    return [...sorted.slice(0, MAX_GROUPS - 1), { label: 'Other', value: rest }];
  });

  private readonly top = computed(() => niceMax(Math.max(0, ...this.grouped().map((point) => point.value))));

  readonly ticks = computed(() => {
    const top = this.top();
    const plot = HEIGHT - 28 - 16;
    return [0, 1, 2, 3, 4].map((step) => ({
      y: 16 + plot - (plot * step) / 4,
      label: formatNumber((top * step) / 4, top < 4 ? 2 : 0),
    }));
  });

  readonly columns = computed(() => {
    const points = this.grouped();
    const plotWidth = this.width() - this.left - 8;
    const plot = HEIGHT - 28 - 16;
    const slot = plotWidth / points.length;
    const w = Math.max(4, Math.min(64, slot * 0.62));
    const chars = Math.max(4, Math.floor(slot / 6.5));
    return points.map((point, index) => {
      const h = (Math.max(0, point.value) / this.top()) * plot;
      return {
        ...point,
        short: short(point.label, chars),
        x: this.left + slot * index + (slot - w) / 2,
        w,
        h,
        y: 16 + plot - h,
      };
    });
  });

  /** A timeline: a place of its own for every day, wide enough to name it, so a long stretch scrolls sideways. */
  readonly days = computed(() => {
    const points = this.points();
    const plot = HEIGHT - 28 - 16;
    const top = niceMax(Math.max(0, ...points.map((point) => point.value)));
    const w = Math.min(40, DAY_SLOT * 0.62);
    let year = '';
    const columns = points.map((point, index) => {
      // "05/09" under each day; the year too on the first and where it changes.
      const iso = point.key && /^\d{4}-\d{2}-\d{2}$/.test(point.key) ? point.key : null;
      const name = iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}${iso.slice(0, 4) !== year ? `/${iso.slice(0, 4)}` : ''}` : point.label;
      if (iso) year = iso.slice(0, 4);
      const h = point.empty ? 0 : (Math.max(0, point.value) / top) * plot;
      return { ...point, name, h, y: 16 + plot - h, w, x: 8 + DAY_SLOT * index + (DAY_SLOT - w) / 2, mid: 8 + DAY_SLOT * index + DAY_SLOT / 2 };
    });
    return {
      columns,
      // Never narrower than the room there is, so a few days still fill the line.
      width: Math.max(this.width() - this.left, 16 + DAY_SLOT * points.length),
      ticks: [0, 1, 2, 3, 4].map((step) => ({
        y: 16 + plot - (plot * step) / 4,
        label: formatNumber((top * step) / 4, top < 4 ? 2 : 0),
      })),
    };
  });

  /** The stacked columns: a group's values on top of each other, the scale from 0 to the tallest stack. */
  readonly stack = computed(() => {
    const series = this.series();
    const keys = series[0]?.points.map((point) => point.key) ?? [];
    const labels = series[0]?.points.map((point) => point.label) ?? [];
    if (!labels.length) return null;
    const totals = labels.map((_, index) => series.reduce((sum, item) => sum + Math.max(0, item.points[index]?.value ?? 0), 0));
    const top = niceMax(Math.max(0, ...totals));
    const plot = HEIGHT - 28 - 16;
    const slot = (this.width() - this.left - 8) / labels.length;
    const w = Math.max(4, Math.min(labels.length === 1 ? 110 : 64, slot * 0.62));
    const chars = Math.max(4, Math.floor(slot / 6.5));
    const ticks = [0, 1, 2, 3, 4].map((step) => ({
      y: 16 + plot - (plot * step) / 4,
      label: formatNumber((top * step) / 4, top < 4 ? 2 : 0),
    }));
    const columns = labels.map((label, index) => {
      let base = 16 + plot;
      const parts = series.map((item, seriesIndex) => {
        const value = item.points[index]?.value ?? 0;
        const h = (Math.max(0, value) / top) * plot;
        base -= h;
        return { series: seriesIndex, name: item.label, value, h, y: base };
      });
      return { key: keys[index], label, short: short(label, chars), total: totals[index], top: base, x: this.left + slot * index + (slot - w) / 2, w, parts };
    });
    return { ticks, columns, line: columns.map((column) => `${column.x + column.w / 2},${column.top}`).join(' '), names: series.map((item) => item.label) };
  });

  readonly barHeight = computed(() => this.grouped().length * 28 + 8);

  readonly bars = computed(() => {
    const room = this.width() - this.labelWidth - 60;
    const top = Math.max(0, ...this.grouped().map((point) => point.value)) || 1;
    return this.grouped().map((point) => ({
      ...point,
      short: short(point.label, 16),
      size: Math.max(1, (Math.max(0, point.value) / top) * room),
    }));
  });

  readonly dots = computed(() => {
    const points = this.grouped();
    const plotWidth = this.width() - this.left - 20;
    const plot = HEIGHT - 28 - 16;
    // A label is named under every point it has room for: its own width (11px text) and a gap, against the space between points.
    const slot = points.length > 1 ? plotWidth / (points.length - 1) : plotWidth;
    const widest = Math.max(1, ...points.map((point) => short(point.label, 10).length)) * 6.5 + 8;
    const every = Math.max(1, Math.ceil(widest / slot));
    return points.map((point, index) => ({
      ...point,
      short: short(point.label, 10),
      showLabel: index % every === 0,
      x: this.left + 10 + (points.length === 1 ? plotWidth / 2 : (plotWidth * index) / (points.length - 1)),
      y: 16 + plot - (Math.max(0, point.value) / this.top()) * plot,
    }));
  });

  readonly linePath = computed(() => this.dots().map((dot) => `${dot.x},${dot.y}`).join(' '));

  /** The line closed down to the axis: the area under it. */
  readonly areaPath = computed(() => {
    const dots = this.dots();
    if (!dots.length) return '';
    const base = 16 + (HEIGHT - 28 - 16);
    return `${dots[0].x},${base} ${this.linePath()} ${dots[dots.length - 1].x},${base}`;
  });

  /** A waterfall's scale: each step rises or falls from where the one before it ended, then the total. */
  private readonly wf = computed(() => {
    let run = 0;
    const rows = this.grouped().map((point) => {
      const start = run;
      run += point.value;
      return { ...point, start, end: run, total: false };
    });
    rows.push({ label: 'Total', value: run, start: 0, end: run, total: true });
    const levels = rows.flatMap((row) => [row.start, row.end]);
    const hi = niceMax(Math.max(0, ...levels));
    const lo = Math.min(0, ...levels) < 0 ? -niceMax(-Math.min(0, ...levels)) : 0;
    return { rows, hi, lo };
  });

  readonly wfTicks = computed(() => {
    const { hi, lo } = this.wf();
    const plot = HEIGHT - 28 - 16;
    return [0, 1, 2, 3, 4].map((step) => ({
      y: 16 + plot - (plot * step) / 4,
      label: formatNumber(lo + ((hi - lo) * step) / 4, hi - lo < 4 ? 2 : 0),
    }));
  });

  readonly steps = computed(() => {
    const { rows, hi, lo } = this.wf();
    const plot = HEIGHT - 28 - 16;
    const slot = (this.width() - this.left - 8) / rows.length;
    const w = Math.max(4, Math.min(64, slot * 0.62));
    const chars = Math.max(4, Math.floor(slot / 6.5));
    const y = (value: number) => 16 + plot - ((value - lo) / (hi - lo || 1)) * plot;
    return rows.map((row, index) => {
      const top = y(Math.max(row.start, row.end));
      const bottom = y(Math.min(row.start, row.end));
      return {
        ...row,
        short: short(row.label, chars),
        x: this.left + slot * index + (slot - w) / 2,
        w,
        y: top,
        h: Math.max(2, bottom - top),
        colour: row.total ? KPI_PALETTE[0] : row.value >= 0 ? GOOD_COLOR : BAD_COLOR,
      };
    });
  });

  /** A funnel's stages, the largest first, each a bar centred in the room, as wide as its share of the first. */
  readonly stages = computed(() => {
    const points = [...this.points()].filter((point) => point.value > 0).sort((a, b) => b.value - a.value).slice(0, MAX_GROUPS);
    const top = points[0]?.value || 1;
    const room = this.width() - this.labelWidth - 60;
    return points.map((point) => {
      const size = Math.max(2, (point.value / top) * room);
      return { ...point, short: short(point.label, 16), size, x: this.labelWidth + (room - size) / 2, pct: Math.round((point.value / top) * 100) };
    });
  });

  readonly tiles = computed(() =>
    squarify(
      this.grouped().filter((point) => point.value > 0).sort((a, b) => b.value - a.value),
      this.width(),
      HEIGHT,
    ),
  );

  /** A radar: a spoke per group, a ring at each quarter of the biggest value, and the shape the values make. */
  readonly radar = computed(() => {
    const points = this.grouped();
    if (points.length < 3) return null;
    const cx = this.width() / 2;
    const cy = HEIGHT / 2 + 4;
    const radius = HEIGHT / 2 - 36;
    const top = niceMax(Math.max(0, ...points.map((point) => point.value)));
    const at = (index: number, fraction: number) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / points.length;
      return { x: cx + Math.cos(angle) * radius * fraction, y: cy + Math.sin(angle) * radius * fraction, cos: Math.cos(angle) };
    };
    const ring = (fraction: number) => points.map((_, index) => at(index, fraction)).map((p) => `${p.x},${p.y}`).join(' ');
    return {
      cx,
      cy,
      rings: [0.25, 0.5, 0.75, 1].map(ring),
      shape: points.map((point, index) => at(index, Math.max(0, point.value) / top)).map((p) => `${p.x},${p.y}`).join(' '),
      spokes: points.map((point, index) => {
        const end = at(index, 1);
        const label = at(index, 1.14);
        const value = at(index, Math.max(0, point.value) / top);
        return {
          key: point.key,
          label: point.label,
          short: short(point.label, 12),
          value: point.value,
          x2: end.x,
          y2: end.y,
          lx: label.x,
          ly: label.y + 4,
          anchor: label.cos > 0.25 ? 'start' : label.cos < -0.25 ? 'end' : 'middle',
          vx: value.x,
          vy: value.y,
        };
      }),
    };
  });

  /** A gauge: a half dial filled to the value of its top, a tick where the goal is. */
  readonly gaugeData = computed(() => {
    const value = this.value() ?? 0;
    const goal = this.goal();
    const max = niceMax(Math.max(value, goal ?? 0, 0.0001));
    const frac = Math.min(1, Math.max(0, value / max));
    const radius = Math.max(60, Math.min(92, this.width() / 2 - 40));
    const cx = this.width() / 2;
    const cy = 128;
    const point = (fraction: number, r = radius) => ({ x: cx - Math.cos(Math.PI * fraction) * r, y: cy - Math.sin(Math.PI * fraction) * r });
    const end = point(frac);
    const goalFraction = goal === null ? null : Math.min(1, Math.max(0, goal / max));
    const g1 = goalFraction === null ? null : point(goalFraction, radius - 17);
    const g2 = goalFraction === null ? null : point(goalFraction, radius + 17);
    return {
      cx,
      cy,
      r: radius,
      frac,
      track: `M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`,
      arc: `M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${end.x} ${end.y}`,
      goal: g1 && g2 ? { x1: g1.x, y1: g1.y, x2: g2.x, y2: g2.y, text: this.format(goal as number) } : null,
      colour: goal === null ? KPI_PALETTE[0] : value >= goal ? GOOD_COLOR : BAD_COLOR,
      valueText: this.format(value),
      maxText: formatNumber(max, max < 4 ? 2 : 0),
    };
  });

  readonly slices = computed(() => {
    const points = this.grouped().filter((point) => point.value > 0);
    const total = points.reduce((sum, point) => sum + point.value, 0) || 1;
    let angle = -Math.PI / 2;
    return points.map((point) => {
      const share = point.value / total;
      const start = angle;
      angle += share * Math.PI * 2;
      const end = angle;
      const large = end - start > Math.PI ? 1 : 0;
      const [x1, y1, x2, y2] = [Math.cos(start), Math.sin(start), Math.cos(end), Math.sin(end)];
      const path =
        share >= 0.9999 ? 'M 1 0 A 1 1 0 1 1 -1 0 A 1 1 0 1 1 1 0 Z' : `M 0 0 L ${x1} ${y1} A 1 1 0 ${large} 1 ${x2} ${y2} Z`;
      return { ...point, path, percent: (share * 100).toFixed(share < 0.1 ? 1 : 0), share: (share * 100).toFixed(1), fraction: share, mid: (start + end) / 2 };
    });
  });

  /** A pie is drawn with its names round it (Google's) when the tile is wide enough for them; narrower, with the list beside it. */
  readonly labelled = computed(() => this.width() >= 400);

  /** The labelled pie worked out in pixels: its slices, each slice, and its name and amount on a line from it to the side. */
  readonly pie = computed(() => {
    const width = this.width();
    const r = Math.max(60, Math.min(100, (width - 260) / 2));
    const height = Math.round(r * 2 + 76);
    const cx = width / 2;
    const cy = height / 2;
    const items = this.slices().map((slice) => {
      const cos = Math.cos(slice.mid);
      const sin = Math.sin(slice.mid);
      const side = cos >= 0 ? 1 : -1;
      return {
        ...slice,
        side,
        dot: { x: cx + cos * r * 0.9, y: cy + sin * r * 0.9 },
        line: cy + sin * (r + 12),
        leader: '',
        text: { x: 0, y: 0, anchor: side > 0 ? 'start' : 'end' },
      };
    });
    // The names of each side keep apart, top to bottom, and inside the tile.
    for (const side of [1, -1]) {
      const column = items.filter((item) => item.side === side).sort((a, b) => a.line - b.line);
      const gap = 40;
      column.forEach((item, index) => {
        item.line = index ? Math.max(item.line, column[index - 1].line + gap) : Math.max(item.line, 22);
      });
      for (let index = column.length - 1; index >= 0; index--) {
        const room = height - 22 - (index === column.length - 1 ? 0 : (column.length - 1 - index) * gap);
        column[index].line = Math.min(column[index].line, room);
      }
    }
    for (const item of items) {
      const cos = Math.cos(item.mid);
      const sin = Math.sin(item.mid);
      const elbow = cx + item.side * (r + 18);
      const far = elbow + item.side * 78;
      item.leader = `${item.dot.x},${item.dot.y} ${cx + cos * (r + 6)},${cy + sin * (r + 6)} ${elbow},${item.line} ${far},${item.line}`;
      item.text = { x: elbow + item.side * 4, y: item.line, anchor: item.text.anchor };
    }
    return { r, cx, cy, height, items };
  });

  /** Signed comparisons retain a zero baseline. Unlike sums/shares, omitted averages must not be added as Other. */
  readonly comparison = computed(() => {
    const all = this.points().filter((point) => Number.isFinite(point.value)).sort((a, b) => b.value - a.value);
    if (!all.length) return null;
    const points = all.slice(0, MAX_GROUPS);
    const lo = Math.min(0, ...points.map((p) => p.value));
    const hi = Math.max(0, ...points.map((p) => p.value));
    const min = lo < 0 ? -niceMax(-lo) : 0;
    const max = hi > 0 ? niceMax(hi) : min === 0 ? 1 : 0;
    const left = Math.min(this.labelWidth, this.width() * 0.36);
    const right = Math.max(left + 30, this.width() - 66);
    // Normalising first avoids overflowing the range when finite values span both numeric extremes.
    const unit = Math.max(Math.abs(min), Math.abs(max), 1);
    const range = max / unit - min / unit;
    const x = (value: number) => left + ((value / unit - min / unit) / range) * (right - left);
    return {
      left, right, zero: x(0), height: points.length * 28 + 36, omitted: all.length - points.length,
      rows: points.map((point) => ({ ...point, x: x(point.value), short: short(point.label, Math.max(4, Math.floor((left - 8) / 6))) })),
      ticks: [0, 1, 2, 3, 4].map((step) => {
        const fraction = step / 4;
        const value = min * (1 - fraction) + max * fraction;
        return { x: x(value), label: formatNumber(value, max / unit - min / unit < 4 / unit ? 2 : 0) };
      }),
    };
  });

  /** Share charts cannot represent negative contributions. Preserve the full positive total when grouping. */
  private readonly contributions = computed(() => {
    const all = this.points().filter((point) => Number.isFinite(point.value));
    if (all.some((point) => point.value < 0)) return null;
    const positive = all.filter((point) => point.value > 0).sort((a, b) => b.value - a.value);
    const total = positive.reduce((sum, point) => sum + point.value, 0);
    if (!(total > 0) || !Number.isFinite(total)) return null;
    const combined = positive.length > MAX_GROUPS;
    const points = combined
      ? [...positive.slice(0, MAX_GROUPS - 1), { label: 'Other', value: positive.slice(MAX_GROUPS - 1).reduce((sum, point) => sum + point.value, 0) }]
      : positive;
    return { points, total, combined };
  });

  readonly pareto = computed(() => {
    const data = this.contributions();
    if (!data) return null;
    const top = niceMax(Math.max(...data.points.map((point) => point.value)));
    const plot = HEIGHT - 28 - 16;
    const slot = (this.width() - this.left - 44) / data.points.length;
    const w = Math.max(3, Math.min(64, slot * 0.62));
    let cumulative = 0;
    const rows = data.points.map((point, index) => {
      cumulative += point.value;
      const fraction = Math.min(1, cumulative / data.total);
      const h = (point.value / top) * plot;
      const cx = this.left + slot * (index + 0.5);
      return { ...point, x: cx - w / 2, y: 16 + plot - h, w, h, cx, cy: 16 + plot * (1 - fraction), percent: (fraction * 100).toFixed(1), short: short(point.label, Math.max(4, Math.floor(slot / 6.5))) };
    });
    return {
      rows, combined: data.combined, path: rows.map((p) => `${p.cx},${p.cy}`).join(' '),
      ticks: [0, 1, 2, 3, 4].map((step) => ({ y: 16 + plot * (1 - step / 4), label: formatNumber((top * step) / 4, top < 4 ? 2 : 0), percent: step * 25 })),
    };
  });

  readonly polar = computed(() => {
    const data = this.contributions();
    if (!data) return null;
    const max = Math.max(...data.points.map((point) => point.value));
    const angle = (Math.PI * 2) / data.points.length;
    return {
      combined: data.combined,
      sectors: data.points.map((point, index) => {
        // Equal-angle sector area is proportional to radius squared, so use the square root.
        const radius = Math.sqrt(point.value / max);
        const start = -Math.PI / 2 + angle * index;
        const end = start + angle;
        const path = data.points.length === 1
          ? `M ${radius} 0 A ${radius} ${radius} 0 1 1 ${-radius} 0 A ${radius} ${radius} 0 1 1 ${radius} 0 Z`
          : `M 0 0 L ${Math.cos(start) * radius} ${Math.sin(start) * radius} A ${radius} ${radius} 0 ${angle > Math.PI ? 1 : 0} 1 ${Math.cos(end) * radius} ${Math.sin(end) * radius} Z`;
        return { ...point, path, radius, percent: ((point.value / data.total) * 100).toFixed(1) };
      }),
    };
  });
}
