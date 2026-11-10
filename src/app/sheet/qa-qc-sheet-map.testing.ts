import type { Column } from '../core/models';

/** A column of the old QA QC sheet's map (the user's CSV, saved in fixtures/qa-qc-sheet-map.json as it was given). */
export interface SheetColumn {
  column: string;
  n: string;
  stage: string;
  group: string;
  field: string;
  type: string;
  key: string;
}

/** What the sheet's group is called here, where the table already called it something else. */
const GROUP: Record<string, string> = {
  'Rejected Marketable Fruit (kg)': 'Rejected (kg)',
  'Cumulative Yield (kg/plant)': 'Cumulative Yield',
};

/** The nine measures taken on each of a block's 20 plants. */
export const PLANT_GROUPS = [
  'Plant Vigor Score (1–5)',
  'Plant Height (cm)',
  'Canopy Diameter A (cm) – widest direction',
  'Canopy Diameter B (cm) – perpendicular direction',
  'Branching (No. branches/plant)',
  'Plant Flowering – Flowers per Plant (No.)',
  'Young/Developing Fruits (No. fruits/plant)',
  'Fruit Length (cm)',
  'Fruit Diameter (cm)',
];

/** The sheet's few labels that read differently here. */
const FIELD: Record<string, string> = {
  '4-5 leaves, good': '4–5, good',
  '3 or >5 leaves': '3, >5',
  'Uneven, Wilt': 'Uneven / Wilt',
  'Mixed orientation': 'Mixed',
  'Different orientation': 'Different',
};

/** The table column a column of the sheet is (undefined: the table has none). */
/** The table column a column of the sheet is, in the QA/QC template (undefined: the table has none). */
export function expectedColumn(row: SheetColumn, template: readonly Column[]): Column | undefined {
  const same = (a: string | undefined, b: string | undefined) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
  if (row.stage === 'Block info') {
    // The sheet's Block is a plot code (A1): the Zone link. Its Planting Date is the row's Date.
    return row.group === 'Block' ? template.find((column) => column.name === 'Zone') : template.find((column) => column.name === 'Date' && !column.box);
  }
  if (row.stage === 'Other') return template.find((column) => column.name === 'Notes' && !column.box);
  const number = Number(/^Stage (\d+)/.exec(row.stage)![1]);
  const inStage = template.filter((column) => column.box?.startsWith(`${number} ·`));
  // The date a stage was observed is the stage's first column, named as the sheet names it ("30 DAT Vegetative").
  if (row.field === 'Observation date*') return inStage.find((column) => column.name === row.group && !column.group);
  if (row.group === '1st Harvest Trimming') return inStage.find((column) => column.name === 'Harvest date' && !column.group);
  const group = GROUP[row.group] ?? row.group;
  const name = row.group === 'Rejected Marketable Fruit (kg)' && row.field === 'Total (kg)' ? 'Total' : (FIELD[row.field] ?? row.field);
  return inStage.find((column) => same(column.group, group) && same(column.name, name));
}

