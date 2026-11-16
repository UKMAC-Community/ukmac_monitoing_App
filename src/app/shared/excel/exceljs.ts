import type * as ExcelJS from 'exceljs';

export type { ExcelJS };

/** exceljs, loaded the first time a workbook is read or written. */
export async function loadExcel(): Promise<typeof ExcelJS> {
  const module = (await import('exceljs')) as unknown as { default?: typeof ExcelJS } & typeof ExcelJS;
  return module.default?.Workbook ? module.default : module;
}

export const HEADER_FILL = 'FF176B4C';

export function styleHeader(sheet: ExcelJS.Worksheet, row = 1) {
  sheet.views = [{ state: 'frozen', ySplit: row }];
  const header = sheet.getRow(row);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
  header.alignment = { vertical: 'middle', wrapText: true };
  header.height = 30;
}

/** A name safe for a file: no slashes or other characters Finder dislikes. */
export function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() || 'table';
}
