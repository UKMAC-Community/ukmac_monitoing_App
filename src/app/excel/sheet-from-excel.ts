import type { Cells, Column, ColumnType } from '../core/models';
import { excelSerialToIso, parseDateText } from '../sheet/columns';
import { loadExcel, type ExcelJS } from './exceljs';
import { MAX_FILE_BYTES, MAX_IMPORT_ROWS } from './excel-template';
import { fixLayout, plainLayout, plainText, syncHeaders, type FileLayout } from './file-layout';

/** A worksheet of any Excel file, read as a new table: its first filled row the headers, the rows under it the data. */
export interface ExcelSheetData {
  name: string;
  /** The row the names start on (the only one, unless `layout` says the names take more). */
  headerRow: number;
  /** Where the names and the data are: found as above, or as the person said. */
  layout: FileLayout;
  /** Where Sync looks when the person hasn't said: the first row with two cells, the data under it. */
  auto: FileLayout;
  headers: string[];
  /** The worksheet column (1-based) each header was read from; headers skip empty cells. */
  positions?: number[];
  /** Each row's cells as text, by header position. */
  rows: string[][];
  /** Per header, whether Excel kept it as a date. */
  dateLike: boolean[];
  /** The sheet has more rows than are read (the first `MAX_IMPORT_ROWS` are). */
  truncated?: boolean;
}

/**
 * The visible tabs of a workbook as tables. Each tab's names and data are found as the doc above says,
 * unless `set` gives the layout of one (a linked table's: the person said where its names and data are).
 */
export async function readExcelSheets(bytes: ArrayBuffer, set?: { tab: string; layout: FileLayout }): Promise<ExcelSheetData[]> {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('Keep the workbook under 15 MB.');
  const Excel = await loadExcel();
  const book = new Excel.Workbook();
  try {
    await book.xlsx.load(bytes);
  } catch {
    throw new Error("This workbook can't be read. Use an .xlsx file that isn't password-protected.");
  }
  const date1904 = Boolean((book.properties as { date1904?: boolean }).date1904);
  const out: ExcelSheetData[] = [];
  for (const worksheet of book.worksheets) {
    if (worksheet.state === 'hidden' || worksheet.state === 'veryHidden') continue;
    // The header row: the first with two or more filled cells (or one, if that's all there is).
    let headerRow = 0;
    for (let at = 1; at <= Math.min(30, worksheet.rowCount); at += 1) {
      let filled = 0;
      worksheet.getRow(at).eachCell(() => (filled += 1));
      if (filled >= 2 || (filled === 1 && !headerRow)) {
        headerRow = at;
        if (filled >= 2) break;
      }
    }
    if (!headerRow) continue;
    const named = set && worksheet.name.trim().toLowerCase() === set.tab.trim().toLowerCase();
    const layout = named ? fixLayout(set.layout, worksheet.rowCount) : plainLayout(headerRow);
    const { headers, positions } = syncHeaders(worksheet, layout, date1904);
    const rows: string[][] = [];
    const dateLike = headers.map(() => false);
    let truncated = false;
    for (let at = layout.dataFrom; at <= worksheet.rowCount; at += 1) {
      const row = worksheet.getRow(at);
      if (!row.hasValues) continue;
      if (rows.length >= MAX_IMPORT_ROWS) {
        truncated = true;
        break;
      }
      const cells = positions.map((position, index) => {
        const { text, date } = plainText(row.getCell(position).value, date1904);
        if (date && text) dateLike[index] = true;
        return text;
      });
      if (cells.some(Boolean)) rows.push(cells);
    }
    out.push({ name: worksheet.name, headerRow: layout.headerFrom, layout, auto: plainLayout(headerRow), headers, positions, rows, dateLike, truncated });
  }
  if (!out.length) throw new Error('The workbook has no sheet with data.');
  return out;
}

const NUMBER = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?%?$/;

/** A column's type, from its values: all numbers → Number, all dates → Date, all yes/no → Yes / No, else Text. */
export function guessType(values: string[], dateLike: boolean): ColumnType {
  const filled = values.filter((value) => value.trim());
  if (!filled.length) return 'text';
  if (dateLike || filled.every((value) => /[-/.]/.test(value) && parseDateText(value))) return 'date';
  if (filled.every((value) => /^(yes|no|true|false)$/i.test(value.trim()))) return 'yesno';
  if (filled.every((value) => NUMBER.test(value.trim()) && /\d/.test(value))) {
    return filled.every((value) => value.trim().endsWith('%')) ? 'percentage' : 'number';
  }
  return 'text';
}

/** The new table's columns and rows (keys `n1`, `n2`… stand in until the table gives its own). */
export function tableFromSheet(data: ExcelSheetData): { columns: Column[]; rows: Cells[] } {
  const columns: Column[] = data.headers.map((header, index) => ({
    key: `n${index + 1}`,
    name: header,
    type: guessType(
      data.rows.map((row) => row[index] ?? ''),
      data.dateLike[index],
    ),
  }));
  const rows = data.rows.map((cells) => {
    const out: Cells = {};
    cells.forEach((raw, index) => {
      const column = columns[index];
      const text = raw.trim();
      if (!text) return;
      if (column.type === 'date') out[column.key] = parseDateText(text) ?? (Number(text) ? excelSerialToIso(Number(text)) ?? text : text);
      else if (column.type === 'number' || column.type === 'percentage') out[column.key] = String(Number(text.replace(/[,%]/g, '')));
      else if (column.type === 'yesno') out[column.key] = /^(yes|true)$/i.test(text) ? 'true' : 'false';
      else out[column.key] = text;
    });
    return out;
  });
  return { columns, rows };
}
