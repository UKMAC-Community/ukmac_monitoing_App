import { ChangeDetectionStrategy, Component, computed, ElementRef, HostListener, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Google } from '@core/google/google';
import { AppUpdater } from '@core/updater';
import { WorkbookStore } from '@core/workbook-store';
import { todayIso } from '@shared/sheet/columns';
import { Icon } from '@shared/ui/icon';
import { noticeCount, notices } from './notices';

/**
 * The bell on the Soft icon rail (the web system's notification bell): a red count of what needs attention, and a list that opens
 * beside the rail. An app update waiting, problems the Data Check found in the open MAC, and Google Sheets that failed or were
 * not read for a day (see notices.ts).
 */
@Component({
  selector: 'app-notification-bell',
  imports: [Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="rail-btn bell" [class.active]="open()" [attr.aria-expanded]="open()" [attr.aria-label]="count() ? 'Notifications, ' + count() + ' need you' : 'Notifications'" [title]="count() ? count() + ' need you' : 'Notifications'" (click)="open.set(!open())">
      <app-icon name="bell" [size]="19" />
      @if (count()) {
        <span class="badge">{{ count() > 9 ? '9+' : count() }}</span>
      }
    </button>
    @if (open()) {
      <div class="panel" role="dialog" aria-label="Notifications">
        <p class="head">Notifications</p>
        @if (list().length) {
          <ul>
            @for (item of list(); track item.id) {
              <li>
                <a [routerLink]="item.link" (click)="open.set(false)">
                  <span class="mark" [class]="'mark ' + item.tone"><app-icon [name]="item.icon" [size]="15" /></span>
                  <span class="text">
                    <strong>{{ item.title }}</strong>
                    @if (item.detail) {
                      <small>{{ item.detail }}</small>
                    }
                  </span>
                </a>
              </li>
            }
          </ul>
        } @else {
          <p class="none">You're all caught up.</p>
        }
      </div>
    }
  `,
  styles: `
    :host { position: relative; display: inline-flex; }
    .bell { position: relative; }
    .badge { position: absolute; top: -3px; right: -3px; min-width: 17px; height: 17px; padding: 0 4px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; background: var(--danger); color: #fff; font-size: 0.625rem; font-weight: 700; font-variant-numeric: tabular-nums; box-shadow: 0 0 0 2px #fff; }
    .panel { position: absolute; left: calc(100% + 18px); bottom: -4px; z-index: 60; width: 22rem; max-height: min(70vh, 32rem); overflow-y: auto; border: var(--hairline) solid var(--border); border-radius: 18px; background: var(--surface-solid); box-shadow: var(--shadow-lg, 0 16px 40px rgba(24, 28, 44, 0.18)); }
    .head { margin: 0; padding: 12px 16px; border-bottom: var(--hairline) solid var(--border); font-size: 0.875rem; font-weight: 600; }
    ul { margin: 0; padding: 0; list-style: none; }
    li + li { border-top: var(--hairline) solid var(--border); }
    a { display: flex; align-items: flex-start; gap: 12px; padding: 11px 16px; color: var(--text); text-decoration: none; }
    a:hover { background: var(--surface-hover); }
    .mark { flex: none; width: 30px; height: 30px; margin-top: 1px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--fill, rgba(24, 28, 44, 0.07)); }
    .mark.warning { background: var(--warning-soft); color: var(--warning); }
    .mark.danger { background: var(--danger-soft); color: var(--danger); }
    .text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    strong { font-size: 0.8125rem; font-weight: 600; line-height: 1.35; }
    small { font-size: 0.75rem; color: var(--text-muted); line-height: 1.35; overflow-wrap: anywhere; }
    .none { margin: 0; padding: 26px 16px; text-align: center; font-size: 0.8125rem; color: var(--text-muted); }
  `,
})
export class NotificationBell {
  /** The open MAC (none on the overview and in Settings: only the update is told there). */
  readonly macId = input<number | null>(null);
  private readonly store = inject(WorkbookStore);
  private readonly google = inject(Google);
  private readonly updater = inject(AppUpdater);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly open = signal(false);

  readonly list = computed(() =>
    notices({
      macId: this.macId(),
      sheets: this.macId() === null ? [] : this.store.sheets(),
      links: this.google.links(),
      failures: this.google.failures(),
      update: { offered: this.updater.update()?.version ?? null, installed: this.updater.installedVersion(), screens: this.updater.screensReady() },
      today: todayIso(),
      now: Date.now(),
    }),
  );
  readonly count = computed(() => noticeCount(this.list()));

  @HostListener('document:pointerdown', ['$event'])
  away(event: PointerEvent) {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  escape() {
    this.open.set(false);
  }
}
