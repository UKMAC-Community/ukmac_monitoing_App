import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { Toasts } from '../core/toast';
import { AppUpdater } from '../core/updater';
import { Icon } from './icon';

/**
 * "Update to v0.1.2": there only while a newer version is out. One click downloads it, installs it (the
 * signature is checked first) and restarts the app; the tables are in the database file, which an update never touches.
 */
@Component({
  selector: 'app-update-button',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (updater.offered()) {
      <button type="button" class="btn btn-primary btn-sm" [disabled]="working()" [title]="title()" (click)="go()">
        @if (working()) {
          <span class="spinner-sm"></span>
        } @else {
          <app-icon name="download" />
        }
        {{ label() }}
      </button>
    }
  `,
})
export class UpdateButton {
  readonly updater = inject(AppUpdater);
  private readonly toasts = inject(Toasts);

  readonly working = computed(() => this.updater.state() === 'downloading' || this.updater.state() === 'installed');

  readonly label = computed(() => {
    const state = this.updater.state();
    if (state === 'installed') return 'Restarting…';
    if (state === 'downloading') {
      const percent = this.updater.percent();
      return percent === null ? 'Updating…' : `Updating… ${percent}%`;
    }
    return `Update to v${this.updater.update()?.version ?? ''}`;
  });

  readonly title = computed(() => {
    const found = this.updater.update();
    if (!found) return '';
    return `Version ${found.version} is out (this is ${found.currentVersion}). It downloads, installs and restarts the app; your tables stay as they are.`;
  });

  async go() {
    await this.updater.install();
    // The button is gone once the app restarts; if it didn't get that far, say why.
    if (this.updater.state() === 'error') this.toasts.error(this.updater.error() ?? 'The update did not install.');
  }
}
