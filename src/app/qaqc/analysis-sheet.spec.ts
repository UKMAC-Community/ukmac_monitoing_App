import type { Cells, Column } from '../core/models';
import { formatFormulaValue } from '../formula/evaluate-formula';
import { WorkbookFormulas } from '../formula/sheet-formulas';
import qaQc from '../sheet/fixtures/qa-qc-columns.json';
import { makeSheet } from '../test-helpers';
import { type Analysis, batchSourceOf, buildAnalysis } from './analysis-sheet';

// The QA/QC columns exactly as the template makes them (a Rust test fails if this copy drifts), without the ID.
const columns = qaQc as Column[];
const keyOf = (stage: number, group: string | undefined, name: string) =>
  columns.find((column) => (column.box ?? '').startsWith(stage ? `${stage} ·` : '\u0000') === !!stage && (stage ? true : !column.box) && (column.group ?? '') === (group ?? '') && column.name === name)!.key;
const own = (name: string) => columns.find((column) => !column.box && column.name === name)!.key;

const LEAF = 'Seedling Leaf Stage (No.)';
const HEALTH = 'Seedling Health / Vigor (No.)';

/** A record as the farm's sheet has it for block A1: a stage's counts, dates and plants. */
function record(zone: string, date: string, extra: Cells = {}): Cells {
  return {
    [own('Date')]: date,
    [own('Zone')]: zone,
    [keyOf(1, undefined, '0 DAT Transplant')]: date,
    [keyOf(1, LEAF, '4–5, good')]: '18',
    [keyOf(1, LEAF, '3, >5')]: '1',
    [keyOf(1, LEAF, 'Disease')]: '1',
    [keyOf(1, HEALTH, 'Healthy')]: '18',
    [keyOf(1, HEALTH, 'Medium')]: '1',
    [keyOf(1, HEALTH, 'Wilt')]: '1',
    [keyOf(2, undefined, '7 DAT Establishment')]: '2026-05-17',
    [keyOf(2, 'Plant Survival (No.)', 'Live plant')]: '18',
    [keyOf(2, 'New Growth (No.)', 'Upright plants')]: '15',
    [keyOf(2, 'New Growth (No.)', 'Uneven / Wilt')]: '3',
    ...extra,
  };
}

const plants = (stage: number, group: string, names: string[], value: (index: number) => number): Cells =>
  Object.fromEntries(names.map((name, index) => [keyOf(stage, group, name), String(value(index))]));
const P = Array.from({ length: 20 }, (_, index) => `P#${index + 1}`);

// Plant Progress: where each plot's nursery batch is.
const progressColumns: Column[] = [
  { key: 'p1', name: 'Nursery batch', type: 'text', required: false },
  { key: 'p2', name: 'Zone plot', type: 'text', required: false },
];
const progress = makeSheet(4, 'Plant Progress', progressColumns, [{ p1: 'B1', p2: 'A1' }, { p1: 'B1', p2: 'A2' }, { p1: 'B2', p2: 'A3' }], 'zone-records');

function work(rows: Cells[]) {
  const records = makeSheet(11, 'QA/QC Management', columns, rows, 'qa-qc-management');
  const analysis = buildAnalysis(records, batchSourceOf([progress, records]));
  const formulas = new WorkbookFormulas([progress, records, analysis.sheet], '2026-11-10');
  /** What the analysis shows for a plot's row, in a stage's check ("Seedling Leaf (%)…"), by its column's header. */
  const at = (plot: string, stage: number, check: string, header: string) => {
    const row = analysis.rows.find((item) => item.data[own('Zone')] === plot)!;
    const shown = analysis.columns.find((item) => item.stage.startsWith(`Stage ${stage} `) && item.check.startsWith(check) && item.header === header);
    if (!shown) return undefined;
    return formatFormulaValue(formulas.cell(analysis.sheet, row, shown.column));
  };
  return { analysis, at, formulas };
}

describe('the QA/QC analysis, as the web has it', () => {
  const a1 = record('A1', '2026-05-10');
  const { analysis, at } = work([a1]);

  it('has every check of the web: none is left out for want of a column', () => {
    expect(analysis.skipped).toEqual([]);
    const checks = new Set(analysis.columns.filter((item) => item.check).map((item) => item.check));
    expect(checks.size).toBe(25);
  });

  it("reads the farm's block A1 as the standard does (counts 18 / 1 / 1)", () => {
    // Seedling Leaf: the biggest bucket's share, GREEN at 90%.
    expect(at('A1', 1, 'Seedling Leaf (%)', 'Value')).toBe('0.9');
    expect(at('A1', 1, 'Seedling Leaf (%)', 'Status')).toBe('GREEN');
    expect(at('A1', 1, 'Seedling Leaf (%)', 'Actual Result')).toBe('4-5 true leaves (18 plants)');
    // Seedling Health: Healthy wins.
    expect(at('A1', 1, 'Seedling Health', 'Status')).toBe('GREEN');
    expect(at('A1', 1, 'Seedling Health', 'Actual Result')).toBe('Healthy / No disease (18 plants)');
    // Plant Survival: 18 live of 18 + 2 dead = 90%, YELLOW (95% for GREEN).
    expect(at('A1', 2, 'Plant Survival', 'Value')).toBe('0.9');
    expect(at('A1', 2, 'Plant Survival', 'Status')).toBe('YELLOW');
    expect(at('A1', 2, 'Plant Survival', 'Actual Result')).toBe('90–94%');
    expect(at('A1', 2, 'Plant Survival', 'Corrective Action')).toBeUndefined();
    // New Growth counts 20 plants; 15 + 3 is not, so it stays empty as the web's does.
    expect(at('A1', 2, 'New Growth', 'Value')).toBe('');
  });

  it("shows each stage's date: the day it was seen, else the plan's (planting + its days)", () => {
    const stage = (n: number) => analysis.columns.find((item) => item.stage.startsWith(`Stage ${n} `) && item.header === 'Date');
    expect(stage(1)).toBeTruthy();
    const row = analysis.rows[0];
    const { formulas } = work([a1]);
    expect(formatFormulaValue(formulas.cell(analysis.sheet, row, stage(1)!.column))).toBe('2026-05-10');
  });

  it('plants: a plant average is the average of the sheet\'s 20 plants', () => {
    const heights = plants(3, 'Plant Height (cm)', P, (index) => 20 + (index % 2)); // 20, 21, 20, 21 … → 20.5
    const score = plants(3, 'Plant Vigor Score (1–5)', P, () => 4);
    const { at: read } = work([record('A1', '2026-05-10', { ...heights, ...score })]);
    expect(read('A1', 3, 'Plant Vigor Score', 'Value')).toBe('4');
    expect(read('A1', 3, 'Plant Vigor Score', 'Status')).toBe('GREEN');
    expect(read('A1', 3, 'Plant Vigor Score', 'Actual Result')).toBe('4.00/5 (80%)');
    // Height against the batch: only A1 is in B1 here with its own record, so 20.5 against 20.5.
    expect(read('A1', 3, 'Plant Height', 'Actual')).toBe('20.5');
    expect(read('A1', 3, 'Plant Height', 'Baseline')).toBe('20.5');
    expect(read('A1', 3, 'Plant Height', 'Deviation')).toBe('0');
    expect(read('A1', 3, 'Plant Height', 'Status')).toBe('GREEN');
  });

  it("baselines average the batch's records: A2 against A1, both in batch B1", () => {
    const tall = plants(3, 'Plant Height (cm)', P, () => 24);
    const short = plants(3, 'Plant Height (cm)', P, () => 16);
    const { at: read } = work([record('A1', '2026-05-10', tall), record('A2', '2026-05-13', short), record('A3', '2026-05-16', plants(3, 'Plant Height (cm)', P, () => 100))]);
    // B1 = A1 (24) and A2 (16): 20. A2 is 20% under: YELLOW at -20% (RED beyond).
    expect(read('A2', 3, 'Plant Height', 'Baseline')).toBe('20');
    expect(read('A2', 3, 'Plant Height', 'Deviation')).toBe('-0.2');
    expect(read('A2', 3, 'Plant Height', 'Status')).toBe('YELLOW');
    expect(read('A2', 3, 'Plant Height', 'Actual Result')).toBe('16.00 cm -4.00 cm');
    expect(read('A1', 3, 'Plant Height', 'Status')).toBe('GREEN');
    // A3 is another batch (B2): its own baseline.
    expect(read('A3', 3, 'Plant Height', 'Baseline')).toBe('100');
  });

  it('harvest: marketable share, the yield a plant from the rounds, the first harvest on time', () => {
    const marketable = {
      [keyOf(8, 'Marketable Fruit (kg)', 'Total')]: '100',
      [keyOf(8, 'Marketable Fruit (kg)', 'Marketable')]: '92',
      [keyOf(8, 'Rejected (kg)', 'Rot')]: '5',
      [keyOf(8, 'Rejected (kg)', 'Disease')]: '3',
    };
    const rounds = {
      [keyOf(10, 'Cumulative Yield', 'Total plant')]: '20',
      [keyOf(10, 'Cumulative Yield', '1st Harvest')]: '0.8',
      [keyOf(10, 'Cumulative Yield', '2nd Harvest')]: '0.75',
    };
    const timing = { [keyOf(6, undefined, 'Harvest date')]: '2026-07-24' };
    const { at: read } = work([record('A1', '2026-05-10', { ...marketable, ...rounds, ...timing })]);
    expect(read('A1', 8, 'Marketable Fruit', 'Value')).toBe('0.92');
    expect(read('A1', 8, 'Marketable Fruit', 'Status')).toBe('GREEN');
    expect(read('A1', 8, 'Marketable Fruit', 'Actual Result')).toBe('92.00/100.00 kg marketable (mostly rot)');
    // 0.8 + 0.75 kg a plant over 2 rounds: 1.55, in the 1.5–1.6 target.
    expect(read('A1', 10, 'Final Cumulative Yield', 'Value')).toBe('1.55');
    expect(read('A1', 10, 'Final Cumulative Yield', 'Status')).toBe('GREEN');
    expect(read('A1', 10, 'Final Cumulative Yield', 'Actual Result')).toBe('31.00 kg over 2 final rounds ÷ 20 plants');
    // Harvested 75 days after planting: on schedule.
    expect(read('A1', 6, '1st Harvest Trimming', 'Value')).toBe('75');
    expect(read('A1', 6, '1st Harvest Trimming', 'Status')).toBe('GREEN');
    expect(read('A1', 6, '1st Harvest Trimming', 'Corrective Action')).toBe('On Schedule');
  });

  it('pest and disease: the weeks added up, over the plants watched', () => {
    const weeks = Object.fromEntries(Array.from({ length: 21 }, (_, week) => [keyOf(9, week < 10 ? 'Pest/Disease Status 0–70 DAT (No. affected)' : 'Pest/Disease Status 0–150 DAT (No. affected)', `W${week + 1}`), week < 10 ? '2' : '3']));
    const { at: read } = work([record('A1', '2026-05-10', weeks)]);
    // Weeks 1–10: 20 of 500 = 4%, GREEN (under 5%); weeks 11–21: 33 of 550 = 6%, YELLOW.
    expect(read('A1', 9, 'Pest/Disease (W1–W10)', 'Value')).toBe('0.04');
    expect(read('A1', 9, 'Pest/Disease (W1–W10)', 'Status')).toBe('GREEN');
    expect(read('A1', 9, 'Pest/Disease (W11–W21)', 'Value')).toBe('0.06');
    expect(read('A1', 9, 'Pest/Disease (W11–W21)', 'Status')).toBe('YELLOW');
  });

  it("shows each plot's latest record only, in plot order", () => {
    const { analysis: built } = work([record('B1', '2026-05-28'), record('A2', '2026-05-13'), record('A2', '2026-06-01'), record('A10', '2026-05-01'), record('A2', '2026-05-20')]);
    expect(built.rows.map((row) => [row.data[own('Zone')], row.data[own('Date')]])).toEqual([
      ['A2', '2026-06-01'],
      ['A10', '2026-05-01'],
      ['B1', '2026-05-28'],
    ]);
  });

  it('leaves the QA/QC table as it is: the analysis is a copy', () => {
    const records = makeSheet(11, 'QA/QC Management', columns, [a1], 'qa-qc-management');
    const before = JSON.stringify(records);
    buildAnalysis(records, batchSourceOf([progress, records]));
    expect(JSON.stringify(records)).toBe(before);
    expect(records.columns).toHaveLength(287);
  });
});
