import type { CellChange, SheetWithRows } from '../core/models';
import { formatOutline, type Usage, type ZoneCell } from './zone-layout';

/** What the Plot form holds. Strings, as the Zones table keeps them (numbers too: "9"). */
export interface PlotForm {
  zone: string;
  section: string;
  row: string;
  column: string;
  usage: Usage;
  /** A not-used plot's or water's own name ("Pond", "Forest"). */
  statusName: string;
  capacity: string;
  note: string;
}

/** The words the Zones table already holds for a plot's use (the system's own). */
const STATUS_WORD: Record<Usage, string> = { normal: 'Active', unused: 'Unused', water: 'Water' };

export function formOf(cell: ZoneCell, statusName: string): PlotForm {
  return {
    zone: cell.zone,
    section: cell.section === null ? '' : String(cell.section),
    row: String(cell.row),
    column: String(cell.column),
    usage: cell.usage,
    statusName,
    capacity: cell.capacity,
    note: cell.note,
  };
}

function keyOf(sheet: SheetWithRows, name: string): string | null {
  return sheet.columns.find((column) => column.name.toLowerCase() === name.toLowerCase())?.key ?? null;
}

function textOf(sheet: SheetWithRows, rowId: number, name: string): string {
  const key = keyOf(sheet, name);
  const row = sheet.rows.find((item) => item.rowId === rowId);
  const value = key && row ? row.data[key] : undefined;
  return value === undefined || value === null ? '' : String(value).trim();
}

/** The plot's Status name as it is in the table (the layout only shows it as the plot's label). */
export function statusNameOf(sheet: SheetWithRows, rowId: number) {
  return textOf(sheet, rowId, 'Status name');
}

/** Only what changed, by column name (never a fixed key), as cell edits for one row. */
export function plotChanges(sheet: SheetWithRows, rowId: number, form: PlotForm): CellChange[] {
  const wanted: [string, string][] = [
    ['Zone', form.zone],
    ['Zone number', form.section],
    ['Row', form.row],
    ['Column', form.column],
    ['Plot status', STATUS_WORD[form.usage]],
    // A plot in use has no name of its own: the label is its code.
    ['Status name', form.usage === 'normal' ? '' : form.statusName],
    ['Plant capacity', form.capacity],
    ['Note', form.note],
  ];
  const changes: CellChange[] = [];
  for (const [name, value] of wanted) {
    const key = keyOf(sheet, name);
    if (!key) continue;
    const next = value.trim();
    if (next !== textOf(sheet, rowId, name)) changes.push({ rowId, key, value: next || null });
  }
  return changes;
}

/** The form's problems that stop a save (a Zone and a Row and Column that are real). */
export function formProblem(form: PlotForm): string | null {
  if (!form.zone.trim()) return 'Give the zone a name.';
  for (const [label, text] of [['Row', form.row], ['Column', form.column]] as const) {
    const n = Number(text);
    if (!text.trim() || !Number.isInteger(n) || n < 1) return `${label} must be a whole number, 1 or more.`;
  }
  if (form.section.trim() && !Number.isFinite(Number(form.section))) return 'Zone number must be a number.';
  if (form.capacity.trim() && !(Number(form.capacity) >= 0)) return 'Plant capacity must be a number.';
  return null;
}

/** Another plot already at this row and column of the same zone and zone number (the Farm view stacks by them): its code, or null. */
export function placeTakenBy(cells: ZoneCell[], self: ZoneCell, form: PlotForm): string | null {
  const section = form.section.trim() ? Number(form.section) : null;
  const other = cells.find(
    (cell) =>
      cell.id !== self.id &&
      cell.zone.trim().toLowerCase() === form.zone.trim().toLowerCase() &&
      cell.section === section &&
      cell.row === Number(form.row) &&
      cell.column === Number(form.column),
  );
  return other ? other.plot || other.label : null;
}

/** The outline edits of reshaped plots, one change each, ready for one save. */
export function outlineChanges(sheet: SheetWithRows, shapes: Record<string, [number, number][]>): CellChange[] {
  const key = keyOf(sheet, 'Outline');
  if (!key) return [];
  const changes: CellChange[] = [];
  for (const [id, points] of Object.entries(shapes)) {
    const rowId = Number(id);
    const value = formatOutline(points);
    if (value !== textOf(sheet, rowId, 'Outline')) changes.push({ rowId, key, value });
  }
  return changes;
}

/** Undo and redo of reshaping: each step is every plot's changed outline at that moment. */
export class ReshapeHistory {
  private past: Record<string, [number, number][]>[] = [{}];
  private at = 0;

  get now() {
    return this.past[this.at];
  }
  get canUndo() {
    return this.at > 0;
  }
  get canRedo() {
    return this.at < this.past.length - 1;
  }
  get changed() {
    return Object.keys(this.now).length > 0;
  }
  /** A plot's new outline. */
  push(id: string, points: [number, number][]) {
    this.past = [...this.past.slice(0, this.at + 1), { ...this.now, [id]: points }];
    this.at++;
  }
  /** Back to the start (a new editing session). */
  reset() {
    this.past = [{}];
    this.at = 0;
  }
  undo() {
    if (this.canUndo) this.at--;
  }
  redo() {
    if (this.canRedo) this.at++;
  }
}
