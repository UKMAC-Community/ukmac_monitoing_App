import { ChangeDetectionStrategy, Component, effect, input, output, signal } from '@angular/core';

import { Icon } from '@shared/ui/icon';
import { Modal } from '@shared/ui/modal';

/** Where a MAC's key is pasted. The page does the work and tells the dialog if it was refused (`error`) or is busy. */
@Component({
  selector: 'app-import-key-dialog',
  imports: [Modal, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [open]="open()"
      title="Import MAC"
      subtitle="Paste the key you were given. It points to the farm's Google Sheets: the data is read from there."
      (closed)="closed.emit()"
    >
      <form id="key-form" class="form-stack" (submit)="$event.preventDefault(); submit()">
        <label class="form-group">
          <span class="form-label">MAC key</span>
          <textarea
            class="input-field key"
            rows="5"
            spellcheck="false"
            autocomplete="off"
            placeholder="UKMAC1-…"
            [value]="key()"
            (input)="key.set($any($event.target).value)"
          ></textarea>
          <small class="form-hint">Only a Google account that can open those sheets can use it. For any other account, nothing is added.</small>
        </label>
        @if (error()) {
          <div class="alert-box error" role="alert">{{ error() }}</div>
        }
      </form>
      <ng-container footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="paste()"><app-icon name="clipboard" [size]="15" /> Paste</button>
        <span class="grow"></span>
        <button type="button" class="btn btn-secondary" (click)="closed.emit()">Cancel</button>
        <button type="submit" form="key-form" class="btn btn-primary" [disabled]="busy() || !key().trim()">
          {{ busy() ? 'Checking…' : 'Add MAC' }}
        </button>
      </ng-container>
    </app-modal>
  `,
  styles: `
    .key { font-family: var(--mono); font-size: 0.75rem; line-height: 1.45; word-break: break-all; resize: vertical; }
    .grow { flex: 1; }
  `,
})
export class ImportKeyDialog {
  readonly open = input(false);
  readonly busy = input(false);
  readonly error = input('');
  readonly closed = output<void>();
  readonly submitted = output<string>();

  readonly key = signal('');
  /** A cleared box each time the dialog opens. */
  private readonly reset = effect(() => {
    if (this.open()) this.key.set('');
  });

  async paste() {
    try {
      this.key.set((await navigator.clipboard.readText()).trim());
    } catch {
      // Not allowed to read the clipboard: the person pastes into the box themselves (⌘V).
    }
  }

  submit() {
    const key = this.key().trim();
    if (key && !this.busy()) this.submitted.emit(key);
  }
}
