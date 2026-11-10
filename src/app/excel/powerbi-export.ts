import type { Column, Mac, Row, SheetWithRows, Workbook } from '../core/models';
import { isFormulaError, type FormulaScalar } from '../formula/evaluate-formula';
import { WorkbookFormulas } from '../formula/sheet-formulas';
import { columnLabel, hasBoxes, isIsoDate, todayIso } from '../sheet/columns';
import { loadExcel, styleHeader } from './exceljs';

/**
 * The tables for Power BI: one workbook, each table an Excel table of its
 * own (Power BI's Get data → Excel workbook lists them by name), a header
 * row and typed values — numbers as numbers, dates as dates, Yes/No as
 * TRUE/FALSE, formula columns worked out. Every MAC's table of the same
 * name goes into one, with the MAC on each row, so farms compare in one
 * visual; the MACs sheet holds where each one is, for a map.
 */

type Typed = string | number | boolean | Date | null;

/** Each column's header in the export: its name and unit, its box in front where a table has several. */
export function exportHeaders(columns: Column[]): Map<string, string> {
  const several = hasBoxes(columns);
  const headers = new Map<string, string>();
  const used = new Set<string>(['mac', 'mac code']);
  for (const column of columns) {
    const label = columnLabel(column);
    const base = several && column.box ? `${column.box} · ${label}` : label;
    let header = base;
    for (let n = 2; used.has(header.toLowerCase()); n += 1) header = `${base} ${n}`;
    used.add(header.toLowerCase());
    headers.set(column.key, header);
  }
  return headers;
}

function asDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

export function typed(column: Column, value: FormulaScalar | string | undefined): Typed {
  if (value === undefined || value === null || value === '' || isFormulaError(value)) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const text = String(value);
  switch (column.type) {
    case 'number':
    case 'percentage': {
      const number = Number(text);
      return Number.isFinite(number) ? number : text;
    }
    case 'date':
      return isIsoDate(text) ? asDate(text) : text;
    case 'yesno':
      return text === 'true' ? true : text === 'false' ? false : text;
    case 'formula':
      if (isIsoDate(text)) return asDate(text);
      return text;
    default:
      return text;
  }
}

interface ExportTable {
  title: string;
  headers: string[];
  /** Per header: how its values look (date, number). */
  kinds: Map<string, 'date' | 'number' | 'other'>;
  rows: Record<string, Typed>[];
}

function kindOf(column: Column): 'date' | 'number' | 'other' {
  if (column.type === 'date') return 'date';
  if (column.type === 'number' || column.type === 'percentage') return 'number';
  return 'other';
}

/** A worksheet's name: ≤31 characters, none of []:*?/\, not used yet. */
export function sheetName(title: string, used: Set<string>) {
  const base = title.replace(/[[\]:*?/\\]/g, '-').slice(0, 31).trim() || 'Table';
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n += 1) {
    const suffix = ` ${n}`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(name.toLowerCase());
  return name;
}

/** An Excel table's name: letters, digits and _, starting with a letter. */
function tableName(title: string, used: Set<string>) {
  let base = title.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'Table';
  if (!/^[A-Za-z_]/.test(base)) base = `T_${base}`;
  if (/^[A-Za-z]{1,3}\d+$/.test(base) || /^[RC]$/i.test(base)) base = `${base}_`;
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base}_${n}`;
  used.add(name.toLowerCase());
  return name;
}

function collect(books: readonly Workbook[]): ExportTable[] {
  const tables = new Map<string, ExportTable>();
  const today = todayIso();
  for (const book of books) {
    const formulas = new WorkbookFormulas(book.sheets, today);
    for (const sheet of book.sheets) {
      const id = sheet.title.trim().toLowerCase();
      const table: ExportTable = tables.get(id) ?? {
        title: sheet.title,
        headers: ['MAC', 'MAC code'],
        kinds: new Map(),
        rows: [],
      };
      tables.set(id, table);
      const headers = exportHeaders(sheet.columns);
      for (const column of sheet.columns) {
        const header = headers.get(column.key)!;
        if (!table.headers.includes(header)) table.headers.push(header);
        const kind = column.type === 'formula' ? 'other' : kindOf(column);
        if (!table.kinds.has(header)) table.kinds.set(header, kind);
      }
      for (const row of sheet.rows) table.rows.push(exportRow(book.mac, sheet, row, headers, formulas));
    }
  }
  return [...tables.values()];
}

function exportRow(
  mac: Mac,
  sheet: SheetWithRows,
  row: Row,
  headers: Map<string, string>,
  formulas: WorkbookFormulas,
): Record<string, Typed> {
  const out: Record<string, Typed> = { MAC: mac.macName, 'MAC code': mac.macCode };
  for (const column of sheet.columns) {
    const value = column.type === 'formula' ? formulas.value(sheet, row, column) : row.data[column.key];
    out[headers.get(column.key)!] = typed(column, value);
  }
  return out;
}

/** A picture to put on a sheet of its own after the tables (the Zones table's map). */
export interface ExportPicture {
  /** A PNG as a data URL. */
  dataUrl: string;
  width: number;
  height: number;
}

/** The Power BI workbook (.xlsx bytes) of these MACs' tables. */
export async function buildPowerBiWorkbook(
  books: readonly Workbook[],
  options: { single?: boolean; picture?: ExportPicture } = {},
): Promise<ArrayBuffer> {
  const Excel = await loadExcel();
  const book = new Excel.Workbook();
  book.creator = 'UKMAC Monitoring';
  book.title = 'UKMAC Monitoring — Power BI';
  const usedSheets = new Set<string>();
  const usedTables = new Set<string>();

  if (!options.single) writeAbout(book, books, usedSheets, usedTables);

  for (const table of collect(books)) {
    if (table.headers.length <= 2) continue;
    writeTable(
      book.addWorksheet(sheetName(table.title, usedSheets)),
      tableName(table.title, usedTables),
      table.headers,
      table.kinds,
      table.rows,
    );
  }
  if (options.picture) writePicture(book, options.picture, usedSheets);
  return book.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

/** The picture on a sheet of its own, with no cells (so a read of the file finds only the tables), and the file opens on it. */
function writePicture(book: import('exceljs').Workbook, picture: ExportPicture, usedSheets: Set<string>) {
  const sheet = book.addWorksheet(sheetName('Zone map', usedSheets));
  const id = book.addImage({ base64: picture.dataUrl, extension: 'png' });
  const shown = Math.min(1500, picture.width);
  sheet.addImage(id, { tl: { col: 0, row: 0 }, ext: { width: shown, height: Math.round((picture.height * shown) / picture.width) } });
  sheet.views = [{ showGridLines: false }];
  book.views = [{ x: 0, y: 0, width: 20000, height: 20000, firstSheet: 0, activeTab: book.worksheets.length - 1, visibility: 'visible' }];
}

/** The About sheet (how to use the file) and the MACs table. */
function writeAbout(
  book: import('exceljs').Workbook,
  books: readonly Workbook[],
  usedSheets: Set<string>,
  usedTables: Set<string>,
) {
  const about = book.addWorksheet(sheetName('About', usedSheets));
  about.columns = [
    { header: 'UKMAC Monitoring — data for Power BI', width: 36 },
    { header: '', width: 90 },
  ];
  about.addRows([
    ['Exported', new Date().toLocaleString('en-GB', { timeZone: 'Asia/Phnom_Penh' }) + ' (Cambodia time)'],
    ['MACs', books.map((item) => item.mac.macName).join(', ')],
    ['In Power BI', 'Get data → Excel workbook → this file. Tick the tables you want (each sheet here is one table).'],
    ['Farms together', 'A table every MAC has (QA/QC Management, …) holds all of their rows; the MAC column tells them apart.'],
    ['Map', 'The MACs table has each farm\'s latitude and longitude, for a map visual.'],
    ['Keep it fresh', 'Export again (or turn on "Keep this file up to date" in the app), then Refresh in Power BI.'],
  ]);
  styleHeader(about);

  const macRows = books.map((item) => ({
    MAC: item.mac.macName,
    'MAC code': item.mac.macCode,
    Location: item.mac.macLocation,
    Latitude: item.mac.latitude,
    Longitude: item.mac.longitude,
    Crop: item.mac.crop,
    'Start date': item.mac.startDate && isIsoDate(item.mac.startDate) ? asDate(item.mac.startDate) : null,
    'End date': item.mac.endDate && isIsoDate(item.mac.endDate) ? asDate(item.mac.endDate) : null,
    Tables: item.sheets.length,
    Rows: item.sheets.reduce((sum, sheet) => sum + sheet.rows.length, 0),
  }));
  writeTable(
    book.addWorksheet(sheetName('MACs', usedSheets)),
    tableName('MACs', usedTables),
    Object.keys(macRows[0] ?? { MAC: null }),
    new Map([
      ['Start date', 'date'],
      ['End date', 'date'],
    ]),
    macRows,
  );
}

function writeTable(
  sheet: import('exceljs').Worksheet,
  name: string,
  headers: string[],
  kinds: Map<string, string>,
  rows: Record<string, Typed>[],
) {
  headers.forEach((header, index) => {
    const column = sheet.getColumn(index + 1);
    column.width = Math.min(40, Math.max(12, header.length + 2));
    // A date column, or a formula one whose values are dates.
    if (kinds.get(header) === 'date' || rows.some((row) => row[header] instanceof Date)) column.numFmt = 'dd/mm/yyyy';
  });
  if (rows.length) {
    sheet.addTable({
      name,
      ref: 'A1',
      headerRow: true,
      style: { theme: 'TableStyleMedium7', showRowStripes: true },
      columns: headers.map((header) => ({ name: header, filterButton: true })),
      rows: rows.map((row) => headers.map((header) => row[header] ?? null)),
    });
  } else {
    sheet.addRow(headers);
    styleHeader(sheet);
  }
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}
