import type { GoogleLink } from '../models';
import { plainLayout, sameLayout, type FileLayout } from '@shared/excel/file-layout';
import { normalizeHeader } from '@shared/sheet/columns';
import { tabNameOf } from './link-plan';

/**
 * Connecting a table to a Google tab once its columns are matched: what the link keeps, so Sync reads the tab the
 * way the person matched it. Used by the per-table import wizard and by the page that connects a whole MAC at once.
 */

/**
 * What each header of the tab fills, as the link remembers it: its name (normalised) → the table column's key.
 * A header that fills nothing is kept with an empty key (left out on purpose), so Sync doesn't add it as a column.
 * `mapping` is each table column's key → the worksheet column (1-based) that fills it; `sync` the tab's headers
 * as Sync reads them, each with its worksheet column.
 */
export function linkHeaderMap(sync: { headers: readonly string[]; positions: readonly number[] }, mapping: Record<string, number>): Record<string, string> {
  const keyAt = new Map(Object.entries(mapping).map(([key, position]) => [position, key] as const));
  const map: Record<string, string> = {};
  sync.headers.forEach((header, index) => {
    const name = normalizeHeader(header);
    const key = keyAt.get(sync.positions[index]) ?? '';
    // Two headers by one name: the one that fills a column is what's kept.
    if (key || !(name in map)) map[name] = key;
  });
  return map;
}

/** What the link keeps of where the names and data are: nothing, when Sync would look there anyway (the names on `headerRow`, the data under them). */
export function linkLayout(layout: FileLayout, headerRow?: number): FileLayout | null {
  return headerRow && sameLayout(layout, plainLayout(headerRow)) ? null : layout;
}

/** A tab's or table's name with case, spaces and marks taken out ("QA-QC Management" and "QA/QC management" are one). */
export function looseName(name: string): string {
  return name.toLowerCase().replace(/[\s_\-/\\.,:;()[\]{}'"’]+/g, '');
}

/**
 * The tab a table is connected to unless the person picks another: the tab it reads now, when it reads this sheet;
 * none when it reads another sheet (its link stays as it is); else the tab that goes by its name. Zones never gets
 * one by itself: it holds the map's plot outlines, and a read would replace them by the tab's rows.
 */
export function defaultTab(
  table: { title: string; templateKey?: string | null },
  tabs: readonly { name: string }[],
  link: Pick<GoogleLink, 'spreadsheetId' | 'tabTitle'> | null,
  spreadsheetId: string,
): string | null {
  const find = (name: string) => tabs.find((tab) => tab.name === name) ?? tabs.find((tab) => looseName(tab.name) === looseName(name));
  if (link) return link.spreadsheetId === spreadsheetId ? (find(link.tabTitle)?.name ?? null) : null;
  if (table.templateKey === 'zones') return null;
  return (find(tabNameOf(table)) ?? find(table.title))?.name ?? null;
}

/** Whether a link would change: another sheet or tab, other matches, or another layout. */
export function linkChanged(
  link: Pick<GoogleLink, 'spreadsheetId' | 'tabTitle' | 'headerMap' | 'layout'> | null,
  next: { spreadsheetId: string; tabTitle: string; headerMap: Record<string, string>; layout: FileLayout | null },
): boolean {
  if (!link) return true;
  if (link.spreadsheetId !== next.spreadsheetId || link.tabTitle !== next.tabTitle) return true;
  const before = Object.fromEntries(Object.entries(link.headerMap).map(([name, key]) => [normalizeHeader(name), key]));
  const names = new Set([...Object.keys(before), ...Object.keys(next.headerMap)]);
  for (const name of names) if ((before[name] ?? null) !== (next.headerMap[name] ?? null)) return true;
  const a = link.layout;
  const b = next.layout;
  return a === null || b === null ? a !== b : !sameLayout(a, b);
}
