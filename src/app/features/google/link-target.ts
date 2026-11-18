import type { GoogleLink } from '@core/models';

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

const loose = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** The tab a typed name means: the one with exactly that name, else the one that differs only in capitals or spaces. */
export function tabNamed<T extends { name: string }>(tabs: readonly T[], typed: string): T | null {
  if (!typed.trim()) return null;
  return tabs.find((tab) => tab.name === typed) ?? tabs.find((tab) => loose(tab.name) === loose(typed)) ?? null;
}
