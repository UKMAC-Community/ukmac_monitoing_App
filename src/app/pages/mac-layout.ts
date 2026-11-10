import { ChangeDetectionStrategy, Component, effect, inject, input, untracked } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';

import { WorkbookStore } from '../core/workbook-store';

/** Opens a MAC: its tables are read once, then every page of it works on them. */
@Component({
  selector: 'app-mac-layout',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.workbook()) {
      <router-outlet />
    } @else if (store.loading()) {
      <div class="page skeleton-page" aria-busy="true" aria-label="Opening the MAC">
        <div class="head">
          <span class="skeleton circle"></span>
          <div class="lines"><span class="skeleton title"></span><span class="skeleton sub"></span></div>
        </div>
        @if (onTable) {
          <span class="skeleton search"></span>
          <div class="card skeleton-rows">
            @for (n of [1, 2, 3, 4, 5, 6, 7, 8]; track n) {
              <div class="skeleton-row"><span class="skeleton cell a"></span><span class="skeleton cell b"></span><span class="skeleton cell c"></span><span class="skeleton cell d"></span></div>
            }
          </div>
        } @else {
          <span class="skeleton map"></span>
          <div class="tiles">
            @for (n of [1, 2, 3, 4, 5, 6]; track n) {
              <div class="card tile-skel"><span class="skeleton line short"></span><span class="skeleton line big"></span><span class="skeleton line wide"></span></div>
            }
          </div>
        }
      </div>
    } @else {
      <p class="loading muted">This MAC couldn't be opened.</p>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .loading { padding: 32px; }
    .skeleton-page { display: flex; flex-direction: column; gap: 16px; }
    .head { display: flex; align-items: center; gap: 14px; }
    .circle { width: 36px; height: 36px; border-radius: 50%; }
    .lines { display: flex; flex-direction: column; gap: 8px; }
    .title { width: 240px; height: 22px; }
    .sub { width: 360px; height: 12px; }
    .map { height: clamp(200px, 36vh, 360px); border-radius: var(--radius-lg); }
    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
    .tile-skel { display: flex; flex-direction: column; gap: 14px; padding: 18px 22px; height: 176px; border-radius: var(--radius-lg); }
    .search { width: 320px; height: 36px; border-radius: var(--radius-md); }
    .cell { height: 14px; flex: none; }
    .cell.a { width: 90px; } .cell.b { width: 220px; } .cell.c { width: 140px; } .cell.d { width: 100px; }
    .line { height: 12px; }
    .line.short { width: 90px; }
    .line.big { width: 140px; height: 32px; }
    .line.wide { width: 100%; height: 40px; margin-top: auto; }
  `,
})
export class MacLayout {
  readonly store = inject(WorkbookStore);
  readonly onTable = inject(Router).url.includes('/table/');
  readonly macId = input.required<string>();

  constructor() {
    effect(() => {
      const id = Number(this.macId());
      untracked(() => {
        if (this.store.mac()?.macId !== id) void this.store.load(id);
      });
    });
  }
}
