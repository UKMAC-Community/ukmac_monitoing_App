import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';

import { Icon } from '@shared/ui/icon';
import type { SheetWithRows } from '@core/models';
import { todayIso } from '@shared/sheet/columns';
import { qaqcChecks, zoneRows, type CheckLine, type TableCheck, type ZoneRow } from './qa-qc-checks';

/**
 * The Data Check's QA/QC Check: a box for each of the farm's tables, and in it, under "Check with {table}", what is wrong
 * (or a tick). A line with problems opens the plots, each with a way to the table. Two more pages go zone by zone: what the plan
 * (Plant Progress) says of each, and what QA/QC says, each with whether the two agree.
 */
@Component({
  selector: 'app-qa-qc-check',
  imports: [Icon, RouterLink, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card qc" aria-labelledby="qc-title">
      <header class="head">
        <div class="head-text">
          <h2 id="qc-title">QA/QC Check</h2>
          <p class="sub">Each table checked with another table, with its own records, or with today's date. A problem is something to look at, not proof that something is wrong.</p>
        </div>
        <span class="badge" [class]="total() ? 'warning' : 'success'">
          @if (total()) { {{ total() | number }} {{ total() === 1 ? 'problem' : 'problems' }} } @else { <app-icon name="check" [size]="11" /> No problems }
        </span>
      </header>

      <nav class="tabs" role="tablist" aria-label="QA/QC Check pages">
        <button type="button" role="tab" class="tab" [attr.aria-selected]="page() === 'checks'" (click)="page.set('checks')">Checks</button>
        <button type="button" role="tab" class="tab" [attr.aria-selected]="page() === 'plan'" (click)="page.set('plan')">From the plan</button>
        <button type="button" role="tab" class="tab" [attr.aria-selected]="page() === 'qaqc'" (click)="page.set('qaqc')">From QA/QC</button>
      </nav>

      @if (page() !== 'checks') {
        <div class="zbar">
          <span class="note">
            @if (page() === 'plan') { What Plant Progress says of each zone: planted − dead + replanted = left. } @else { What QA/QC Management says of each zone, beside what the plan says is left. }
          </span>
          <span class="grow"></span>
          <button type="button" class="chip" [class.is-on]="!onlyOff()" (click)="onlyOff.set(false)">All zones · {{ zones().length | number }}</button>
          <button type="button" class="chip" [class.is-on]="onlyOff()" (click)="onlyOff.set(true)">Not matching · {{ off().length | number }}</button>
        </div>
        <div class="ztable">
          <table>
            <thead>
              @if (page() === 'plan') {
                <tr><th>Zone</th><th>Planted on</th><th class="n">Planted</th><th class="n">Dead</th><th class="n">Replanted</th><th class="n">Left</th><th>With QA/QC</th></tr>
              } @else {
                <tr><th>Zone</th><th class="n">Total plant</th><th class="n">Live (sample)</th><th class="n">Dead (sample)</th><th class="n">Plan says left</th><th>With the plan</th></tr>
              }
            </thead>
            <tbody>
              @for (row of zonePage(); track row.plot) {
                <tr [class.off]="row.status !== 'match'">
                  <td><span class="plot">{{ row.plot }}</span></td>
                  @if (page() === 'plan') {
                    <td>{{ row.plantedOn ?? '—' }}</td>
                    <td class="n">{{ num(row.planted) }}</td><td class="n">{{ num(row.dead) }}</td><td class="n">{{ num(row.replanted) }}</td><td class="n strong">{{ num(row.left) }}</td>
                  } @else {
                    <td class="n strong">{{ num(row.total) }}</td><td class="n">{{ num(row.live) }}</td><td class="n">{{ num(row.qaDead) }}</td><td class="n">{{ num(row.left) }}</td>
                  }
                  <td>
                    @if (row.status === 'match') {
                      <span class="badge success"><app-icon name="check" [size]="11" /> Match</span>
                    } @else {
                      <span class="badge" [class]="row.status === 'no-count' ? 'neutral' : 'warning'" [title]="row.note">{{ statusWord(row) }}</span>
                      <span class="why">{{ row.note }}</span>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="7" class="muted">{{ zones().length ? 'Every zone matches.' : 'Needs Plant Progress and QA/QC Management.' }}</td></tr>
              }
            </tbody>
          </table>
        </div>
        @if (zoneMore() > 0) {
          <button type="button" class="chip more0" (click)="zoneCount.update(n => n + 25)">Show 25 more ({{ zoneMore() }} left)</button>
        }
      } @else {
      <div class="boxes">
        @for (box of boxes(); track box.sheetId) {
          <article class="box" [attr.aria-label]="box.title">
            <header class="box-head">
              <span class="box-title"><app-icon [name]="box.icon || 'table'" [size]="17" /> {{ box.title }}</span>
              @if (box.problems) {
                <span class="badge warning">{{ box.problems | number }} {{ box.problems === 1 ? 'problem' : 'problems' }}</span>
              } @else {
                <span class="badge success"><app-icon name="check" [size]="11" /> All good</span>
              }
            </header>

            @for (group of groups(box); track group.against) {
              <div class="with">
                <span class="with-label">Check with <b>{{ group.against }}</b></span>
                <ul class="lines">
                  @for (line of group.lines; track line.id) {
                    <li class="line-item" [class.is-open]="isOpen(box, line)">
                      <button
                        type="button"
                        class="line"
                        [class.bad]="!line.cannot && line.findings.length"
                        [disabled]="!!line.cannot || !line.findings.length"
                        [attr.aria-expanded]="line.findings.length ? isOpen(box, line) : null"
                        (click)="toggle(box, line)"
                      >
                        <span class="mark" [class]="'mark ' + (line.cannot ? 'off' : line.findings.length ? 'warn' : 'ok')">
                          <app-icon [name]="line.cannot ? 'circle-minus' : line.findings.length ? 'alert' : 'check'" [size]="13" />
                        </span>
                        <span class="say">{{ line.cannot ? "Can't check: " + line.cannot : line.findings.length ? line.bad : line.good }}</span>
                        @if (!line.cannot && line.findings.length) {
                          <span class="see">{{ isOpen(box, line) ? 'Hide' : 'See' }} <app-icon [name]="isOpen(box, line) ? 'chevron-down' : 'chevron-right'" [size]="13" /></span>
                        }
                      </button>
                      @if (line.same && !line.findings.length) {
                        <p class="hint">The numbers are exactly the same. If QA/QC copies them from this table, this check can't find anything.</p>
                      }
                      @if (isOpen(box, line) && shown(); as list) {
                        <ul class="plots">
                          @for (finding of list.items; track $index) {
                            <li class="plot-row">
                              <span class="plot">{{ finding.plot }}</span>
                              <span class="what" [class.unreadable]="finding.unreadable">{{ finding.text }}</span>
                              <a class="goto" [routerLink]="['/mac', box.macId, 'table', box.sheetId]" [title]="'Open ' + box.title" [attr.aria-label]="'Open ' + box.title"><app-icon name="arrow-right" [size]="13" /></a>
                            </li>
                          }
                        </ul>
                        @if (list.more) {
                          <button type="button" class="chip more" (click)="more()">Show {{ list.more > PAGE ? PAGE : list.more }} more ({{ list.more }} left)</button>
                        }
                      }
                    </li>
                  }
                </ul>
              </div>
            }
          </article>
        } @empty {
          <p class="muted">No tables to check yet.</p>
        }
      </div>
      }
    </section>
  `,
  styles: `
    :host { display: block; }
    .qc { display: flex; flex-direction: column; gap: 16px; }
    .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
    .head-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; max-width: 72ch; }
    h2 { font-size: 1.0625rem; font-weight: 700; color: var(--text); }
    .sub { font-size: 0.8125rem; color: var(--text-muted); line-height: 1.45; }
    .tabs { display: flex; gap: 6px; border-bottom: var(--hairline) solid var(--border); }
    .tab { padding: 8px 12px; border: 0; border-bottom: 2px solid transparent; background: transparent; font: inherit; font-size: 0.875rem; font-weight: 500; color: var(--text-muted); cursor: pointer; white-space: nowrap; }
    .tab:hover { color: var(--text); }
    .tab[aria-selected='true'] { color: var(--accent); border-bottom-color: var(--accent); }
    .zbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .zbar .note { font-size: 0.8125rem; color: var(--text-muted); }
    .grow { flex: 1; }
    .chip.is-on { background: var(--accent); color: #fff; }
    .more0 { align-self: flex-start; }
    .ztable { overflow-x: auto; border: var(--hairline) solid var(--border); border-radius: 12px; background: var(--surface-solid); }
    .ztable table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
    .ztable th { position: sticky; top: 0; padding: 8px 12px; text-align: left; font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-muted); background: var(--surface-solid); border-bottom: var(--hairline) solid var(--border); white-space: nowrap; }
    .ztable td { padding: 7px 12px; border-top: var(--hairline) solid var(--border); white-space: nowrap; }
    .ztable tbody tr:first-child td { border-top: 0; }
    .ztable .n { text-align: right; font-variant-numeric: tabular-nums; }
    .ztable .strong { font-weight: 700; }
    .ztable tr.off { background: var(--warning-soft); }
    .ztable .why { margin-left: 8px; color: var(--text-muted); }
    .ztable td.muted { padding: 24px; text-align: center; }
    .boxes { display: grid; grid-template-columns: repeat(auto-fill, minmax(440px, 1fr)); gap: 12px; align-items: start; }
    .box { display: flex; flex-direction: column; gap: 12px; min-width: 0; padding: 14px 16px 16px; border: var(--hairline) solid var(--border); border-radius: 14px; background: var(--surface-solid); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); }
    .box-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .box-title { display: inline-flex; align-items: center; gap: 8px; font-size: 1rem; font-weight: 700; color: var(--text); }
    .box-title app-icon { color: var(--text-muted); }
    .with { display: flex; flex-direction: column; gap: 4px; }
    .with-label { font-size: 0.75rem; color: var(--text-muted); }
    .with-label b { font-weight: 600; color: var(--text); }
    .lines { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
    .line-item { border-radius: 10px; }
    .line-item.is-open { background: var(--fill); }
    .line { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 8px; border: 0; border-radius: 10px; background: transparent; font: inherit; text-align: left; color: var(--text); }
    .line.bad { cursor: pointer; }
    .line.bad:hover { background: var(--fill); }
    .line:disabled { cursor: default; }
    .mark { flex: none; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; }
    .mark.ok { background: var(--success-soft); color: var(--success); }
    .mark.warn { background: var(--warning-soft); color: var(--warning); }
    .mark.off { background: var(--fill); color: var(--text-muted); }
    .say { flex: 1; min-width: 0; font-size: 0.875rem; line-height: 1.35; }
    .line.bad .say { font-weight: 600; }
    .line:disabled .say { color: var(--text-muted); }
    .see { flex: none; display: inline-flex; align-items: center; gap: 2px; font-size: 0.75rem; font-weight: 600; color: var(--accent); }
    .hint { margin: 0 8px 4px 42px; font-size: 0.75rem; color: var(--text-muted); line-height: 1.4; }
    .plots { display: flex; flex-direction: column; margin: 2px 8px 8px 42px; padding: 0; list-style: none; border: var(--hairline) solid var(--border); border-radius: 10px; overflow: hidden; background: var(--surface-solid); }
    .plot-row { display: grid; grid-template-columns: 3.5rem minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 6px 8px; font-size: 0.8125rem; }
    .plot-row + .plot-row { border-top: var(--hairline) solid var(--border); }
    .plot { justify-self: start; padding: 1px 8px; border-radius: 999px; background: var(--fill); font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .what { color: var(--text); line-height: 1.35; }
    .what.unreadable { color: var(--text-muted); }
    .goto { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; color: var(--text-muted); background: var(--fill); transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease); }
    .goto:hover { background: var(--accent); color: #fff; }
    .more { margin: 0 8px 8px 42px; }
    .muted { font-size: 0.8125rem; color: var(--text-muted); }
    @media (max-width: 760px) { .boxes { grid-template-columns: 1fr; } }
  `,
})
export class QaQcCheck {
  readonly sheets = input.required<readonly SheetWithRows[]>();
  readonly PAGE = 25;
  /** The line whose plots are listed (its table and check), and how many of them are shown. */
  readonly open = signal<string | null>(null);
  private readonly count = signal(this.PAGE);

  readonly boxes = computed<TableCheck[]>(() => qaqcChecks(this.sheets(), todayIso()));
  /** Which page: the checks, or every zone from the plan, or from QA/QC. */
  readonly page = signal<'checks' | 'plan' | 'qaqc'>('checks');
  readonly onlyOff = signal(false);
  readonly zoneCount = signal(25);
  readonly zones = computed<ZoneRow[]>(() => zoneRows(this.sheets()));
  readonly off = computed(() => this.zones().filter((row) => row.status !== 'match' && row.status !== 'no-count'));
  private readonly zoneList = computed(() => (this.onlyOff() ? this.off() : this.zones()));
  readonly zonePage = computed(() => this.zoneList().slice(0, this.zoneCount()));
  readonly zoneMore = computed(() => this.zoneList().length - this.zonePage().length);
  num(n: number | null) {
    return n === null ? '—' : n.toLocaleString('en');
  }
  statusWord(row: ZoneRow) {
    return { differs: 'Differs', 'only-plan': 'Only in plan', 'only-qaqc': 'Only in QA/QC', unreadable: "Can't compare", 'no-count': 'No count', match: 'Match' }[row.status];
  }
  readonly total = computed(() => this.boxes().reduce((sum, box) => sum + box.problems, 0));

  /** A box's lines under each thing its table is checked with, in the order they come. */
  groups(box: TableCheck) {
    const out: { against: string; lines: CheckLine[] }[] = [];
    for (const line of box.lines) {
      const group = out.find((item) => item.against === line.against);
      if (group) group.lines.push(line);
      else out.push({ against: line.against, lines: [line] });
    }
    return out;
  }

  private readonly picked = computed(() => {
    const open = this.open();
    for (const box of this.boxes()) for (const line of box.lines) if (`${box.sheetId}:${line.id}` === open) return line;
    return null;
  });
  readonly shown = computed(() => {
    const line = this.picked();
    if (!line) return null;
    const items = line.findings.slice(0, this.count());
    return { items, more: line.findings.length - items.length };
  });

  isOpen(box: TableCheck, line: CheckLine) {
    return this.open() === `${box.sheetId}:${line.id}`;
  }
  toggle(box: TableCheck, line: CheckLine) {
    const id = `${box.sheetId}:${line.id}`;
    this.open.update((now) => (now === id ? null : id));
    this.count.set(this.PAGE);
  }
  more() {
    this.count.update((n) => n + this.PAGE);
  }
}
