import type { Column, ColumnType } from '../core/models';

/** Between a box's, a group's and a column's names in a formula: `[2 · Establishment (7 DAT) › Date]`. */
export const PATH_SEPARATOR = ' › ';

export const COLUMN_TYPES: { value: ColumnType; label: string; hint: string }[] = [
  { value: 'text', label: 'Text', hint: 'Any words or codes' },
  { value: 'number', label: 'Number', hint: 'A count, a weight, a size…' },
  { value: 'percentage', label: 'Percent (%)', hint: 'A number out of 100' },
  { value: 'date', label: 'Date', hint: 'A day: shown 16/06/2026' },
  { value: 'choice', label: 'Choice list', hint: 'One of the values you list' },
  { value: 'yesno', label: 'Yes / No', hint: 'Yes or No' },
  { value: 'link', label: 'Pick from a table', hint: "A value from another table's column, e.g. a Zone's Plot" },
  { value: 'formula', label: 'Formula', hint: 'Worked out from the other columns, like Excel' },
];

export function typeLabel(type: ColumnType) {
  return COLUMN_TYPES.find((item) => item.value === type)?.label ?? type;
}

const clean = (text: string | undefined | null) => (text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** The unit to show after a column's name — none when the name ends with it already. */
export function shownUnit(name: string, unit?: string | null): string {
  const text = unit?.trim() ?? '';
  if (!text) return '';
  return name.trim().toLowerCase().endsWith(`(${text.toLowerCase()})`) ? '' : text;
}

/** A column's name with its unit: "Plant height (cm)". */
export function columnLabel(column: Pick<Column, 'name' | 'unit'>) {
  const unit = shownUnit(column.name, column.unit);
  return unit ? `${column.name} (${unit})` : column.name;
}

/** Whether a column is typed in (and imported): every one but a formula. */
/** A column a person fills in: not a worked-out formula, not an ID the app numbers. */
export const isEntryColumn = (column: Column) => column.type !== 'formula' && !column.auto;

export function hasBoxes(columns: Column[]) {
  return new Set(columns.map((column) => column.box?.trim()).filter(Boolean)).size > 1;
}

/**
 * Each typed-in column's Excel header, as the server's Excel template writes
 * them: its name (and unit); in a table of several boxes, its box in front
 * ("1 · Transplant (0 DAT) · 4–5, good"); a header two columns would share,
 * the column's key after it.
 */
export function excelHeaders(columns: Column[]): Map<string, string> {
  const entry = columns.filter(isEntryColumn);
  const several = hasBoxes(columns);
  const base = entry.map((column) => {
    const label = columnLabel(column);
    return several && column.box ? `${column.box} · ${label}` : label;
  });
  const headers = new Map<string, string>();
  entry.forEach((column, index) => {
    const header = base[index];
    const shared = base.filter((other) => clean(other) === clean(header)).length > 1;
    headers.set(column.key, shared ? `${header} (${column.key})` : header);
  });
  return headers;
}

/** Every header a column is known by on import (its Excel header first), normalized. */
export function headerAliases(column: Column, header: string): string[] {
  const label = columnLabel(column);
  const names = [header, label, column.name, `${label} (${column.key})`, `${column.name} (${column.key})`, ...(column.aliases ?? [])];
  if (column.box) {
    names.push(
      `${column.box} · ${label}`,
      `${column.box} · ${column.name}`,
      `${column.box}${PATH_SEPARATOR}${label}`,
      `${column.box}${PATH_SEPARATOR}${column.name}`,
    );
    if (column.group) {
      names.push(`${column.box}${PATH_SEPARATOR}${column.group}${PATH_SEPARATOR}${column.name}`);
    }
  }
  return [...new Set(names.map(normalizeHeader))];
}

export function normalizeHeader(value: string) {
  return value
    .replace(/^﻿/, '')
    .replace(/\s*›\s*/g, ' › ')
    .replace(/\s*·\s*/g, ' · ')
    .trim()
    .replace(/\s*\*+$/, '') // a required marker ("Variety name *") isn't part of the name
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

// --------------------------------------------------------------- links

/** `'Zones'[Plot]` (or `Zones[Plot]`) as its table and column. */
export function parseLinkSource(source: string | undefined | null): { table: string; column: string } | null {
  const text = (source ?? '').trim();
  const quoted = /^'((?:[^']|'')+)'\s*\[([^\]]+)\]$/.exec(text);
  if (quoted) return { table: quoted[1].replace(/''/g, "'").trim(), column: quoted[2].trim() };
  const bare = /^([A-Za-z0-9_\u0080-￿]+)\s*\[([^\]]+)\]$/.exec(text);
  return bare ? { table: bare[1], column: bare[2].trim() } : null;
}

export function linkSourceText(table: string, column: string) {
  return `'${table.replace(/'/g, "''")}'[${column}]`;
}

// -------------------------------------------------------------- values

export function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const two = (n: number) => String(n).padStart(2, '0');

/** Excel's day number (1900 system) as YYYY-MM-DD. */
export function excelSerialToIso(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial)) return null;
  const whole = Math.floor(serial);
  if (whole < (date1904 ? 0 : 1) || whole > 2958465) return null;
  const adjusted = date1904 ? whole : whole - (whole > 60 ? 1 : 0);
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 31);
  const date = new Date(epoch + adjusted * 86_400_000);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

/** A date as typed or pasted — 2026-06-16, 16/06/2026, 16-6-2026, 2026/6/16 — as YYYY-MM-DD. */
export function parseDateText(text: string): string | null {
  const value = text.trim();
  if (!value) return null;
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(value);
  if (match) {
    const iso = `${match[1]}-${two(+match[2])}-${two(+match[3])}`;
    return isIsoDate(iso) ? iso : null;
  }
  // Day first, as Cambodia (and the server's sheets) write dates.
  match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(value);
  if (match) {
    const year = match[3].length === 2 ? 2000 + +match[3] : +match[3];
    const iso = `${year}-${two(+match[2])}-${two(+match[1])}`;
    return isIsoDate(iso) ? iso : null;
  }
  if (/^\d{4,6}(\.\d+)?$/.test(value)) return excelSerialToIso(Number(value));
  return null;
}

export function formatDate(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}

export function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

export interface CellCheck {
  /** The value to keep (normalized). */
  value: string;
  /** Why it doesn't fit the column (it's kept as typed). */
  error?: string;
}

/**
 * A value typed, pasted or imported for a column, as it's kept: numbers
 * without thousands' commas, dates as YYYY-MM-DD, Yes/No as true/false, a
 * choice or a link as its option's own spelling. One that doesn't fit is
 * kept as it was, with why.
 */
/** What's wrong with a number a column limits (its `min` and `max`), or nothing. */
export function rangeProblem(column: Pick<Column, 'min' | 'max'>, number: number): string | undefined {
  const { min, max } = column;
  if (min !== undefined && number < min) return max !== undefined ? `Use a number from ${min} to ${max}` : `Use ${min} or more`;
  if (max !== undefined && number > max) return min !== undefined ? `Use a number from ${min} to ${max}` : `Use ${max} or less`;
  return undefined;
}

/** A column's limits in words ("from 1 to 5", "0 or more"), or '' for none. */
export function rangeText(column: Pick<Column, 'min' | 'max'>): string {
  const { min, max } = column;
  if (min !== undefined && max !== undefined) return `from ${min} to ${max}`;
  if (min !== undefined) return `${min} or more`;
  if (max !== undefined) return `${max} or less`;
  return '';
}

export function checkCell(column: Column, raw: string, linkOptions: readonly string[] = []): CellCheck {
  const value = raw.trim();
  if (!value) return { value: '', error: column.required ? 'This column needs a value' : undefined };
  switch (column.type) {
    case 'number':
    case 'percentage': {
      let text = value.replace(/,/g, '').replace(/\s+/g, '');
      if (column.type === 'percentage') text = text.replace(/%$/, '');
      if (!NUMBER.test(text) || !Number.isFinite(Number(text))) return { value, error: 'Use a number' };
      const number = Number(text);
      const outside = rangeProblem(column, number);
      return outside ? { value: String(number), error: outside } : { value: String(number) };
    }
    case 'date': {
      const iso = parseDateText(value);
      return iso ? { value: iso } : { value, error: 'Use a date: 16/06/2026 or 2026-06-16' };
    }
    case 'yesno': {
      const text = value.toLowerCase();
      if (['yes', 'y', 'true', '1', 'ok', '✓'].includes(text)) return { value: 'true' };
      if (['no', 'n', 'false', '0'].includes(text)) return { value: 'false' };
      return { value, error: 'Use Yes or No' };
    }
    case 'choice': {
      const found = (column.options ?? []).find((option) => clean(option) === clean(value));
      return found ? { value: found } : { value, error: `Not in the list: ${(column.options ?? []).join(', ')}` };
    }
    case 'link': {
      const found = linkOptions.find((option) => clean(option) === clean(value));
      const source = parseLinkSource(column.source);
      return found
        ? { value: found }
        : { value, error: source ? `Not in ${source.table} › ${source.column}` : 'Pick a value from the linked table' };
    }
    default:
      return { value };
  }
}

/** A kept value as the sheet shows it. */
export function displayCell(column: Column, value: string | undefined): string {
  if (value === undefined || value === '') return '';
  switch (column.type) {
    case 'date':
      return isIsoDate(value) ? formatDate(value) : value;
    case 'yesno':
      return value === 'true' ? 'Yes' : value === 'false' ? 'No' : value;
    case 'percentage':
      return NUMBER.test(value) ? `${value}%` : value;
    default:
      return value;
  }
}

export function defaultWidth(column: Column) {
  if (column.width) return column.width;
  switch (column.type) {
    case 'number':
    case 'percentage':
    case 'yesno':
      return 110;
    case 'date':
      return 120;
    case 'formula':
      return 120;
    default:
      return 160;
  }
}

/** Whether a value lines up right, as numbers do in a sheet. */
export function alignsRight(column: Column) {
  // An ID the app numbers lines up left, as a label does, not right as a measure does.
  return !column.auto && (column.type === 'number' || column.type === 'percentage');
}
