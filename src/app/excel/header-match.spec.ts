import type { Column } from '../core/models';
import columns from '../sheet/fixtures/qa-qc-columns.json';
import map from '../sheet/fixtures/qa-qc-sheet-map.json';
import { expectedColumn, type SheetColumn } from '../sheet/qa-qc-sheet-map.testing';
import { stageOfColumns } from './file-layout';
import { loose, matchByStage, stageOfBox, type StagedColumn } from './header-match';
import headers from './fixtures/real-qaqc-headers.json';

/**
 * The real QA QC tab's three header rows (the user's file; no data rows), against what their own column map says each
 * column is. Wrong is worse than missing, so the test is strict about the first and reports the second.
 */
interface Header { n: number; r1: string; r2: string; r3: string }
const real = headers as Header[];
const template = columns as Column[];
const sheet = map as SheetColumn[];

const read = (row: number, column: number) => {
  const found = real.find((item) => item.n === column);
  return found ? [found.r1, found.r2, found.r3][row - 1] ?? '' : '';
};

/** The file's columns as the importer sees them: the stage by position, the group and the field from the last two header rows. */
function fileColumns(lastNameRow: 3, firstNameRow: 1 | 2): StagedColumn[] {
  const stages = stageOfColumns(read, 3, 308);
  return real.map((item) => {
    const parts = [1, 2, 3].filter((row) => row >= firstNameRow && row <= lastNameRow).map((row) => read(row, item.n).trim());
    return { position: item.n, stage: stages[item.n], group: parts.at(-2) ?? '', field: parts.at(-1) ?? '' };
  });
}

/** Where the user's map says each position goes (the table column), for the columns of stages. */
const expected = new Map(sheet.filter((row) => row.stage.startsWith('Stage')).map((row) => [Number(row.n), expectedColumn(row, template)] as const));
const SPACERS = [144, 172, 229, 237, 271];

describe('the stage of a column', () => {
  it('is carried from the column headed "Stage N_" to the next one, so a stage with no banner (6) or a different one (5) still has its columns', () => {
    const stages = stageOfColumns(read, 3, 308);
    expect([stages[1], stages[2], stages[3], stages[4], stages[17], stages[18], stages[38]]).toEqual([0, 0, 1, 1, 3, 3, 3]);
    // Stage 5's fruit block says only "Observe in 50 fruits/block"; stage 6 has no banner at all.
    expect(read(1, 169)).toBe('Observe in 50 fruits/block');
    expect(stages[169]).toBe(5);
    expect(read(1, 179)).toBe('');
    expect(stages[179]).toBe(6);
    expect(stages[300]).toBe(10);
    // "Other" ends the stages.
    expect(stages[308]).toBe(0);
  });

  it('is read from the rows above the data, not only the rows that name the columns', () => {
    const files = fileColumns(3, 2);
    expect(files.find((file) => file.position === 18)!.stage).toBe(3);
    expect(files.find((file) => file.position === 179)!.stage).toBe(6);
  });

  it('is the number a table column\'s box begins with', () => {
    expect([stageOfBox('3 · Vegetative (30 DAT)'), stageOfBox('10 · End of Cycles'), stageOfBox(undefined), stageOfBox('QC record')]).toEqual([3, 10, 0, 0]);
  });
});

describe('matching the real file\'s columns to the table by stage, group and field', () => {
  for (const [label, first] of [['names on rows 1–3', 1], ['names on rows 2–3', 2]] as const) {
    const files = fileColumns(3, first);
    const matched = matchByStage(files, template, new Set());

    it(`puts no column in the wrong place (${label})`, () => {
      const wrong = [...matched].filter(([position, column]) => expected.get(position)?.key !== column.key).map(([position, column]) => `${position} → ${column.box} › ${column.group ?? ''} › ${column.name}`);
      expect(wrong).toEqual([]);
    });

    it(`leaves the spacer columns, which hold only a banner, unmatched (${label})`, () => {
      for (const position of SPACERS) expect(matched.has(position), String(position)).toBe(false);
    });

    it(`finds every column of the stages but the two the app works out itself (${label})`, () => {
      // Dead Plant and the Rejected Total are formulas here, so a file column is never put in them.
      const missed = [...expected].filter(([position, column]) => column && !matched.has(position)).map(([position, column]) => `${position} ${column!.group ?? ''} › ${column!.name}`);
      expect(missed).toEqual(['13 Plant Survival (No.) › Dead plant', '236 Rejected (kg) › Total']);
      // 284 columns in the stages of the map, 282 matched: all but those two.
      expect(matched.size).toBe(282);
    });
  }
});

describe('the loose form of a header', () => {
  it('drops case, brackets and what is in them, dashes, underscores and punctuation, and keeps letters and digits', () => {
    expect(loose('Plant Vigor Score (1-5 Score)')).toBe('plant vigor score');
    expect(loose('Pest/Disease Status_0–70 DAT_(No. Pest/Disease per block)')).toBe('pest disease status 0 70 dat');
    expect(loose('4-5, good')).toBe('4 5 good');
    expect(loose('3, >5')).toBe('3 5');
    expect(loose('Flower\nAbortion')).toBe('flower abortion');
    expect(loose('P#12')).toBe('p#12');
    // The letter that tells canopy A from B stays.
    expect(loose('Canopy Diameter (cm) A; Widest direction')).toBe('canopy diameter a widest direction');
    expect(loose('Canopy Diameter (cm) B; Perpendicular direction')).not.toBe(loose('Canopy Diameter (cm) A; Widest direction'));
  });
});
