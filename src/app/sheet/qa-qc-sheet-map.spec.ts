import type { Column } from '../core/models';
import columns from './fixtures/qa-qc-columns.json';
import map from './fixtures/qa-qc-sheet-map.json';
import { expectedColumn, PLANT_GROUPS, type SheetColumn } from './qa-qc-sheet-map.testing';

/**
 * The QA/QC template against the old QA QC sheet's own column map (A–KV, saved in fixtures/qa-qc-sheet-map.json as
 * it was given): every column of the sheet has its place in the table, with the type, the unit and the limits it has.
 */
const template = columns as Column[];
const sheet = map as SheetColumn[];

const here = (row: SheetColumn) => expectedColumn(row, template);

describe('the QA/QC template against the old sheet\'s column map', () => {
  it('has the 287 columns of the map, as saved', () => {
    expect(sheet).toHaveLength(287);
    expect(sheet.at(0)?.column).toBe('A');
    expect(sheet.at(-1)).toMatchObject({ column: 'KV', n: '308', field: 'Notes' });
    // 180 plants' columns: nine measures, 20 plants each.
    expect(sheet.filter((row) => /^(P#\d+|\d+[AB])$/.test(row.field))).toHaveLength(180);
  });

  it('has a column for every column of the sheet', () => {
    const missing = sheet.filter((row) => !here(row)).map((row) => `${row.column}: ${row.stage} › ${row.group} › ${row.field}`);
    expect(missing).toEqual([]);
  });

  it('gives each sheet column its own table column, and the type it is: dates, counts and measures, percentages, text', () => {
    const used = new Set<string>();
    for (const row of sheet) {
      const column = here(row)!;
      expect(used.has(column.key), `${row.column} shares ${column.key}`).toBe(false);
      used.add(column.key);
      const label = `${row.column} ${row.field}`;
      if (row.type === 'date') expect(column.type, label).toBe('date');
      else if (row.type === 'decimal %') expect(column.type, label).toBe('percentage');
      else if (row.type === 'text → FK block') expect(column.type, label).toBe('link');
      else if (row.type === 'text') expect(column.type, label).toBe('text');
      // The sheet's own totals are worked out here: the dead plants from the live ones, the rejected kilos from the six reasons.
      else if (row.field === 'Dead Plant' || row.field === 'Total (kg)') expect(column.type, label).toBe('formula');
      else expect(column.type, label).toBe('number');
    }
    expect(used.size).toBe(287);
  });

  it('gives the units and the limits the sheet\'s types say', () => {
    for (const row of sheet) {
      const column = here(row)!;
      const label = `${row.column} ${row.field}`;
      if (row.type === 'decimal cm') expect(column.unit, label).toBe('cm');
      if (row.type === 'decimal kg/plant') expect(column.unit, label).toBe('kg/plant');
      if (row.type === 'int 1–5') expect([column.min, column.max], label).toEqual([1, 5]);
      if (row.type === 'decimal %') expect([column.min, column.max], label).toEqual([0, 100]);
      if (/^(int|decimal)/.test(row.type) && row.type !== 'int 1–5' && row.type !== 'decimal %' && column.type === 'number') {
        expect(column.min, label).toBe(0);
      }
    }
  });

  it('shows each stage as the sheet does: the date first, then each group with its plants, named as in the sheet', () => {
    // Stage 3 in the sheet (the user's picture): "30 DAT Vegetative", then "Plant Vigor Score" over P#1…P#20.
    const stage3 = template.filter((column) => column.box?.startsWith('3 ·'));
    expect(stage3.slice(0, 4).map((column) => [column.group ?? '', column.name])).toEqual([['', '30 DAT Vegetative'], ['Plant Vigor Score (1–5)', 'P#1'], ['Plant Vigor Score (1–5)', 'P#2'], ['Plant Vigor Score (1–5)', 'P#3']]);
    expect(stage3.some((column) => column.group === 'Plant average')).toBe(false);
    expect(stage3.some((column) => column.name === 'Days after transplant')).toBe(false);
  });

  it('keeps each measure\'s 20 plants together, in order, in their stage', () => {
    for (const group of PLANT_GROUPS) {
      const rows = sheet.filter((row) => row.group === group);
      expect(rows, group).toHaveLength(20);
      const at = rows.map((row) => template.indexOf(here(row)!));
      expect(at, group).toEqual(Array.from({ length: 20 }, (_, index) => at[0] + index));
    }
  });
});
