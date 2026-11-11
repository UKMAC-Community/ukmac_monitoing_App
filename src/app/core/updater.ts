import { computed, inject, Injectable, signal } from '@angular/core';

import { errorText } from './api';
import { Toasts } from './toast';

/** What the update plugin hands back (a subset of `Update` from @tauri-apps/plugin-updater). */
export interface PendingUpdate {
  version: string;
  currentVersion: string;
  body?: string;
  date?: string;
  downloadAndInstall(onEvent?: (event: UpdateEvent) => void): Promise<void>;
}

export type UpdateEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' };

/** The three calls the plugins make, so a test (or the browser) can stand in for them. */
export interface UpdaterBackend {
  version(): Promise<string>;
  check(): Promise<PendingUpdate | null>;
  relaunch(): Promise<void>;
  /**
   * The new version can be put in place while the app keeps running (the Mac swaps the app on disk and the open window goes on as it
   * was). Not so on Windows, whose installer closes the app. Left out: no.
   */
  installsQuietly?(): boolean;
}

/** The real thing: the Tauri updater and process plugins, loaded only when asked for. */
export const tauriUpdater: UpdaterBackend = {
  version: async () => (await import('@tauri-apps/api/app')).getVersion(),
  check: async () => (await import('@tauri-apps/plugin-updater')).check(),
  relaunch: async () => (await import('@tauri-apps/plugin-process')).relaunch(),
  installsQuietly: () => /Mac/i.test(navigator.userAgent),
};

export type UpdateState = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'installed' | 'ready' | 'error';

/**
 * Updates from inside the app: look at the releases page, say what is new. Where the new version can go in while the app runs (the
 * Mac) it is downloaded and installed by itself (the signature is checked first), with no restart: the open app goes on as it is
 * and the new version is the one that opens next time ('ready'). Elsewhere it waits for a click, which downloads, installs and restarts.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdater {
  private readonly toasts = inject(Toasts);
  /** Replaced by tests. */
  backend: UpdaterBackend = tauriUpdater;

  readonly state = signal<UpdateState>('idle');
  readonly version = signal<string | null>(null);
  readonly update = signal<PendingUpdate | null>(null);
  readonly error = signal<string | null>(null);
  readonly lastChecked = signal<Date | null>(null);
  /** The version that is installed but not open yet (it starts the next time the app is opened). */
  readonly installedVersion = signal<string | null>(null);
  /** Bytes downloaded and the whole size, when the server says it. */
  readonly downloaded = signal(0);
  readonly total = signal<number | null>(null);
  readonly percent = computed(() => {
    const total = this.total();
    return total ? Math.min(100, Math.round((this.downloaded() / total) * 100)) : null;
  });
  readonly busy = computed(() => this.state() === 'checking' || this.state() === 'downloading' || this.state() === 'installed');
  /** A new version is waiting: what the "Update" buttons around the app show. */
  readonly offered = computed(() => this.update() !== null);
  /** Set by the shell: true while something is being written to the database (an edit, a Google read), so a restart never cuts it off. */
  writing: () => boolean = () => false;
  private started = false;
  /** The version a message was already shown for, so a later look does not repeat it. */
  private told: string | null = null;

  /** The running version, shown on the settings page. */
  async loadVersion() {
    try {
      this.version.set(await this.backend.version());
    } catch {
      this.version.set(null);
    }
  }

  /**
   * A quiet look a little after start, and again every few hours (a farm computer stays open for days): it
   * says something only when there is a new version, and once per version. The Update buttons stay until it is installed.
   */
  async checkOnStart(delayMs = 4000, everyMs = RECHECK_MS) {
    if (this.started) return;
    this.started = true;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await this.lookAndTell();
    if (everyMs > 0) setInterval(() => void this.lookAndTell(), everyMs);
  }

  private async lookAndTell() {
    await this.check(true);
    const found = this.update();
    if (found && found.version !== this.told) {
      this.told = found.version;
      if (this.backend.installsQuietly?.()) {
        await this.installQuietly();
        return;
      }
      this.toasts.show(`Version ${found.version} is ready.`, 'info', { label: 'Update', run: () => void this.install() }, 15000);
    }
  }

  /** Download and put the new version in place without restarting: it is the one that opens next time. A failure leaves the Update button to try again. */
  private async installQuietly() {
    const found = this.update();
    if (!found || this.busy()) return;
    this.state.set('downloading');
    this.error.set(null);
    this.downloaded.set(0);
    this.total.set(null);
    try {
      await found.downloadAndInstall((event) => {
        if (event.event === 'Started') this.total.set(event.data.contentLength ?? null);
        else if (event.event === 'Progress') this.downloaded.update((bytes) => bytes + event.data.chunkLength);
      });
      this.installedVersion.set(found.version);
      this.update.set(null);
      this.state.set('ready');
      this.toasts.show(`Version ${found.version} is installed. It starts the next time you open the app.`, 'info', { label: 'Restart now', run: () => void this.restartNow() }, 12000);
    } catch (error) {
      this.error.set(friendly(errorText(error)));
      this.state.set('available');
    }
  }

  /** Open the version that was installed in the background now (waits, a few seconds at most, for an edit being saved). */
  async restartNow() {
    if (this.state() !== 'ready') return;
    this.state.set('installed');
    try {
      await this.untilQuiet();
      await this.backend.relaunch();
    } catch (error) {
      this.error.set(friendly(errorText(error)));
      this.state.set('error');
    }
  }

  /** Look for a newer version. `quiet`: a failure (no network, no releases yet) is not an error to show. */
  async check(quiet = false) {
    if (this.busy()) return;
    this.state.set('checking');
    this.error.set(null);
    try {
      const found = await this.backend.check();
      this.lastChecked.set(new Date());
      // The version already put in place is not offered again while this copy of the app is still the old one.
      if (found && found.version === this.installedVersion()) {
        this.update.set(null);
        this.state.set('ready');
        return;
      }
      this.update.set(found);
      this.state.set(found ? 'available' : 'current');
    } catch (error) {
      if (quiet) {
        // A look nobody asked for that fails (no network for a moment) must not take back a version already found.
        this.state.set(this.update() ? 'available' : 'idle');
      } else {
        this.update.set(null);
        this.error.set(friendly(errorText(error)));
        this.state.set('error');
      }
    }
  }

  /** Download, install, restart. The data is in the database file, which an update never touches. */
  async install() {
    const found = this.update();
    if (!found || this.state() === 'downloading') return;
    this.state.set('downloading');
    this.error.set(null);
    this.downloaded.set(0);
    this.total.set(null);
    try {
      await found.downloadAndInstall((event) => {
        if (event.event === 'Started') this.total.set(event.data.contentLength ?? null);
        else if (event.event === 'Progress') this.downloaded.update((bytes) => bytes + event.data.chunkLength);
      });
      this.state.set('installed');
      await this.untilQuiet();
      await this.backend.relaunch();
    } catch (error) {
      this.error.set(friendly(errorText(error)));
      this.state.set('error');
    }
  }

  /** The restart waits (a few seconds at most) for an edit being saved or a Google read to finish. */
  private async untilQuiet(maxMs = 10000) {
    const end = Date.now() + maxMs;
    while (this.writing() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

/** How often a running app looks again for a new version. */
const RECHECK_MS = 3 * 60 * 60 * 1000;

/** The plugin's own messages are terse; say what to try. */
function friendly(text: string) {
  if (/network|dns|connect|timed out|error sending request|resolve/i.test(text)) {
    return `Could not reach the updates page. Check the internet connection and try again. (${text})`;
  }
  if (/signature/i.test(text)) return `The download did not pass its signature check, so it was not installed. (${text})`;
  if (/404|not found|status code|valid release json|no release/i.test(text)) {
    return `There is no published release to read yet. (${text})`;
  }
  return text;
}
