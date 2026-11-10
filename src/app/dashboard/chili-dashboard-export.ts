import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';

import { Icon } from '../components/icon';
import { Modal } from '../components/modal';
import { errorText } from '../core/api';
import { Toasts } from '../core/toast';
import { ChiliVersionStore } from './chili-version-store';
import { latestOf } from './chili-versions';
import { baseName } from '../core/paths';

/**
 * Export dashboard: the dashboard as it is now, as a file to share. When it has changed since its latest
 * version this saves it as the next version and writes that; people who import it are brought up to date.
 */
@Component({
  selector: 'app-chili-dashboard-export',
  imports: [Icon, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal [open]="true" title="Export dashboard" subtitle="Share your KPIs as a file. Anyone who imports it gets this version." (closed)="closed.emit()">
      <div class="body">
        @if (failure()) {
          <p class="state" role="alert">{{ failure() }}</p>
        } @else {
        <p class="state" role="status">{{ state() }}</p>
        @if (plan().created) {
          <label class="form-group"><span class="form-label">Name</span>
            <input class="input-field" maxlength="80" [value]="name()" (input)="name.set($any($event.target).value)" />
          </label>
          <label class="form-group"><span class="form-label">What changed? (optional)</span>
            <textarea class="input-field" rows="3" maxlength="300" [value]="note()" (input)="note.set($any($event.target).value)" placeholder="For example: added Harvest by year and removed Stem rot."></textarea>
          </label>
        } @else {
          <p class="small">The file is named “{{ plan().version.name }} v{{ plan().version.number }}”. Saved on {{ when() }}.</p>
        }
        <p class="small">The file holds only the KPI list: which table and column each one works out. No rows or other data are in it.</p>
        }
      </div>
      <ng-container footer>
        <button type="button" class="btn btn-secondary" (click)="closed.emit()">Cancel</button>
        <button type="button" class="btn btn-primary" [disabled]="busy() || !!failure()" (click)="run()"><app-icon name="download" /> {{ busy() ? 'Exporting…' : failure() ? 'Export' : 'Export version ' + plan().version.number }}</button>
      </ng-container>
    </app-modal>
  `,
  styles: `
    .body { display: flex; flex-direction: column; gap: 14px; }
    .state { margin: 0; font-size: 0.875rem; line-height: 1.5; }
    .form-group { display: grid; gap: 4px; }
    .form-group .input-field { width: 100%; }
    textarea.input-field { resize: vertical; min-height: 72px; line-height: 1.5; }
    .small { margin: 0; font-size: 0.75rem; color: var(--text-muted); line-height: 1.5; }
  `,
})
export class ChiliDashboardExport {
  readonly closed = output<void>();
  private readonly store = inject(ChiliVersionStore);
  private readonly toasts = inject(Toasts);

  readonly name = signal(this.store.currentName());
  readonly note = signal('');
  readonly busy = signal(false);
  /** What exporting would do, or why it can't (a full history is a message, not a crash). */
  private readonly outcome = computed(() => {
    try {
      return { plan: this.store.preview(this.name(), this.note()), failure: '' };
    } catch (error) {
      return { plan: null, failure: errorText(error) };
    }
  });
  readonly failure = computed(() => this.outcome().failure);
  /** Only read when there is no failure. */
  readonly plan = computed(() => this.outcome().plan!);
  readonly state = computed(() => {
    if (this.failure()) return '';
    const { created, version } = this.plan();
    const active = this.store.book().activeId;
    const before = active ? latestOf(this.store.book(), active) : null;
    if (!created) return `Nothing has changed since version ${version.number}, so version ${version.number} is exported again.`;
    return before
      ? `You have changed the dashboard since version ${before.number}. Exporting saves your changes as version ${version.number}.`
      : `This is the first version of your dashboard. Exporting saves it as version ${version.number}.`;
  });

  when() {
    if (this.failure()) return '';
    return new Date(this.plan().version.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  async run() {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const done = await this.store.exportCurrent(this.name(), this.note());
      if (!done) return; // They closed the save window: nothing was made.
      this.toasts.show(`${done.created ? 'Saved as version ' + done.version.number + ' and exported' : 'Exported version ' + done.version.number}: ${baseName(done.path)}`);
      this.closed.emit();
    } catch (error) {
      this.toasts.error(errorText(error));
    } finally {
      this.busy.set(false);
    }
  }
}
