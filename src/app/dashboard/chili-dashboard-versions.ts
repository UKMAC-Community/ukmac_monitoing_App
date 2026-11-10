import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';

import { Icon } from '../components/icon';
import { Modal } from '../components/modal';
import { Api, errorText } from '../core/api';
import { Toasts } from '../core/toast';
import { ChiliKpiStore } from './chili-kpi-store';
import { ChiliVersionStore, importMessage } from './chili-version-store';
import { keptWords, versionDays, type DashboardVersion } from './chili-versions';

/**
 * Dashboard versions: every version of the dashboard this Mac has made or been sent, as a vertical
 * timeline (newest first, grouped by day, as the system's Edit history is), ending on the built-in
 * suggested dashboard it all started from. Go to one (what is in use is kept as a version first),
 * write it to a file to share, or remove it.
 */
@Component({
  selector: 'app-chili-dashboard-versions',
  imports: [Icon, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [open]="true" title="Dashboard versions" subtitle="Go back to an earlier version, share one, or remove the ones you don't need." size="wide" (closed)="closed.emit()">
      @if (store.unsaved()) {
        <p class="notice" role="status">Your dashboard has changes that aren't a version yet. If you go to another version, they are kept as a version first.</p>
      }
      <div class="timeline-scroll">
        @for (day of days(); track $index) {
          <section [attr.aria-label]="day.label">
            <h4 class="day">{{ day.label }}</h4>
            <ol class="timeline">
              @for (version of day.versions; track version.id) {
                <li [class.current]="version.id === store.inUse()?.id">
                  <span class="dot" [class.on]="version.id === store.inUse()?.id" aria-hidden="true"></span>
                  <div class="card">
                    <div class="main">
                      <div class="head">
                        <time class="time" [attr.datetime]="version.createdAt">{{ time(version) }}</time>
                        <strong>Version {{ version.number }}</strong>
                        @if (store.several()) { <span class="dash">{{ version.name }}</span> }
                        @if (version.id === store.inUse()?.id) { <span class="badge info">In use</span> }
                        <span class="badge neutral">{{ version.source === 'imported' ? 'Imported' : 'Made here' }}</span>
                      </div>
                      <p class="meta">{{ version.kpis.length }} KPI{{ version.kpis.length === 1 ? '' : 's' }}</p>
                      @if (version.note) { <p class="note">{{ version.note }}</p> }
                    </div>
                    <div class="actions">
                      <button type="button" class="btn btn-secondary btn-sm" [disabled]="busy() || version.id === store.inUse()?.id" (click)="use(version)">Use</button>
                      <button type="button" class="icon-btn" [attr.aria-label]="'Export version ' + version.number" title="Export this version" [disabled]="busy()" (click)="exportOne(version)"><app-icon name="download" [size]="15" /></button>
                      <button type="button" class="icon-btn danger" [attr.aria-label]="'Remove version ' + version.number" title="Remove this version" [disabled]="busy()" (click)="remove(version)"><app-icon name="trash" [size]="15" /></button>
                    </div>
                  </div>
                </li>
              }
            </ol>
          </section>
        }
        @if (!store.versions().length) {
          <p class="none">No versions yet. A version is made when you export your dashboard, or when an update replaces it.</p>
        }
        <section aria-label="Built in">
          <h4 class="day">Built in</h4>
          <ol class="timeline">
            <li [class.current]="!kpis.custom()">
              <span class="dot" [class.on]="!kpis.custom()" [class.start]="kpis.custom()" aria-hidden="true"></span>
              <div class="card">
                <div class="main">
                  <div class="head"><strong>Suggested dashboard</strong>@if (!kpis.custom()) { <span class="badge info">In use</span> }<span class="badge neutral">Built in</span></div>
                  <p class="note">The KPIs UKMAC Monitoring comes with, as the system's Chili page shows them.</p>
                </div>
                <div class="actions"><button type="button" class="btn btn-secondary btn-sm" [disabled]="busy() || !kpis.custom()" (click)="useSuggested()">Use</button></div>
              </div>
            </li>
          </ol>
        </section>
      </div>
      <ng-container footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="importFile()"><app-icon name="upload" /> Import dashboard…</button>
        <span class="grow"></span>
        <button type="button" class="btn btn-primary" (click)="closed.emit()">Done</button>
      </ng-container>
    </app-modal>
  `,
  styles: `
    .notice { margin: 0 0 12px; padding: 9px 12px; border-radius: 8px; background: var(--accent-soft); font-size: 0.8125rem; line-height: 1.5; }
    /* The scroll box keeps a little room on the left so the dots on the line are not cut off. */
    .timeline-scroll { max-height: 56vh; overflow-y: auto; padding: 0 2px 0 7px; display: flex; flex-direction: column; gap: 14px; }
    .day { margin: 0 0 8px; font-size: 0.75rem; font-weight: 500; color: var(--text-muted); }
    .timeline { margin: 0 0 0 1px; padding: 0; list-style: none; border-left: 1px solid var(--border-strong); }
    .timeline li { position: relative; padding: 0 0 8px 20px; }
    .timeline li:last-child { padding-bottom: 0; }
    .dot { position: absolute; left: -6px; top: 17px; width: 11px; height: 11px; border-radius: 50%; background: var(--border-strong); }
    .dot.on { background: var(--accent-solid); }
    .dot.start { box-sizing: border-box; border: 2px solid var(--border-strong); background: var(--surface-solid); }
    .card { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: var(--hairline) solid var(--border); border-radius: 12px; background: var(--surface); }
    .current .card { border-color: var(--accent); background: var(--accent-soft); }
    .main { flex: 1; min-width: 0; }
    .head { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
    .head strong { font-size: 0.875rem; }
    .time { font-size: 0.75rem; font-variant-numeric: tabular-nums; color: var(--text-muted); }
    .dash { font-size: 0.75rem; color: var(--text-muted); }
    .meta, .note { margin: 3px 0 0; font-size: 0.75rem; color: var(--text-muted); line-height: 1.5; overflow-wrap: anywhere; }
    .note { color: var(--text); }
    .actions { display: flex; align-items: center; gap: 4px; flex: none; }
    .none { margin: 0; font-size: 0.8125rem; color: var(--text-muted); }
    .actions button:disabled { opacity: 0.5; cursor: default; }
  `,
})
export class ChiliDashboardVersions {
  readonly closed = output<void>();
  readonly store = inject(ChiliVersionStore);
  readonly kpis = inject(ChiliKpiStore);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  readonly busy = signal(false);
  /** The versions as a timeline: a heading for each day, newest first. */
  readonly days = computed(() => versionDays(this.store.versions()));

  /** The time of day a version was made (its day is the heading above it). */
  time(version: DashboardVersion) {
    const at = new Date(version.createdAt);
    return Number.isFinite(at.getTime()) ? at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
  }

  private async run(work: () => Promise<void>) {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await work();
    } catch (error) {
      this.toasts.error(errorText(error));
    } finally {
      this.busy.set(false);
    }
  }

  private kept(kept: DashboardVersion | null) {
    return kept ? ` Your earlier dashboard is ${keptWords(kept)}.` : '';
  }

  use(version: DashboardVersion) {
    return this.run(async () => {
      const kept = await this.store.use(version.id);
      this.toasts.show(`Using version ${version.number}.${this.kept(kept)}`);
    });
  }

  useSuggested() {
    return this.run(async () => {
      const kept = await this.store.useSuggested();
      this.toasts.show(`Using the suggested dashboard.${this.kept(kept)}`);
    });
  }

  exportOne(version: DashboardVersion) {
    return this.run(async () => {
      const path = await this.store.exportVersion(version);
      if (path) this.toasts.show(`Exported version ${version.number}: ${path.split('/').pop()}`);
    });
  }

  importFile() {
    return this.run(async () => {
      const result = await this.store.importFromFile();
      if (result) this.toasts.show(importMessage(result));
    });
  }

  remove(version: DashboardVersion) {
    return this.run(async () => {
      const inUse = version.id === this.store.inUse()?.id;
      const ok = await this.api.confirm(`Remove version ${version.number}? ${inUse ? 'Your dashboard stays as it is. ' : ''}This can't be undone.`, 'Remove version', 'Remove');
      if (!ok) return;
      await this.store.remove(version.id);
      this.toasts.show(`Removed version ${version.number}`);
    });
  }
}
