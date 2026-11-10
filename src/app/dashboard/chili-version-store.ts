import { computed, inject, Injectable, signal } from '@angular/core';

import { Api } from '../core/api';
import { ChiliKpiStore } from './chili-kpi-store';
import type { ChiliKpi } from './chili-kpis';
import { newId } from './dashboard-model';
import {
  emptyBook,
  fileName,
  fileText,
  importVersion,
  inUseVersion,
  keptWords,
  latestOf,
  parseBook,
  parseFile,
  publish,
  removeVersion,
  stringifyBook,
  switchTo,
  switchToSuggested,
  DEFAULT_DASHBOARD_NAME,
  MAX_FILE_BYTES,
  type Clock,
  type DashboardVersion,
  type ImportOutcome,
  type VersionBook,
} from './chili-versions';

const KEY = 'chili-dashboard-versions';

function uuid() {
  return globalThis.crypto?.randomUUID?.() ?? `${newId()}-${newId()}`;
}
const clock: Clock = { now: () => new Date().toISOString(), id: uuid };

/**
 * The chili dashboard's versions, kept beside the dashboard itself (one setting each). What the person
 * has in use is the dashboard (ChiliKpiStore); this keeps the versions it can go back to, and brings
 * in and writes the files others share. A version is written before the dashboard is replaced, so an
 * interrupted change never loses what was in use.
 */
@Injectable({ providedIn: 'root' })
export class ChiliVersionStore {
  private readonly api = inject(Api);
  private readonly dashboard = inject(ChiliKpiStore);

  readonly book = signal<VersionBook>(emptyBook());
  readonly loaded = signal(false);

  /** Newest first. */
  readonly versions = computed(() => [...this.book().versions].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.number - a.number));
  /** The version the dashboard in use is exactly (null: the suggested one, or one with changes that aren't a version). */
  readonly inUse = computed(() => (this.dashboard.custom() ? inUseVersion(this.book(), this.dashboard.kpis()) : null));
  /** The dashboard in use has changes that aren't saved as a version. */
  readonly unsaved = computed(() => this.dashboard.custom() && !this.inUse());
  /** More than one dashboard's versions are listed (so a row says which dashboard it is of). */
  readonly several = computed(() => new Set(this.book().versions.map((version) => version.dashboardId)).size > 1);

  async load() {
    try {
      this.book.set(parseBook(await this.api.getSetting(KEY)));
    } catch {
      // The versions are an extra: the dashboard works without them.
      this.book.set(emptyBook());
    } finally {
      this.loaded.set(true);
    }
  }

  private get working() {
    return { kpis: this.dashboard.kpis(), custom: this.dashboard.custom() };
  }

  /** The versions first, then the dashboard: an interrupted change can only leave a version too many. */
  private async commit(book: VersionBook, kpis?: ChiliKpi[]) {
    this.book.set(book);
    const saved = this.dashboard.persist(KEY, stringifyBook(book));
    if (kpis) await this.dashboard.save(kpis);
    await saved;
  }

  /** What exporting now would write: the next version, or the latest again when nothing changed. */
  preview(name: string, note: string) {
    return publish(this.book(), this.dashboard.kpis(), name, note, clock);
  }

  /** The name the dashboard goes by: its latest version's. */
  currentName() {
    const active = this.book().activeId;
    return (active && latestOf(this.book(), active)?.name) || DEFAULT_DASHBOARD_NAME;
  }

  /** Saves the dashboard as its next version (if it changed) and writes that version to a file the person chooses. */
  async exportCurrent(name: string, note: string): Promise<{ version: DashboardVersion; created: boolean; path: string } | null> {
    const made = this.preview(name, note);
    const path = await this.api.pickSavePath(fileName(made.version), 'UKMAC dashboard', ['ukdash']);
    if (!path) return null;
    if (made.created) await this.commit(made.book);
    else if (made.book.activeId !== this.book().activeId) await this.commit(made.book);
    await this.api.writeFile(path, new TextEncoder().encode(fileText(made.version)));
    return { version: made.version, created: made.created, path };
  }

  /** Writes one version, as it is, to a file the person chooses. */
  async exportVersion(version: DashboardVersion): Promise<string | null> {
    const path = await this.api.pickSavePath(fileName(version), 'UKMAC dashboard', ['ukdash']);
    if (!path) return null;
    await this.api.writeFile(path, new TextEncoder().encode(fileText(version)));
    return path;
  }

  /** Reads a dashboard file the person chooses. Null: they chose none. */
  async importFromFile(): Promise<{ outcome: ImportOutcome; version: DashboardVersion; kept: DashboardVersion | null; top: number } | null> {
    const path = await this.api.pickDashboardFile();
    if (!path) return null;
    const bytes = await this.api.readFile(path);
    if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('This file is too large to be a dashboard file.');
    const result = importVersion(this.book(), parseFile(bytes), this.working, clock);
    await this.commit(result.book, result.kpis ?? undefined);
    return { outcome: result.outcome, version: result.version, kept: result.kept, top: result.top };
  }

  /** Goes to a version; what was in use is kept as a version first. Returns the one kept. */
  async use(id: string): Promise<DashboardVersion | null> {
    const switched = switchTo(this.book(), id, this.working, clock);
    await this.commit(switched.book, switched.kpis);
    return switched.kept;
  }

  /** Back to the suggested dashboard; what was in use is kept as a version first. */
  async useSuggested(): Promise<DashboardVersion | null> {
    const switched = switchToSuggested(this.book(), this.working, clock);
    this.book.set(switched.book);
    const saved = this.dashboard.persist(KEY, stringifyBook(switched.book));
    await this.dashboard.reset();
    await saved;
    return switched.kept;
  }

  async remove(id: string) {
    await this.commit(removeVersion(this.book(), id));
  }
}

type ImportResult = NonNullable<Awaited<ReturnType<ChiliVersionStore['importFromFile']>>>;

/** What to tell the person about an import: what happened to their dashboard, and where the earlier one is. */
export function importMessage(result: ImportResult): string {
  const { outcome, version, kept, top } = result;
  const have = top ? ` (you have version ${top})` : '';
  switch (outcome) {
    case 'updated':
      return `Dashboard updated to version ${version.number}.${kept ? ` Your earlier dashboard is ${keptWords(kept)} in Dashboard versions.` : ''}`;
    case 'up-to-date':
      return `Your dashboard is already version ${version.number}.`;
    case 'present':
      return `You already have version ${version.number}. It is in Dashboard versions.`;
    case 'older':
      return `Version ${version.number} is older than the one you have${have}. It was added to Dashboard versions; your dashboard stays as it is.`;
    case 'added':
      return `Version ${version.number} has the same number as yours but different content. It was added to Dashboard versions; your dashboard stays as it is.`;
  }
}
