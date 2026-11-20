import type { GoogleLink, SheetWithRows } from '@core/models';
import { qaqcChecks, zoneRows } from '@features/data-check/qa-qc-checks';

/**
 * What needs this person's attention, as the bell on the icon rail lists it (the web system's notification bell): an app update
 * waiting, problems the Data Check found, and Google Sheets that failed to be read or have not been for a day. `warning` and
 * `danger` count on the bell; `info` is listed but not counted.
 */
export interface Notice {
  id: string;
  tone: 'danger' | 'warning' | 'info';
  icon: string;
  title: string;
  detail: string;
  /** Where clicking it goes. */
  link: unknown[];
}

export interface NoticeInput {
  /** The open MAC's id and tables (none when no MAC is open: only the update is told then). */
  macId: number | null;
  sheets: readonly SheetWithRows[];
  links: readonly GoogleLink[];
  /** Tables whose last read failed, and why. */
  failures: ReadonlyMap<number, string>;
  /** The app's update: a version offered, one installed and waiting for the next open, a package of screens waiting. */
  update: { offered: string | null; installed: string | null; screens: string | null };
  today: string;
  now: number;
}

/** A read this old (ms) is told as old. */
export const STALE_MS = 24 * 3_600_000;
/** How many tables or zones a notice names before "and 2 more". */
const NAMED = 3;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function named(names: string[]): string {
  const shown = names.slice(0, NAMED).join(', ');
  return names.length > NAMED ? `${shown} and ${names.length - NAMED} more` : shown;
}

export function notices(input: NoticeInput): Notice[] {
  const out: Notice[] = [];
  const { update, macId } = input;

  if (update.offered) out.push({ id: 'update', tone: 'warning', icon: 'download', title: `Version ${update.offered} is ready`, detail: 'Open Settings to update the app.', link: ['/settings'] });
  else if (update.installed) out.push({ id: 'update', tone: 'warning', icon: 'download', title: `Version ${update.installed} is installed`, detail: 'It starts the next time the app is opened.', link: ['/settings'] });
  if (update.screens) out.push({ id: 'screens', tone: 'info', icon: 'refresh', title: 'New screens are ready', detail: `Version ${update.screens} shows at the next page change.`, link: ['/settings'] });

  if (macId === null) return out;

  // Data Check: a table whose checks found problems, and the zones the plan and QA/QC count differently.
  for (const table of qaqcChecks(input.sheets, input.today)) {
    if (!table.problems) continue;
    const worst = table.lines.filter((line) => !line.cannot && line.findings.length).sort((a, b) => b.findings.length - a.findings.length)[0];
    out.push({
      id: `check-${table.sheetId}`,
      tone: 'warning',
      icon: 'alert',
      title: `${table.title}: ${plural(table.problems, 'problem')} in the Data Check`,
      detail: worst?.bad ?? '',
      link: ['/mac', macId, 'data-check'],
    });
  }
  const differing = zoneRows(input.sheets).filter((zone) => zone.status === 'differs');
  if (differing.length) {
    out.push({
      id: 'zones-differ',
      tone: 'warning',
      icon: 'alert',
      title: `${plural(differing.length, 'zone')} counted differently in Plant Progress and QA/QC`,
      detail: named(differing.map((zone) => zone.plot)),
      link: ['/mac', macId, 'data-check'],
    });
  }

  // Google Sheets: a read that failed, and tables not read for a day (a link the app made to write to is not read, so it is left out).
  const titles = new Map(input.sheets.map((sheet) => [sheet.sheetId, sheet.title]));
  const failed: string[] = [];
  for (const [sheetId, why] of input.failures) {
    const title = titles.get(sheetId);
    if (title) failed.push(`${title} (${why})`);
  }
  if (failed.length) {
    out.push({ id: 'sync-failed', tone: 'danger', icon: 'cloud-check', title: `${plural(failed.length, 'table')} could not be read from Google`, detail: named(failed), link: ['/mac', macId] });
  }
  const old: string[] = [];
  for (const link of input.links) {
    if (link.macId !== macId || link.origin === 'app' || !titles.has(link.sheetId) || input.failures.has(link.sheetId)) continue;
    const at = link.lastSyncedAt ? new Date(`${link.lastSyncedAt.replace(' ', 'T')}Z`).getTime() : null;
    if (at === null || input.now - at > STALE_MS) old.push(titles.get(link.sheetId)!);
  }
  if (old.length) {
    out.push({ id: 'sync-old', tone: 'warning', icon: 'cloud-check', title: `${plural(old.length, 'table')} not read from Google for over a day`, detail: named(old), link: ['/mac', macId] });
  }
  return out;
}

/** What the bell's badge counts: everything but the `info` ones. */
export function noticeCount(list: readonly Notice[]): number {
  return list.filter((item) => item.tone !== 'info').length;
}
