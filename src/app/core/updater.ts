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
}

/** The real thing: the Tauri updater and process plugins, loaded only when asked for. */
export const tauriUpdater: UpdaterBackend = {
  version: async () => (await import('@tauri-apps/api/app')).getVersion(),
  check: async () => (await import('@tauri-apps/plugin-updater')).check(),
  relaunch: async () => (await import('@tauri-apps/plugin-process')).relaunch(),
};

export type UpdateState = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'installed' | 'error';

/**
 * Updates from inside the app: look at the releases page, say what is new, and on a click
 * download it, install it (the signature is checked first) and restart.
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
  /** Bytes downloaded and the whole size, when the server says it. */
  readonly downloaded = signal(0);
  readonly total = signal<number | null>(null);
  readonly percent = computed(() => {
    const total = this.total();
    return total ? Math.min(100, Math.round((this.downloaded() / total) * 100)) : null;
  });
  readonly busy = computed(() => this.state() === 'checking' || this.state() === 'downloading' || this.state() === 'installed');
  private started = false;

  /** The running version, shown on the settings page. */
  async loadVersion() {
    try {
      this.version.set(await this.backend.version());
    } catch {
      this.version.set(null);
    }
  }

  /** A quiet look a little after start: it says something only when there is a new version. */
  async checkOnStart(delayMs = 4000) {
    if (this.started) return;
    this.started = true;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    await this.check(true);
    const found = this.update();
    if (found) {
      this.toasts.show(`Version ${found.version} is ready.`, 'info', { label: 'Update', run: () => void this.install() }, 15000);
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
      this.update.set(found);
      this.state.set(found ? 'available' : 'current');
    } catch (error) {
      this.update.set(null);
      if (quiet) {
        this.state.set('idle');
      } else {
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
      await this.backend.relaunch();
    } catch (error) {
      this.error.set(friendly(errorText(error)));
      this.state.set('error');
    }
  }
}

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
