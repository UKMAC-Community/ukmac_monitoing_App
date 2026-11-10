import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Google } from '../core/google';
import { GoogleSignIn } from './google-sign-in';

/** What is shown until someone is signed in with Google: no MAC, no table, nothing of the farm. */
@Component({
  selector: 'app-sign-in-gate',
  imports: [GoogleSignIn, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="gate">
      <section class="card gate-card">
        <img src="logo/UKMAC_Logo.webp" alt="" />
        <h1>Sign in to open your MACs</h1>
        <p>
          The farm's data is kept in Google Sheets. Nothing is shown here until you sign in, and then only what your Google account can open.
        </p>
        <p class="steps">
          To see a farm: sign in, then open the <b>.ukmac</b> file you were given (Import MAC). If your account can't open the Google Sheets
          that file points at, nothing is added.
        </p>
        @if (google.status()?.configured) {
          <app-google-sign-in />
        } @else {
          <p class="steps">Google isn't set up on this computer yet.</p>
          <a class="btn btn-secondary" routerLink="/settings">Set up Google</a>
        }
      </section>
    </div>
  `,
  styles: `
    .gate { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 48px 24px; }
    .gate-card { max-width: 480px; display: flex; flex-direction: column; align-items: center; gap: 14px; text-align: center; padding: 36px 32px; }
    .gate-card img { width: 56px; height: 56px; border-radius: 14px; }
    h1 { margin: 0; font-size: 1.375rem; font-weight: 700; letter-spacing: -0.02em; }
    p { margin: 0; line-height: 1.55; color: var(--text-muted); }
    .steps { font-size: 0.8125rem; }
    .steps b { color: var(--text); font-weight: 600; }
  `,
})
export class SignInGate {
  readonly google = inject(Google);
}
