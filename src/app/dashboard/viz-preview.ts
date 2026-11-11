import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, signal } from '@angular/core';

import { STUDIO_TYPES, wellNames, type StudioType } from './studio-model';

/** What each type is for, in a line, under its animated drawing (as the system's report studio words them). */
export const VISUAL_PREVIEWS: Record<StudioType, string> = {
  card: 'One number, big and clear.',
  column: 'Compare amounts across categories, side by side.',
  stacked: 'Compare totals across categories, each split into the parts that make it up.',
  bar: 'Compare categories as rows: good for long names and rankings.',
  line: 'See how values rise and fall over time.',
  area: 'A trend over time, with the volume under it filled in.',
  waterfall: 'How a total builds up or falls step by step: rises green, falls red.',
  pie: "Each part's share of the whole.",
  donut: 'Shares of a whole, with the total in the middle.',
  treemap: 'Many parts of a whole, each box sized by its value.',
  funnel: 'How a number shrinks stage by stage, from sown to harvested.',
  radar: 'Each category a spoke: see at a glance where each is strong.',
  gauge: 'One value on its way to the target and the maximum.',
  lollipop: 'Rank categories with a dot and stem from zero, including negative values.',
  dot: 'Compare category values on one shared scale without the weight of bars.',
  pareto: 'Find the largest contributors and their cumulative share of the total.',
  polar: 'Compare positive category values as equal-angle sectors sized by area.',
  table: 'Rows of detail, with the numbers worked out for each.',
};

// It plays again this often while it shows: draw, do what it does, hold.
const REPLAY_MS = 4500;
const WIDTH = 240;
const GAP = 14;
const EDGE = 8;
const HEIGHT = 236;

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * A visual type's preview beside its button in the Visualizations pane (as the system's report studio
 * shows it): the visual drawing itself and doing what it does, its name, what it is for, and the
 * fields it takes. Level with the button and beside the grid of types: toward the page (left) when
 * there's room, else to the right.
 */
@Component({
  selector: 'app-viz-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'tooltip', '[style.left.px]': 'left()', '[style.top.px]': 'top()' },
  template: `
    @for (play of [round()]; track play) {
      <svg class="art" viewBox="0 0 200 110" aria-hidden="true">
        @switch (type()) {
          @case ('card') {
            <rect x="52" y="22" width="96" height="66" rx="8" fill="#fff" stroke="#e2e5e3" />
            <text x="100" y="62" text-anchor="middle" class="big pop" style="--i: 0">{{ count() }}</text>
            <text x="100" y="78" text-anchor="middle" class="cap fade" style="--d: 700ms">Plants</text>
          }
          @case ('column') {
            <g class="grid"><line x1="12" x2="190" y1="30" y2="30" /><line x1="12" x2="190" y1="55" y2="55" /><line x1="12" x2="190" y1="80" y2="80" /></g>
            <line class="axis" x1="12" x2="190" y1="96" y2="96" />
            <rect class="grow-y" style="--i: 0" x="26" y="52" width="26" height="44" rx="2" fill="#118DFF" />
            <rect class="grow-y" style="--i: 1" x="66" y="34" width="26" height="62" rx="2" fill="#118DFF" />
            <rect class="grow-y" style="--i: 2" x="106" y="64" width="26" height="32" rx="2" fill="#118DFF" />
            <rect class="grow-y" style="--i: 3" x="146" y="22" width="26" height="74" rx="2" fill="#118DFF" />
            <text class="cap fade" style="--d: 900ms" x="159" y="16" text-anchor="middle">highest</text>
          }
          @case ('stacked') {
            <g class="grid"><line x1="12" x2="190" y1="30" y2="30" /><line x1="12" x2="190" y1="55" y2="55" /><line x1="12" x2="190" y1="80" y2="80" /></g>
            <line class="axis" x1="12" x2="190" y1="96" y2="96" />
            <rect class="grow-y" style="--i: 0" x="26" y="58" width="26" height="38" rx="2" fill="#118DFF" />
            <rect class="grow-y" style="--i: 0" x="26" y="46" width="26" height="12" rx="2" fill="#12239E" />
            <rect class="grow-y" style="--i: 1" x="66" y="40" width="26" height="56" rx="2" fill="#118DFF" />
            <rect class="grow-y" style="--i: 1" x="66" y="26" width="26" height="14" rx="2" fill="#12239E" />
            <rect class="grow-y" style="--i: 2" x="106" y="68" width="26" height="28" rx="2" fill="#118DFF" />
            <rect class="grow-y" style="--i: 2" x="106" y="60" width="26" height="8" rx="2" fill="#12239E" />
            <rect class="grow-y" style="--i: 3" x="146" y="32" width="26" height="64" rx="2" fill="#118DFF" />
            <rect class="grow-y" style="--i: 3" x="146" y="18" width="26" height="14" rx="2" fill="#12239E" />
          }
          @case ('bar') {
            <line class="axis" x1="44" x2="44" y1="10" y2="100" />
            <text class="cap" x="38" y="29" text-anchor="end">Chili</text>
            <text class="cap" x="38" y="51" text-anchor="end">Cow</text>
            <text class="cap" x="38" y="73" text-anchor="end">Goat</text>
            <text class="cap" x="38" y="95" text-anchor="end">Bean</text>
            <rect class="grow-x" style="--i: 0" x="44" y="18" width="130" height="14" rx="2" fill="#118DFF" />
            <rect class="grow-x" style="--i: 1" x="44" y="40" width="98" height="14" rx="2" fill="#118DFF" />
            <rect class="grow-x" style="--i: 2" x="44" y="62" width="70" height="14" rx="2" fill="#118DFF" />
            <rect class="grow-x" style="--i: 3" x="44" y="84" width="44" height="14" rx="2" fill="#118DFF" />
          }
          @case ('line') {
            <g class="grid"><line x1="12" x2="190" y1="30" y2="30" /><line x1="12" x2="190" y1="55" y2="55" /><line x1="12" x2="190" y1="80" y2="80" /></g>
            <path class="draw" pathLength="100" d="M14 78 L44 60 L74 68 L104 40 L134 48 L164 26 L190 32" fill="none" stroke="#118DFF" stroke-width="2.5" stroke-linejoin="round" />
            <circle class="pop" style="--i: 6" cx="164" cy="26" r="4" fill="#118DFF" />
            <g class="fade" style="--d: 1000ms"><rect x="132" y="6" width="64" height="14" rx="4" fill="#252a27" /><text class="tip" x="164" y="16" text-anchor="middle">Jul · 1,240</text></g>
          }
          @case ('area') {
            <g class="grid"><line x1="12" x2="190" y1="30" y2="30" /><line x1="12" x2="190" y1="55" y2="55" /><line x1="12" x2="190" y1="80" y2="80" /></g>
            <path class="fade" style="--d: 700ms" d="M14 96 L14 78 L44 60 L74 68 L104 40 L134 48 L164 26 L190 32 L190 96 Z" fill="#118DFF" fill-opacity="0.22" />
            <path class="draw" pathLength="100" d="M14 78 L44 60 L74 68 L104 40 L134 48 L164 26 L190 32" fill="none" stroke="#118DFF" stroke-width="2.5" stroke-linejoin="round" />
          }
          @case ('waterfall') {
            <line class="axis" x1="12" x2="190" y1="96" y2="96" />
            <rect class="grow-y" style="--i: 0" x="20" y="60" width="22" height="36" rx="2" fill="#1a7f37" />
            <rect class="grow-y" style="--i: 1" x="52" y="40" width="22" height="20" rx="2" fill="#1a7f37" />
            <rect class="grow-y" style="--i: 2" x="84" y="40" width="22" height="14" rx="2" fill="#d1242f" />
            <rect class="grow-y" style="--i: 3" x="116" y="26" width="22" height="28" rx="2" fill="#1a7f37" />
            <rect class="grow-y" style="--i: 4" x="156" y="26" width="26" height="70" rx="2" fill="#118DFF" />
            <g class="grid fade" style="--d: 800ms"><line x1="42" x2="52" y1="60" y2="60" /><line x1="74" x2="84" y1="40" y2="40" /><line x1="106" x2="116" y1="54" y2="54" /><line x1="138" x2="156" y1="26" y2="26" /></g>
            <text class="cap" x="169" y="106" text-anchor="middle">Total</text>
          }
          @case ('pie') {
            <g transform="rotate(-90 64 55)">
              <circle class="sweep" style="--len: 42; --start: 0; stroke-dasharray: 42 58; stroke-dashoffset: 0" cx="64" cy="55" r="26" fill="none" stroke="#118DFF" stroke-width="52" pathLength="100" />
              <circle class="sweep" style="--len: 26; --start: 42; stroke-dasharray: 26 74; stroke-dashoffset: -42" cx="64" cy="55" r="26" fill="none" stroke="#12239E" stroke-width="52" pathLength="100" />
              <circle class="sweep" style="--len: 18; --start: 68; stroke-dasharray: 18 82; stroke-dashoffset: -68" cx="64" cy="55" r="26" fill="none" stroke="#E66C37" stroke-width="52" pathLength="100" />
              <circle class="sweep" style="--len: 14; --start: 86; stroke-dasharray: 14 86; stroke-dashoffset: -86" cx="64" cy="55" r="26" fill="none" stroke="#6B007B" stroke-width="52" pathLength="100" />
            </g>
            <g class="legend fade" style="--d: 900ms">
              <rect x="124" y="28" width="7" height="7" rx="1.5" fill="#118DFF" /><text class="cap2" x="135" y="34.5">Chili 42%</text>
              <rect x="124" y="44" width="7" height="7" rx="1.5" fill="#12239E" /><text class="cap2" x="135" y="50.5">Cow 26%</text>
              <rect x="124" y="60" width="7" height="7" rx="1.5" fill="#E66C37" /><text class="cap2" x="135" y="66.5">Goat 18%</text>
              <rect x="124" y="76" width="7" height="7" rx="1.5" fill="#6B007B" /><text class="cap2" x="135" y="82.5">Bean 14%</text>
            </g>
          }
          @case ('donut') {
            <g transform="rotate(-90 64 55)">
              <circle class="sweep" style="--len: 42; --start: 0; stroke-dasharray: 42 58; stroke-dashoffset: 0" cx="64" cy="55" r="32" fill="none" stroke="#118DFF" stroke-width="18" pathLength="100" />
              <circle class="sweep" style="--len: 26; --start: 42; stroke-dasharray: 26 74; stroke-dashoffset: -42" cx="64" cy="55" r="32" fill="none" stroke="#12239E" stroke-width="18" pathLength="100" />
              <circle class="sweep" style="--len: 18; --start: 68; stroke-dasharray: 18 82; stroke-dashoffset: -68" cx="64" cy="55" r="32" fill="none" stroke="#E66C37" stroke-width="18" pathLength="100" />
              <circle class="sweep" style="--len: 14; --start: 86; stroke-dasharray: 14 86; stroke-dashoffset: -86" cx="64" cy="55" r="32" fill="none" stroke="#6B007B" stroke-width="18" pathLength="100" />
            </g>
            <text class="big2 fade" style="--d: 700ms" x="64" y="60" text-anchor="middle">{{ count() }}</text>
            <g class="legend fade" style="--d: 900ms">
              <rect x="124" y="28" width="7" height="7" rx="1.5" fill="#118DFF" /><text class="cap2" x="135" y="34.5">Chili 42%</text>
              <rect x="124" y="44" width="7" height="7" rx="1.5" fill="#12239E" /><text class="cap2" x="135" y="50.5">Cow 26%</text>
              <rect x="124" y="60" width="7" height="7" rx="1.5" fill="#E66C37" /><text class="cap2" x="135" y="66.5">Goat 18%</text>
              <rect x="124" y="76" width="7" height="7" rx="1.5" fill="#6B007B" /><text class="cap2" x="135" y="82.5">Bean 14%</text>
            </g>
          }
          @case ('treemap') {
            <rect class="pop" style="--i: 0" x="12" y="10" width="92" height="90" rx="3" fill="#118DFF" />
            <rect class="pop" style="--i: 1" x="108" y="10" width="80" height="50" rx="3" fill="#12239E" />
            <rect class="pop" style="--i: 2" x="108" y="64" width="46" height="36" rx="3" fill="#E66C37" />
            <rect class="pop" style="--i: 3" x="158" y="64" width="30" height="20" rx="3" fill="#6B007B" />
            <rect class="pop" style="--i: 4" x="158" y="88" width="30" height="12" rx="3" fill="#E044A7" />
            <g class="fade" style="--d: 700ms"><text class="tile" x="20" y="28">Chili</text><text class="tile" x="116" y="28">Cow</text><text class="tile" x="116" y="82">Goat</text></g>
          }
          @case ('funnel') {
            <rect class="grow-c" style="--i: 0" x="20" y="12" width="160" height="19" rx="2" fill="#118DFF" />
            <rect class="grow-c" style="--i: 1" x="36" y="36" width="128" height="19" rx="2" fill="#12239E" />
            <rect class="grow-c" style="--i: 2" x="56" y="60" width="88" height="19" rx="2" fill="#E66C37" />
            <rect class="grow-c" style="--i: 3" x="76" y="84" width="48" height="19" rx="2" fill="#6B007B" />
            <g class="fade" style="--d: 800ms"><text class="tile" x="100" y="25" text-anchor="middle">Sown 100%</text><text class="tile" x="100" y="49" text-anchor="middle">Healthy 80%</text><text class="tile" x="100" y="73" text-anchor="middle">Planted 55%</text><text class="tile" x="100" y="97" text-anchor="middle">Harvested 30%</text></g>
          }
          @case ('radar') {
            <g class="grid">
              <polygon points="100,18 138,46 124,90 76,90 62,46" fill="none" /><polygon points="100,34 126,53 116,82 84,82 74,53" fill="none" /><polygon points="100,50 114,60 108,74 92,74 86,60" fill="none" />
              <line x1="100" y1="62" x2="100" y2="18" /><line x1="100" y1="62" x2="138" y2="46" /><line x1="100" y1="62" x2="124" y2="90" /><line x1="100" y1="62" x2="76" y2="90" /><line x1="100" y1="62" x2="62" y2="46" />
            </g>
            <polygon class="turn" points="100,26 128,50 112,82 82,76 70,50" fill="#118DFF" fill-opacity="0.28" stroke="#118DFF" stroke-width="2" stroke-linejoin="round" />
            <g class="fade" style="--d: 700ms"><text class="cap" x="100" y="12" text-anchor="middle">Yield</text><text class="cap" x="146" y="48">Care</text><text class="cap" x="126" y="100">Speed</text><text class="cap" x="74" y="100" text-anchor="end">Cost</text><text class="cap" x="54" y="48" text-anchor="end">Size</text></g>
          }
          @case ('gauge') {
            <path d="M34 90 A66 66 0 0 1 166 90" fill="none" stroke="#e2e5e3" stroke-width="16" stroke-linecap="round" pathLength="100" />
            <path class="sweep" style="--len: 68; --start: 0; stroke-dasharray: 68 100" d="M34 90 A66 66 0 0 1 166 90" fill="none" stroke="#118DFF" stroke-width="16" stroke-linecap="round" pathLength="100" />
            <line class="fade" style="--d: 800ms" x1="152" y1="52" x2="162" y2="44" stroke="#252a27" stroke-width="2.5" />
            <text class="big pop" style="--i: 3" x="100" y="82" text-anchor="middle">{{ count() }}</text>
            <text class="cap" x="34" y="104" text-anchor="middle">0</text><text class="cap" x="166" y="104" text-anchor="middle">1,500</text>
          }
          @case ('lollipop') {
            <line class="axis" x1="48" x2="48" y1="10" y2="100" />
            @for (item of comparisonRows; track item.name; let i = $index) {
              <g class="row-in" [style.--i]="i">
                <text class="cap" x="40" [attr.y]="24 + i * 23" text-anchor="end">{{ item.name }}</text>
                <line class="draw" pathLength="100" x1="48" [attr.x2]="item.x" [attr.y1]="20 + i * 23" [attr.y2]="20 + i * 23" stroke="#118DFF" stroke-width="2" />
                <circle class="pop" [style.--i]="i" [attr.cx]="item.x" [attr.cy]="20 + i * 23" r="5" fill="#118DFF" />
              </g>
            }
          }
          @case ('dot') {
            <line class="axis" x1="48" x2="48" y1="10" y2="100" />
            @for (item of comparisonRows; track item.name; let i = $index) {
              <g class="row-in" [style.--i]="i">
                <text class="cap" x="40" [attr.y]="24 + i * 23" text-anchor="end">{{ item.name }}</text>
                <line class="axis" x1="48" x2="184" [attr.y1]="20 + i * 23" [attr.y2]="20 + i * 23" />
                <circle class="pop" [style.--i]="i" [attr.cx]="item.x" [attr.cy]="20 + i * 23" r="5" fill="#118DFF" />
              </g>
            }
          }
          @case ('pareto') {
            <line class="axis" x1="14" x2="190" y1="96" y2="96" />
            <rect class="grow-y" style="--i: 0" x="24" y="26" width="28" height="70" fill="#118DFF" rx="2" />
            <rect class="grow-y" style="--i: 1" x="66" y="48" width="28" height="48" fill="#118DFF" rx="2" />
            <rect class="grow-y" style="--i: 2" x="108" y="66" width="28" height="30" fill="#118DFF" rx="2" />
            <rect class="grow-y" style="--i: 3" x="150" y="80" width="28" height="16" fill="#118DFF" rx="2" />
            <path class="draw" pathLength="100" d="M38 62 L80 38 L122 22 L164 14" fill="none" stroke="#E66C37" stroke-width="2.5" />
            <text class="cap fade" style="--d: 1000ms" x="184" y="12" text-anchor="end">100%</text>
          }
          @case ('polar') {
            <path class="turn" d="M100 55 V9 A46 46 0 0 1 146 55 Z" fill="#118DFF" stroke="#fff" stroke-width="2" />
            <path class="turn" d="M100 55 H138 A38 38 0 0 1 100 93 Z" fill="#12239E" stroke="#fff" stroke-width="2" />
            <path class="turn" d="M100 55 V86 A31 31 0 0 1 69 55 Z" fill="#E66C37" stroke="#fff" stroke-width="2" />
            <path class="turn" d="M100 55 H79 A21 21 0 0 1 100 34 Z" fill="#6B007B" stroke="#fff" stroke-width="2" />
          }
          @case ('table') {
            <rect x="14" y="10" width="172" height="14" rx="3" fill="#eef1ef" />
            <text class="cap" x="22" y="20">Zone</text><text class="cap" x="116" y="20" text-anchor="end">Plants</text><text class="cap" x="176" y="20" text-anchor="end">Share</text>
            @for (row of tableRows; track row.name; let i = $index) {
              <g class="row-in" [style.--i]="i">
                <text class="cap2" x="22" [attr.y]="40 + i * 20">{{ row.name }}</text>
                <text class="cap2" x="116" [attr.y]="40 + i * 20" text-anchor="end">{{ row.plants }}</text>
                <rect class="grow-x" [style.--i]="i + 2" x="126" [attr.y]="32 + i * 20" [attr.width]="row.bar" height="10" rx="2" fill="#118DFF" fill-opacity="0.45" />
              </g>
            }
          }
        }
      </svg>
    }
    <p class="title">{{ label() }}</p>
    <p class="text">{{ text() }}</p>
    @if (fields().length) {
      <ul class="fields" aria-label="Fields">
        @for (field of fields(); track field) {
          <li>{{ field }}</li>
        }
      </ul>
    }
  `,
  styles: `
    :host { position: fixed; z-index: 1000; width: ${WIDTH}px; padding: 8px 8px 11px; border: 1px solid #e2e5e3; border-radius: 12px; background: #fff; box-shadow: 0 12px 32px rgba(16, 24, 21, 0.16); color: #252a27; pointer-events: none; animation: card-in 140ms ease-out both; }
    .art { display: block; width: 100%; height: auto; border-radius: 8px; background: #f7f8f7; font-family: inherit; }
    .title { margin: 9px 4px 2px; font-size: 12.5px; font-weight: 650; }
    .text { margin: 0 4px; color: #6b7470; font-size: 11.5px; line-height: 1.4; }
    .fields { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 4px 0; padding: 0; list-style: none; }
    .fields li { padding: 1px 7px; border-radius: 999px; background: #eef1ef; color: #3a413d; font-size: 10.5px; font-weight: 600; }

    .grid line, .grid polygon { stroke: #e2e5e3; stroke-width: 1; }
    .axis { stroke: #c9cfcb; stroke-width: 1; }
    .cap { font-size: 8.5px; fill: #6b7470; }
    .cap2 { font-size: 8.5px; fill: #252a27; }
    .tip { font-size: 8px; fill: #fff; font-weight: 600; }
    .tile { font-size: 8.5px; fill: #fff; font-weight: 600; }
    .big { font-size: 24px; font-weight: 700; fill: #252a27; font-variant-numeric: tabular-nums; }
    .big2 { font-size: 13px; font-weight: 700; fill: #252a27; font-variant-numeric: tabular-nums; }

    /* The parts come in one after another (--i), each from its own box. */
    .grow-y, .grow-x, .grow-c, .pop, .turn, .row-in { transform-box: fill-box; }
    .grow-y { transform-origin: 50% 100%; animation: grow-y 520ms cubic-bezier(0.2, 0.8, 0.2, 1) calc(var(--i, 0) * 90ms) both; }
    .grow-x { transform-origin: 0 50%; animation: grow-x 520ms cubic-bezier(0.2, 0.8, 0.2, 1) calc(var(--i, 0) * 90ms) both; }
    .grow-c { transform-origin: 50% 50%; animation: grow-x 560ms cubic-bezier(0.2, 0.8, 0.2, 1) calc(var(--i, 0) * 130ms) both; }
    .pop { transform-origin: 50% 50%; animation: pop 380ms cubic-bezier(0.2, 0.9, 0.3, 1.2) calc(var(--i, 0) * 110ms) both; }
    .turn { transform-origin: 50% 50%; animation: pop 700ms cubic-bezier(0.2, 0.9, 0.3, 1) 150ms both; }
    .draw { stroke-dasharray: 100; animation: draw 900ms ease-out both; }
    .fade { animation: fade 500ms ease-out var(--d, 600ms) both; }
    .sweep { animation: sweep calc(var(--len) * 8ms) linear calc(var(--start) * 8ms) both; }
    .row-in { animation: row-in 420ms ease-out calc(var(--i, 0) * 110ms) both; }

    @keyframes card-in { from { opacity: 0; transform: translateY(4px); } }
    @keyframes grow-y { from { transform: scaleY(0); } }
    @keyframes grow-x { from { transform: scaleX(0); } }
    @keyframes pop { from { opacity: 0; transform: scale(0.4); } }
    @keyframes draw { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
    @keyframes fade { from { opacity: 0; } }
    @keyframes sweep { from { stroke-dasharray: 0 100; } }
    @keyframes row-in { from { opacity: 0; transform: translateX(-10px); } }

    @media (prefers-reduced-motion: reduce) {
      :host, :host * { animation: none !important; }
    }
  `,
})
export class VizPreview {
  readonly type = input.required<StudioType>();
  /** Where it goes beside: the grid of types across, the hovered button's row down. */
  readonly anchor = input.required<DOMRect>();

  /** Played again each time: the drawing is made anew. */
  readonly round = signal(0);
  /** A number counting up, for the card, the donut's middle and the gauge. */
  readonly counted = signal(0);
  readonly count = computed(() => this.counted().toLocaleString('en-US'));

  readonly tableRows = [
    { name: 'Zone A', plants: '8,240', bar: 40 },
    { name: 'Zone B', plants: '6,120', bar: 30 },
    { name: 'Zone C', plants: '4,580', bar: 22 },
  ];
  readonly comparisonRows = [
    { name: 'Chili', x: 174 },
    { name: 'Bean', x: 146 },
    { name: 'Corn', x: 108 },
    { name: 'Rice', x: 76 },
  ];

  readonly label = computed(() => STUDIO_TYPES.find((item) => item.type === this.type())?.label ?? '');
  readonly text = computed(() => VISUAL_PREVIEWS[this.type()]);
  readonly fields = computed(() => {
    const wells = wellNames(this.type());
    return [wells.axis, wells.values].filter((name): name is string => !!name);
  });

  readonly left = computed(() => {
    const anchor = this.anchor();
    let left = anchor.left - GAP - WIDTH;
    if (left < EDGE) left = anchor.right + GAP;
    return Math.max(EDGE, Math.min(left, window.innerWidth - EDGE - WIDTH));
  });
  readonly top = computed(() => {
    const anchor = this.anchor();
    const middle = anchor.top + anchor.height / 2 - HEIGHT / 2;
    return Math.min(Math.max(EDGE, middle), Math.max(EDGE, window.innerHeight - EDGE - HEIGHT));
  });

  private frame = 0;

  constructor() {
    const destroy = inject(DestroyRef);
    // The type is known once it's drawn.
    afterNextRender(() => this.countUp());
    if (!reduced()) {
      const replay = setInterval(() => {
        this.round.update((n) => n + 1);
        this.countUp();
      }, REPLAY_MS);
      destroy.onDestroy(() => clearInterval(replay));
    }
    destroy.onDestroy(() => cancelAnimationFrame(this.frame));
  }

  /** The number runs up to its value over the first moment of each play. */
  private countUp() {
    const target = this.type() === 'gauge' ? 1020 : this.type() === 'card' ? 28254 : 4320;
    if (reduced() || typeof requestAnimationFrame === 'undefined') return this.counted.set(target);
    cancelAnimationFrame(this.frame);
    const begin = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - begin) / 900);
      this.counted.set(Math.round(target * (1 - (1 - t) ** 3)));
      if (t < 1) this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }
}
