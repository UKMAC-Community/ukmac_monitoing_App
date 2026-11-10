import type { Column, SheetWithRows } from '../core/models';
import { sheetName } from '../excel/powerbi-export';
import type { ExcelSheetData } from '../excel/sheet-from-excel';
import { headerMapOf, matchHeaders } from './sheet-sync';

/** Which tab each table goes to, read from a Google Sheet made from the input workbook. */
export interface LinkPlan {
  /** Tables with a tab whose headers are all the table's own: they can be linked. */
  ready: { table: SheetWithRows; tab: ExcelSheetData; headerMap: Record<string, string> }[];
  /** Tables the sheet has no tab for (named as the workbook names it). */
  noTab: SheetWithRows[];
  /** Tables whose tab has headers the table has no column for (linking would add columns on the next Sync). */
  different: { table: SheetWithRows; tab: ExcelSheetData; extra: string[] }[];
}

/** The tab name the input workbook gives a table. */
export function tabNameOf(table: Pick<SheetWithRows, 'title'>): string {
  return sheetName(table.title, new Set());
}

/** Pairs each table with the tab of the same name (as the input workbook names them) and checks its headers. */
export function planLinks(tables: readonly SheetWithRows[], tabs: readonly ExcelSheetData[]): LinkPlan {
  const plan: LinkPlan = { ready: [], noTab: [], different: [] };
  for (const table of tables) {
    const wanted = tabNameOf(table).toLowerCase();
    const tab = tabs.find((item) => item.name.trim().toLowerCase() === wanted);
    if (!tab) {
      plan.noTab.push(table);
      continue;
    }
    const { matched, fresh } = matchHeaders(table.columns as Column[], tab.headers, {});
    if (fresh.length) plan.different.push({ table, tab, extra: fresh.map((index) => tab.headers[index]) });
    else plan.ready.push({ table, tab, headerMap: headerMapOf(tab.headers, matched) });
  }
  return plan;
}
