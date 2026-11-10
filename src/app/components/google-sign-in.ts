import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';

import { Google } from '../core/google';

/** "Sign in with Google": opens Google in the browser, then waits (with a way out) until it answers. */
@Component({
  selector: 'app-google-sign-in',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (google.signingIn()) {
      <span class="waiting"><span class="spinner-sm"></span> Waiting for Google in your browser…</span>
      <button type="button" class="btn btn-secondary btn-sm" (click)="google.cancelSignIn()">Cancel</button>
    } @else {
      <button type="button" class="btn btn-secondary gsi" [disabled]="disabled()" (click)="start()">
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
        {{ label() }}
      </button>
    }
  `,
  styles: `
    :host { display: inline-flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .gsi { gap: 10px; font-weight: 500; }
    .waiting { display: inline-flex; align-items: center; gap: 8px; font-size: 0.8125rem; color: var(--text-muted); }
  `,
})
export class GoogleSignIn {
  readonly google = inject(Google);
  readonly label = input('Sign in with Google');
  readonly disabled = input(false);
  /** A first step that must work out before Google opens (saving a pasted client, say); false: stop here. */
  readonly prepare = input<(() => Promise<boolean>) | null>(null);
  readonly signedIn = output<void>();

  async start() {
    const prepare = this.prepare();
    if (prepare && !(await prepare())) return;
    if (await this.google.signIn()) this.signedIn.emit();
  }
}
