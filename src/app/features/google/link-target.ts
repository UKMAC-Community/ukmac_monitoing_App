// Which Google Sheet a table reads, else its MAC's: kept with the rest of connecting, as the app's background linking uses it too.
export { spreadsheetOf, type SpreadsheetRef } from '@core/google/connect-plan';

const loose = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/** The tab a typed name means: the one with exactly that name, else the one that differs only in capitals or spaces. */
export function tabNamed<T extends { name: string }>(tabs: readonly T[], typed: string): T | null {
  if (!typed.trim()) return null;
  return tabs.find((tab) => tab.name === typed) ?? tabs.find((tab) => loose(tab.name) === loose(typed)) ?? null;
}
