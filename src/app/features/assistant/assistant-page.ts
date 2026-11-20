import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { WorkbookStore } from '@core/workbook-store';
import { Icon } from '@shared/ui/icon';
import { Assistant, type Chat } from './assistant';
import { AssistantAsk } from './assistant-ask';

/** One group of the history: a heading and its chats. */
interface Group {
  label: string;
  chats: Chat[];
}

/**
 * AI chat: the whole window is the chat. Down the left, the chats of this MAC (the latest first) and a new chat; the rest is the conversation
 * with the local assistant, which answers about the MAC's data. The menu of the MAC's tables is not shown here.
 */
@Component({
  selector: 'app-assistant-page',
  imports: [RouterLink, Icon, AssistantAsk],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.mac(); as mac) {
      <div class="shell" [class.folded]="!historyOpen()">
        <aside class="history" aria-label="Chat history">
          <div class="h-top">
            <a class="h-back" [routerLink]="['/mac', mac.macId]" title="Back to {{ mac.macName }}" aria-label="Back"><app-icon name="arrow-left" [size]="16" /></a>
            <span class="h-title">AI chat</span>
            <button type="button" class="h-fold" title="Hide the history" aria-label="Hide the history" (click)="historyOpen.set(false)"><app-icon name="panel-left" [size]="16" /></button>
          </div>
          <button type="button" class="new" [disabled]="!!assistant.busy()" (click)="assistant.newChat(mac.macId)"><app-icon name="plus" [size]="15" /> New chat</button>
          <label class="search">
            <app-icon name="search" [size]="14" />
            <input type="search" placeholder="Search chats" [value]="search()" (input)="search.set($any($event.target).value)" aria-label="Search chats" />
          </label>
          <nav class="list">
            @for (group of groups(); track group.label) {
              <span class="g-label">{{ group.label }}</span>
              @for (chat of group.chats; track chat.id) {
                <div class="item" [class.on]="chat.id === assistant.activeId(mac.macId)">
                  <button type="button" class="open" [title]="chat.title" (click)="assistant.select(mac.macId, chat.id)">{{ chat.title }}</button>
                  <button type="button" class="del" title="Delete this chat" aria-label="Delete this chat" (click)="assistant.deleteChat(mac.macId, chat.id)"><app-icon name="trash" [size]="13" /></button>
                </div>
              }
            } @empty {
              <p class="none">{{ search() ? 'No chat matches.' : 'Your chats show here.' }}</p>
            }
          </nav>
          <a class="model" routerLink="/settings" title="The assistant is set up in Settings">
            <span class="dot" [class.on]="assistant.status()?.running" [class.off]="!assistant.ready()"></span>
            <span class="m-text">
              <b>{{ assistant.status()?.modelName ?? 'Local assistant' }}</b>
              <small>{{ assistant.ready() ? (assistant.status()?.running ? 'Running on this Mac' : 'Ready · starts when you ask') : 'Not downloaded yet' }}</small>
            </span>
            <app-icon name="settings" [size]="14" />
          </a>
        </aside>

        <section class="main">
          <header class="m-head">
            @if (!historyOpen()) {
              <button type="button" class="h-fold" title="Show the history" aria-label="Show the history" (click)="historyOpen.set(true)"><app-icon name="panel-left" [size]="16" /></button>
            }
            <span class="m-title">{{ current()?.title ?? 'New chat' }}</span>
            <span class="chip-model"><span class="dot" [class.on]="assistant.status()?.running" [class.off]="!assistant.ready()"></span> {{ assistant.status()?.modelName ?? 'Local assistant' }}</span>
          </header>
          <app-assistant-ask [sheets]="store.sheets()" [macId]="mac.macId" [macName]="mac.macName" />
        </section>
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .shell { flex: 1; min-height: 0; display: flex; gap: 12px; padding: 12px; }
    .history { flex: none; width: 272px; display: flex; flex-direction: column; gap: 10px; min-height: 0; padding: 14px 12px 12px; border: var(--hairline) solid var(--border); border-radius: 24px; background: var(--surface); box-shadow: var(--shadow-sm); }
    .shell.folded .history { display: none; }
    .h-top { display: flex; align-items: center; gap: 8px; padding: 0 2px; }
    .h-title { flex: 1; font-weight: 600; letter-spacing: -0.01em; }
    .h-back, .h-fold { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 50%; background: transparent; color: var(--text-muted); cursor: pointer; }
    .h-back:hover, .h-fold:hover { background: var(--fill); color: var(--text); }
    .new { display: flex; align-items: center; justify-content: center; gap: 8px; height: 40px; border: 0; border-radius: 999px; background: var(--ink, var(--accent)); color: #fff; font: inherit; font-size: 0.875rem; font-weight: 600; cursor: pointer; }
    .new:disabled { opacity: 0.5; cursor: default; }
    .search { display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 36px; border-radius: 12px; background: var(--field, var(--surface-solid)); color: var(--text-muted); box-shadow: inset 0 1px 2px rgba(24, 28, 44, 0.07); }
    .search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: inherit; font-size: 0.8125rem; color: var(--text); }
    .list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; margin: 0 -4px; padding: 0 4px; }
    .g-label { margin: 12px 8px 4px; font-family: var(--mono); font-size: 0.625rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-muted); }
    .item { display: flex; align-items: center; border-radius: 12px; }
    .item:hover { background: var(--surface-hover, rgba(24, 28, 44, 0.05)); }
    .item.on { background: #fff; box-shadow: var(--shadow-xs), 0 4px 12px rgba(24, 28, 44, 0.06); }
    .open { flex: 1; min-width: 0; padding: 9px 10px; border: 0; background: transparent; font: inherit; font-size: 0.8125rem; text-align: left; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
    .del { flex: none; display: none; place-items: center; width: 26px; height: 26px; margin-right: 4px; border: 0; border-radius: 8px; background: transparent; color: var(--text-muted); cursor: pointer; }
    .item:hover .del { display: grid; }
    .del:hover { background: var(--fill); color: var(--danger, #b42318); }
    .none { margin: 12px 8px; font-size: 0.8125rem; color: var(--text-muted); }
    .model { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 14px; background: var(--surface-solid); box-shadow: var(--shadow-xs); color: var(--text-muted); text-decoration: none; }
    .model:hover { color: var(--text); }
    .m-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .m-text b { font-size: 0.75rem; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .m-text small { font-size: 0.6875rem; }
    .dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--success); }
    .dot.on { box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 25%, transparent); }
    .dot.off { background: var(--text-muted); opacity: 0.5; }
    .main { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; border: var(--hairline) solid var(--border); border-radius: 24px; background: var(--surface); box-shadow: var(--shadow-sm); overflow: hidden; }
    .m-head { flex: none; display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-bottom: var(--hairline) solid var(--border); }
    .m-title { flex: 1; min-width: 0; font-weight: 600; font-size: 0.9375rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .chip-model { display: inline-flex; align-items: center; gap: 8px; padding: 5px 12px; border-radius: 999px; background: var(--surface-solid); box-shadow: var(--shadow-xs); font-size: 0.75rem; font-weight: 500; color: var(--text-muted); }
    .main app-assistant-ask { flex: 1; min-height: 0; }
    @media (max-width: 900px) { .history { position: absolute; z-index: 20; inset: 12px auto 12px 12px; } }
  `,
})
export class AssistantPage {
  readonly store = inject(WorkbookStore);
  readonly assistant = inject(Assistant);

  readonly historyOpen = signal(true);
  readonly search = signal('');

  constructor() {
    void this.assistant.refresh();
  }

  readonly current = computed(() => {
    const mac = this.store.mac();
    return mac ? (this.assistant.chats().find((chat) => chat.id === this.assistant.activeId(mac.macId)) ?? null) : null;
  });

  /** This MAC's chats that match the search, in groups by how long ago they were last used. */
  readonly groups = computed<Group[]>(() => {
    const mac = this.store.mac();
    if (!mac) return [];
    const words = this.search().trim().toLowerCase();
    const chats = this.assistant.chatsOf(mac.macId).filter((chat) => !words || chat.title.toLowerCase().includes(words) || chat.turns.some((turn) => turn.question.toLowerCase().includes(words)));
    const startOfDay = new Date().setHours(0, 0, 0, 0);
    const buckets: Group[] = [
      { label: 'Today', chats: [] },
      { label: 'Yesterday', chats: [] },
      { label: 'Earlier this week', chats: [] },
      { label: 'Older', chats: [] },
    ];
    for (const chat of chats) {
      const days = Math.floor((startOfDay - new Date(chat.updatedAt).setHours(0, 0, 0, 0)) / 86_400_000);
      buckets[days <= 0 ? 0 : days === 1 ? 1 : days < 7 ? 2 : 3].chats.push(chat);
    }
    return buckets.filter((bucket) => bucket.chats.length);
  });
}
