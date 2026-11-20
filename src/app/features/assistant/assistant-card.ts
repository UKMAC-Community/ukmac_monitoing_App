import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { Icon } from '@shared/ui/icon';
import { Assistant, bytesText } from './assistant';

/** Settings: download, start, stop and remove the local assistant. */
@Component({
  selector: 'app-assistant-card',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card">
      <div class="row-head">
        <span class="tile-icon"><app-icon name="sparkles" [size]="18" /></span>
        <div class="grow">
          <h2 class="card-title">Local assistant</h2>
          <p class="card-desc">
            A small AI model that runs on this Mac, to ask about your data in AI chat: “what happened on 12 Nov?”. The app finds the
            records; the model puts them into words and says what doesn't fit. It is downloaded once, then works offline, and your
            data never leaves this computer. It answers in English: small models are weak in Khmer.
          </p>
        </div>
      </div>

      @if (assistant.status(); as status) {
        <div class="setting-row">
          <div class="setting-text">
            <span class="setting-title">{{ status.modelName }}</span>
            @if (!status.supported) {
              <span class="setting-desc">Not available on this system yet: it runs on a Mac.</span>
            } @else if (assistant.busy() === 'install' || status.installing) {
              <span class="setting-desc">{{ phaseText() }}</span>
              <progress class="bar" max="100" [value]="percent()"></progress>
            } @else if (assistant.busy() === 'start') {
              <span class="setting-desc">Starting… the first time loads the model, which takes a few seconds.</span>
            } @else if (assistant.ready()) {
              <span class="setting-desc">
                Downloaded ({{ bytes(status.diskBytes) }}). {{ status.running ? 'Running now; it stops by itself after ten quiet minutes, or when the app closes.' : 'Not running: it starts when you ask it something.' }}
              </span>
            } @else {
              <span class="setting-desc">Download {{ bytes(status.downloadBytes) }} once (the engine and the model).</span>
            }
            @if (assistant.error()) {
              <span class="setting-desc err" role="alert">{{ assistant.error() }}</span>
            }
          </div>
          <div class="actions">
            @if (status.supported) {
              @if (assistant.busy() === 'install' || status.installing) {
                <button type="button" class="btn btn-secondary btn-sm" (click)="assistant.cancel()">Stop</button>
              } @else if (!assistant.ready()) {
                <button type="button" class="btn btn-primary btn-sm" [disabled]="!!assistant.busy()" (click)="assistant.install()"><app-icon name="download" /> Download</button>
              } @else {
                @if (status.running) {
                  <button type="button" class="btn btn-secondary btn-sm" (click)="assistant.stop()">Stop</button>
                } @else {
                  <button type="button" class="btn btn-secondary btn-sm" [disabled]="!!assistant.busy()" (click)="assistant.start()">Start</button>
                }
                <button type="button" class="btn btn-secondary btn-sm" [disabled]="!!assistant.busy()" (click)="assistant.remove()"><app-icon name="trash" /> Remove</button>
              }
            }
          </div>
        </div>
      }
    </section>
  `,
  styles: `
    .row-head { display: flex; gap: 14px; margin-bottom: 6px; }
    .grow { flex: 1; min-width: 0; }
    .tile-icon { flex: none; width: 38px; height: 38px; border-radius: 10px; background: var(--accent-soft); color: var(--accent); display: inline-flex; align-items: center; justify-content: center; }
    .card-desc { line-height: 1.55; }
    .setting-row { border-top: var(--hairline) solid var(--border); }
    .actions { display: flex; gap: 8px; flex: none; }
    .bar { display: block; width: min(360px, 100%); height: 8px; margin-top: 10px; border: 0; border-radius: 999px; overflow: hidden; appearance: none; -webkit-appearance: none; background: var(--fill); }
    .bar::-webkit-progress-bar { background: var(--fill); border-radius: 999px; }
    .bar::-webkit-progress-value { background: var(--accent); border-radius: 999px; transition: width 0.25s ease; }
    .bar::-moz-progress-bar { background: var(--accent); border-radius: 999px; }
    .err { color: var(--danger, #b42318); margin-top: 4px; }
  `,
})
export class AssistantCard {
  readonly assistant = inject(Assistant);
  readonly bytes = bytesText;

  readonly percent = computed(() => {
    const progress = this.assistant.progress();
    return progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;
  });

  readonly phaseText = computed(() => {
    const progress = this.assistant.progress();
    if (!progress) return 'Starting the download…';
    if (progress.phase === 'check') return 'Checking what was downloaded…';
    const what = progress.phase === 'engine' ? 'The engine' : 'The model';
    return `${what}: ${bytesText(progress.done)} of ${bytesText(progress.total)} (${this.percent()}%)`;
  });

  constructor() {
    void this.assistant.refresh();
  }
}
