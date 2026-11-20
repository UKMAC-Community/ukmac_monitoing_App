import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import type { SheetWithRows } from '@core/models';
import { formatDate, isIsoDate, todayIso } from '@shared/sheet/columns';
import { Icon } from '@shared/ui/icon';
import { Assistant, type Turn } from './assistant';
import { type Rag, runRag } from './assistant-rag';

/** One of the queries the app ran for an answer, shown inside it as a step. */
interface Step {
  title: string;
  detail: string;
  /** How it was called: a function and its arguments. */
  call?: string;
  /** The result, line by line. A long one is folded away. */
  lines?: string[];
  state: 'ok' | 'warn';
}

/** The queries behind an answer: what the app understood, each query it ran with its result, and the assistant's part. */
export function stepsOf(turn: Turn): Step[] {
  const { rag } = turn;
  const steps: Step[] = [{ title: 'Understood the question', detail: rag.understood.length ? rag.understood.join(' · ') : 'No table, day or plot recognised', state: 'ok' }];
  for (const query of rag.queries) steps.push({ title: query.title, detail: query.sql, call: query.call, lines: query.lines, state: query.warn ? 'warn' : 'ok' });
  if (rag.records > 0) {
    steps.push({
      title: 'Checked how the records relate',
      detail: 'Planting date of each plot, records with no plot, dates in the future',
      lines: rag.notes.length ? rag.notes : ["Nothing that doesn't fit."],
      state: rag.notes.length ? 'warn' : 'ok',
    });
  }
  if (turn.seconds !== null) steps.push({ title: 'Asked the assistant', detail: `Put the results into words in ${turn.seconds.toFixed(1)} s, on this Mac`, call: 'assistant.answer(results, records, question)', state: 'ok' });
  return steps;
}

/** The AI chat: ask the local assistant about the MAC's data. The app runs the queries (finds the records, works out how they relate); the assistant puts it into words. */
@Component({
  selector: 'app-assistant-ask',
  imports: [Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="chat">
      <div class="thread" #thread>
        @if (!assistant.status()) {
          <p class="note">Looking for the assistant…</p>
        } @else if (!assistant.status()!.supported) {
          <p class="note">The local assistant isn't available on this system yet: it runs on a Mac.</p>
        } @else if (!assistant.ready()) {
          <div class="empty">
            <span class="logo"><app-icon name="sparkles" [size]="22" /></span>
            <strong>Set up the assistant first</strong>
            <p>It needs a one-time download ({{ gb() }}), then it works on this Mac without the internet.</p>
            <a class="btn btn-primary btn-sm" routerLink="/settings" fragment="assistant"><app-icon name="download" /> Set it up in Settings</a>
          </div>
        } @else {
          @if (!turns().length && !pending()) {
            <div class="empty">
              <span class="logo"><app-icon name="sparkles" [size]="24" /></span>
              <h2>What would you like to know about {{ macName() }}?</h2>
              <p>I search every table, work out how the records relate, and show you each query I ran.</p>
              <div class="cards">
                @for (sample of samples(); track sample.text) {
                  <button type="button" class="card-q" (click)="pick(sample.text)">
                    <span class="card-icon"><app-icon [name]="sample.icon" [size]="16" /></span>
                    <span>{{ sample.text }}</span>
                  </button>
                }
              </div>
            </div>
          }
          @for (turn of turns(); track $index) {
            <div class="msg user"><p>{{ turn.question }}</p></div>
            <div class="msg bot">
              <span class="avatar"><app-icon name="sparkles" [size]="15" /></span>
              <div class="bot-body">
                <details class="steps" [open]="$last || turn.rag.notes.length > 0">
                  <summary>
                    <app-icon name="chevron-right" [size]="13" class="chev" />
                    Ran {{ steps(turn).length }} quer{{ steps(turn).length === 1 ? 'y' : 'ies' }}
                    @if (turn.rag.notes.length) {
                      <span class="flag">{{ turn.rag.notes.length }} thing{{ turn.rag.notes.length === 1 ? '' : 's' }} to look at</span>
                    }
                  </summary>
                  <ol>
                    @for (step of steps(turn); track step.title) {
                      <li [class.warn]="step.state === 'warn'">
                        <span class="dot"></span>
                        <div class="step">
                          <b>{{ step.title }}</b>
                          @if (step.call) {
                            <code class="call"><span class="fn">ƒ</span> {{ step.call }}</code>
                          }
                          <span class="detail">{{ step.detail }}</span>
                          @if (step.lines && step.lines.length <= 4) {
                            <ul [class.warn]="step.state === 'warn'">
                              @for (line of step.lines; track $index) {
                                <li>{{ line }}</li>
                              }
                            </ul>
                          } @else if (step.lines) {
                            <ul [class.warn]="step.state === 'warn'">
                              @for (line of step.lines.slice(0, 3); track $index) {
                                <li>{{ line }}</li>
                              }
                            </ul>
                            <details class="records">
                              <summary>Show all {{ step.lines.length }} lines</summary>
                              <pre>{{ step.lines.join('\n') }}</pre>
                            </details>
                          }
                        </div>
                      </li>
                    }
                  </ol>
                </details>
                <p class="said">{{ turn.answer }}</p>
                @if (turn.rag.sources.length) {
                  <div class="refs">
                    <span class="refs-label">Sources</span>
                    @for (source of turn.rag.sources; track source.sheetId; let n = $index) {
                      <a class="ref" [routerLink]="['/mac', macId(), 'table', source.sheetId]" [title]="'Open ' + source.table + ': ' + source.columns.join(', ')">
                        <span class="ref-n">{{ n + 1 }}</span>
                        <span class="ref-text"><b>{{ source.table }}</b><small>{{ source.columns.length ? source.columns.join(', ') + ' · ' : '' }}{{ source.rows }} record{{ source.rows === 1 ? '' : 's' }}</small></span>
                      </a>
                    }
                  </div>
                }
              </div>
            </div>
          }
          @if (pending(); as asking) {
            <div class="msg user"><p>{{ asking.question }}</p></div>
            <div class="msg bot">
              <span class="avatar"><app-icon name="sparkles" [size]="15" /></span>
              <div class="bot-body">
                <ol class="live">
                  <li><span class="dot done"></span><div class="step"><b>Understood the question</b><span class="detail">{{ asking.rag.understood.length ? asking.rag.understood.join(' · ') : 'No table, day or plot recognised' }}</span></div></li>
                  @for (query of asking.rag.queries; track query.title) {
                    <li><span class="dot done"></span><div class="step"><b>{{ query.title }}</b><code class="call"><span class="fn">ƒ</span> {{ query.call }}</code><span class="detail">{{ query.lines[0] }}</span></div></li>
                  }
                  <li>
                    <span class="dot spin"></span>
                    <div class="step"><b>Asking the assistant…</b><code class="call"><span class="fn">ƒ</span> assistant.answer(results, records, question)</code><span class="detail">The first question of a session loads the model: a few seconds.</span></div>
                  </li>
                </ol>
              </div>
            </div>
          }
          @if (assistant.error()) {
            <div class="alert-box error" role="alert">{{ assistant.error() }}</div>
          }
        }
      </div>

      @if (assistant.ready()) {
        <form class="composer" (submit)="$event.preventDefault(); ask()">
          <input
            type="text"
            autocomplete="off"
            [value]="question()"
            (input)="question.set($any($event.target).value)"
            [placeholder]="'Ask anything about ' + macName() + ', e.g. What happened on ' + example() + '?'"
            [disabled]="!!assistant.busy()"
            aria-label="Your question"
          />
          <button type="submit" class="send" [disabled]="!!assistant.busy() || !question().trim()" aria-label="Ask"><app-icon name="arrow-up" [size]="16" /></button>
        </form>
        <small class="foot">Runs on this Mac: nothing is sent anywhere. A small model can slip: the queries under each answer show what it was given.</small>
      }
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; flex: 1; min-height: 0; }
    .chat { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
    .thread { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 22px; padding: 28px max(16px, calc((100% - 780px) / 2)) 16px; scroll-behavior: smooth; }
    .note { margin: auto; font-size: 0.875rem; color: var(--text-muted); }
    .empty { margin: auto; width: 100%; max-width: 640px; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; padding: 24px 0; }
    .empty h2 { margin: 6px 0 0; font-size: 1.625rem; font-weight: 600; letter-spacing: -0.03em; line-height: 1.2; }
    .empty p { margin: 0; font-size: 0.9375rem; line-height: 1.55; color: var(--text-muted); }
    .cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; width: 100%; margin-top: 18px; }
    .card-q { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border: var(--hairline) solid var(--border); border-radius: 16px; background: var(--surface-solid); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); font: inherit; font-size: 0.875rem; font-weight: 500; text-align: left; color: var(--text); cursor: pointer; transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s; }
    .card-q:hover { transform: translateY(-1px); border-color: var(--accent); box-shadow: 0 8px 22px rgba(24, 28, 44, 0.1); }
    .card-icon { flex: none; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 10px; background: var(--accent-soft); color: var(--accent); }
    .logo { display: grid; place-items: center; width: 56px; height: 56px; border-radius: 20px; background: var(--accent-soft); color: var(--accent); }
    .chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 6px; }
    .chip { padding: 7px 14px; border: var(--hairline) solid var(--border); border-radius: 999px; background: var(--surface-solid); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); font: inherit; font-size: 0.8125rem; color: var(--text); cursor: pointer; }
    .chip:hover { border-color: var(--accent); color: var(--accent); }
    .msg { display: flex; gap: 12px; width: 100%; }
    .msg.user { align-self: flex-end; width: auto; max-width: 80%; }
    .msg.user p { margin: 0; padding: 10px 16px; border-radius: 18px 18px 4px 18px; background: var(--ink, var(--accent)); color: #fff; font-size: 0.9375rem; line-height: 1.5; }
    .avatar { flex: none; display: grid; place-items: center; width: 30px; height: 30px; margin-top: 2px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); }
    .bot-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
    .said { margin: 0; white-space: pre-wrap; font-size: 1rem; line-height: 1.7; }
    .steps { border: var(--hairline) solid var(--border); border-radius: 12px; background: var(--surface-solid); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); }
    .steps > summary { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; list-style: none; font-size: 0.8125rem; font-weight: 500; color: var(--text-muted); }
    .steps > summary::-webkit-details-marker { display: none; }
    .steps .chev { transition: transform 0.15s; }
    .steps[open] .chev { transform: rotate(90deg); }
    .flag { margin-left: auto; padding: 1px 9px; border-radius: 999px; background: var(--warning-soft); color: var(--warning); font-size: 0.75rem; font-weight: 600; }
    ol { margin: 0; padding: 4px 14px 12px; list-style: none; display: flex; flex-direction: column; gap: 10px; }
    ol > li { position: relative; display: flex; gap: 10px; }
    ol > li:not(:last-child)::before { content: ''; position: absolute; left: 4px; top: 14px; bottom: -12px; width: 1px; background: var(--border-strong); }
    .dot { flex: none; width: 9px; height: 9px; margin-top: 5px; border-radius: 50%; background: var(--success); }
    li.warn > .dot { background: var(--warning); }
    .dot.done { background: var(--success); }
    .dot.spin { background: transparent; border: 2px solid var(--accent); border-right-color: transparent; width: 11px; height: 11px; margin-top: 4px; animation: turn 0.8s linear infinite; }
    @keyframes turn { to { transform: rotate(360deg); } }
    .live { padding: 0; }
    .step { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: 0.8125rem; }
    .step b { font-weight: 600; }
    .detail { color: var(--text-muted); line-height: 1.45; }
    .call { display: block; margin: 3px 0; padding: 5px 9px; border-radius: 8px; background: var(--fill); font: 0.75rem/1.45 var(--mono); color: var(--text); overflow-wrap: anywhere; }
    .call .fn { color: var(--accent); font-weight: 700; margin-right: 4px; }
    .refs { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 2px; }
    .refs-label { font-family: var(--mono); font-size: 0.625rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-muted); }
    .ref { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; padding: 5px 12px 5px 6px; border: var(--hairline) solid var(--border); border-radius: 999px; background: var(--surface-solid); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); color: var(--text); text-decoration: none; }
    .ref:hover { border-color: var(--accent); }
    .ref-n { flex: none; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--accent-soft); color: var(--accent); font-size: 0.6875rem; font-weight: 700; }
    .ref-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.25; }
    .ref-text b { font-size: 0.75rem; font-weight: 600; }
    .ref-text small { font-size: 0.6875rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .step ul { margin: 4px 0 0; padding-left: 16px; color: var(--text); line-height: 1.5; }
    .step ul.warn { color: var(--warning); }
    .records summary { cursor: pointer; font-size: 0.75rem; color: var(--accent); margin-top: 2px; }
    .records pre { max-height: 240px; overflow: auto; margin: 6px 0 0; padding: 10px 12px; border-radius: 8px; background: var(--fill); font: 0.75rem/1.5 var(--mono); white-space: pre-wrap; color: var(--text); }
    .composer { display: flex; align-items: center; gap: 8px; width: min(780px, calc(100% - 32px)); margin: 0 auto; padding: 8px 8px 8px 22px; border: var(--hairline) solid var(--border); border-radius: 28px; background: var(--surface-solid); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05), 0 8px 24px rgba(24, 28, 44, 0.08); }
    .composer input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font: inherit; font-size: 1rem; color: var(--text); padding: 10px 0; }
    .send { flex: none; display: grid; place-items: center; width: 40px; height: 40px; border: 0; border-radius: 50%; background: var(--ink, var(--accent)); color: #fff; cursor: pointer; }
    .send:disabled { opacity: 0.35; cursor: default; }
    .foot { text-align: center; font-size: 0.6875rem; color: var(--text-muted); padding-bottom: 10px; }
    @media (max-width: 700px) { .cards { grid-template-columns: 1fr; } }
  `,
})
export class AssistantAsk {
  readonly assistant = inject(Assistant);
  readonly sheets = input.required<SheetWithRows[]>();
  readonly macId = input.required<number>();
  readonly macName = input('this MAC');

  readonly question = signal('');
  /** The question being answered now, with what the app found for it. */
  readonly pending = signal<{ question: string; rag: Rag } | null>(null);
  readonly turns = computed(() => this.assistant.turns(this.macId()));
  private readonly thread = viewChild<ElementRef<HTMLElement>>('thread');

  /** The latest day the data has records on (not after today): an example for the box. */
  readonly latest = computed(() => {
    const today = todayIso();
    let latest = '';
    for (const sheet of this.sheets()) {
      const column = sheet.columns.find((item) => item.type === 'date');
      if (!column) continue;
      for (const row of sheet.rows) {
        const day = String(row.data[column.key] ?? '').slice(0, 10);
        if (isIsoDate(day) && day <= today && day > latest) latest = day;
      }
    }
    return latest;
  });
  readonly example = computed(() => (this.latest() ? `${Number(this.latest().slice(8, 10))} ${MONTHS[Number(this.latest().slice(5, 7)) - 1] ?? ''}` : 'yesterday'));
  readonly samples = computed(() => {
    const day = this.latest();
    const base = [
      { text: 'How many plots are in each zone?', icon: 'grid' },
      { text: 'Total harvest yield per zone', icon: 'chart' },
      { text: 'Does anything not fit?', icon: 'alert' },
    ];
    return day ? [{ text: `What happened on ${formatDate(day)}?`, icon: 'calendar' }, ...base] : base;
  });

  private readonly stepCache = new WeakMap<Turn, Step[]>();

  constructor() {
    void this.assistant.refresh();
    // The newest message comes into view as it is added.
    effect(() => {
      this.turns();
      this.pending();
      const element = this.thread()?.nativeElement;
      if (element) untracked(() => setTimeout(() => element.scrollTo({ top: element.scrollHeight }), 0));
    });
  }

  steps(turn: Turn): Step[] {
    let steps = this.stepCache.get(turn);
    if (!steps) this.stepCache.set(turn, (steps = stepsOf(turn)));
    return steps;
  }

  gb() {
    return `${((this.assistant.status()?.downloadBytes ?? 0) / 1024 ** 3).toFixed(1)} GB`;
  }

  pick(sample: string) {
    this.question.set(sample);
    void this.ask();
  }

  async ask() {
    const question = this.question().trim();
    if (!question || this.assistant.busy()) return;
    const rag = runRag(question, this.sheets(), todayIso(), this.turns().at(-1)?.rag.carry ?? null);
    this.question.set('');
    // Nothing for the model to put into words: the app answers itself.
    if (rag.direct) {
      this.assistant.addTurn(this.macId(), { question, answer: rag.direct, rag, seconds: null });
      return;
    }
    this.pending.set({ question, rag });
    const began = performance.now();
    const text = await this.assistant.ask(this.macId(), withHistory(this.turns(), rag.context), question);
    this.pending.set(null);
    if (text) this.assistant.addTurn(this.macId(), { question, answer: text, rag, seconds: (performance.now() - began) / 1000 });
    else this.question.set(question);
  }
}

/** How many earlier exchanges the model is reminded of, and how much of each answer. */
const HISTORY_TURNS = 2;
const HISTORY_CHARS = 300;

/** The query results the model reads, with the last exchanges before them, so a follow-up ("tell me in detail") is answered as part of the conversation. */
export function withHistory(turns: readonly Turn[], context: string): string {
  const recent = turns.slice(-HISTORY_TURNS);
  if (!recent.length) return context;
  const said = recent.map((turn) => `Q: ${turn.question}\nA: ${turn.answer.length > HISTORY_CHARS ? `${turn.answer.slice(0, HISTORY_CHARS)}…` : turn.answer}`).join('\n');
  return `THE CONVERSATION SO FAR (the question below may follow on from it):\n${said}\n\n${context}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
