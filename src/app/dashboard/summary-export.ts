import { loadExcel, styleHeader } from '../excel/exceljs';
import type { SummaryResult } from './dashboard-model';

/** A table's summaries as Excel: one sheet each, its groups and totals, as the dashboard shows them. */
export async function buildSummaryWorkbook(title: string, summaries: { title: string; result: SummaryResult }[]): Promise<ArrayBuffer> {
  const Excel = await loadExcel();
  const book = new Excel.Workbook();
  book.creator = 'UKMAC Monitoring';
  book.title = `${title} — summaries`;
  const used = new Set<string>();
  for (const { title: name, result } of summaries) {
    let sheetName = name.replace(/[[\]:*?/\\]/g, '-').slice(0, 31) || 'Summary';
    for (let n = 2; used.has(sheetName.toLowerCase()); n += 1) sheetName = `${sheetName.slice(0, 28)} ${n}`;
    used.add(sheetName.toLowerCase());
    const sheet = book.addWorksheet(sheetName);
    sheet.addRow([result.header, ...result.columns]);
    for (const row of result.rows) sheet.addRow([row.label, ...row.values]);
    const total = sheet.addRow(['Total', ...result.totals]);
    total.font = { bold: true };
    styleHeader(sheet);
    sheet.columns.forEach((column, index) => (column.width = index === 0 ? 24 : 16));
  }
  return book.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
