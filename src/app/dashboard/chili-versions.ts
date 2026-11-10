import { parseKpis, stringifyKpis, type ChiliKpi } from './chili-kpis';

/**
 * Versions of the chili dashboard, so one person can improve it and share it, and whoever imports it
 * is brought up to date without losing what they had. Pure: the store keeps the book and the file.
 *
 * - A version is a saved KPI list with a number, a date and a note. Versions made from one another
 *   share a `dashboardId`; their numbers count up, and a number is never used twice (not even after
 *   a removal), so "version 3" means one thing wherever it is.
 * - Export saves the dashboard as the next version when it has changed since the last one, and writes
 *   that version to a file. Nothing changed: the same version is written again.
 * - Import of a newer version than the dashboard has brings the dashboard up to it; an older one only
 *   joins the versions. Before the dashboard is replaced, whatever was in use that isn't already a
 *   version is kept as one, so going back is always possible.
 */

export const DASHBOARD_FORMAT = 'ukmac-dashboard';
export const DASHBOARD_FORMAT_VERSION = 1;
export const DEFAULT_DASHBOARD_NAME = 'Chili dashboard';
export const MAX_VERSIONS = 100;
export const MAX_FILE_BYTES = 1_000_000;
const MAX_NOTE = 300;
const MAX_NAME = 80;
const ID = /^[A-Za-z0-9_-]{6,64}$/;

export interface DashboardVersion {
  /** Unique to this version, wherever it travels. */
  id: string;
  /** The dashboard it is a version of. */
  dashboardId: string;
  name: string;
  number: number;
  note: string;
  /** ISO time. */
  createdAt: string;
  /** Made here, or came in from a file. */
  source: 'made' | 'imported';
  kpis: ChiliKpi[];
}

export interface VersionBook {
  /** The dashboard the one in use belongs to (null: none has been versioned yet). */
  activeId: string | null;
  /** The highest number each dashboard has had, kept after a removal so a number is never reused. */
  counters: Record<string, number>;
  versions: DashboardVersion[];
}

export interface Clock {
  now: () => string;
  id: () => string;
}

export const emptyBook = (): VersionBook => ({ activeId: null, counters: {}, versions: [] });

// -------------------------------------------------------------- equality

/** A list as it reads back from a save: keys in one order, nothing undefined. */
function normal(kpis: readonly ChiliKpi[]) {
  const parsed = parseKpis(stringifyKpis(kpis));
  // A list with a KPI that can't be read is compared as it is, never as a smaller one it would equal.
  return stringifyKpis(parsed && parsed.length === kpis.length ? parsed : kpis);
}

export function sameKpis(a: readonly ChiliKpi[], b: readonly ChiliKpi[]) {
  return normal(a) === normal(b);
}

/** A copy that shares nothing with the original. */
export function copyKpis(kpis: readonly ChiliKpi[]): ChiliKpi[] {
  return parseKpis(stringifyKpis(kpis)) ?? [];
}

// ---------------------------------------------------------------- reading

export function latestOf(book: VersionBook, dashboardId: string): DashboardVersion | null {
  let latest: DashboardVersion | null = null;
  for (const version of book.versions) if (version.dashboardId === dashboardId && (!latest || version.number > latest.number)) latest = version;
  return latest;
}

/** The version a KPI list is exactly (the active dashboard's, then the highest number), or null. */
export function inUseVersion(book: VersionBook, kpis: readonly ChiliKpi[]): DashboardVersion | null {
  const target = normal(kpis);
  const found = book.versions.filter((version) => normal(version.kpis) === target);
  found.sort((a, b) => Number(b.dashboardId === book.activeId) - Number(a.dashboardId === book.activeId) || b.number - a.number);
  return found[0] ?? null;
}

function nextNumber(book: VersionBook, dashboardId: string) {
  return Math.max(book.counters[dashboardId] ?? 0, latestOf(book, dashboardId)?.number ?? 0) + 1;
}

function withVersion(book: VersionBook, version: DashboardVersion, activeId: string | null = book.activeId): VersionBook {
  return {
    activeId,
    counters: { ...book.counters, [version.dashboardId]: Math.max(book.counters[version.dashboardId] ?? 0, version.number) },
    versions: [...book.versions, version],
  };
}

function room(book: VersionBook, needed: number) {
  if (book.versions.length + needed > MAX_VERSIONS) throw new Error(`There are already ${book.versions.length} dashboard versions. Remove some old ones in Dashboard versions first.`);
}

// ------------------------------------------------------------ the changes

/** A dashboard this Mac only made: none of its versions came from a file. */
function isOwn(book: VersionBook, dashboardId: string) {
  const mine = book.versions.filter((version) => version.dashboardId === dashboardId);
  return mine.length > 0 && mine.every((version) => version.source === 'made');
}

export const KEPT_NAME = 'Your earlier dashboard';

/** How a kept copy is told of: kept (it is its own dashboard in the list), or kept as the version number it took. */
export function keptWords(kept: DashboardVersion) {
  return kept.name === KEPT_NAME ? 'kept' : `kept as version ${kept.number}`;
}

/**
 * Keeps the dashboard in use as a version, unless it is one already or is the built-in one (custom false).
 * Changes to a dashboard this Mac made go on as its next version. Changes to one that was sent are kept
 * as a dashboard of their own, so their number can never get in the way of the sender's next version.
 */
function keepInUse(book: VersionBook, working: { kpis: readonly ChiliKpi[]; custom: boolean }, note: string, clock: Clock): { book: VersionBook; kept: DashboardVersion | null } {
  if (!working.custom || inUseVersion(book, working.kpis)) return { book, kept: null };
  room(book, 1);
  const own = book.activeId !== null && isOwn(book, book.activeId);
  const dashboardId = own ? book.activeId! : clock.id();
  const kept: DashboardVersion = { id: clock.id(), dashboardId, name: own ? (latestOf(book, dashboardId)?.name ?? DEFAULT_DASHBOARD_NAME) : KEPT_NAME, number: nextNumber(book, dashboardId), note, createdAt: clock.now(), source: 'made', kpis: copyKpis(working.kpis) };
  return { book: withVersion(book, kept, book.activeId), kept };
}

export interface Published {
  book: VersionBook;
  version: DashboardVersion;
  /** A new version was made (false: the latest one, unchanged, is written again). */
  created: boolean;
}

/** What Export writes: the dashboard as its next version, or its latest one again when nothing has changed. */
export function publish(book: VersionBook, kpis: readonly ChiliKpi[], name: string, note: string, clock: Clock): Published {
  const same = inUseVersion(book, kpis);
  // Going back to an older version and exporting it makes it the newest, so people with the later ones get it.
  if (same && latestOf(book, same.dashboardId)?.number === same.number) return { book: { ...book, activeId: same.dashboardId }, version: same, created: false };
  room(book, 1);
  const dashboardId = same?.dashboardId ?? book.activeId ?? clock.id();
  const version: DashboardVersion = {
    id: clock.id(),
    dashboardId,
    name: name.trim().slice(0, MAX_NAME) || latestOf(book, dashboardId)?.name || DEFAULT_DASHBOARD_NAME,
    number: nextNumber(book, dashboardId),
    note: (note.trim() || (same ? `Same as version ${same.number}` : '')).slice(0, MAX_NOTE),
    createdAt: clock.now(),
    source: 'made',
    kpis: copyKpis(kpis),
  };
  return { book: withVersion(book, version, dashboardId), version, created: true };
}

/** updated: the dashboard now is this version; up-to-date: it already was; present: this version was already in the list (an older one); older / added: joined the list without replacing the dashboard. */
export type ImportOutcome = 'updated' | 'up-to-date' | 'present' | 'older' | 'added';

export interface Imported {
  book: VersionBook;
  outcome: ImportOutcome;
  version: DashboardVersion;
  /** The dashboard to show now; null: leave it as it is. */
  kpis: ChiliKpi[] | null;
  /** What was in use, kept as a version before it was replaced. */
  kept: DashboardVersion | null;
  /** The highest number this dashboard had before (for the message when this one is older). */
  top: number;
}

/** A file's version joins the versions; a newer one than the dashboard has also replaces it. */
export function importVersion(book: VersionBook, file: DashboardFile, working: { kpis: readonly ChiliKpi[]; custom: boolean }, clock: Clock): Imported {
  const present = book.versions.find((version) => version.id === file.versionId) ?? null;
  const newest = latestOf(book, file.dashboardId);
  // The highest number this dashboard has had here, even if that version has since been removed: an older file never replaces it.
  const top = Math.max(book.counters[file.dashboardId] ?? 0, newest?.number ?? 0);
  // Newer than any it has had; or one it has already, if that is its newest. Same number, other id (two people edited at once): only added.
  const apply = present ? present.number >= top : file.number > top;
  let next = book;
  let version = present;
  if (!version) {
    version = { id: file.versionId, dashboardId: file.dashboardId, name: file.name, number: file.number, note: file.note, createdAt: file.createdAt, source: 'imported', kpis: copyKpis(file.kpis) };
  }
  if (!apply) {
    // Its number is the highest it has had: a version removed and sent again, if it is what is in use; else another person's version of that number.
    const tie = !present && file.number === top;
    const inUse = tie && working.custom && sameKpis(working.kpis, version.kpis);
    if (!present) {
      room(next, 1);
      next = withVersion(next, version, inUse ? version.dashboardId : next.activeId);
    }
    return { book: next, outcome: present ? 'present' : inUse ? 'up-to-date' : tie ? 'added' : 'older', version, kpis: null, kept: null, top };
  }
  const already = working.custom && sameKpis(working.kpis, version.kpis);
  const keptInUse = already ? { book: next, kept: null } : keepInUse(next, working, `Before updating to version ${version.number}`, clock);
  next = keptInUse.book;
  if (!present) room(next, 1);
  next = present ? { ...next, activeId: version.dashboardId } : withVersion(next, version, version.dashboardId);
  if (already) return { book: next, outcome: 'up-to-date', version, kpis: null, kept: null, top };
  return { book: next, outcome: 'updated', version, kpis: copyKpis(version.kpis), kept: keptInUse.kept, top };
}

export interface Switched {
  book: VersionBook;
  kpis: ChiliKpi[];
  kept: DashboardVersion | null;
}

/** Goes back to (or forward to) a version; what was in use is kept first. */
export function switchTo(book: VersionBook, id: string, working: { kpis: readonly ChiliKpi[]; custom: boolean }, clock: Clock): Switched {
  const version = book.versions.find((item) => item.id === id);
  if (!version) throw new Error('That version is no longer there.');
  if (working.custom && sameKpis(working.kpis, version.kpis)) return { book: { ...book, activeId: version.dashboardId }, kpis: copyKpis(version.kpis), kept: null };
  const { book: kept, kept: made } = keepInUse(book, working, `Before going to version ${version.number}`, clock);
  return { book: { ...kept, activeId: version.dashboardId }, kpis: copyKpis(version.kpis), kept: made };
}

/** Goes back to the built-in suggested dashboard; what was in use is kept first. */
export function switchToSuggested(book: VersionBook, working: { kpis: readonly ChiliKpi[]; custom: boolean }, clock: Clock) {
  return keepInUse(book, working, 'Before going back to the suggested dashboard', clock);
}

/** A version gone from the list. Its number stays used. */
export function removeVersion(book: VersionBook, id: string): VersionBook {
  return { ...book, versions: book.versions.filter((version) => version.id !== id) };
}

// ------------------------------------------------------------------ file

export interface DashboardFile {
  format: typeof DASHBOARD_FORMAT;
  formatVersion: number;
  dashboardId: string;
  versionId: string;
  name: string;
  number: number;
  note: string;
  createdAt: string;
  kpis: ChiliKpi[];
}

export function fileName(version: Pick<DashboardVersion, 'name' | 'number'>) {
  return `${version.name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || DEFAULT_DASHBOARD_NAME} v${version.number}.ukdash`;
}

export function fileText(version: DashboardVersion): string {
  const file: DashboardFile = { format: DASHBOARD_FORMAT, formatVersion: DASHBOARD_FORMAT_VERSION, dashboardId: version.dashboardId, versionId: version.id, name: version.name, number: version.number, note: version.note, createdAt: version.createdAt, kpis: version.kpis };
  return JSON.stringify(file, null, 2);
}

const str = (value: unknown, max: number) => (typeof value === 'string' && value.length <= max ? value : null);
const isoOf = (value: unknown) => {
  const text = str(value, 40);
  const time = text ? Date.parse(text) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

function versionFields(raw: Record<string, unknown>): Omit<DashboardFile, 'format' | 'formatVersion'> | null {
  const dashboardId = str(raw['dashboardId'], 64), versionId = str(raw['id'] ?? raw['versionId'], 64), note = str(raw['note'] ?? '', MAX_NOTE), name = str(raw['name'] ?? DEFAULT_DASHBOARD_NAME, MAX_NAME);
  const createdAt = isoOf(raw['createdAt']), number = raw['number'];
  if (!dashboardId || !ID.test(dashboardId) || !versionId || !ID.test(versionId) || note === null || name === null || !createdAt) return null;
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 1 || number > 99_999) return null;
  const list = raw['kpis'];
  if (!Array.isArray(list)) return null;
  const kpis = parseKpis(JSON.stringify({ kpis: list }));
  // A list with a KPI that can't be read is a damaged one, not a smaller one.
  if (!kpis || kpis.length !== list.length) return null;
  return { dashboardId, versionId, name: name.trim() || DEFAULT_DASHBOARD_NAME, number, note, createdAt, kpis };
}

/** A dashboard file, read and checked; throws a message for the person if it isn't one. */
export function parseFile(content: ArrayBuffer | string): DashboardFile {
  if ((typeof content === 'string' ? content.length : content.byteLength) > MAX_FILE_BYTES) throw new Error('This file is too large to be a dashboard file.');
  let payload: unknown;
  try { payload = JSON.parse(typeof content === 'string' ? content : new TextDecoder('utf-8').decode(content)); } catch { throw new Error("This isn't a UKMAC dashboard file."); }
  const raw = payload as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object' || raw['format'] !== DASHBOARD_FORMAT) throw new Error("This isn't a UKMAC dashboard file.");
  if (typeof raw['formatVersion'] !== 'number' || raw['formatVersion'] > DASHBOARD_FORMAT_VERSION) throw new Error('This dashboard file is from a newer version of UKMAC Monitoring. Update the app, then import it again.');
  const fields = versionFields(raw);
  if (!fields) throw new Error('This dashboard file is damaged and could not be read.');
  return { format: DASHBOARD_FORMAT, formatVersion: raw['formatVersion'], ...fields };
}

// ------------------------------------------------------------- the book

/** The saved book, or an empty one when there is none or it can't be read; a version that can't be read is left out. */
export function parseBook(saved: string | null): VersionBook {
  if (!saved) return emptyBook();
  let payload: Record<string, unknown> | null;
  try { payload = JSON.parse(saved) as Record<string, unknown> | null; } catch { return emptyBook(); }
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload['versions'])) return emptyBook();
  const seen = new Set<string>();
  const versions: DashboardVersion[] = [];
  for (const item of payload['versions'].slice(0, MAX_VERSIONS) as unknown[]) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const fields = versionFields(raw);
    if (!fields || seen.has(fields.versionId)) continue;
    seen.add(fields.versionId);
    versions.push({ id: fields.versionId, dashboardId: fields.dashboardId, name: fields.name, number: fields.number, note: fields.note, createdAt: fields.createdAt, source: raw['source'] === 'imported' ? 'imported' : 'made', kpis: fields.kpis });
  }
  const counters: Record<string, number> = {};
  const rawCounters = payload['counters'];
  if (rawCounters && typeof rawCounters === 'object') {
    for (const [key, value] of Object.entries(rawCounters)) if (ID.test(key) && typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 99_999) counters[key] = value;
  }
  // A number once used stays used, even if the counter was lost.
  for (const version of versions) counters[version.dashboardId] = Math.max(counters[version.dashboardId] ?? 0, version.number);
  const active = payload['activeId'];
  return { activeId: typeof active === 'string' && ID.test(active) ? active : null, counters, versions };
}

export function stringifyBook(book: VersionBook) {
  return JSON.stringify(book);
}

// ---------------------------------------------------------------- timeline

export interface VersionDay {
  /** The local day, `YYYY-MM-DD` (`''` for a time that can't be read). */
  key: string;
  /** "Today", "Yesterday", or "Mon 9 Nov 2026". */
  label: string;
  versions: DashboardVersion[];
}

function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Versions as a timeline: grouped by the local day they were made, in the order given (newest first stays so). */
export function versionDays(versions: readonly DashboardVersion[], now: Date = new Date()): VersionDay[] {
  const today = localDay(now);
  const yesterday = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const days: VersionDay[] = [];
  for (const version of versions) {
    const at = new Date(version.createdAt);
    const valid = Number.isFinite(at.getTime());
    const key = valid ? localDay(at) : '';
    let day = days.at(-1);
    if (day?.key !== key) {
      const label = !valid ? 'Unknown date' : key === today ? 'Today' : key === yesterday ? 'Yesterday' : at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(',', '');
      day = { key, label, versions: [] };
      days.push(day);
    }
    day.versions.push(version);
  }
  return days;
}
