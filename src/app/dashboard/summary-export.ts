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
    // A table grouped twice has a second label column (a day, then its zone numbers).
    const second = result.header2 !== undefined;
    sheet.addRow([result.header, ...(second ? [result.header2] : []), ...result.columns]);
    for (const row of result.rows) sheet.addRow([row.label, ...(second ? [row.label2 ?? ''] : []), ...row.values]);
    const total = sheet.addRow(['Total', ...(second ? [''] : []), ...result.totals]);
    total.font = { bold: true };
    styleHeader(sheet);
    sheet.columns.forEach((column, index) => (column.width = index === 0 ? 24 : 16));
  }
  return book.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}
