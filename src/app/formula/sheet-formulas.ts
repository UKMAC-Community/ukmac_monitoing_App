import type { Column, Row, SheetWithRows } from '../core/models';
import { checkCell, columnLabel } from '../sheet/columns';
import { evaluateFormula, FormulaError, isFormulaError, type FormulaScalar } from './evaluate-formula';
import { FormulaSyntaxError, parseFormula, type FormulaNode } from './parse-formula';

const clean = (name: string | undefined | null) => (name ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** A kept cell as a formula reads it: a number, Yes/No, text, or blank. */
export function storedScalar(column: Column, raw: string | undefined): FormulaScalar {
  if (raw === undefined || raw === '') return null;
  switch (column.type) {
    case 'number':
    case 'percentage': {
      const value = Number(raw);
      return Number.isFinite(value) ? value : raw;
    }
    case 'yesno':
      return raw === 'true';
    default:
      return raw;
  }
}

/**
 * Formula columns worked out over a MAC's tables: a row's own columns by
 * name — `[Live plant]`, or with its box (and group) in front where boxes
 * share a name, `[2 · Establishment (7 DAT) › Date]` — and another table's
 * whole column for LOOKUP, SUMIF and the rest: `'Zones'[Plant capacity]`.
 *
 * A formula can use another formula column (each worked out once); one
 * that leads back to itself is #CYCLE!. Made again whenever the data
 * changes, so nothing goes stale.
 */
export class WorkbookFormulas {
  private readonly cache = new Map<string, FormulaScalar>();
  private readonly columnCache = new Map<string, FormulaScalar[] | FormulaError>();
  private readonly trees = new Map<string, FormulaNode | FormulaSyntaxError>();
  private readonly visiting = new Set<string>();
  private readonly byName = new Map<string, SheetWithRows>();

  constructor(
    readonly sheets: readonly SheetWithRows[],
    private readonly today: string,
  ) {
    for (const sheet of sheets) this.byName.set(clean(sheet.title), sheet);
  }

  table(name: string) {
    return this.byName.get(clean(name));
  }

  /** A formula column's value on one of `sheet`'s rows. */
  value(sheet: SheetWithRows, row: Row, column: Column): FormulaScalar {
    const key = `${sheet.sheetId}:${row.rowId}:${column.key}`;
    const known = this.cache.get(key);
    if (known !== undefined) return known;
    if (this.visiting.has(key)) return new FormulaError('#CYCLE!', `${column.name} leads back to itself`);
    const tree = this.tree(column.formula ?? '');
    if (tree instanceof FormulaSyntaxError) return new FormulaError('#NAME?', tree.message);
    this.visiting.add(key);
    try {
      const value = evaluateFormula(tree, {
        column: (name) => this.rowValue(sheet, row, name, column),
        tableColumn: (table, name) => this.tableColumn(table, name),
        today: this.today,
      });
      this.cache.set(key, value);
      return value;
    } finally {
      this.visiting.delete(key);
    }
  }

  /** Any column's value on a row, as a formula sees it. */
  cell(sheet: SheetWithRows, row: Row, column: Column): FormulaScalar {
    return column.type === 'formula' ? this.value(sheet, row, column) : storedScalar(column, row.data[column.key]);
  }

  /** What's wrong with a cell: a formula's error, or a value that doesn't fit its column (null: nothing). */
  problem(sheet: SheetWithRows, row: Row, column: Column, linkOptions: readonly string[] = []): string | null {
    if (column.type === 'formula') {
      const value = this.value(sheet, row, column);
      return isFormulaError(value) ? value.reason : null;
    }
    const value = row.data[column.key];
    if (!value) return null;
    return checkCell(column, value, linkOptions).error ?? null;
  }

  /** What's wrong with a formula as written (null: nothing). */
  check(formula: string): string | null {
    const tree = this.tree(formula);
    return tree instanceof FormulaSyntaxError ? tree.message : null;
  }

  private tree(formula: string) {
    let tree = this.trees.get(formula);
    if (!tree) {
      try {
        tree = parseFormula(formula);
      } catch (error) {
        tree = error instanceof FormulaSyntaxError ? error : new FormulaSyntaxError("This formula can't be read", 0);
      }
      this.trees.set(formula, tree);
    }
    return tree;
  }

  /** Each table's columns' names as found (the same name read again for every row). */
  private readonly resolved = new WeakMap<readonly Column[], Map<string, Column | null>>();

  /** The column `name` means, from `from`'s formula. */
  resolve(columns: readonly Column[], name: string, from?: Column): Column | null {
    let known = this.resolved.get(columns);
    if (!known) this.resolved.set(columns, (known = new Map()));
    const key = `${from?.key ?? ''}\u0000${from?.box ?? ''}\u0000${name}`;
    if (known.has(key)) return known.get(key)!;
    const found = this.find(columns, name, from);
    known.set(key, found);
    return found;
  }

  private find(columns: readonly Column[], name: string, from?: Column): Column | null {
    const parts = name.split(/\s*›\s*/);
    const qualified = parts.length > 1;
    const wanted = clean(parts.at(-1));
    const box = qualified ? clean(parts[0]) : '';
    const group = parts.length > 2 ? clean(parts[1]) : '';
    const candidates = columns.filter(
      (column) =>
        column.key !== from?.key &&
        (clean(column.name) === wanted || clean(columnLabel(column)) === wanted) &&
        (!qualified || (clean(column.box) === box && (!group || clean(column.group) === group))),
    );
    if (candidates.length <= 1) return candidates[0] ?? null;
    // A name several boxes share, alone: the row's own column (no box) —
    // the row's Date, not one stage's — then the formula's own box's.
    return (
      candidates.find((column) => !column.box) ??
      candidates.find((column) => from?.box && clean(column.box) === clean(from.box)) ??
      candidates.find((column) => column.type !== 'formula') ??
      candidates[0]
    );
  }

  private rowValue(sheet: SheetWithRows, row: Row, name: string, from: Column): FormulaScalar {
    const column = this.resolve(sheet.columns, name, from);
    if (!column) return new FormulaError('#NAME?', `No column “${name}” in ${sheet.title}`);
    return this.cell(sheet, row, column);
  }

  /** Every row's value of a table's column (formula ones worked out). */
  tableColumn(tableName: string, name: string): FormulaScalar[] | FormulaError {
    const key = `${clean(tableName)}\u0000${clean(name)}`;
    const known = this.columnCache.get(key);
    if (known) return known;
    const sheet = this.table(tableName);
    if (!sheet) return new FormulaError('#REF!', `No table “${tableName}”`);
    const column = this.resolve(sheet.columns, name);
    if (!column) return new FormulaError('#REF!', `No column “${name}” in ${sheet.title}`);
    const values = sheet.rows.map((row) => this.cell(sheet, row, column));
    this.columnCache.set(key, values);
    return values;
  }

  /** The values a link column picks from: its source column's, each once. */
  linkOptions(source: { table: string; column: string } | null): string[] {
    if (!source) return [];
    const values = this.tableColumn(source.table, source.column);
    if (isFormulaError(values)) return [];
    const seen = new Set<string>();
    const options: string[] = [];
    for (const value of values) {
      if (value === null || value === '' || isFormulaError(value)) continue;
      const text = String(value).trim();
      const key = text.toLowerCase();
      if (text && !seen.has(key)) {
        seen.add(key);
        options.push(text);
      }
    }
    return options;
  }
}
