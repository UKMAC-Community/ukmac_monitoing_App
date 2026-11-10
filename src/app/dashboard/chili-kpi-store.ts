import { inject, Injectable, signal } from '@angular/core';

import { Api, errorText } from '../core/api';
import { Toasts } from '../core/toast';
import { parseKpis, starterKpis, stringifyKpis, type ChiliKpi } from './chili-kpis';

const KEY = 'chili-dashboard';

/**
 * The chili dashboard's KPIs. Kept once for the whole app, as the web keeps one
 * report for the crop ("dashboard:chili") that every chili farm shows: until
 * one is edited the starter shows, and a saved list is read back as it was.
 * Each change shows at once and is written as it's made.
 */
@Injectable({ providedIn: 'root' })
export class ChiliKpiStore {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private writes: Promise<unknown> = Promise.resolve();

  readonly kpis = signal<ChiliKpi[]>(starterKpis());
  /** Whether a saved list (not the starter) is showing. */
  readonly custom = signal(false);
  readonly loaded = signal(false);

  async load() {
    try {
      const saved = parseKpis(await this.api.getSetting(KEY));
      this.kpis.set(saved ?? starterKpis());
      this.custom.set(saved !== null);
    } catch (error) {
      this.toasts.error(errorText(error));
    } finally {
      this.loaded.set(true);
    }
  }

  /** Shows the list now and keeps it. */
  save(kpis: ChiliKpi[]) {
    this.kpis.set(kpis);
    this.custom.set(true);
    return this.persist(KEY, stringifyKpis(kpis));
  }

  /** Back to the starter: the saved list is forgotten. */
  reset() {
    this.kpis.set(starterKpis());
    this.custom.set(false);
    return this.persist(KEY, null);
  }

  /** Writes a setting in turn with the others, so what is written first is kept first. */
  persist(key: string, value: string | null) {
    this.writes = this.writes
      .then(() => this.api.setSetting(key, value))
      .catch((error: unknown) => {
        this.toasts.error(`Couldn't keep the dashboard: ${errorText(error)}`);
      });
    return this.writes;
  }
}
