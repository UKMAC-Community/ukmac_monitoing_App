import { Injectable, inject, signal } from '@angular/core';
import { listen } from '@tauri-apps/api/event';

import { Api, errorText } from '@core/api';
import type { AssistantProgress, AssistantStatus } from '@core/models';
import type { Rag } from './assistant-rag';

/** A conversation about one MAC. */
export interface Chat {
  id: string;
  macId: number;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: Turn[];
}

const CHATS_KEY = 'ukmac.chats.v1';
const MAX_CHATS = 60;

/** What is kept of a chat on this computer: the questions, answers and what the queries found (not the text handed to the model). */
function slim(chats: Chat[]): Chat[] {
  return chats.map((chat) => ({
    ...chat,
    turns: chat.turns.map((turn) => ({ ...turn, rag: { ...turn.rag, context: '', queries: turn.rag.queries.map((query) => ({ ...query, lines: query.lines.slice(0, 40) })) } })),
  }));
}

function loadChats(): Chat[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHATS_KEY) ?? '[]') as Chat[];
    return Array.isArray(parsed) ? parsed.filter((chat) => chat && typeof chat.id === 'string' && Array.isArray(chat.turns)) : [];
  } catch {
    return [];
  }
}

/** One question and its answer: the queries the app ran for it, and how long the assistant took (null: the app answered itself). */
export interface Turn {
  question: string;
  answer: string;
  rag: Rag;
  seconds: number | null;
}

/** The local assistant's state, shared by Settings (set up, start, remove) and Data Check (ask). */
@Injectable({ providedIn: 'root' })
export class Assistant {
  private readonly api = inject(Api);

  readonly status = signal<AssistantStatus | null>(null);
  readonly progress = signal<AssistantProgress | null>(null);
  /** What it is doing now: downloading, loading the model, or answering. */
  readonly busy = signal<'' | 'install' | 'start' | 'ask'>('');
  readonly error = signal('');
  /** The conversations, on this computer (they hold what the queries found in the farm's tables, like the database does). */
  readonly chats = signal<Chat[]>(loadChats());
  /** The chat open for each MAC; none means a new chat, made when the first question is asked. */
  private readonly open = signal<Record<number, string | null>>({});

  constructor() {
    // Progress comes from the native side while a download runs (not available outside the app, e.g. in tests).
    listen<AssistantProgress>('assistant-progress', (event) => this.progress.set(event.payload)).catch(() => undefined);
  }

  /** A MAC's chats, the latest first. */
  chatsOf(macId: number): Chat[] {
    return this.chats()
      .filter((chat) => chat.macId === macId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  activeId(macId: number): string | null {
    return this.open()[macId] ?? null;
  }

  turns(macId: number): Turn[] {
    const id = this.activeId(macId);
    return this.chats().find((chat) => chat.id === id)?.turns ?? [];
  }

  addTurn(macId: number, turn: Turn) {
    const now = Date.now();
    let id = this.activeId(macId);
    if (!id || !this.chats().some((chat) => chat.id === id)) {
      id = `${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      const title = turn.question.length > 48 ? `${turn.question.slice(0, 47)}…` : turn.question;
      this.chats.update((all) => [...all, { id: id!, macId, title, createdAt: now, updatedAt: now, turns: [] }]);
      this.open.update((open) => ({ ...open, [macId]: id }));
    }
    this.chats.update((all) => all.map((chat) => (chat.id === id ? { ...chat, updatedAt: now, turns: [...chat.turns, turn] } : chat)));
    this.save(macId);
  }

  newChat(macId: number) {
    this.open.update((open) => ({ ...open, [macId]: null }));
  }

  select(macId: number, id: string) {
    this.open.update((open) => ({ ...open, [macId]: id }));
  }

  deleteChat(macId: number, id: string) {
    this.chats.update((all) => all.filter((chat) => chat.id !== id));
    if (this.activeId(macId) === id) this.newChat(macId);
    this.save(macId);
  }

  clearAll(macId: number) {
    this.chats.update((all) => all.filter((chat) => chat.macId !== macId));
    this.newChat(macId);
    this.save(macId);
  }

  private save(macId: number) {
    // Only the newest chats of a MAC are kept.
    const mine = this.chatsOf(macId);
    if (mine.length > MAX_CHATS) {
      const drop = new Set(mine.slice(MAX_CHATS).map((chat) => chat.id));
      this.chats.update((all) => all.filter((chat) => !drop.has(chat.id)));
    }
    try {
      localStorage.setItem(CHATS_KEY, JSON.stringify(slim(this.chats())));
    } catch {
      // The browser's storage is full or off: the chats stay for as long as the app is open.
    }
  }

  /** Ready to be asked: both downloads are in place. */
  ready() {
    const status = this.status();
    return !!status && status.engineReady && status.modelReady;
  }

  async refresh() {
    try {
      this.status.set(await this.api.assistantStatus());
    } catch {
      this.status.set(null);
    }
  }

  /** Runs `work`, keeping `busy` and `error` up to date; the status is read again after. */
  private async run<T>(kind: 'install' | 'start' | 'ask', work: () => Promise<T>): Promise<T | null> {
    if (this.busy()) return null;
    this.busy.set(kind);
    this.error.set('');
    this.progress.set(null);
    this.status.update((status) => (status && kind === 'install' ? { ...status, installing: true } : status));
    try {
      return await work();
    } catch (error) {
      this.error.set(errorText(error));
      return null;
    } finally {
      this.busy.set('');
      this.progress.set(null);
      await this.refresh();
    }
  }

  install() {
    return this.run('install', () => this.api.assistantInstall());
  }

  cancel() {
    return this.api.assistantCancel();
  }

  start() {
    return this.run('start', () => this.api.assistantStart());
  }

  async stop() {
    this.status.set(await this.api.assistantStop());
  }

  async remove() {
    this.error.set('');
    try {
      this.status.set(await this.api.assistantRemove());
    } catch (error) {
      this.error.set(errorText(error));
    }
  }

  /** The answer, or null (the reason is in `error`). */
  ask(macId: number, context: string, question: string) {
    return this.run('ask', () => this.api.assistantAsk(macId, context, question));
  }
}

export function bytesText(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}
