import type { Cells, Column, Sheet } from '../core/models';
import {
  checkCell,
  columnLabel,
  excelHeaders,
  excelSerialToIso,
  headerAliases,
  isEntryColumn,
  normalizeHeader,
  parseLinkSource,
  PATH_SEPARATOR,
  rangeText,
  typeLabel,
} from '../sheet/columns';
import { loadExcel, styleHeader, type ExcelJS } from './exceljs';
import { fixLayout, headerNames, mergesOf, ownName, peekOf, stageOfColumns, syncHeaders, usedColumns, withGroupRow, type FileLayout, type FilePeek } from './file-layout';
import { matchByStage } from './header-match';

/**
 * A table's Excel template and import — the server's way: a "Data" sheet
 * whose first row is the table's columns (as `excelHeaders` names them),
 * filled in and imported back; a column is matched by its header.
 *
 * Kinder than the server on a farm's own workbook: a sheet that isn't
 * called "Data" is read too (the first one), a header row lower down is
 * found, Excel's own dates and formulas' results are taken, and a column
 * the table doesn't have is left out with a note instead of stopping it.
 */

export const MAX_IMPORT_ROWS = 5000;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
/** Rows of the template given drop-down lists. */
const TEMPLATE_ROWS = 500;

export interface TemplateContext {
  /** A link column's values to pick from. */
  linkOptions: (column: Column) => string[];
}

function describe(column: Column, ctx: TemplateContext): string {
  const parts = [column.required ? 'Required.' : 'Optional.', `${typeLabel(column.type)}.`];
  const range = rangeText(column);
  switch (column.type) {
    case 'number':
      parts.push(range ? `Enter a number ${range}.` : 'Enter a number.');
      break;
    case 'percentage':
      parts.push(range ? `Enter a number ${range} (the % sign is optional).` : 'Enter a number out of 100 (the % sign is optional).');
      break;
    case 'date':
      parts.push('Use a date like 16/06/2026 or 2026-06-16, or an Excel date.');
      break;
    case 'yesno':
      parts.push('Yes or No.');
      break;
    case 'choice':
      parts.push(`One of: ${(column.options ?? []).join(', ')}.`);
      break;
    case 'link': {
      const source = parseLinkSource(column.source);
      const count = ctx.linkOptions(column).length;
      parts.push(
        source
          ? `A ${source.column} from the ${source.table} table (${count} to pick from, see the Lists sheet).`
          : 'A value from the linked table.',
      );
      break;
    }
  }
  if (column.note) parts.push(column.note);
  return parts.join(' ');
}

function listValues(column: Column, ctx: TemplateContext): string[] {
  if (column.type === 'choice') return column.options ?? [];
  if (column.type === 'yesno') return ['Yes', 'No'];
  if (column.type === 'link') return ctx.linkOptions(column);
  return [];
}

function columnLetter(index: number) {
  let n = index;
  let letters = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** The table's blank Excel template (.xlsx bytes). */
export async function buildTemplate(sheet: Sheet, ctx: TemplateContext): Promise<ArrayBuffer> {
  const Excel = await loadExcel();
  const book = new Excel.Workbook();
  book.creator = 'UKMAC Monitoring';
  book.title = sheet.title;
  const headers = excelHeaders(sheet.columns);
  const columns = sheet.columns.filter(isEntryColumn);

  const data = book.addWorksheet('Data');
  data.columns = columns.map((column) => ({
    header: headers.get(column.key)!,
    key: column.key,
    width: Math.min(40, Math.max(14, headers.get(column.key)!.length + 2)),
  }));
  styleHeader(data);

  // Drop-down lists, from the Lists sheet.
  const lists = book.addWorksheet('Lists');
  let listColumn = 0;
  columns.forEach((column, index) => {
    const header = data.getCell(1, index + 1);
    header.note = describe(column, ctx);
    const excelColumn = data.getColumn(index + 1);
    if (column.type === 'date' || column.type === 'text' || column.type === 'link' || column.type === 'choice') {
      // Text, so Excel keeps a date or a code as it's typed.
      excelColumn.numFmt = '@';
    }
    const values = listValues(column, ctx);
    if (!values.length) return;
    listColumn += 1;
    const letter = columnLetter(listColumn);
    lists.getCell(1, listColumn).value = headers.get(column.key)!;
    values.forEach((value, at) => (lists.getCell(at + 2, listColumn).value = value));
    lists.getColumn(listColumn).width = Math.min(40, Math.max(14, headers.get(column.key)!.length + 2));
    const range = `Lists!$${letter}$2:$${letter}$${values.length + 1}`;
    for (let row = 2; row <= TEMPLATE_ROWS + 1; row += 1) {
      data.getCell(row, index + 1).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [range],
        showErrorMessage: column.type !== 'link',
        errorStyle: 'warning',
        errorTitle: 'Not in the list',
        error: 'Pick a value from the list.',
      };
    }
  });
  if (listColumn) styleHeader(lists);

  const instructions = book.addWorksheet('Instructions');
  instructions.columns = [
    { header: 'Column', width: 42 },
    { header: 'How to fill it in', width: 110 },
  ];
  instructions.addRow([
    sheet.title,
    `Enter one record per row on the Data sheet (up to ${MAX_IMPORT_ROWS}). Keep the headers in row 1. Blank rows are skipped.`,
  ]);
  instructions.addRow([
    'Importing',
    'In UKMAC Monitoring, open the table and choose Import Excel. You see every row before anything is saved, and you can undo an import.',
  ]);
  for (const column of columns) instructions.addRow([headers.get(column.key)!, describe(column, ctx)]);
  const worked = sheet.columns.filter((column) => column.type === 'formula');
  if (worked.length) {
    instructions.addRow([
      'Worked out by the app',
      `Not in the template, the app works them out: ${worked.map((column) => columnLabel(column)).join(', ')}.`,
    ]);
  }
  styleHeader(instructions);
  instructions.getColumn(2).alignment = { wrapText: true, vertical: 'top' };

  return book.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

// ---------------------------------------------------------------- import

export interface ImportCellError {
  key: string;
  header: string;
  message: string;
}

export interface ImportRow {
  rowNumber: number;
  cells: Cells;
  errors: ImportCellError[];
}

/** How many different values of a column of the file are shown, to tell it from another by. */
const PEEK_VALUES = 6;
/** How far down a column of the file is looked for them. */
const PEEK_ROWS = 100;

export interface FileColumn {
  /** The worksheet column, 1-based. */
  position: number;
  header: string;
  /** The first value under it. */
  sample: string;
  /** The first different values under it, each with the worksheet row it's on. */
  values: { row: number; text: string }[];
  /** The stage it is in (a file laid out in stages, each begun by a column headed "Stage 3_"): 1–10, 0 for the row's own columns and for a file with none. */
  stage: number;
  /** The header's text on each row that names the columns (the stage's banner, the group, the field). */
  parts: string[];
}

export interface ImportPreview {
  fileName: string;
  sheetName: string;
  /** The row the names start on. */
  headerRow: number;
  /** Where the names and the data are, as read. */
  layout: FileLayout;
  /** Where they were found to be before the person said (the layout to go back to). */
  detected: FileLayout;
  /** The file's first rows as they are, to say where the names and the data are from. */
  peek: FilePeek;
  /** The headers Sync reads this tab by with this layout, and the worksheet column each is in (what a connected table remembers). */
  sync: { headers: string[]; positions: number[] };
  /** Names the file has more than once, which fill a column already filled by the first of them: left out. */
  repeated: string[];
  /** The table's columns found in the file, in the file's order. */
  matched: { key: string; header: string; fileHeader: string; /** The worksheet column (1-based) that fills it. */ position: number }[];
  /** Every column of the file's header row, with the first value under it: what can be matched. */
  fileColumns: FileColumn[];
  /** Headers in the file the table hasn't: left out. */
  unknownHeaders: string[];
  /** The table's columns the file hasn't: left blank. */
  missing: Column[];
  /** Of those, the ones every row needs: the rows are still read and shown, each marked for it. */
  missingRequired: { key: string; header: string }[];
  /** Formula columns the file has: worked out by the app instead. */
  workedOut: string[];
  rows: ImportRow[];
  /** Problems with the whole file. */
  issues: string[];
  /** A link column's values not in its table yet, by column key. */
  missingLinks: { column: Column; header: string; values: string[] }[];
  errorRows: number;
}

class ImportError extends Error {}

function textOf(value: ExcelJS.CellValue, column: Column | undefined, date1904: boolean): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') {
    if (column?.type === 'date') return excelSerialToIso(value, date1904) ?? String(value);
    return String(Number(value.toPrecision(15)));
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return '';
    // exceljs gives an Excel date as that day's midnight, UTC.
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((part) => part.text).join('').trim();
    if ('error' in value) throw new ImportError(`Excel shows ${value.error} here`);
    if ('result' in value) {
      const result = (value as { result?: ExcelJS.CellValue }).result;
      return result === undefined ? '' : textOf(result as ExcelJS.CellValue, column, date1904);
    }
    if ('text' in value) return String((value as { text: unknown }).text ?? '').trim();
  }
  return String(value).trim();
}

/** Reads an .xlsx file's rows into the table's columns, checking each value. Nothing is saved. */
export async function readImport(
  bytes: ArrayBuffer,
  fileName: string,
  sheet: Sheet,
  ctx: TemplateContext,
  options: {
    /** The tab to read (a Google Sheet's tab the user picked); else "Data", else the first with rows. */
    tab?: string;
    /** The user's own matches: table column key → the worksheet column (1-based) that fills it. The
     * file's names aren't used then; a column not matched here is left out, whatever it's called. */
    columns?: Record<string, number>;
    /** The row the names are found on, when the reader of the source already knows it (a Google tab's): the guess starts from it. */
    headerRow?: number;
    /** Where the names and the data are, once the person has said (or it was read before): used as it is, not guessed. */
    layout?: FileLayout;
  } = {},
): Promise<ImportPreview> {
  if (!/\.xlsx$/i.test(fileName)) throw new Error('Choose an .xlsx workbook. Save an older .xls file as .xlsx first.');
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('Keep the workbook under 15 MB.');
  const Excel = await loadExcel();
  const book = new Excel.Workbook();
  try {
    await book.xlsx.load(bytes);
  } catch {
    throw new Error("This workbook can't be read. Use an .xlsx file that isn't password-protected.");
  }
  const date1904 = Boolean((book.properties as { date1904?: boolean }).date1904);
  const worksheet = options.tab
    ? book.worksheets.find((ws) => ws.name === options.tab)
    : (book.worksheets.find((ws) => ws.name.trim().toLowerCase() === 'data') ??
      book.worksheets.find((ws) => ws.state !== 'hidden' && ws.actualRowCount > 0));
  if (!worksheet) throw new Error(options.tab ? `The tab “${options.tab}” isn't in the workbook.` : 'The workbook has no sheet with data.');

  const headers = excelHeaders(sheet.columns);
  const entry = sheet.columns.filter(isEntryColumn);
  // Each name a column answers to → its column (names two columns share don't count).
  const byAlias = new Map<string, Column | null>();
  for (const column of entry) {
    for (const alias of headerAliases(column, headers.get(column.key)!)) {
      byAlias.set(alias, byAlias.has(alias) && byAlias.get(alias)?.key !== column.key ? null : column);
    }
  }
  // A column's own template header is always its (they're never shared).
  for (const column of entry) byAlias.set(normalizeHeader(headers.get(column.key)!), column);
  const formulaNames = new Set(
    sheet.columns
      .filter((column) => column.type === 'formula')
      .flatMap((column) => [column.name, columnLabel(column), column.box ? `${column.box} · ${columnLabel(column)}` : ''])
      .filter(Boolean)
      .map(normalizeHeader),
  );

  // The row the names are found on: the one the source said, else of the first 10 the one naming the most columns.
  let headerRow = options.headerRow ?? 1;
  if (!options.headerRow) {
    let best = -1;
    let firstWide = 0;
    for (let at = 1; at <= Math.min(10, worksheet.rowCount); at += 1) {
      let found = 0;
      let filled = 0;
      worksheet.getRow(at).eachCell((cell) => {
        filled += 1;
        try {
          if (byAlias.get(normalizeHeader(textOf(cell.value, undefined, date1904)))) found += 1;
        } catch {
          /* an error cell isn't a header */
        }
      });
      if (filled >= 2 && !firstWide) firstWide = at;
      if (found > best) {
        best = found;
        headerRow = at;
      }
    }
    // No row names any column (the user matches them by hand): the first with two or more filled cells, as a new table's reader takes.
    if (best <= 0 && firstWide) headerRow = firstWide;
  }
  // A row of group names merged over the names (or the names merged down) makes the names take two rows.
  const merges = mergesOf(worksheet);
  const width = usedColumns(worksheet);
  const detected = fixLayout(withGroupRow(merges, headerRow, width), worksheet.rowCount);
  const layout = options.layout ? fixLayout(options.layout, worksheet.rowCount) : detected;
  headerRow = layout.headerFrom;

  const issues: string[] = [];
  const matched: ImportPreview['matched'] = [];
  const unknownHeaders: string[] = [];
  const repeated: string[] = [];
  const workedOut: string[] = [];
  const columnAt = new Map<number, Column>();
  const fileColumns: FileColumn[] = [];
  const badHeaders = new Set<number>();
  const named = headerNames(
    (row, column) => {
      try {
        return textOf(worksheet.getCell(row, column).value, undefined, date1904);
      } catch {
        badHeaders.add(column);
        return '';
      }
    },
    layout,
    width,
  );
  for (const column of badHeaders) issues.push(`Header in column ${column}: use plain text.`);
  // The stage of each column is read from every row above the data, whichever rows are chosen to name the columns.
  const above = (row: number, column: number) => {
    try {
      return textOf(worksheet.getCell(row, column).value, undefined, date1904);
    } catch {
      return '';
    }
  };
  const stages = stageOfColumns(above, layout.dataFrom - 1, width);
  for (const { position, name, parts } of named) fileColumns.push({ position, header: name, sample: '', values: [], stage: stages[position] ?? 0, parts });

  /** The table column a file column's name is found for, if any: by name, the user's matches being none. */
  const taken = new Set<string>();
  const place = (position: number, text: string, column: Column) => {
    taken.add(column.key);
    columnAt.set(position, column);
    matched.push({ key: column.key, header: headers.get(column.key)!, fileHeader: text, position });
  };
  if (options.columns) {
    for (const { position, name } of named) {
      const key = Object.keys(options.columns).find((item) => options.columns![item] === position);
      const mine = key ? entry.find((item) => item.key === key) : undefined;
      if (mine) place(position, name, mine);
      else unknownHeaders.push(name);
    }
  } else {
    // A name the table has a column for, else (for a group's name over a column's) the column's own name under the group,
    // when that's the only column of the file called so. A column two file columns would fill is filled by the first.
    const rest: typeof named = [];
    for (const item of named) {
      const column = byAlias.get(normalizeHeader(item.name));
      if (!column) rest.push(item);
      else if (taken.has(column.key)) {
        unknownHeaders.push(item.name);
        repeated.push(item.name);
      } else place(item.position, item.name, column);
    }
    // A file laid out in stages (a banner, a group, a field over each column): by stage, group and field, taking each
    // pair only when it can be no other. Before the own-name guess below, which doesn't know the stage.
    const byStage =
      layout.headerTo > layout.headerFrom
        ? matchByStage(
            rest.map((item) => ({ position: item.position, stage: stages[item.position] ?? 0, group: item.parts.at(-2) ?? '', field: item.parts.at(-1) ?? '' })),
            entry,
            taken,
          )
        : new Map<number, Column>();
    for (const item of rest) {
      const column = byStage.get(item.position);
      if (column && !taken.has(column.key)) place(item.position, item.name, column);
    }
    const left = rest.filter((item) => !byStage.has(item.position));
    const ownCount = new Map<string, number>();
    for (const item of left) ownCount.set(normalizeHeader(ownName(item.name)), (ownCount.get(normalizeHeader(ownName(item.name))) ?? 0) + 1);
    for (const item of left) {
      const own = normalizeHeader(ownName(item.name));
      const column = item.name.includes(PATH_SEPARATOR) && ownCount.get(own) === 1 ? byAlias.get(own) : undefined;
      if (column && !taken.has(column.key)) place(item.position, item.name, column);
      else if (formulaNames.has(normalizeHeader(item.name))) workedOut.push(item.name);
      else unknownHeaders.push(item.name);
    }
  }
  matched.sort((a, b) => a.position - b.position);
  // What each column of the file holds, as its first different values (for the user to match by).
  const cellAt = (row: number, column: number) => {
    try {
      return textOf(worksheet.getCell(row, column).value, undefined, date1904);
    } catch {
      return '';
    }
  };
  for (const column of fileColumns) {
    for (let at = layout.dataFrom; at <= Math.min(worksheet.rowCount, layout.dataFrom + PEEK_ROWS) && column.values.length < PEEK_VALUES; at += 1) {
      const text = cellAt(at, column.position);
      if (text && !column.values.some((value) => value.text === text)) column.values.push({ row: at, text });
    }
    column.sample = column.values[0]?.text ?? '';
  }
  if (!matched.length) {
    issues.push(
      options.columns
        ? 'Match at least one column of the file to a column of the table.'
        : `No column of ${sheet.title} was found in “${worksheet.name}”. Match the columns by hand above, or download the table's Excel template and use its headers.`,
    );
  }
  const missing = entry.filter((column) => !matched.some((item) => item.key === column.key));
  // A required column the file hasn't doesn't stop the import: the rows are still read and shown,
  // each marked as needing it, and the user chooses whether to bring them in.
  const missingRequired = missing.filter((item) => item.required).map((column) => ({ key: column.key, header: headers.get(column.key)! }));

  const linkOptions = new Map<string, string[]>();
  for (const column of entry.filter((item) => item.type === 'link')) linkOptions.set(column.key, ctx.linkOptions(column));
  const missingLinks = new Map<string, Set<string>>();

  const rows: ImportRow[] = [];
  if (!issues.length) {
    for (let at = layout.dataFrom; at <= worksheet.rowCount; at += 1) {
      const excelRow = worksheet.getRow(at);
      if (!excelRow.hasValues) continue;
      const cells: Cells = {};
      const errors: ImportCellError[] = [];
      let filled = false;
      for (const [index, column] of columnAt) {
        const header = headers.get(column.key)!;
        let text = '';
        try {
          text = textOf(excelRow.getCell(index).value, column, date1904);
        } catch (error) {
          errors.push({ key: column.key, header, message: (error as Error).message });
          continue;
        }
        if (!text) continue;
        filled = true;
        const checked = checkCell(column, text, linkOptions.get(column.key));
        cells[column.key] = checked.value;
        if (checked.error) {
          errors.push({ key: column.key, header, message: checked.error });
          if (column.type === 'link') {
            const set = missingLinks.get(column.key) ?? new Set<string>();
            set.add(checked.value);
            missingLinks.set(column.key, set);
          }
        }
      }
      if (!filled) continue;
      for (const column of entry) {
        if (column.required && !cells[column.key] && !errors.some((error) => error.key === column.key)) {
          errors.push({ key: column.key, header: headers.get(column.key)!, message: 'This column needs a value' });
        }
      }
      rows.push({ rowNumber: at, cells, errors });
      if (rows.length > MAX_IMPORT_ROWS) {
        issues.push(`Import at most ${MAX_IMPORT_ROWS} rows at a time. Split the file and import each part.`);
        break;
      }
    }
    if (!rows.length && !issues.length) {
      issues.push(`“${worksheet.name}” has no rows under its headers. Fill in at least one row.`);
    }
  }

  return {
    fileName,
    sheetName: worksheet.name,
    headerRow,
    layout,
    detected,
    peek: peekOf(worksheet, cellAt, merges),
    sync: syncHeaders(worksheet, layout, date1904),
    repeated,
    matched,
    fileColumns,
    unknownHeaders,
    missing,
    missingRequired,
    workedOut,
    rows,
    issues,
    missingLinks: [...missingLinks.entries()].map(([key, values]) => {
      const column = entry.find((item) => item.key === key)!;
      return { column, header: headers.get(key)!, values: [...values] };
    }),
    errorRows: rows.filter((row) => row.errors.length).length,
  };
}
