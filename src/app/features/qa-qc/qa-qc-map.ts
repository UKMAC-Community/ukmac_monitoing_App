import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, signal, viewChild } from '@angular/core';

import { Icon } from '@shared/ui/icon';
import { SegmentedThumb } from '@shared/ui/segmented-thumb';
import type { MapShape } from '@shared/map/mac-map';
import { MacMap3d, type PlotCard } from '@shared/map/mac-map-3d';
import type { SheetWithRows } from '@core/models';
import { WorkbookFormulas } from '@shared/formula/sheet-formulas';
import { todayIso } from '@shared/sheet/columns';
import { buildZoneLayout, filterLayout, mapCentre, plotShapes } from '@shared/map/zone-layout';
import { plotReadings, type Reading, type Status, STATUS_ORDER, worst } from './analysis-readings';
import { batchSourceOf, buildAnalysis } from './analysis-sheet';
import { type CheckTally, checkCells, latestStageCounts, latestStageOf, plotStatuses, type ReadingMatch, readingsUnder, tallyOf, tallyRing, tallyWords } from './check-view';

/** What the map keeps clear when it brings the plots into view: big, the key and details down its right; small, only a little. */
const ROOM_BIG = { top: 70, bottom: 80, left: 110, right: 330 };
const ROOM_SMALL = { top: 56, bottom: 52, left: 70, right: 70 };
/** Seen by check: the list down the map's left (its width and the gaps round it), and the room the farm keeps from it and the edges. */
const LIST_WIDTH = 300;
const LIST_COVER = 12 + LIST_WIDTH + 12;
const CHECK_ROOM = { top: 64, bottom: 76, left: 150, right: 150 };
/** The view the map was last left in. */
const VIEW_KEY = 'ukmac.qa-qc-map.view';
export type MapView = 'towers' | 'checks';

function savedView(): MapView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'checks' ? 'checks' : 'towers';
  } catch {
    return 'towers';
  }
}

/** The status colours, on the stacked layers, the key and the picker's counts. */
export const STATUS_COLOURS: Record<Status | 'NONE', { fill: string; stroke: string; label: string }> = {
  GREEN: { fill: '#34a853', stroke: '#1e7e34', label: 'Green' },
  YELLOW: { fill: '#fbbc04', stroke: '#b98600', label: 'Yellow' },
  RED: { fill: '#ea4335', stroke: '#b3261e', label: 'Red' },
  NONE: { fill: '#c9cec9', stroke: '#8d948f', label: 'No QC record' },
};

const STATUS_KEYS = ['GREEN', 'YELLOW', 'RED'] as const;
/** The numbers in a status's colour (on the key's bars): dark on yellow, white on the rest. */
const STATUS_TEXT: Record<Status, string> = { GREEN: '#ffffff', YELLOW: '#3b2f00', RED: '#ffffff' };

/** A plot in use, laid on the satellite as a pale bed (its layers are what carry the colour). */
const BED = { fill: '#e2e8f0', stroke: '#94a3b8' };

/** A check without its target: "Plant Vigor Score (Avg.) (≥4/5 Preferred)" is "Plant Vigor Score". */
export function shortName(name: string) {
  return name.replace(/ \(.*$/, '');
}

/** A stage and its checks (each by the key the analysis names it with, its own name and its target). */
export interface Stage {
  /** How the analysis names it, which its readings are matched by: "Stage 4 (45 DAT)". */
  name: string;
  no: number;
  /** The farm's own word for it (from the QA/QC table's stage headings): "Flowering". */
  title: string;
  /** "Stage 4 · 45 DAT". */
  sub: string;
  checks: { key: string; label: string; target: string }[];
}

/** What can be stacked on a plot, and how a plot's readings make up one layer of it. */
export const OVERALL = 'overall';
/** Each plot's newest stage with readings: where it is now (seen by check, the pick it opens on). */
export const LATEST = 'latest';
export const stageKey = (stage: string) => `stage:${stage}`;
export const checkKey = (stage: string, check: string) => `check:${stage}|${check}`;

/** What one layer of every plot's stack stands for: the overall, each plot's latest stage, a whole stage (the worst of its checks) or a single check. */
export interface Pane {
  key: string;
  kind: 'overall' | 'latest' | 'stage' | 'check';
  label: string;
  /** A check's stage, said under its name. */
  where: string;
  /** In full, for a hover. */
  title: string;
  match: ReadingMatch;
}

/** A plot in use with a QC record: what each layer of its stack says (null: no reading in it yet). */
interface Entry {
  statuses: (Status | null)[];
  overall: Status | null;
  checks: number;
}

/** How a status looks in words. */
export function fillOf(status: Status | null) {
  return STATUS_COLOURS[status ?? 'NONE'].fill;
}

const wordOf = (status: Status | null) => (status ? STATUS_COLOURS[status].label : 'No reading yet');

/**
 * The QA/QC Analysis on the farm's plots in 3D, as the web's map shows the QA/QC table: every plot with a QC record carries a stack of
 * layers, one for each stage (or for each thing ticked), the first at the bottom and the last on top, each in the colour of what the
 * analysis says there: green is fine, yellow needs watching, red is a problem. A frame with no colour is a layer nothing has been
 * recorded for yet. The key over the map names the layers top first; pointing at a tower names its layers and numbers them; a plot
 * clicked tells its own, the ones that are not green first.
 */
@Component({
  selector: 'app-qa-qc-map',
  imports: [MacMap3d, Icon, NgTemplateOutlet, SegmentedThumb],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card map-card" aria-label="The QA/QC analysis on the plots in 3D">

      <ng-template #keyTpl>
            <aside class="key" aria-label="What the colours mean">
              <header>
                <app-icon name="layers" [size]="14" />
                <strong>What the colours mean</strong>
              </header>
              <footer class="words">
                <span><i [style.background]="fill('GREEN')"></i>Green: fine</span>
                <span><i [style.background]="fill('YELLOW')"></i>Yellow: watch</span>
                <span><i [style.background]="fill('RED')"></i>Red: a problem</span>
                <span><i class="frame"></i>Frame: not entered yet</span>
                <span><i class="dot"></i>Dot by a name: plot overall</span>
              </footer>
            </aside>
      </ng-template>
      <!-- One line of the list seen by check: a ring of how the plots divide, its name, how many are OK (and to watch), a red badge for the problems. -->
      <ng-template #rowTpl let-row let-kind="kind">
        <button type="button" class="cl-row" [class.is-check]="kind === 'check'" [class.on]="chosen() === row.key" [attr.aria-pressed]="chosen() === row.key" [title]="row.title" (click)="choose(row.key)">
          <span class="cl-ring" [style.background]="row.ring"><span></span></span>
          <span class="cl-text">
            <span class="cl-name">{{ row.label }}@if (row.note) { <small>{{ row.note }}</small> }</span>
            <span class="cl-sub"><i [style.background]="fill('GREEN')"></i>{{ row.tally.GREEN }} plot{{ row.tally.GREEN === 1 ? '' : 's' }} OK@if (row.tally.YELLOW) { <span class="cl-watch">· {{ row.tally.YELLOW }} to watch</span> }</span>
            @if (row.at?.length) {
              <span class="cl-at">
                @for (item of row.at; track item.label) {
                  <span><b>{{ item.label }}</b> · {{ item.plots }} plot{{ item.plots === 1 ? '' : 's' }}</span>
                }
              </span>
            }
          </span>
          @if (row.tally.RED) {
            <span class="cl-badge" [attr.aria-label]="row.tally.RED + ' red'">{{ row.tally.RED }}</span>
          }
        </button>
      </ng-template>
      <header class="head">
        <div class="title">
          <h2>QA/QC map</h2>
          @if (view() === 'checks') {
            <p>Pick a check on the left: every plot takes its colour for it. Green is fine, yellow to watch, red a problem.</p>
          } @else {
            <p>Each plot is a tower of layers, first at the bottom. Colour shows how it is doing.</p>
          }
        </div>
        <div class="segmented is-sm" role="group" aria-label="How the map shows the analysis">
          <button type="button" class="segment" [attr.aria-pressed]="view() === 'towers'" title="Each plot a tower of layers, one for each stage" (click)="setView('towers')"><app-icon name="layers" [size]="14" /> Towers</button>
          <button type="button" class="segment" [attr.aria-pressed]="view() === 'checks'" title="Each check in a list, and the plots coloured for the one picked" (click)="setView('checks')"><app-icon name="grid" [size]="14" /> By check</button>
        </div>
        @if (view() === 'towers') {
        <div class="by">
          <button type="button" class="btn btn-secondary btn-sm picker-btn" [attr.aria-expanded]="open()" (click)="open.set(!open())">
            <app-icon name="layers" [size]="14" />
            <span class="by-label">Layers</span>
            <strong>{{ summary() }}</strong>
            <app-icon name="chevron-down" [size]="14" />
          </button>
          @if (open()) {
            <div class="scrim" (click)="open.set(false)"></div>
            <div class="panel" role="group" aria-label="Choose the layers">
              <div class="panel-head">
                <span>Tick what to stack: the first you tick is the bottom layer, the last the top. Nothing ticked: a layer for each stage.</span>
                <button type="button" class="btn btn-plain btn-sm" [disabled]="!picks().length" (click)="clear()">Each stage</button>
              </div>
              <div class="panel-list">
                <label class="row stage-row">
                  <input type="checkbox" [checked]="order(overallKey) > 0" (change)="toggle(overallKey)" />
                  @if (order(overallKey)) {
                    <b class="order">{{ order(overallKey) }}</b>
                  }
                  <span class="name">Overall<small class="target">the worst of every check</small></span>
                  <span class="counts">
                    @for (item of overallCounts(); track item.key) {
                      <span class="count" [title]="item.label + ': ' + item.count + ' plot' + (item.count === 1 ? '' : 's')"><i [style.background]="item.fill"></i>{{ item.count }}</span>
                    }
                  </span>
                </label>
                @for (stage of stages(); track stage.name) {
                  <label class="row stage-row">
                    <input type="checkbox" [checked]="order(stageKey(stage.name)) > 0" (change)="toggle(stageKey(stage.name))" />
                    @if (order(stageKey(stage.name))) {
                      <b class="order">{{ order(stageKey(stage.name)) }}</b>
                    }
                    <span class="name">{{ stage.title }}<small class="target">{{ stage.sub }} · the worst of its checks</small></span>
                    <span class="counts">
                      @for (item of stageCounts(stage); track item.key) {
                        <span class="count" [title]="item.label + ': ' + item.count + ' plot' + (item.count === 1 ? '' : 's')"><i [style.background]="item.fill"></i>{{ item.count }}</span>
                      }
                    </span>
                  </label>
                  @for (check of stage.checks; track check.key) {
                    <label class="row check-row">
                      <input type="checkbox" [checked]="order(checkKey(stage.name, check.key)) > 0" (change)="toggle(checkKey(stage.name, check.key))" />
                      @if (order(checkKey(stage.name, check.key))) {
                        <b class="order">{{ order(checkKey(stage.name, check.key)) }}</b>
                      }
                      <span class="name">{{ check.label }}@if (check.target) { <small class="target">{{ check.target }}</small> }</span>
                      <span class="counts">
                        @for (item of checkCounts(stage.name, check.key); track item.key) {
                          <span class="count" [title]="item.label + ': ' + item.count + ' plot' + (item.count === 1 ? '' : 's')"><i [style.background]="item.fill"></i>{{ item.count }}</span>
                        }
                      </span>
                    </label>
                  }
                }
              </div>
            </div>
          }
        </div>
        }
      </header>

      @if (view() === 'towers' && picks().length) {
        <div class="chips">
          <p>The layers on each plot, from the bottom up:</p>
          @for (pane of panes(); track pane.key; let index = $index) {
            <span class="chip-item">
              <b>{{ index + 1 }}</b>
              {{ pane.label }}
              <button type="button" class="chip-x" [attr.aria-label]="'Remove ' + pane.label" (click)="toggle(pane.key)"><app-icon name="x" [size]="12" /></button>
            </span>
          }
          <button type="button" class="btn btn-plain btn-sm" (click)="clear()">Back to each stage</button>
        </div>
      }

      @if (place(); as at) {
        @if (view() === 'checks') {
        <div class="map-box is-checks">
          <app-mac-map-3d
            [latitude]="at.lat"
            [longitude]="at.lng"
            [name]="name()"
            [shapes]="checkShapes()"
            [farm]="false"
            [selected]="pickedPlot()"
            [card]="checkCard()"
            [fitPadding]="checkRoom"
            [cover]="listCover"
            [fitOnOpen]="true"
            (picked)="pickedPlot.set($event)"
            (cleared)="pickedPlot.set(null)"
          >
            <!-- Down the map's left, also when it is opened big: each check, how the plots are on it; a click colours the map by it. -->
            @if (checkList(); as list) {
            <aside class="check-list" aria-label="Each check, and how the plots are on it">
              <header class="cl-head">
                <strong>Status by check</strong>
                <span>{{ list.plots }} plots · {{ list.checks }} checks</span>
              </header>
              <div class="cl-body">
                <ng-container [ngTemplateOutlet]="rowTpl" [ngTemplateOutletContext]="{ $implicit: list.latest, kind: 'latest' }" />
                <ng-container [ngTemplateOutlet]="rowTpl" [ngTemplateOutletContext]="{ $implicit: list.overall, kind: 'overall' }" />
                @for (stage of list.stages; track stage.key) {
                  <div class="cl-stage">
                    <button type="button" class="fold" [attr.aria-expanded]="!folded().has(stage.key)" [attr.aria-label]="(folded().has(stage.key) ? 'Open the checks of ' : 'Fold the checks of ') + stage.label" (click)="fold(stage.key)"><app-icon name="chevron-down" [size]="14" /></button>
                    <span class="cl-cap">{{ stage.sub }}</span>
                  </div>
                  <ng-container [ngTemplateOutlet]="rowTpl" [ngTemplateOutletContext]="{ $implicit: stage, kind: 'stage' }" />
                  @if (!folded().has(stage.key)) {
                    @for (check of stage.checks; track check.key) {
                      <ng-container [ngTemplateOutlet]="rowTpl" [ngTemplateOutletContext]="{ $implicit: check, kind: 'check' }" />
                    }
                  }
                }
              </div>
              <footer class="cl-key">
                <span><i [style.background]="fill('GREEN')"></i>Fine</span>
                <span><i [style.background]="fill('YELLOW')"></i>To watch</span>
                <span><i [style.background]="fill('RED')"></i>A problem</span>
                <span><i [style.background]="fill(null)"></i>No reading</span>
              </footer>
            </aside>
            }
          </app-mac-map-3d>
        </div>
        } @else {
        <div class="map-box">
          <app-mac-map-3d
            [latitude]="at.lat"
            [longitude]="at.lng"
            [name]="name()"
            [shapes]="shapes()"
            [selected]="pickedPlot()"
            [card]="card()"
            [highlight]="hover()"
            [focus]="stackedIds()"
            [fitPadding]="room()"
            [fitOnOpen]="true"
            (picked)="pickedPlot.set($event)"
            (cleared)="pickedPlot.set(null)"
            (layerHover)="pointed.set($event ? $event.level : null)"
          >
            <!-- One column down the map's right, always the same place: a plot's details (when one is open) and, under them, the key. -->
            <div class="side">
              @if (detail(); as plot) {
                <aside class="detail" aria-live="polite">
                  <header>
                    <div class="who">
                      <h3>{{ plot.title }}</h3>
                      <span class="where">{{ plot.where }}</span>
                    </div>
                    @if (plot.overall) {
                      <span class="badge-status" [style.background]="fill(plot.overall)">{{ statusLabel(plot.overall) }} overall</span>
                    }
                    <button type="button" class="chip-x" aria-label="Close" (click)="pickedPlot.set(null)"><app-icon name="x" [size]="14" /></button>
                  </header>
                  @if (plot.note) {
                    <p class="help-line">{{ plot.note }}</p>
                  } @else {
                    <p class="tally">
                      {{ plot.checks }} checks:
                      @for (item of plot.counts; track item.key) {
                        <span class="count"><i [style.background]="item.fill"></i>{{ item.count }} {{ item.word }}</span>
                      }
                    </p>
                      <ol class="layers">
                      @for (layer of plot.layers; track layer.level) {
                        <li>
                          <div class="layer-head">
                            <span class="num">{{ layer.level + 1 }}</span>
                            <i class="square" [class.frame]="!layer.status" [style.background]="layer.status ? fill(layer.status) : null"></i>
                            <span class="what">
                              <span class="name">{{ layer.label }}</span>
                              @if (layer.where) {
                                <small class="where">{{ layer.where }}</small>
                              }
                            </span>
                            <span class="word">{{ layer.word }}@if (layer.result) { · {{ layer.result }} }</span>
                          </div>
                          @if (layer.items.length) {
                            <ul>
                              @for (item of layer.items; track $index) {
                                <li><i [style.background]="item.fill"></i><span class="check" [title]="item.target">{{ item.check }}</span><span class="result" [title]="item.result">{{ item.result }}</span></li>
                              }
                            </ul>
                          }
                        </li>
                      }
                    </ol>
                  }
                </aside>
              } @else {
                <aside class="detail overview" aria-label="The layers of every plot">
                  <header>
                    <app-icon name="layers" [size]="14" />
                    <strong>Layers, top first</strong>
                    <button type="button" class="fold" [attr.aria-expanded]="keyOpen()" [attr.aria-label]="keyOpen() ? 'Fold the list' : 'Open the list'" (click)="keyOpen.set(!keyOpen())"><app-icon name="chevron-down" [size]="14" /></button>
                  </header>
                  @if (keyOpen()) {
                  <ul class="help">
                    @if (stackedCount()) {
                      <li>Layer 1 is on the ground, layer {{ panes().length }} is on top.</li>
                      <li>Point at a tower or a row to see which layer is which.</li>
                      <li>From above (Top): the outer ring is layer 1, the middle is the top.</li>
                    } @else {
                      <li>No plot has a QC record yet, so nothing is stacked.</li>
                    }
                  </ul>
                  <ol class="rows">
                    <li class="cap"><span aria-hidden="true">▲</span> Top of the stack</li>
                    @for (row of keyRows(); track row.key) {
                      <li class="row" tabindex="0" [class.on]="hover() === row.level" [class.near]="pointed() === row.level" [title]="row.title" (mouseenter)="hover.set(row.level)" (mouseleave)="hover.set(null)" (focus)="hover.set(row.level)" (blur)="hover.set(null)">
                        <span class="num">{{ row.level + 1 }}</span>
                        <span class="what">
                          <span class="name">{{ row.label }}</span>
                          @if (row.where) {
                            <small class="where">{{ row.where }}</small>
                          }
                        </span>
                        <span class="bar" [title]="row.barTitle">
                          @for (item of row.segments; track item.key) {
                            <i [style.flex-grow]="item.count" [style.background]="item.fill" [style.color]="item.text">{{ item.count }}</i>
                          } @empty {
                            <em>no reading</em>
                          }
                        </span>
                      </li>
                    }
                    <li class="cap"><span aria-hidden="true">▼</span> Bottom, on the ground</li>
                  </ol>
                  }
                </aside>
              }
              <ng-container [ngTemplateOutlet]="keyTpl" />
            </div>
          </app-mac-map-3d>
        </div>
        }
      } @else {
        <p class="none-yet">The 3D map needs the plots' outlines: add them in the Zones table (the Zone Map draws them).</p>
      }
    </section>
  `,
  styles: `
    :host { display: block; }
    .map-card { padding: 0; }
    .head { display: flex; align-items: center; gap: 16px; padding: 16px 20px 12px; flex-wrap: wrap; }
    .title { flex: 1; min-width: 240px; }
    .title h2 { margin: 0; font-size: 1.0625rem; }
    .title p { margin: 2px 0 0; color: var(--text-muted); font-size: 0.8125rem; max-width: 760px; }
    .by { position: relative; }
    .picker-btn { max-width: 380px; }
    .picker-btn strong { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .by-label { color: var(--text-muted); font-weight: 400; }
    .scrim { position: fixed; inset: 0; z-index: 20; }
    .panel { position: absolute; top: calc(100% + 6px); right: 0; z-index: 21; width: min(540px, 90vw); background: var(--surface-solid); border: var(--hairline) solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg, 0 12px 32px rgba(0, 0, 0, 0.18)); overflow: hidden; }
    .panel-head { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: var(--hairline) solid var(--border); font-size: 0.75rem; color: var(--text-muted); }
    .panel-head span { flex: 1; }
    .panel-list { max-height: min(420px, 55vh); overflow-y: auto; padding: 6px 0 8px; }
    .panel .row { display: flex; align-items: center; gap: 10px; padding: 5px 14px; cursor: pointer; font-size: 0.8125rem; }
    .panel .row:hover { background: var(--surface-hover); }
    .panel .row .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .stage-row { margin-top: 6px; font-weight: 600; }
    .check-row { padding-left: 38px !important; font-weight: 400; }
    .target { margin-left: 6px; color: var(--text-muted); font-size: 0.6875rem; font-weight: 400; }
    .order { display: inline-grid; place-items: center; flex: none; width: 18px; height: 18px; border-radius: 50%; background: #1d1d1f; color: #fff; font-size: 0.625rem; }
    .counts { display: inline-flex; gap: 8px; flex: none; font-variant-numeric: tabular-nums; color: var(--text-muted); font-size: 0.75rem; font-weight: 400; }
    .count { display: inline-flex; align-items: center; gap: 4px; }
    .count i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }

    .chips { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 0 20px 12px; }
    .chips p { margin: 0; width: 100%; color: var(--text-muted); font-size: 0.75rem; }
    .chip-item { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 4px 0 6px; border: var(--hairline) solid var(--border); border-radius: 999px; background: var(--surface-solid); font-size: 0.75rem; font-weight: 500; }
    .chip-item b { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: #1d1d1f; color: #fff; font-size: 0.625rem; }
    .chip-x { display: inline-grid; place-items: center; width: 22px; height: 22px; border: 0; border-radius: 50%; background: none; color: var(--text-muted); cursor: pointer; }
    .chip-x:hover { background: var(--surface-hover); color: var(--text); }

    .map-box { position: relative; height: clamp(380px, 60vh, 560px); overflow: hidden; border-radius: 0 0 var(--radius-lg) var(--radius-lg); }
    /* Seen by check the farm has room round it: a taller map. */
    .map-box.is-checks { height: clamp(500px, 74vh, 780px); }
    .map-box app-mac-map-3d { container-type: size; }
    .map-box app-mac-map-3d:not(.m3-expanded) { position: absolute; inset: 0; }
    /* Small: just the map (the layers and the key are over it only when it is opened big, with Open). */
    .map-box app-mac-map-3d:not(.m3-expanded) .side { display: none; }
    .none-yet { padding: 28px 20px; text-align: center; color: var(--text-muted); font-size: 0.875rem; }

    /* What is laid over the map (it is inside the map, so it stays when the map is opened big). */
    .key, .detail { display: flex; flex-direction: column; background: var(--surface-solid); border: var(--hairline) solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-card); font-size: 0.8125rem; color: var(--text); }
    .key { flex: none; }
    .key > header { padding: 5px 10px 5px 12px; }
    .key .words { padding: 5px 12px 6px; gap: 2px 10px; border-top: 0; }
    /* The key is always in this column; with a plot open it sits under that plot's details and tells only its colours (the details have the layers). */
    .side { position: absolute; z-index: 5; right: 12px; top: 58px; width: 350px; max-height: calc(100% - 58px - 56px); display: flex; flex-direction: column; gap: 6px; overflow-y: auto; scrollbar-width: thin; border-radius: var(--radius-lg); }
    .key > header, .overview > header { display: flex; align-items: center; gap: 8px; padding: 9px 10px 9px 12px; }
    .key > header strong, .overview > header strong { flex: 1; }
    .overview { padding: 0; }
    .overview > header { padding: 9px 10px 4px 12px; }
    .fold { display: inline-grid; place-items: center; width: 24px; height: 24px; border: 0; border-radius: 50%; background: none; color: var(--text-muted); cursor: pointer; }
    .fold:hover { background: var(--surface-hover); color: var(--text); }
    .fold app-icon { display: inline-flex; transition: transform 0.15s; }
    .fold[aria-expanded='false'] app-icon { transform: rotate(-90deg); }
    .help { margin: 0; padding: 0 12px 8px 26px; color: var(--text-muted); font-size: 0.75rem; line-height: 1.45; }
    .help li { margin-bottom: 2px; }
    .help-line { margin: 0; padding: 0 0 4px; color: var(--text-muted); font-size: 0.75rem; line-height: 1.5; }
    .rows { margin: 0; padding: 0 0 4px; list-style: none; }
    .rows .row { display: flex; align-items: center; gap: 8px; padding: 2px 12px; outline: none; cursor: default; }
    .rows .row:hover, .rows .row.on, .rows .row:focus-visible { background: var(--surface-hover); }
    .rows .row.near { box-shadow: inset 3px 0 0 var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
    .num { flex: none; display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 4px; background: #1d1d1f; color: #fff; font-size: 0.625rem; font-weight: 700; }
    .what { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.25; }
    .what .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
    .what .where { color: var(--text-muted); font-size: 0.6875rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    /* How the plots with a reading divide into green, yellow and red on one layer: a bar of three parts, each with its count. */
    .bar { flex: none; display: flex; width: 90px; height: 18px; overflow: hidden; border-radius: 5px; background: var(--surface-hover); }
    .bar i { flex-basis: 0; min-width: 0; display: grid; place-items: center; overflow: hidden; font-size: 0.625rem; font-style: normal; font-weight: 700; line-height: 1; }
    .bar em { margin: auto; color: var(--text-muted); font-size: 0.625rem; font-style: normal; }
    .cap { display: flex; align-items: center; gap: 6px; padding: 4px 12px; color: var(--accent); font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
    .words { display: flex; flex-wrap: wrap; gap: 3px 10px; padding: 7px 12px; border-top: var(--hairline) solid var(--border); font-size: 0.6875rem; color: var(--text-muted); }
    .words span { display: inline-flex; align-items: center; gap: 5px; }
    .words i, .square { width: 11px; height: 11px; border-radius: 3px; display: inline-block; flex: none; box-sizing: border-box; }
    .words i.dot { width: 9px; height: 9px; border-radius: 50%; background: #475569; box-shadow: 0 0 0 1.5px #fff, 0 0 0 2.5px #94a3b8; }
    .frame { background: transparent; border: 2px solid #94a3b8; }

    .detail { flex: none; padding: 10px 12px 8px; }
    /* A small map: the key gives up its help and some width, the details some width, and the key folds while a plot is open (its layers are in the details). */
    @container (max-width: 1000px) {
      .side { width: 306px; }
    }
    @container (max-height: 640px) {
      .overview .help { display: none; }
    }
    .detail > header { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
    .detail .who { flex: 1; min-width: 0; }
    .detail h3 { margin: 0; font-size: 1rem; }
    .detail .who .where { color: var(--text-muted); font-size: 0.75rem; }
    .tally { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; margin: 0 0 6px; color: var(--text-muted); font-size: 0.75rem; }
    .tally .count { color: var(--text); font-weight: 500; }
    .badge-status { padding: 2px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; color: rgba(0, 0, 0, 0.75); white-space: nowrap; }
    .layers { margin: 0; padding: 0; list-style: none; display: grid; gap: 3px; }
    .layer-head { display: flex; align-items: center; gap: 8px; }
    .layer-head .name { font-weight: 600; }
    .layer-head .word { margin-left: auto; flex: none; color: var(--text-muted); font-size: 0.75rem; white-space: nowrap; }
    .layers ul { margin: 1px 0 0 28px; padding: 0; list-style: none; display: grid; grid-template-columns: minmax(0, 1fr); gap: 0; }
    .layers ul li { display: flex; align-items: baseline; gap: 8px; min-width: 0; font-size: 0.75rem; line-height: 1.3; }
    .layers ul li i { width: 9px; height: 9px; border-radius: 2px; flex: none; align-self: center; }
    .layers .check { flex: none; font-weight: 500; }
    .layers .result { color: var(--text-muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* Seen by check: the list down the map's left (as wide as the room the map keeps for it). */
    .check-list { position: absolute; z-index: 5; left: 12px; top: 12px; bottom: 16px; width: 300px; display: flex; flex-direction: column; background: var(--surface-solid); border: var(--hairline) solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-card); overflow: hidden; font-size: 0.8125rem; color: var(--text); }
    .cl-head { display: flex; flex-direction: column; gap: 1px; padding: 12px 14px 10px; border-bottom: var(--hairline) solid var(--border); }
    .cl-head strong { font-size: 0.875rem; }
    .cl-head span { color: var(--text-muted); font-size: 0.75rem; }
    .cl-body { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; padding: 4px 0 8px; }
    .cl-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 12px 7px 14px; border: 0; background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; box-shadow: inset 3px 0 0 transparent; }
    .cl-row:hover { background: var(--surface-hover); }
    .cl-row.on { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); }
    .cl-row.is-check { padding: 5px 12px 5px 34px; }
    .cl-ring { flex: none; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; }
    .cl-ring span { width: 18px; height: 18px; border-radius: 50%; background: var(--surface-solid); }
    .cl-row.on .cl-ring span { background: color-mix(in srgb, var(--accent-soft) 60%, var(--surface-solid)); }
    .cl-row.is-check .cl-ring { width: 22px; height: 22px; }
    .cl-row.is-check .cl-ring span { width: 13px; height: 13px; }
    .cl-text { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.3; }
    .cl-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .cl-row.is-check .cl-name { font-weight: 500; }
    .cl-name small { margin-left: 5px; color: var(--text-muted); font-size: 0.6875rem; font-weight: 400; }
    .cl-sub { display: flex; align-items: center; gap: 5px; color: var(--text-muted); font-size: 0.75rem; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .cl-sub i { flex: none; width: 7px; height: 7px; border-radius: 50%; }
    .cl-watch { color: var(--warning); font-weight: 500; }
    .cl-at { display: flex; flex-direction: column; margin-top: 3px; color: var(--text-muted); font-size: 0.75rem; font-variant-numeric: tabular-nums; }
    .cl-at span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cl-at b { font-weight: 600; color: var(--text); }
    .cl-badge { flex: none; display: inline-grid; place-items: center; min-width: 22px; height: 22px; padding: 0 6px; box-sizing: border-box; border-radius: 999px; background: #ea4335; color: #fff; font-size: 0.6875rem; font-weight: 700; font-variant-numeric: tabular-nums; }
    .cl-stage { display: flex; align-items: center; gap: 2px; margin-top: 8px; padding: 0 12px 0 6px; }
    .cl-cap { color: var(--text-muted); font-size: 0.6875rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }
    .cl-key { display: flex; flex-wrap: wrap; gap: 3px 12px; padding: 8px 14px; border-top: var(--hairline) solid var(--border); color: var(--text-muted); font-size: 0.6875rem; }
    .cl-key span { display: inline-flex; align-items: center; gap: 5px; }
    .cl-key i { width: 10px; height: 10px; border-radius: 3px; }
  `,
})
export class QaQcMap {
  /** The QA/QC table, the MAC's tables, and the MAC (its place and name). */
  readonly sheet = input.required<SheetWithRows>();
  readonly sheets = input.required<readonly SheetWithRows[]>();
  readonly mac = input<{ macName: string; latitude: number | null; longitude: number | null } | null>(null);

  /** What is stacked, in the order ticked (the first at the bottom); none ticked: a layer for each stage. */
  readonly picks = signal<readonly string[]>([]);
  readonly open = signal(false);
  readonly keyOpen = signal(true);
  readonly pickedPlot = signal<string | null>(null);

  /** Towers (a stack of layers on each plot) or by check (a list down the left, the plots coloured for the one picked). */
  readonly view = signal<MapView>(savedView());
  setView(view: MapView) {
    if (view === this.view()) return;
    this.view.set(view);
    this.pickedPlot.set(null);
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* kept for this run only */
    }
  }
  /** The layer the pointer is over on the key (its place from the bottom): it is lit up on the map. */
  readonly hover = signal<number | null>(null);
  /** The layer the pointer is over on the map: its row on the key is marked. */
  readonly pointed = signal<number | null>(null);

  /** What the map keeps clear when it brings the plots into view: the key and details down its right, the buttons over it and the tools under it. */
  readonly room = computed(() => (this.big()?.expanded() ? ROOM_BIG : ROOM_SMALL));
  private readonly big = viewChild(MacMap3d);
  readonly overallKey = OVERALL;
  readonly stageKey = stageKey;
  readonly checkKey = checkKey;

  readonly name = computed(() => this.mac()?.macName ?? 'MAC');

  private readonly built = computed(() => buildAnalysis(this.sheet(), batchSourceOf(this.sheets())));
  /** What the analysis says of each plot. */
  private readonly readings = computed(() => plotReadings(this.built(), new WorkbookFormulas([...this.sheets(), this.built().sheet], todayIso())));

  private readonly layout = computed(() =>
    buildZoneLayout(
      this.sheets().find((item) => item.templateKey === 'zones') ?? null,
      this.sheets().find((item) => item.templateKey === 'zone-records') ?? null,
    ),
  );
  private readonly cells = computed(() => new Map(this.layout().cells.map((cell) => [cell.id, cell])));

  /** The farm's own word for each stage, from the QA/QC table's headings ("4 · Flowering (45 DAT)" says "Flowering"). */
  private readonly stageTitles = computed(() => {
    const titles = new Map<number, string>();
    for (const column of this.sheet().columns) {
      const match = /^(\d+) · (.+)$/.exec(column.box ?? '');
      if (match && !titles.has(Number(match[1]))) titles.set(Number(match[1]), match[2].replace(/ \(.*\)$/, ''));
    }
    return titles;
  });

  /** The stages and, in each, its checks: what can be stacked. */
  readonly stages = computed(() => {
    const stages: Stage[] = [];
    for (const item of this.built().columns) {
      if (item.kind !== 'status') continue;
      let stage = stages.find((entry) => entry.name === item.stage);
      if (!stage) {
        const parts = /^Stage (\d+) \((.*)\)$/.exec(item.stage);
        const no = parts ? Number(parts[1]) : 0;
        stages.push((stage = { name: item.stage, no, title: this.stageTitles().get(no) ?? item.stage, sub: parts ? `Stage ${no} · ${parts[2]}` : item.stage, checks: [] }));
      }
      stage.checks.push({ key: item.check, label: item.label ?? shortName(item.check), target: item.target ?? '' });
    }
    return stages;
  });

  fill(status: Status | null) {
    return fillOf(status);
  }

  statusLabel(status: Status) {
    return STATUS_COLOURS[status].label;
  }

  // ------------------------------------------------------------ what is stacked

  /** Everything that can be a layer, by its key: the overall, each stage, each check. */
  private readonly catalogue = computed(() => {
    const catalogue = new Map<string, Pane>();
    catalogue.set(OVERALL, { key: OVERALL, kind: 'overall', label: 'Overall', where: '', title: 'Overall: the worst of every check', match: () => true });
    // A plot's newest stage, found once for its readings.
    const order = this.stages().map((stage) => stage.name);
    const latest = new WeakMap<readonly Reading[], string | null>();
    const latestOf = (all: readonly Reading[]) => {
      if (!latest.has(all)) latest.set(all, latestStageOf(all, order));
      return latest.get(all) ?? null;
    };
    catalogue.set(LATEST, {
      key: LATEST,
      kind: 'latest',
      label: 'Latest stage',
      where: '',
      title: 'Latest stage: each plot by the worst of the checks of the newest stage it has data in',
      match: (reading, all) => reading.stage === latestOf(all),
    });
    for (const stage of this.stages()) {
      const checks = stage.checks.length;
      catalogue.set(stageKey(stage.name), {
        key: stageKey(stage.name),
        kind: 'stage',
        label: stage.title,
        where: '',
        title: `${stage.title} (${stage.sub}): the worst of its ${checks} check${checks === 1 ? '' : 's'}`,
        match: (reading) => reading.stage === stage.name,
      });
      for (const check of stage.checks) {
        catalogue.set(checkKey(stage.name, check.key), {
          key: checkKey(stage.name, check.key),
          kind: 'check',
          label: check.label,
          where: `Stage ${stage.no} · ${stage.title}`,
          title: `${check.label}${check.target ? ` (${check.target})` : ''} · ${stage.sub} · ${stage.title}`,
          match: (reading) => reading.stage === stage.name && reading.check === check.key,
        });
      }
    }
    return catalogue;
  });

  /** The layers of every plot's stack, the bottom one first: what is ticked, in the order ticked; else each stage. */
  readonly panes = computed<Pane[]>(() => {
    const catalogue = this.catalogue();
    const ticked = this.picks()
      .map((key) => catalogue.get(key))
      .filter((pane): pane is Pane => !!pane);
    if (ticked.length) return ticked;
    return this.stages().map((stage) => catalogue.get(stageKey(stage.name))!);
  });

  toggle(key: string) {
    const now = this.picks();
    this.picks.set(now.includes(key) ? now.filter((item) => item !== key) : [...now, key]);
  }

  /** Its place among what is ticked (1 the bottom layer); 0 when it is not ticked. */
  order(key: string) {
    return this.picks().indexOf(key) + 1;
  }

  clear() {
    this.picks.set([]);
  }

  /** The picker button's words: what is stacked now. */
  readonly summary = computed(() => {
    const panes = this.panes();
    if (!this.picks().length) return `Each stage (${panes.length} layers)`;
    return panes.length === 1 ? panes[0].label : `${panes.length} layers`;
  });

  // ------------------------------------------------------------ the stacks

  /** The plots in use that have a QC record, by their id: what each layer of their stack says. */
  private readonly stacked = computed(() => {
    const panes = this.panes();
    const entries = new Map<string, Entry>();
    for (const cell of this.layout().cells) {
      if (cell.usage !== 'normal') continue;
      const list = this.readings().get(cell.plot);
      if (!list?.length) continue;
      entries.set(cell.id, {
        statuses: panes.map((pane) => worst(readingsUnder(list, pane.match).map((reading) => reading.status))),
        overall: worst(list.map((reading) => reading.status)),
        checks: list.length,
      });
    }
    return entries;
  });

  readonly stackedCount = computed(() => this.stacked().size);
  /** The plots with a QC record: the map opens on them (the rest of the farm round them). */
  readonly stackedIds = computed(() => [...this.stacked().keys()]);

  /**
   * The plots for the map: only those with a QC record (the rest of the farm, with no record, and water, are left off), each a pale bed
   * under its stack, with a dot by its name of what the plot comes to. While no plot has a record yet, every plot is drawn as a pale bed
   * (as the Zone Map has them) so the map is not empty.
   */
  readonly shapes = computed<MapShape[]>(() => {
    const panes = this.panes();
    const stacked = this.stacked();
    const all = plotShapes(this.layout());
    return (stacked.size ? all.filter((shape) => stacked.has(shape.id)) : all).map((shape) => {
      const cell = this.cells().get(shape.id)!;
      if (cell.usage !== 'normal') return { id: shape.id, points: shape.points, label: shape.label, fill: cell.palette.bg, stroke: cell.palette.border, hint: cell.usage === 'water' ? 'Water' : 'Not a plot in use' };
      const entry = stacked.get(shape.id);
      return {
        id: shape.id,
        points: shape.points,
        label: shape.label,
        fill: BED.fill,
        stroke: BED.stroke,
        hint: entry ? `${entry.overall ? STATUS_COLOURS[entry.overall].label : 'No reading'} overall: point at a layer` : 'No QC record yet',
        ...(entry
          ? {
              badge: fillOf(entry.overall),
              stack: panes.map((pane, level) => ({
                fill: entry.statuses[level] ? fillOf(entry.statuses[level]) : null,
                label: pane.where ? `${pane.label} (${pane.where})` : pane.label,
                note: wordOf(entry.statuses[level]),
              })),
            }
          : {}),
      };
    });
  });

  readonly place = computed(() => mapCentre(this.mac() ?? { latitude: null, longitude: null }, this.shapes()));

  /** The key: the layers top first, each numbered from the bottom, with how many of the plots with a reading are green, yellow and red. */
  readonly keyRows = computed(() => {
    const panes = this.panes();
    const entries = [...this.stacked().values()];
    return panes
      .map((pane, level) => {
        const counts: Record<Status, number> = { GREEN: 0, YELLOW: 0, RED: 0 };
        for (const entry of entries) {
          const status = entry.statuses[level];
          if (status) counts[status] += 1;
        }
        const scored = counts.GREEN + counts.YELLOW + counts.RED;
        const segments = STATUS_KEYS.filter((status) => counts[status]).map((status) => ({ key: status, label: STATUS_COLOURS[status].label, fill: STATUS_COLOURS[status].fill, text: STATUS_TEXT[status], count: counts[status] }));
        return {
          level,
          key: pane.key,
          label: pane.label,
          where: pane.where,
          title: pane.title,
          scored,
          segments,
          barTitle: scored ? `${segments.map((item) => `${item.count} ${item.label.toLowerCase()}`).join(', ')} of ${scored} plot${scored === 1 ? '' : 's'}` : 'No plot has a reading here yet',
        };
      })
      .reverse();
  });

  // ------------------------------------------------------------ a plot picked

  private where(cell: { zone: string; section: number | null }) {
    return cell.section !== null ? `Zone ${cell.zone} · ${cell.section}` : cell.zone;
  }

  /** How many of a plot's checks are red, yellow and green, in words. */
  private tally(list: readonly Reading[]) {
    return (['RED', 'YELLOW', 'GREEN'] as const)
      .map((status) => ({ key: status, fill: STATUS_COLOURS[status].fill, word: STATUS_COLOURS[status].label.toLowerCase(), count: list.filter((reading) => reading.status === status).length }))
      .filter((item) => item.count);
  }

  /** The plot picked: its stack, layer by layer, top first; a layer that is not green says which of its checks are not. */
  readonly detail = computed(() => {
    const cell = this.cells().get(this.pickedPlot() ?? '');
    if (!cell) return null;
    const title = cell.usage === 'normal' ? cell.plot : cell.label;
    const entry = this.stacked().get(cell.id);
    if (!entry) {
      return { title, where: this.where(cell), overall: null, note: cell.usage === 'normal' ? 'No QC record for this plot yet.' : 'Not a plot in use.', checks: 0, counts: [], layers: [] };
    }
    const list = this.readings().get(cell.plot) ?? [];
    const layers = this.panes()
      .map((pane, level) => {
        const status = entry.statuses[level];
        const inside = readingsUnder(list, pane.match);
        return {
          level,
          label: pane.label,
          where: pane.where,
          status,
          word: wordOf(status),
          // A single check says its result on its own line; a stage or the overall says which of its checks are not green, the worst first.
          result: pane.kind === 'check' ? (inside[0]?.result ?? '') : '',
          items:
            pane.kind === 'check'
              ? []
              : inside
                  .filter((reading) => reading.status !== 'GREEN')
                  .sort((a, b) => STATUS_ORDER[b.status] - STATUS_ORDER[a.status])
                  .map((reading) => ({ check: reading.label, target: reading.target, fill: STATUS_COLOURS[reading.status].fill, result: reading.result })),
        };
      })
      .reverse();
    return { title, where: this.where(cell), overall: entry.overall, note: '', checks: entry.checks, counts: this.tally(list), layers };
  });

  /** The picked plot's card over it on the map: its worst, and how its checks divide. */
  readonly card = computed<PlotCard | null>(() => {
    const cell = this.cells().get(this.pickedPlot() ?? '');
    if (!cell) return null;
    const entry = this.stacked().get(cell.id);
    if (!entry) return { title: cell.usage === 'normal' ? cell.plot : cell.label, lines: [cell.usage === 'normal' ? 'No QC record yet' : 'Not a plot in use'], color: STATUS_COLOURS.NONE.fill };
    const counts = this.tally(this.readings().get(cell.plot) ?? []);
    return {
      title: cell.plot,
      lines: [`${entry.overall ? STATUS_COLOURS[entry.overall].label : 'No reading'} overall`, `${counts.map((item) => `${item.count} ${item.word}`).join(' · ')} checks`],
      color: fillOf(entry.overall),
    };
  });

  // ------------------------------------------------------------ seen by check

  readonly checkRoom = CHECK_ROOM;
  readonly listCover = LIST_COVER;
  /** What the plots are coloured for: the overall, a stage or a check (by its key, as the layers name them). */
  readonly chosen = signal<string>(LATEST);
  /** The stages whose checks are folded away in the list. */
  readonly folded = signal<ReadonlySet<string>>(new Set());

  choose(key: string) {
    this.chosen.set(key);
  }

  fold(key: string) {
    this.folded.update((set) => {
      const next = new Set(set);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  private readonly chosenPane = computed(() => this.catalogue().get(this.chosen()) ?? this.catalogue().get(LATEST)!);
  /** The plots the map colours: in use, with an outline. */
  private readonly checkedCells = computed(() => checkCells(this.layout().cells));
  /** What the pick says of each of those plots: one place for the map's colours and the list's counts. */
  private readonly chosenStatuses = computed(() => plotStatuses(this.checkedCells(), this.readings(), this.chosenPane().match));

  /** The list down the map's left: the overall, then each stage and its checks, each with how its plots divide. */
  readonly checkList = computed(() => {
    const cells = this.checkedCells();
    const readings = this.readings();
    const catalogue = this.catalogue();
    const fills = { GREEN: fillOf('GREEN'), YELLOW: fillOf('YELLOW'), RED: fillOf('RED'), NONE: fillOf(null) };
    const row = (key: string, label: string, note: string) => {
      const pane = catalogue.get(key)!;
      const tally: CheckTally = tallyOf(plotStatuses(cells, readings, pane.match));
      return { key, label, note, tally, ring: tallyRing(tally, fills), title: `${pane.title}: ${tallyWords(tally)}` };
    };
    const stages = this.stages().map((stage) => ({
      ...row(stageKey(stage.name), stage.title, 'whole stage'),
      sub: stage.sub,
      checks: stage.checks.map((check) => row(checkKey(stage.name, check.key), check.label, check.target)),
    }));
    return {
      plots: cells.length,
      checks: stages.reduce((sum, stage) => sum + stage.checks.length, 0),
      latest: {
        ...row(LATEST, 'Latest stage', "each plot's newest"),
        // Which stages the plots are at: "Stage 9 · 75–150 DAT · 90 plots".
        at: latestStageCounts(cells, readings, this.stages().map((stage) => stage.name)).map((item) => ({
          label: this.stages().find((stage) => stage.name === item.stage)?.sub ?? item.stage,
          plots: item.plots,
        })),
      },
      overall: row(OVERALL, 'Overall', 'every check'),
      stages,
    };
  });

  /** What a plot's readings under the pick say: a check its result; a stage or the overall how its checks divide (the latest stage also which stage). */
  private saying(pane: Pane, plot: string): string {
    const inside = readingsUnder(this.readings().get(plot) ?? [], pane.match);
    if (!inside.length) return '';
    if (pane.kind === 'check') return inside[0].result;
    const counts = `${this.tally(inside).map((item) => `${item.count} ${item.word}`).join(' · ')} of ${inside.length} check${inside.length === 1 ? '' : 's'}`;
    if (pane.kind !== 'latest') return counts;
    const stage = this.stages().find((item) => item.name === inside[0].stage);
    return `${stage?.sub ?? inside[0].stage}: ${counts}`;
  }

  /**
   * The zones' plots as the MAC's map draws them (their outlines, each zone's colour round its plots and its name beside them), each in
   * one colour: what the pick says there, grey where it has no reading.
   */
  readonly checkShapes = computed<MapShape[]>(() => {
    const pane = this.chosenPane();
    const statuses = this.chosenStatuses();
    return plotShapes(filterLayout(this.layout(), 'zones')).map((shape) => {
      const cell = this.cells().get(shape.id)!;
      const status = statuses.get(shape.id) ?? null;
      const said = this.saying(pane, cell.plot);
      return { ...shape, fill: fillOf(status), hint: `${pane.label}: ${wordOf(status)}${said ? ` · ${said}` : ''}` };
    });
  });

  /** The plot picked, seen by check: what the pick says there, and where it is. */
  readonly checkCard = computed<PlotCard | null>(() => {
    const cell = this.cells().get(this.pickedPlot() ?? '');
    if (!cell) return null;
    const pane = this.chosenPane();
    const status = this.chosenStatuses().get(cell.id) ?? null;
    return { title: cell.plot, lines: [`${pane.label}: ${wordOf(status)}`, this.saying(pane, cell.plot), this.where(cell)].filter(Boolean), color: fillOf(status) };
  });

  // ------------------------------------------------------------ the counts in the picker

  /** How many plots each colour has on one check: what ticking it would show. */
  private readonly countsByCheck = computed(() => {
    const counts = new Map<string, Record<Status, number>>();
    for (const list of this.readings().values()) {
      for (const reading of list) {
        const key = checkKey(reading.stage, reading.check);
        const entry = counts.get(key) ?? { GREEN: 0, YELLOW: 0, RED: 0 };
        entry[reading.status] += 1;
        counts.set(key, entry);
      }
    }
    return counts;
  });

  private countItems(entry: Record<Status, number> | undefined) {
    return STATUS_KEYS.filter((status) => entry?.[status]).map((status) => ({ key: status, label: STATUS_COLOURS[status].label, fill: STATUS_COLOURS[status].fill, count: entry![status] }));
  }

  checkCounts(stage: string, check: string) {
    return this.countItems(this.countsByCheck().get(checkKey(stage, check)));
  }

  /** A stage's colours: its plots by the worst of the stage's checks. */
  stageCounts(stage: Stage) {
    const entry: Record<Status, number> = { GREEN: 0, YELLOW: 0, RED: 0 };
    for (const list of this.readings().values()) {
      const worse = worst(list.filter((reading) => reading.stage === stage.name).map((reading) => reading.status));
      if (worse) entry[worse] += 1;
    }
    return this.countItems(entry);
  }

  /** The overall's colours: the plots in use by the worst of all their checks. */
  readonly overallCounts = computed(() => {
    const entry: Record<Status, number> = { GREEN: 0, YELLOW: 0, RED: 0 };
    for (const cell of this.layout().cells) {
      if (cell.usage !== 'normal') continue;
      const worse = worst((this.readings().get(cell.plot) ?? []).map((reading) => reading.status));
      if (worse) entry[worse] += 1;
    }
    return this.countItems(entry);
  });
}
