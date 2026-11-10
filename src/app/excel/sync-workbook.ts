import type { SheetWithRows } from '../core/models';
import { headerMapOf } from '../google/sheet-sync';
import { excelHeaders, isEntryColumn } from '../sheet/columns';
import { loadExcel, styleHeader } from './exceljs';
import { sheetName, typed } from './powerbi-export';

/** Where one table went in the workbook, and how its headers map back to its columns. */
export interface PublishedTab {
  sheetId: number;
  tab: string;
  headerMap: Record<string, string>;
  rows: number;
}

/**
 * The tables as a workbook a Google Sheet is made from, and read back from by Sync: one tab per table (named as an
 * Excel tab may be), a single header row of the names the importer matches by, the typed columns only (a formula
 * column is worked out by the app, so Sync would add it as a new column), and each cell's own value.
 */
export async function buildSyncWorkbook(tables: readonly SheetWithRows[]): Promise<{ bytes: ArrayBuffer; tabs: PublishedTab[] }> {
  const Excel = await loadExcel();
  const book = new Excel.Workbook();
  book.creator = 'UKMAC Monitoring';
  const used = new Set<string>();
  const tabs: PublishedTab[] = [];
  for (const table of tables) {
    const columns = table.columns.filter(isEntryColumn);
    const names = excelHeaders(table.columns);
    const headers = columns.map((column) => names.get(column.key) ?? column.name);
    const sheet = book.addWorksheet(sheetName(table.title, used));
    sheet.addRow(headers);
    styleHeader(sheet);
    columns.forEach((column, index) => {
      if (column.type === 'date') sheet.getColumn(index + 1).numFmt = 'yyyy-mm-dd';
      sheet.getColumn(index + 1).width = Math.min(40, Math.max(12, headers[index].length + 2));
    });
    for (const row of table.rows) sheet.addRow(columns.map((column) => typed(column, row.data[column.key])));
    tabs.push({
      sheetId: table.sheetId,
      tab: sheet.name,
      headerMap: headerMapOf(headers, new Map(columns.map((column, index) => [index, column] as const))),
      rows: table.rows.length,
    });
  }
  return { bytes: (await book.xlsx.writeBuffer()) as ArrayBuffer, tabs };
}
