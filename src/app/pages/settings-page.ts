import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';

import { RouterLink } from '@angular/router';

import { GoogleSignIn } from '../components/google-sign-in';
import { Icon } from '../components/icon';
import { Api, errorText } from '../core/api';
import { AutoSync } from '../core/auto-sync';
import { Google } from '../core/google';
import type { DatabaseInfo, GoogleLink, GoogleStatus } from '../core/models';
import { PowerBi } from '../core/powerbi';
import { ACCENTS, COLUMN_SPACINGS, ROW_HEIGHTS, Theme } from '../core/theme';
import { Toasts } from '../core/toast';
import { AppUpdater } from '../core/updater';
import { baseName } from '../core/paths';

/** Google sign-in and the sheets read from it, Power BI, backups, and where the data is kept. */
@Component({
  selector: 'app-settings-page',
  imports: [Icon, RouterLink, GoogleSignIn],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <header class="page-header">
        <a class="page-back-icon" routerLink="/" title="Back to UKMAC" aria-label="Back"><app-icon name="arrow-left" [size]="16" /></a>
        <div class="page-header-text">
          <h1 class="page-title">Settings</h1>
          <p class="page-desc">How the app looks, your Google account, Power BI, backups and updates.</p>
        </div>
      </header>

      <div class="columns">
        <div>
          <span class="section-label">Theme</span>
          <section class="card">
            <div class="row-head">
              <span class="tile-icon"><app-icon name="sparkles" [size]="18" /></span>
              <div class="grow">
                <h2 class="card-title">Look of the app</h2>
                <p class="card-desc">Pick the colour and how roomy the tables are. It is kept on this computer and changes at once.</p>
              </div>
            </div>
            <div class="setting-row theme-row">
              <div class="setting-text">
                <span class="setting-title">Colour</span>
                <span class="setting-desc">Buttons, links and what is picked.</span>
              </div>
              <div class="swatches" role="group" aria-label="Colour">
                @for (item of accents; track item.value) {
                  <button type="button" class="swatch" [attr.aria-pressed]="theme.accent() === item.value" [title]="item.label" [attr.aria-label]="item.label" (click)="theme.update({ accent: item.value })">
                    <span class="dot" [style.background]="item.swatch">
                      @if (theme.accent() === item.value) {
                        <app-icon name="check" [size]="12" />
                      }
                    </span>
                  </button>
                }
              </div>
            </div>
            <div class="setting-row theme-row">
              <div class="setting-text">
                <span class="setting-title">Row height</span>
                <span class="setting-desc">How tall a table's rows are.</span>
              </div>
              <div class="segmented is-sm" role="group" aria-label="Row height">
                @for (item of rowHeights; track item.value) {
                  <button type="button" class="segment" [attr.aria-pressed]="theme.rowHeight() === item.value" (click)="theme.update({ rowHeight: item.value })">{{ item.label }}</button>
                }
              </div>
            </div>
            <div class="setting-row theme-row">
              <div class="setting-text">
                <span class="setting-title">Column spacing</span>
                <span class="setting-desc">The room at the sides of a table's cells.</span>
              </div>
              <div class="segmented is-sm" role="group" aria-label="Column spacing">
                @for (item of columnSpacings; track item.value) {
                  <button type="button" class="segment" [attr.aria-pressed]="theme.columnSpacing() === item.value" (click)="theme.update({ columnSpacing: item.value })">{{ item.label }}</button>
                }
              </div>
            </div>
            <div class="preview" aria-hidden="true">
              @for (row of [0, 1, 2, 3]; track row) {
                <div class="preview-row" [class.head]="row === 0" [attr.data-density]="theme.rowHeight()" [attr.data-spacing]="theme.columnSpacing()">
                  @for (width of [28, 40, 22, 32]; track width) {
                    <span class="preview-cell"><i [style.width.px]="width * 1.6"></i></span>
                  }
                </div>
              }
            </div>
            <div class="setting-row theme-row">
              <div class="setting-text"><span class="setting-desc">Every table in the app follows these choices.</span></div>
              <button type="button" class="btn btn-secondary btn-sm" (click)="theme.reset()">Back to the defaults</button>
            </div>
          </section>
        </div>
      </div>

      <div class="columns">
        <div>
          <span class="section-label">Google Sheets</span>
          <section class="card">
            <div class="row-head">
              <span class="tile-icon"><app-icon name="table" [size]="18" /></span>
              <div class="grow">
                <h2 class="card-title">Google account</h2>
                <p class="card-desc">
                  Sign in with Google, then bring a Google Sheet's tabs into a MAC as tables (the Import from Google Sheets button on the MAC's page).
                  Press Sync on a table to read its tab again; its charts and the Power BI file follow. The app only reads: nothing in Google is changed.
                </p>
              </div>
            </div>
            <label class="setting-row">
              <span class="setting-text">
                <span class="setting-title">Sync automatically</span>
                <span class="setting-desc">
                  Every table linked to a Google Sheet is read again by itself, within about 30 seconds of a change in the sheet, while the app is open.
                  A table open in Open in sheet waits until you close it.
                </span>
              </span>
              <input type="checkbox" class="switch" [checked]="autoSync.on()" (change)="autoSync.setOn($any($event.target).checked)" />
            </label>

            @if (google.status(); as g) {
              @if (g.signedIn) {
                <div class="setting-row">
                  <div class="setting-text">
                    <span class="setting-title who"><span class="avatar is-sm">{{ initial(g) }}</span> {{ g.name || 'Signed in with Google' }}</span>
                    @if (g.email) {
                      <span class="setting-desc">{{ g.email }}</span>
                    }
                  </div>
                  <div class="actions">
                    <button type="button" class="btn btn-secondary btn-sm" [disabled]="loggingOut() !== null" title="Sign out of this Google account; the Client ID and secret stay saved" (click)="logOut(false)">
                      <app-icon name="log-out" /> {{ loggingOut() === 'keep' ? 'Logging out…' : 'Log out' }}
                    </button>
                    @if (g.clientId) {
                      <button type="button" class="btn btn-danger-soft btn-sm" [disabled]="loggingOut() !== null || google.signingIn()" title="Sign out and remove the saved Client ID and secret too" (click)="logOut(true)">
                        {{ loggingOut() === 'forget' ? 'Logging out…' : 'Log out & forget client' }}
                      </button>
                    }
                  </div>
                </div>
              } @else {
                <div class="setting-row">
                  <div class="setting-text">
                    <span class="setting-title">Not signed in</span>
                    <span class="setting-desc">
                      @if (usesBuiltIn(g) && !editing()) {
                        Sign in with your own Google account. You can read only the sheets that account has access to.
                      } @else if (g.configured && !editing()) {
                        Google opens in your browser; come back here once it says you're signed in.
                      } @else {
                        Paste your Google client below (once), then sign in.
                      }
                    </span>
                  </div>
                  <div class="actions"><app-google-sign-in [prepare]="prepareSignIn" /></div>
                </div>
              }

              @if (!g.configured || editing()) {
                <form class="setup" (submit)="$event.preventDefault(); saveClient(true)">
                  <details class="guide" [open]="!g.configured">
                    <summary>
                      <app-icon name="info" [size]="16" />
                      <span class="guide-title">Set up once in Google Cloud <span class="guide-sub">4 steps, about 5 minutes</span></span>
                      <app-icon name="chevron-down" [size]="14" class="chev" />
                    </summary>
                    <ol class="guide-steps">
                      <li>
                        <span class="n">1</span>
                        <div class="t"><strong>Make a project</strong><span>Pick one you already have, or create a new one.</span></div>
                        <button type="button" class="btn btn-secondary btn-sm" (click)="open('https://console.cloud.google.com/projectcreate')">Cloud Console <app-icon name="external-link" [size]="13" /></button>
                      </li>
                      <li>
                        <span class="n">2</span>
                        <div class="t"><strong>Turn on the Google Drive API</strong><span>APIs &amp; Services → Library → Google Drive API → <b>Enable</b>.</span></div>
                        <button type="button" class="btn btn-secondary btn-sm" (click)="open('https://console.cloud.google.com/apis/library/drive.googleapis.com')">Drive API <app-icon name="external-link" [size]="13" /></button>
                      </li>
                      <li>
                        <span class="n">3</span>
                        <div class="t">
                          <strong>Set up the consent screen</strong>
                          <span>
                            Name it “UKMAC Monitoring”. Choose <b>Internal</b> if everyone who will sign in has a Google Workspace account of your
                            organisation (nothing to add, no warning). Otherwise choose <b>External</b> and add each person under
                            <b>Audience → Test users</b>; to stay signed in longer than 7 days, set the publishing status to <b>In production</b>.
                          </span>
                        </div>
                        <button type="button" class="btn btn-secondary btn-sm" (click)="open('https://console.cloud.google.com/auth/overview')">Auth Platform <app-icon name="external-link" [size]="13" /></button>
                      </li>
                      <li>
                        <span class="n">4</span>
                        <div class="t"><strong>Create a Desktop client</strong><span>Clients → Create client → application type <b>Desktop app</b> → Create. Copy the Client ID and the Client secret.</span></div>
                        <button type="button" class="btn btn-secondary btn-sm" (click)="open('https://console.cloud.google.com/auth/clients')">Clients <app-icon name="external-link" [size]="13" /></button>
                      </li>
                    </ol>
                  </details>

                  <div class="form-stack">
                    <label class="form-group">
                      <span class="form-label">Client ID</span>
                      <input
                        #clientField
                        class="input-field"
                        autocomplete="off"
                        spellcheck="false"
                        placeholder="123456-abc.apps.googleusercontent.com"
                        [attr.aria-invalid]="idProblem() ? 'true' : null"
                        [value]="clientId()"
                        (input)="clientId.set($any($event.target).value)"
                      />
                      @if (idProblem()) {
                        <span class="form-hint is-error">{{ idProblem() }}</span>
                      } @else {
                        <span class="form-hint">Copied from the client you made in step 4.</span>
                      }
                    </label>
                    <label class="form-group">
                      <span class="form-label">Client secret</span>
                      <span class="input-wrap">
                        <input
                          class="input-field has-action"
                          [type]="showSecret() ? 'text' : 'password'"
                          autocomplete="off"
                          spellcheck="false"
                          [placeholder]="g.hasSecret ? '(saved: leave blank to keep it)' : 'GOCSPX-…'"
                          [value]="clientSecret()"
                          (input)="clientSecret.set($any($event.target).value)"
                        />
                        <button type="button" class="input-action" [attr.aria-label]="showSecret() ? 'Hide the secret' : 'Show the secret'" (click)="showSecret.set(!showSecret())">
                          <app-icon [name]="showSecret() ? 'eye-off' : 'eye'" />
                        </button>
                      </span>
                      <span class="form-hint">Kept on this Mac only, outside the database, so backups never carry it.</span>
                    </label>
                    <div class="form-actions is-start">
                      <button type="submit" class="btn btn-primary btn-sm" [disabled]="saving() || google.signingIn() || !canSave(g)">{{ saving() ? 'Saving…' : 'Save & sign in with Google' }}</button>
                      @if (g.configured) {
                        <button type="button" class="btn btn-secondary btn-sm" (click)="cancelEdit()">Cancel</button>
                      }
                      <span class="after">Google opens in your browser. If it warns the app is unverified (it is your own): <strong>Advanced → Continue</strong>.</span>
                    </div>
                    @if (!g.builtIn) {
                      <p class="owner-note">
                        <app-icon name="info" [size]="13" />
                        <span>
                          For many people to use this app: put the same two values in <code>src-tauri/google-client.json</code> (see
                          <code>google-client.example.json</code>) and rebuild. They are built into the app, so nobody else sees these steps:
                          each person only presses <strong>Sign in with Google</strong> and can read just the sheets their own account can open.
                        </span>
                      </p>
                    }
                  </div>
                </form>
              } @else if (usesBuiltIn(g)) {
                <div class="setting-row">
                  <div class="setting-text">
                    <span class="setting-title">Google client</span>
                    <span class="setting-desc">Built into this app. Each person signs in with their own Google account.</span>
                  </div>
                  <div class="actions">
                    <button type="button" class="btn btn-secondary btn-sm" (click)="change(g)">Use my own…</button>
                  </div>
                </div>
              } @else {
                <div class="setting-row">
                  <div class="setting-text">
                    <span class="setting-title">Client ID</span>
                    <code class="path">{{ g.clientId }}</code>
                  </div>
                  <div class="actions">
                    <button type="button" class="btn btn-secondary btn-sm" (click)="change(g)">Change…</button>
                    @if (!g.signedIn) {
                      <button type="button" class="btn btn-danger-soft btn-sm" [disabled]="loggingOut() !== null || google.signingIn()" title="Remove the saved Client ID and secret" (click)="logOut(true)">Forget</button>
                    }
                  </div>
                </div>
              }
            } @else {
              <div class="setting-row"><span class="skeleton sk-path"></span></div>
            }

            @if (google.links().length) {
              <div class="linked-head">
                <span class="setting-title">Tables kept in step with Google</span>
                @if (google.links().length > 1) {
                  <button type="button" class="btn btn-secondary btn-sm" [disabled]="!google.signedIn() || syncingAll()" (click)="syncAll()">
                    <app-icon name="refresh" /> Sync all
                  </button>
                }
              </div>
              @for (link of google.links(); track link.linkId) {
                <div class="setting-row">
                  <div class="setting-text">
                    <span class="setting-title">{{ link.tableTitle }} <span class="badge neutral">{{ link.macName }}</span></span>
                    <span class="setting-desc">{{ link.spreadsheetTitle }} › {{ link.tabTitle }} · {{ link.lastRowCount }} rows · read {{ google.ago(link.lastSyncedAt) }}</span>
                  </div>
                  <div class="actions">
                    <a class="btn btn-plain btn-sm" [routerLink]="['/mac', link.macId, 'table', link.sheetId]">Open</a>
                    <button type="button" class="btn btn-secondary btn-sm" [disabled]="!google.signedIn() || google.isSyncing(link.sheetId)" (click)="google.syncAndTell(link.sheetId)">
                      <app-icon name="refresh" /> {{ google.isSyncing(link.sheetId) ? 'Reading…' : 'Sync' }}
                    </button>
                    <button type="button" class="btn btn-plain btn-sm" title="Stop syncing this table; its rows stay" (click)="disconnect(link)">Disconnect</button>
                  </div>
                </div>
              }
            }
          </section>
        </div>

        <div>
          <span class="section-label">Power BI</span>
          <section class="card">
            <div class="row-head">
              <span class="tile-icon"><app-icon name="chart" [size]="18" /></span>
              <div class="grow">
                <h2 class="card-title">Power BI file</h2>
                <p class="card-desc">
                  One Excel file with every MAC's tables, each an Excel table Power BI reads by name: numbers as numbers, dates as dates,
                  formulas worked out. The same table of every MAC is one table (its MAC column tells them apart), and the MACs table has each
                  farm's latitude and longitude for a map.
                </p>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-text">
                <span class="setting-title">The file</span>
                @if (powerBi.path()) {
                  <code class="path">{{ powerBi.path() }}</code>
                } @else {
                  <span class="setting-desc">None yet: save it once, then it's kept here.</span>
                }
              </div>
              <div class="actions">
                @if (powerBi.path()) {
                  <button type="button" class="btn btn-secondary btn-sm" [disabled]="powerBi.exporting()" (click)="powerBi.exportTo(powerBi.path()!, false)">
                    <app-icon name="refresh" /> Update now
                  </button>
                }
                <button type="button" class="btn btn-primary btn-sm" [disabled]="powerBi.exporting()" (click)="powerBi.exportAs()">
                  <app-icon name="download" /> {{ powerBi.path() ? 'Save elsewhere…' : 'Save the file…' }}
                </button>
              </div>
            </div>
            <label class="setting-row">
              <span class="setting-text">
                <span class="setting-title">Keep it up to date</span>
                <span class="setting-desc">Saved again a few seconds after each change, so Refresh in Power BI reads the latest.</span>
              </span>
              <input type="checkbox" class="switch" [checked]="powerBi.auto()" [disabled]="!powerBi.path()" (change)="powerBi.setAuto($any($event.target).checked)" />
            </label>
            @if (powerBi.lastExport()) {
              <p class="last">Last saved {{ powerBi.lastExport()!.toLocaleTimeString('en-GB', { timeZone: 'Asia/Phnom_Penh' }) }} (Cambodia time).</p>
            }
            <div class="alert-box info steps">
              <app-icon name="info" [size]="16" />
              <span>
                <strong>In Power BI Desktop:</strong> Get data → Excel workbook → this file → tick the tables → Load. Then Refresh reads the latest.
                Keep the file in OneDrive or a shared folder to open it on a Windows PC or in the Power BI service.
              </span>
            </div>
          </section>
        </div>

        <div>
          <span class="section-label">Data</span>
          <section class="card">
            <div class="row-head">
              <span class="tile-icon"><app-icon name="database" [size]="18" /></span>
              <div class="grow">
                <h2 class="card-title">Backup</h2>
                <p class="card-desc">Every MAC, table and row is in one database file on this Mac. Save a copy now and then, to a USB drive or the cloud.</p>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-text">
                <span class="setting-title">Kept in</span>
                @if (info(); as info) {
                  <code class="path">{{ info.path }}</code>
                  <span class="setting-desc">{{ size(info.sizeBytes) }}</span>
                } @else {
                  <span class="skeleton sk-path"></span>
                  <span class="skeleton sk-size"></span>
                }
              </div>
              <button type="button" class="btn btn-secondary btn-sm" (click)="backup()"><app-icon name="download" /> Save a backup…</button>
            </div>
          </section>
        </div>

        <div>
          <span class="section-label">App</span>
          <section class="card">
            <div class="row-head">
              <span class="tile-icon"><app-icon name="download" [size]="18" /></span>
              <div class="grow">
                <h2 class="card-title">Updates</h2>
                <p class="card-desc">
                  New versions download and install by themselves in the background. The app keeps running as it is and uses the new version the next time you open it; your tables stay as they are.
                </p>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-text">
                <span class="setting-title">This version</span>
                <span class="setting-desc update-status">
                  @switch (updater.state()) {
                    @case ('checking') { Looking for a new version… }
                    @case ('available') { Version {{ updater.update()?.version }} is ready. }
                    @case ('downloading') { Downloading version {{ updater.update()?.version }}@if (updater.percent() !== null) { : {{ updater.percent() }}% } … }
                    @case ('installed') { Installed. Restarting… }
                    @case ('ready') { Version {{ updater.installedVersion() }} is installed. It is used the next time you open the app. }
                    @case ('current') { You have the newest version. }
                    @case ('error') { <span class="update-error">{{ updater.error() }}</span> }
                    @default { Not checked yet. }
                  }
                </span>
                <code class="path">{{ updater.version() ? 'UKMAC Monitoring ' + updater.version() : 'UKMAC Monitoring' }}</code>
              </div>
              <div class="actions">
                @if (updater.state() === 'ready') {
                  <button type="button" class="btn btn-secondary btn-sm" (click)="updater.restartNow()">Restart now</button>
                } @else if (updater.state() === 'available' || updater.state() === 'downloading' || updater.state() === 'installed') {
                  <button type="button" class="btn btn-primary btn-sm" [disabled]="updater.busy()" (click)="updater.install()">
                    <app-icon name="download" /> Update and restart
                  </button>
                } @else {
                  <button type="button" class="btn btn-secondary btn-sm" [disabled]="updater.busy()" (click)="updater.check()">Check for updates</button>
                }
              </div>
            </div>
            @if (updater.update(); as found) {
              @if (found.body) {
                <div class="setting-row notes">
                  <div class="setting-text">
                    <span class="setting-title">What is new in {{ found.version }}</span>
                    <pre class="release-notes">{{ found.body }}</pre>
                  </div>
                </div>
              }
            }
          </section>
        </div>
      </div>
    </div>
  `,
  styles: `
    .theme-row { align-items: center; }
    .swatches { display: inline-flex; gap: 10px; }
    .swatch { padding: 3px; border: 2px solid transparent; border-radius: 50%; background: none; cursor: pointer; display: inline-flex; }
    .swatch[aria-pressed='true'] { border-color: var(--accent); }
    .swatch .dot { width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; color: #fff; }
    .preview { margin: 14px 0 6px; border: var(--hairline) solid var(--border); border-radius: var(--radius-md); overflow: hidden; color: var(--text-muted); }
    .preview-row { display: flex; align-items: center; height: 40px; border-top: var(--hairline) solid var(--border); background: var(--surface-solid); transition: height 0.2s var(--ease); }
    .preview-row.head { border-top: 0; background: var(--fill); }
    .preview-row[data-density='default'] { height: 48px; }
    .preview-row[data-density='comfortable'] { height: 56px; }
    .preview-cell { padding: 0 16px; transition: padding 0.2s var(--ease); }
    .preview-row[data-spacing='narrow'] .preview-cell { padding: 0 10px; }
    .preview-row[data-spacing='wide'] .preview-cell { padding: 0 24px; }
    .preview-cell i { display: block; height: 6px; border-radius: 3px; background: currentColor; opacity: 0.25; }
    .update-status { display: block; }
    .update-error { color: var(--danger, #b42318); }
    .release-notes { margin: 6px 0 0; white-space: pre-wrap; font: inherit; font-size: 0.8125rem; line-height: 1.5; color: var(--text-muted); max-height: 220px; overflow: auto; }
    .sk-path { width: 340px; max-width: 100%; height: 14px; margin-top: 6px; }
    .sk-size { width: 60px; height: 12px; margin-top: 8px; }
    .page { max-width: 944px; margin: 0 auto; padding-top: 40px; }
    .columns { display: grid; grid-template-columns: minmax(0, 1fr); gap: 22px; max-width: 880px; }
    .row-head { display: flex; gap: 14px; margin-bottom: 6px; }
    .tile-icon { flex: none; width: 38px; height: 38px; border-radius: 10px; background: var(--accent-soft); color: var(--accent); display: inline-flex; align-items: center; justify-content: center; }
    .card-desc { line-height: 1.55; }
    .setting-row { border-top: var(--hairline) solid var(--border); }
    label.setting-row { cursor: pointer; }
    .actions { display: flex; gap: 8px; flex: none; }
    .path { font-family: var(--mono); font-size: 0.75rem; color: var(--text-muted); word-break: break-all; }
    .last { font-size: 0.75rem; color: var(--text-muted); margin-bottom: 10px; }
    .steps { align-items: flex-start; font-size: 0.8125rem; line-height: 1.5; }
    .setup { display: flex; flex-direction: column; gap: 18px; padding-top: 16px; border-top: var(--hairline) solid var(--border); }
    .guide { border: var(--hairline) solid var(--border); border-radius: var(--radius-md); background: var(--accent-soft); overflow: hidden; }
    .guide summary { display: flex; align-items: center; gap: 10px; padding: 11px 14px; color: var(--accent); cursor: pointer; list-style: none; }
    .guide summary::-webkit-details-marker { display: none; }
    .guide-title { flex: 1; font-size: 0.875rem; font-weight: 600; }
    .guide-sub { margin-left: 6px; font-weight: 400; color: var(--text-muted); }
    .guide .chev { transition: transform 0.18s; }
    .guide[open] .chev { transform: rotate(180deg); }
    .guide-steps { margin: 0; padding: 4px 14px 14px; list-style: none; display: flex; flex-direction: column; gap: 4px; }
    .guide-steps li { display: flex; align-items: flex-start; gap: 12px; padding: 10px 12px; border-radius: var(--radius); background: var(--surface-solid); }
    .guide-steps .n { flex: none; width: 22px; height: 22px; margin-top: 1px; border-radius: 50%; background: var(--accent); color: var(--accent-fg); font-size: 0.75rem; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; }
    .guide-steps .t { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: 0.8125rem; line-height: 1.5; color: var(--text-muted); }
    .guide-steps .t strong { font-size: 0.875rem; font-weight: 600; color: var(--text); }
    .guide-steps .t b { font-weight: 600; color: var(--text); }
    .guide-steps .btn { flex: none; gap: 6px; }
    .after { flex: 1 1 260px; font-size: 0.75rem; line-height: 1.45; color: var(--text-muted); }
    .after strong { font-weight: 600; color: var(--text); }
    .owner-note { display: flex; align-items: flex-start; gap: 8px; margin: 0; padding-top: 12px; border-top: var(--hairline) solid var(--border); font-size: 0.75rem; line-height: 1.5; color: var(--text-muted); }
    .owner-note app-icon { margin-top: 2px; flex: none; }
    .owner-note code { font-family: var(--mono); font-size: 0.6875rem; color: var(--text); }
    .owner-note strong { font-weight: 600; color: var(--text); }
    .who { display: inline-flex; align-items: center; gap: 8px; }
    .linked-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 14px; padding-top: 14px; border-top: var(--hairline) solid var(--border); }
  `,
})
export class SettingsPage implements OnInit {
  readonly powerBi = inject(PowerBi);
  readonly google = inject(Google);
  readonly autoSync = inject(AutoSync);
  readonly theme = inject(Theme);
  readonly accents = ACCENTS;
  readonly rowHeights = ROW_HEIGHTS;
  readonly columnSpacings = COLUMN_SPACINGS;
  readonly updater = inject(AppUpdater);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  readonly info = signal<DatabaseInfo | null>(null);

  readonly clientId = signal('');
  readonly clientSecret = signal('');
  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly syncingAll = signal(false);
  private readonly clientField = viewChild<ElementRef<HTMLInputElement>>('clientField');
  readonly showSecret = signal(false);
  /** Which log out is under way: it keeps the Client ID and secret, or forgets them too. */
  readonly loggingOut = signal<'keep' | 'forget' | null>(null);

  /** What is wrong with the pasted Client ID, said once there is something to judge. */
  readonly idProblem = computed(() => {
    const id = this.clientId().trim();
    return id && !id.endsWith('.apps.googleusercontent.com') ? 'A Client ID ends with .apps.googleusercontent.com' : '';
  });

  async ngOnInit() {
    void this.updater.loadVersion();
    void this.google.init().then(() => {
      void this.google.refreshStatus();
      void this.google.refreshLinks();
    });
    await this.powerBi.init();
    try {
      this.info.set(await this.api.databaseInfo());
    } catch {
      /* shown without it */
    }
  }

  /** The app's own Google client is the one in use (none saved on this Mac). */
  usesBuiltIn(status: GoogleStatus) {
    return status.builtIn && !status.clientId;
  }

  initial(status: GoogleStatus) {
    return ((status.name || status.email || '?').trim()[0] ?? '?').toUpperCase();
  }

  change(status: GoogleStatus) {
    this.clientId.set(status.clientId);
    this.clientSecret.set('');
    this.showSecret.set(false);
    this.editing.set(true);
  }

  cancelEdit() {
    this.clientSecret.set('');
    this.showSecret.set(false);
    this.editing.set(false);
  }

  /** A good-looking Client ID and a secret (or the saved one, kept for the same ID). */
  canSave(status: GoogleStatus) {
    const id = this.clientId().trim();
    if (!id || this.idProblem()) return false;
    return !!this.clientSecret().trim() || (status.hasSecret && id === status.clientId);
  }

  /** Keeps the pasted Client ID and secret; then, with `signIn`, opens Google. False: it wasn't saved. */
  async saveClient(signIn: boolean): Promise<boolean> {
    this.saving.set(true);
    try {
      await this.google.saveClient(this.clientId(), this.clientSecret());
      this.cancelEdit();
    } catch (error) {
      this.toasts.error(errorText(error));
      return false;
    } finally {
      this.saving.set(false);
    }
    if (signIn) await this.google.signIn();
    return true;
  }

  /**
   * The Sign in button's first step. With a client saved, nothing; with the fields filled in, they're
   * saved first (so one press does both); with nothing pasted yet, the empty field is pointed at.
   */
  readonly prepareSignIn = async (): Promise<boolean> => {
    const status = this.google.status();
    if (!status) return false;
    if (status.configured && !this.editing()) return true;
    if (!this.canSave(status)) {
      this.toasts.error('Paste the Client ID and the Client secret first: the steps above show where to get them.');
      const field = this.clientField()?.nativeElement;
      field?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      field?.focus({ preventScroll: true });
      return false;
    }
    return this.saveClient(false);
  };

  /** Log out; forgetting the client too asks first, as the secret has to be pasted again after it. */
  async logOut(forgetClient: boolean) {
    if (forgetClient) {
      const signedIn = this.google.signedIn();
      const ok = await this.api.confirm(
        `${signedIn ? 'Log out of Google and remove' : 'Remove'} the saved Client ID and secret from this Mac? To sign in again you will paste them again (or make a new client). Tables already read from Google keep their rows.`,
        'Forget Google client',
        signedIn ? 'Log out & forget' : 'Forget',
      );
      if (!ok) return;
    }
    this.loggingOut.set(forgetClient ? 'forget' : 'keep');
    try {
      if (await this.google.signOut(forgetClient) && forgetClient) {
        this.clientId.set('');
        this.clientSecret.set('');
        this.showSecret.set(false);
        this.editing.set(false);
      }
    } finally {
      this.loggingOut.set(null);
    }
  }

  open(url: string) {
    this.api.openLink(url).catch((error) => this.toasts.error(errorText(error)));
  }

  async syncAll() {
    this.syncingAll.set(true);
    try {
      for (const link of this.google.links()) await this.google.syncAndTell(link.sheetId);
    } finally {
      this.syncingAll.set(false);
    }
  }

  async disconnect(link: GoogleLink) {
    try {
      await this.google.disconnect(link.sheetId);
      this.toasts.show(`${link.tableTitle} is no longer read from Google; its rows stay`);
    } catch (error) {
      this.toasts.error(errorText(error));
    }
  }

  size(bytes: number) {
    return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  async backup() {
    const stamp = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Phnom_Penh' });
    const path = await this.api.pickSavePath(`UKMAC Monitoring backup ${stamp}.db`, 'Database', ['db']);
    if (!path) return;
    try {
      await this.api.backupDatabase(path);
      this.toasts.show(`Backup saved: ${baseName(path)}`);
    } catch (error) {
      this.toasts.error(errorText(error));
    }
  }
}
