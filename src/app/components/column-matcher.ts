import {
  afterEveryRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';

import type { Column } from '../core/models';
import type { FileColumn } from '../excel/excel-template';
import { stageOfBox } from '../excel/header-match';
import { columnLabel } from '../sheet/columns';
import { Icon } from './icon';

type Side = 'file' | 'table';
type Mapping = Record<string, number>;

/** A pointer moved this far (px) is dragging, not clicking. */
const DRAG_FROM = 5;
/** How wide each of the two lists is (px): the person's choice is kept for the next import. */
const WIDTH_KEY = 'ukmac.matcher-width';
const MIN_WIDTH = 240;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 340;
/** A long name that doesn't fit keeps its end: this many characters at most (from a word's start). */
const TAIL = 22;

function storedWidth() {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(saved) && saved >= MIN_WIDTH ? Math.min(saved, MAX_WIDTH) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

/**
 * A name in two parts for a narrow list: the start (shortened with "…" if it must be) and the end, which stays. Names
 * in one file often differ only at their end ("… in 20 plants/ Seedling Leaf Stage (No.) › 3, >5").
 */
export function nameParts(name: string): [string, string] {
  if (name.length <= TAIL + 8) return [name, ''];
  const from = name.indexOf(' ', name.length - TAIL);
  return from > 0 ? [name.slice(0, from), name.slice(from)] : [name.slice(0, name.length - 14), name.slice(name.length - 14)];
}

/**
 * The file's columns beside the table's, a line between each pair matched (as a database import wizard
 * does): drag from one to the other, or click one then the other; click a line to take it off.
 * `mapping` is each table column's key → the file's column (its worksheet position) that fills it.
 */
@Component({
  selector: 'app-column-matcher',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown.escape)': 'picked.set(null)' },
  template: `
    <section class="matcher">
      <header class="bar">
        <span class="count">{{ count() }} of {{ targets().length }} matched</span>
        <span class="grow"></span>
        <label class="width" title="How wide the two lists are, to read long names whole">
          <span>Width</span>
          <input type="range" [min]="minWidth" [max]="maxWidth" step="20" [value]="width()" (input)="setWidth($event)" aria-label="Width of the lists" />
        </label>
        <button type="button" class="btn btn-plain btn-sm" (click)="auto.emit()"><app-icon name="refresh" /> Match by name</button>
        <button type="button" class="btn btn-plain btn-sm" [disabled]="!count()" (click)="clear()">Clear</button>
      </header>

      @if (stageChips().length) {
        <nav class="stages" aria-label="Stages">
          <button type="button" class="stage-chip" [class.on]="stage() === 'all'" (click)="showStage('all')">All</button>
          @for (chip of stageChips(); track chip.stage) {
            <button type="button" class="stage-chip" [class.on]="stage() === chip.stage" [class.done]="chip.total > 0 && chip.matched === chip.total" (click)="showStage(chip.stage)" [title]="chip.matched + ' of ' + chip.total + ' columns of the table matched'">
              {{ chip.label }} <small>{{ chip.matched }}/{{ chip.total }}</small>
            </button>
          }
        </nav>
      }

      <div class="diagram" [style.grid-template-columns]="'minmax(0, ' + width() + 'px) 110px minmax(0, ' + width() + 'px)'">
        <div class="panel">
          <h4>Columns in the file</h4>
          <ul>
            @for (file of shownFiles(); track file.position; let i = $index) {
              @if (fileGroupStarts(i); as label) {
                <li class="group-label" aria-hidden="true">{{ label }}</li>
              }
              <li
                class="item"
                [attr.data-pos]="file.position"
                [class.on]="used().has(file.position)"
                [class.picked]="picked()?.side === 'file' && picked()?.id === file.position"
                [class.open]="openFile() === file.position"
                [title]="file.header"
                (pointerdown)="down($event, 'file', file.position)"
              >
                <div class="head">
                  <span class="name"><span class="a">{{ parts(file.header)[0] }}</span><span class="z">{{ parts(file.header)[1] }}</span></span>
                  <app-icon class="chev" [name]="openFile() === file.position ? 'chevron-down' : 'chevron-right'" />
                </div>
                @if (openFile() === file.position) {
                  <div class="peek">
                    @for (value of file.values; track value.row) {
                      <div class="val"><span class="row">Row {{ value.row }}</span><span class="text" [title]="value.text">{{ value.text }}</span></div>
                    } @empty {
                      <span class="none">Nothing under this heading.</span>
                    }
                  </div>
                }
              </li>
            }
          </ul>
        </div>

        <svg class="lines" aria-hidden="true">
          @for (line of lines(); track line.key) {
            <path class="hit" [attr.d]="line.d" (click)="unmatch(line.key)" />
            <path class="line" [attr.d]="line.d" />
            <circle class="dot" cx="0" [attr.cy]="line.y1" r="3" />
            <circle class="dot" [attr.cx]="coords().w" [attr.cy]="line.y2" r="3" />
          }
          @if (dragPath(); as d) {
            <path class="line is-drag" [attr.d]="d" />
          }
        </svg>

        <div class="panel">
          <h4>Columns of {{ tableTitle() }}</h4>
          <ul>
            @for (column of shownTargets(); track column.key; let i = $index) {
              @if (targetGroupStarts(i); as label) {
                <li class="group-label" aria-hidden="true">{{ label }}</li>
              }
              <li
                class="item"
                [attr.data-key]="column.key"
                [class.on]="local()[column.key] != null"
                [class.picked]="picked()?.side === 'table' && picked()?.id === column.key"
                [class.open]="openTable() === column.key"
                [title]="label(column)"
                (pointerdown)="down($event, 'table', column.key)"
              >
                <div class="head">
                  <span class="name"><span class="a">{{ parts(label(column))[0] }}</span><span class="z">{{ parts(label(column))[1] }}</span></span>
                  @if (column.required) {
                    <span class="req" title="Every row needs this column">*</span>
                  }
                  <app-icon class="chev" [name]="openTable() === column.key ? 'chevron-down' : 'chevron-right'" />
                </div>
                @if (openTable() === column.key) {
                  <div class="peek">
                    @if (fillingFrom(column.key); as from) {
                      <span class="from">Filled from “{{ from.header }}”</span>
                      @for (value of from.values; track value.row) {
                        <div class="val"><span class="row">Row {{ value.row }}</span><span class="text" [title]="value.text">{{ value.text }}</span></div>
                      } @empty {
                        <span class="none">Nothing under that heading.</span>
                      }
                    } @else {
                      <span class="none">Nothing fills it yet. Match a column of the file to it.</span>
                    }
                  </div>
                }
              </li>
            }
          </ul>
        </div>
      </div>
      <p class="muted hint">Drag a column of the file onto a column of the table, or click one then the other. Click a line to take it off. A click also shows the first values in that column.</p>
    </section>
  `,
  styles: `
    :host { display: flex; flex-direction: column; min-height: 0; }
    .matcher { flex: 1; min-height: 0; display: flex; flex-direction: column; border: var(--hairline) solid var(--border); border-radius: var(--radius-md); background: var(--surface-solid); padding: 8px 14px 10px; }
    .bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .count { font-size: 0.875rem; font-weight: 600; }
    .grow { flex: 1; }
    .hint { margin: 8px 0 0; text-align: center; font-size: 0.75rem; }
    .diagram { display: grid; grid-template-columns: minmax(0, 340px) 110px minmax(0, 340px); justify-content: center; flex: 1; min-height: 0; overflow: auto; margin-top: 8px; align-items: start; }
    .panel { border: var(--hairline) solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface-solid); overflow: hidden; }
    .panel h4 { position: sticky; top: 0; z-index: 1; margin: 0; padding: 5px 10px; background: var(--fill); border-bottom: var(--hairline) solid var(--border); font-size: 0.75rem; font-weight: 600; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .panel ul { list-style: none; margin: 0; padding: 0; }
    .item { min-width: 0; font-size: 0.8125rem; line-height: 1.3; cursor: pointer; user-select: none; touch-action: none; transition: background-color var(--dur-fast) var(--ease); }
    .head { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 3px 10px; }
    .chev { flex: none; margin-left: auto; width: 12px; height: 12px; color: var(--text-muted); opacity: 0.45; transition: opacity var(--dur-fast) var(--ease); }
    .item:hover .chev, .item.open .chev { opacity: 1; }
    .req + .chev { margin-left: 0; }
    .peek { display: flex; flex-direction: column; gap: 2px; padding: 2px 10px 7px; font-size: 0.75rem; }
    .val { display: flex; gap: 8px; min-width: 0; }
    .val .row { flex: none; width: 46px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
    .val .text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .from, .none { color: var(--text-muted); }
    .from { margin-bottom: 1px; }
    .item + .item { border-top: var(--hairline) solid var(--border); }
    .item:hover { background: var(--surface-hover); }
    .item.on { background: var(--accent-soft); }
    .item.picked { outline: 2px solid var(--accent); outline-offset: -2px; }
    .name { display: flex; min-width: 0; overflow: hidden; white-space: nowrap; }
    .name .a { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .name .z { flex: none; white-space: pre; }
    .group-label { padding: 4px 10px 2px; background: var(--fill); font-size: 0.6875rem; font-weight: 600; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; border-top: var(--hairline) solid var(--border); }
    .stages { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .stage-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 11px; border: var(--hairline) solid var(--border-strong); border-radius: 999px; background: var(--surface-solid); color: var(--text); font: inherit; font-size: 0.8125rem; cursor: pointer; white-space: nowrap; }
    .stage-chip small { color: var(--text-muted); font-size: 0.6875rem; font-variant-numeric: tabular-nums; }
    .stage-chip:hover { background: var(--surface-hover); }
    .stage-chip.done small { color: var(--accent); font-weight: 600; }
    .stage-chip.on { border-color: var(--accent); background: var(--accent-soft); }
    .width { display: inline-flex; align-items: center; gap: 8px; font-size: 0.75rem; color: var(--text-muted); }
    .width input { width: 120px; accent-color: var(--accent); }
    .req { flex: none; margin-left: auto; font-weight: 700; color: var(--danger); }
    .lines { display: block; width: 100%; height: 100%; min-height: 1px; overflow: visible; }
    .line { fill: none; stroke: var(--text); stroke-width: 1.5; pointer-events: none; }
    .line.is-drag { stroke: var(--accent); stroke-dasharray: 5 4; }
    .hit { fill: none; stroke: transparent; stroke-width: 12; cursor: pointer; }
    .hit:hover + .line { stroke-width: 3; stroke: var(--danger); }
    .dot { fill: var(--text); pointer-events: none; }
  `,
})
export class ColumnMatcher {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly fileColumns = input.required<FileColumn[]>();
  readonly targets = input.required<Column[]>();
  /** Each table column's key → the file column (worksheet position) that fills it. */
  readonly mapping = input.required<Mapping>();
  readonly tableTitle = input('this table');
  readonly mappingChange = output<Mapping>();
  /** "Match by name": the matches go back to what the names say. */
  readonly auto = output<void>();

  /** What is shown at once; the parent's answer (the file read again with it) replaces it when it comes. */
  readonly local = linkedSignal<Mapping>(() => this.mapping());
  readonly picked = signal<{ side: Side; id: string | number } | null>(null);
  readonly minWidth = MIN_WIDTH;
  readonly maxWidth = MAX_WIDTH;
  /** How wide each list is (px). */
  readonly width = signal(storedWidth());
  /** The column of each side whose values are showing under its name (a click opens it, another click shuts it). */
  readonly openFile = signal<number | null>(null);
  readonly openTable = signal<string | null>(null);
  private readonly fileAt = computed(() => new Map(this.fileColumns().map((column) => [column.position, column])));
  /** The line being dragged: where the pointer is, in the lines' own coordinates. */
  private readonly drag = signal<{ side: Side; id: string | number; x: number; y: number } | null>(null);
  /** Where each column's row sits (its middle, from the lines' top) and how wide the lines' space is. */
  readonly coords = signal<{ w: number; file: Record<number, number>; table: Record<string, number> }>({ w: 0, file: {}, table: {} });

  /** The stage whose columns the two lists show: "all", or 0 (the row's own columns) or 1–10. */
  readonly stage = signal<'all' | number>('all');
  /** The stage of each table column (the number its box begins with). */
  private readonly targetStage = computed(() => new Map(this.targets().map((column) => [column.key, stageOfBox(column.box)])));
  /** Stages are shown only when the file has them (columns after a "Stage 3_" column) and so does the table. */
  readonly stageChips = computed(() => {
    const files = this.fileColumns();
    const stages = this.targetStage();
    if (!files.some((file) => file.stage > 0) || ![...stages.values()].some((stage) => stage > 0)) return [];
    const present = new Set<number>([...files.map((file) => file.stage), ...stages.values()]);
    const mapping = this.local();
    return [...present]
      .sort((a, b) => a - b)
      .map((stage) => {
        const here = this.targets().filter((column) => stages.get(column.key) === stage);
        return { stage, label: stage === 0 ? 'Row' : `Stage ${stage}`, total: here.length, matched: here.filter((column) => mapping[column.key] !== undefined).length };
      });
  });
  readonly shownFiles = computed(() => {
    const stage = this.stage();
    return this.stageChips().length && stage !== 'all' ? this.fileColumns().filter((file) => file.stage === stage) : this.fileColumns();
  });
  readonly shownTargets = computed(() => {
    const stage = this.stage();
    const stages = this.targetStage();
    return this.stageChips().length && stage !== 'all' ? this.targets().filter((column) => stages.get(column.key) === stage) : this.targets();
  });
  readonly count = computed(() => Object.keys(this.local()).length);
  readonly used = computed(() => new Set(Object.values(this.local())));
  readonly lines = computed(() => {
    const { w, file, table } = this.coords();
    const out: { key: string; d: string; y1: number; y2: number }[] = [];
    for (const [key, position] of Object.entries(this.local())) {
      const y1 = file[position];
      const y2 = table[key];
      if (y1 === undefined || y2 === undefined) continue;
      out.push({ key, d: curve(0, y1, w, y2), y1, y2 });
    }
    return out;
  });
  readonly dragPath = computed(() => {
    const drag = this.drag();
    if (!drag) return null;
    const { w, file, table } = this.coords();
    if (drag.side === 'file') {
      const y = file[drag.id as number];
      return y === undefined ? null : curve(0, y, drag.x, drag.y);
    }
    const y = table[drag.id as string];
    return y === undefined ? null : curve(w, y, drag.x, drag.y);
  });

  constructor() {
    // The lines follow the rows: measured after each draw, and kept only when something moved.
    afterEveryRender(() => this.measure());
    const destroy = inject(DestroyRef);
    destroy.onDestroy(() => this.stopDrag?.());
  }

  label(column: Column) {
    return columnLabel(column);
  }

  /** The group a file column belongs to (its header's row above the field), when it has one that isn't just its own name. */
  private fileGroup(file: FileColumn | undefined) {
    if (!file || file.parts.length < 2) return '';
    const group = (file.parts.at(-2) ?? '').trim();
    return group && group !== (file.parts.at(-1) ?? '').trim() ? group : '';
  }

  /** The group a file column opens, when the lists are shown by stage and the column begins a group. */
  fileGroupStarts(index: number) {
    if (!this.stageChips().length) return '';
    const list = this.shownFiles();
    const group = this.fileGroup(list[index]);
    return group && group !== this.fileGroup(list[index - 1]) ? group : '';
  }

  /** The group a table column opens, when the lists are shown by stage and the column begins a group. */
  targetGroupStarts(index: number) {
    if (!this.stageChips().length) return '';
    const list = this.shownTargets();
    const group = list[index]?.group ?? '';
    return group && group !== (index > 0 ? (list[index - 1].group ?? '') : '') ? group : '';
  }

  /** Shows one stage's columns in both lists (or all). A column picked and now out of sight is let go. */
  showStage(stage: 'all' | number) {
    this.stage.set(stage);
    this.picked.set(null);
  }

  parts(name: string) {
    return nameParts(name);
  }

  setWidth(event: Event) {
    const width = Math.min(Math.max(Number((event.target as HTMLInputElement).value), MIN_WIDTH), MAX_WIDTH);
    if (!Number.isFinite(width)) return;
    this.width.set(width);
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      /* a preference that can't be kept is just not kept */
    }
  }

  /** The file column that fills the table column `key` (undefined: none yet). */
  fillingFrom(key: string) {
    const position = this.local()[key];
    return position === undefined ? undefined : this.fileAt().get(position);
  }

  // ---------------------------------------------------------------- matches

  /** The file column `position` fills the table column `key` (null: none). A file column fills one only. */
  private set(key: string, position: number | null) {
    const next = { ...this.local() };
    if (position === null) {
      delete next[key];
    } else {
      for (const other of Object.keys(next)) if (next[other] === position) delete next[other];
      next[key] = position;
    }
    this.local.set(next);
    this.mappingChange.emit(next);
  }

  unmatch(key: string) {
    this.set(key, null);
  }

  clear() {
    this.local.set({});
    this.mappingChange.emit({});
  }

  // ------------------------------------------------------------ the pointer

  private stopDrag: (() => void) | null = null;

  /** A press on a column: dragged to another side's column it makes the match; not moved, it's a click. */
  down(event: PointerEvent, side: Side, id: string | number) {
    if (event.button !== 0) return;
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY, moved: false };
    const move = (e: PointerEvent) => {
      if (!start.moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_FROM) return;
      start.moved = true;
      const box = this.linesBox();
      if (box) this.drag.set({ side, id, x: e.clientX - box.left, y: e.clientY - box.top });
    };
    const up = (e: PointerEvent) => {
      this.stopDrag?.();
      if (!start.moved) return this.click(side, id);
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-pos],[data-key]');
      if (!over) return;
      if (side === 'file' && over.dataset['key']) this.set(over.dataset['key'], id as number);
      if (side === 'table' && over.dataset['pos']) this.set(id as string, Number(over.dataset['pos']));
    };
    this.stopDrag = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.drag.set(null);
      this.stopDrag = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** Clicked: the first column is held, the next one on the other side is its match. */
  private click(side: Side, id: string | number) {
    const held = this.picked();
    // Making a match shows the column it lands on; any other click opens the column or, if it's open, shuts it.
    const matching = !!held && held.side !== side;
    if (side === 'file') this.openFile.update((open) => (!matching && open === id ? null : (id as number)));
    else this.openTable.update((open) => (!matching && open === id ? null : (id as string)));
    if (!held || held.side === side) {
      this.picked.set(held && held.side === side && held.id === id ? null : { side, id });
      return;
    }
    this.picked.set(null);
    if (side === 'table') this.set(id as string, held.id as number);
    else this.set(held.id as string, id as number);
  }

  private linesBox() {
    return this.host.nativeElement.querySelector('svg.lines')?.getBoundingClientRect() ?? null;
  }

  private measure() {
    const box = this.linesBox();
    if (!box) return;
    const file: Record<number, number> = {};
    const table: Record<string, number> = {};
    const root = this.host.nativeElement;
    // Each line meets its column's name, not the middle of the row when values are open under it.
    root.querySelectorAll<HTMLElement>('[data-pos]').forEach((element) => {
      const rect = (element.querySelector('.head') ?? element).getBoundingClientRect();
      file[Number(element.dataset['pos'])] = Math.round(rect.top + rect.height / 2 - box.top);
    });
    root.querySelectorAll<HTMLElement>('[data-key]').forEach((element) => {
      const rect = (element.querySelector('.head') ?? element).getBoundingClientRect();
      table[element.dataset['key']!] = Math.round(rect.top + rect.height / 2 - box.top);
    });
    const next = { w: Math.round(box.width), file, table };
    if (JSON.stringify(next) !== JSON.stringify(this.coords())) this.coords.set(next);
  }
}

/** A line from one side to the other, leaving and arriving level. */
function curve(x1: number, y1: number, x2: number, y2: number) {
  const middle = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`;
}
