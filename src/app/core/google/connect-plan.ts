import type { Column, GoogleLink } from '../models';
import { plainLayout, sameLayout, type FileLayout } from '@shared/excel/file-layout';
import { normalizeHeader } from '@shared/sheet/columns';
import { tabNameOf } from './link-plan';
import { mappingFromLink } from './sheet-sync';

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

/**
 * The matches a table takes to another Google Sheet (the farm's real one after a test copy, say): each header its link
 * matched goes to the same column again wherever the new tab has a header of that name, a header it left out stays out,
 * and what the names alone match (`byName`: column key → worksheet column) fills in the rest. Nothing matched by hand has
 * to be matched again. The result is as `mapping` is kept: each table column's key → the worksheet column that fills it.
 */
export function carriedMapping(
  columns: Column[],
  sync: { headers: readonly string[]; positions: readonly number[] },
  remembered: Record<string, string>,
  byName: Record<string, number>,
): Record<string, number> {
  const mapping = mappingFromLink(columns, [...sync.headers], [...sync.positions], remembered);
  const leftOut = new Set(Object.entries(remembered).filter(([, key]) => key === '').map(([name]) => normalizeHeader(name)));
  const used = new Set(Object.values(mapping));
  for (const [key, position] of Object.entries(byName)) {
    if (key in mapping || used.has(position)) continue;
    const header = sync.headers[sync.positions.indexOf(position)];
    if (header !== undefined && leftOut.has(normalizeHeader(header))) continue;
    mapping[key] = position;
    used.add(position);
  }
  return mapping;
}

/** What the link keeps of where the names and data are: nothing, when Sync would look there anyway (the names on `headerRow`, the data under them). */
export function linkLayout(layout: FileLayout, headerRow?: number): FileLayout | null {
  return headerRow && sameLayout(layout, plainLayout(headerRow)) ? null : layout;
}

/** A tab's or table's name with case, spaces and marks taken out ("QA-QC Management" and "QA/QC management" are one). */
export function looseName(name: string): string {
  return name.toLowerCase().replace(/[\s_\-/\\.,:;()[\]{}'"’]+/g, '');
}

/** The farm sheet's own names for the tabs some tables read: Fertigation is its Fertilizer tab, Pesticides its Fungicide tab. */
const FARM_TABS: Readonly<Record<string, readonly string[]>> = {
  fertigation: ['Fertilizer'],
  pesticides: ['Fungicide'],
};

/**
 * The tab a table is connected to unless the person picks another: the tab it reads now, when it reads this sheet;
 * none when it reads another sheet (its link stays as it is); else the tab that goes by its name, or by the name the
 * farm's sheet gives it (Fertigation's Fertilizer tab). Zones never gets one by itself: it holds the map's plot
 * outlines, and a read would replace them by the tab's rows.
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
  const farm = (FARM_TABS[table.templateKey ?? ''] ?? []).map(find).find(Boolean);
  return (find(tabNameOf(table)) ?? find(table.title) ?? farm)?.name ?? null;
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

/** A Google Sheet file, by its id and its name. */
export interface SpreadsheetRef {
  spreadsheetId: string;
  spreadsheetTitle: string;
}

/**
 * The Google Sheet a table reads its tab from: its own link's, else the one its MAC's other tables read (the
 * one most of them read, when there are more). Null: nothing in the MAC is read from Google yet.
 */
export function spreadsheetOf(links: readonly GoogleLink[], sheetId: number, macId: number): SpreadsheetRef | null {
  const own = links.find((link) => link.sheetId === sheetId);
  if (own) return { spreadsheetId: own.spreadsheetId, spreadsheetTitle: own.spreadsheetTitle };
  const counted = new Map<string, { ref: SpreadsheetRef; count: number }>();
  for (const link of links) {
    if (link.macId !== macId) continue;
    const seen = counted.get(link.spreadsheetId);
    if (seen) seen.count += 1;
    else counted.set(link.spreadsheetId, { ref: { spreadsheetId: link.spreadsheetId, spreadsheetTitle: link.spreadsheetTitle }, count: 1 });
  }
  let best: { ref: SpreadsheetRef; count: number } | null = null;
  for (const item of counted.values()) if (!best || item.count > best.count) best = item;
  return best?.ref ?? null;
}
