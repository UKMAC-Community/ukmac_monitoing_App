import type { Column } from '../core/models';
import fixture from '../sheet/fixtures/qa-qc-columns.json';
import { makeSheet } from '../test-helpers';
import { formatFormulaValue, isFormulaError } from './evaluate-formula';
import { WorkbookFormulas } from './sheet-formulas';

const columns = fixture as Column[];
const zones = makeSheet(1, 'Zones', [{ key: 'c1', name: 'Plot', type: 'text' }], [{ c1: 'A1' }]);

/** A column of the template by its stage box (its number), group and name. */
const find = (stage: number, group: string | undefined, name: string) => {
  const found = columns.find((column) => column.box?.startsWith(`${stage} ·`) && column.group === group && column.name === name);
  if (!found) throw new Error(`${stage} › ${group} › ${name} is not in the template`);
  return found;
};

function check(stage: number, group: string, name: string, entered: Record<string, string>) {
  const cells: Record<string, string> = { c1: '2026-06-01' };
  for (const [path, value] of Object.entries(entered)) {
    const [part, ...rest] = path.split('|');
    cells[find(Number(part), rest.length > 1 ? rest[0] : undefined, rest.at(-1)!).key] = value;
  }
  const sheet = makeSheet(2, 'QA/QC Management', columns, [cells]);
  const formulas = new WorkbookFormulas([zones, sheet], '2026-11-10');
  return formatFormulaValue(formulas.value(sheet, sheet.rows[0], find(stage, group, name)));
}

const LEAF = 'Seedling Leaf Stage (No.)';
const HEALTH = 'Seedling Health / Vigor (No.)';

describe('the QA/QC checks that counts add up', () => {
  it('leaf stage and health are checked against the 20 plants of a block: OK, or what they add up to, blank until all three are in', () => {
    const entered = (a: string, b: string, c: string) => ({ [`1|${LEAF}|4–5, good`]: a, [`1|${LEAF}|3, >5`]: b, [`1|${LEAF}|Disease`]: c });
    expect(check(1, LEAF, 'Leaf stage check', entered('12', '6', '2'))).toBe('OK');
    expect(check(1, LEAF, 'Leaf stage check', entered('10', '6', '2'))).toBe('18 of 20');
    expect(check(1, LEAF, 'Leaf stage check', entered('12', '6', '3'))).toBe('21 of 20');
    expect(check(1, LEAF, 'Leaf stage check', { [`1|${LEAF}|4–5, good`]: '12', [`1|${LEAF}|3, >5`]: '6' })).toBe('');
    // Zero counts are counts: 20 + 0 + 0 is fine.
    expect(check(1, LEAF, 'Leaf stage check', entered('20', '0', '0'))).toBe('OK');
    const health = (a: string, b: string, c: string) => ({ [`1|${HEALTH}|Healthy`]: a, [`1|${HEALTH}|Medium`]: b, [`1|${HEALTH}|Wilt`]: c });
    expect(check(1, HEALTH, 'Health check', health('15', '3', '2'))).toBe('OK');
    expect(check(1, HEALTH, 'Health check', health('15', '3', '1'))).toBe('19 of 20');
  });

  it('new growth must make up the live plants counted at the stage, not a fixed 20', () => {
    const growth = (live: string, up: string, uneven: string) => ({
      '2|Plant Survival (No.)|Live plant': live,
      '2|New Growth (No.)|Upright plants': up,
      '2|New Growth (No.)|Uneven / Wilt': uneven,
    });
    expect(check(2, 'New Growth (No.)', 'Growth check', growth('18', '12', '6'))).toBe('OK');
    expect(check(2, 'New Growth (No.)', 'Growth check', growth('18', '12', '5'))).toBe('17 of 18');
    expect(check(2, 'New Growth (No.)', 'Growth check', growth('', '12', '6'))).toBe('');
    expect(check(2, 'New Growth (No.)', 'Growth check', growth('18', '12', ''))).toBe('');
  });

  it('fruit orientation, shape and color are checked against the 50 fruits', () => {
    const orientation = { '5|Fruit Orientation (No.)|Upright': '40', '5|Fruit Orientation (No.)|Mixed': '8', '5|Fruit Orientation (No.)|Different': '2' };
    expect(check(5, 'Fruit Orientation (No.)', 'Orientation check', orientation)).toBe('OK');
    expect(check(5, 'Fruit Orientation (No.)', 'Orientation check', { ...orientation, '5|Fruit Orientation (No.)|Different': '5' })).toBe('53 of 50');
    const shape = { '5|Fruit Shape (No.)|True-to-type': '44', '5|Fruit Shape (No.)|Variability': '4', '5|Fruit Shape (No.)|Off-type': '2' };
    expect(check(5, 'Fruit Shape (No.)', 'Shape check', shape)).toBe('OK');
    const color = { '7|Fruit Color (No.)|Green': '20', '7|Fruit Color (No.)|Turning': '20', '7|Fruit Color (No.)|Red': '9' };
    expect(check(7, 'Fruit Color (No.)', 'Color check', color)).toBe('49 of 50');
  });

  it('what is marketable can not be more than what was harvested', () => {
    const marketable = (total: string, market: string) => ({ '8|Marketable Fruit (kg)|Total': total, '8|Marketable Fruit (kg)|Marketable': market });
    expect(check(8, 'Marketable Fruit (kg)', 'Marketable check', marketable('120.5', '100'))).toBe('OK');
    expect(check(8, 'Marketable Fruit (kg)', 'Marketable check', marketable('100', '100'))).toBe('OK');
    expect(check(8, 'Marketable Fruit (kg)', 'Marketable check', marketable('100', '110'))).toBe('More than total');
    expect(check(8, 'Marketable Fruit (kg)', 'Marketable check', marketable('100', ''))).toBe('');
  });

  it('every formula of the template, new and old, works out on an empty row and on a full one, with no #NAME? or #REF!', () => {
    const full: Record<string, string> = { c1: '2026-06-01', c2: 'A1' };
    for (const column of columns) {
      if (column.type === 'number' || column.type === 'percentage') full[column.key] = '5';
      if (column.type === 'date' && column.key !== 'c1') full[column.key] = '2026-07-01';
    }
    const sheet = makeSheet(2, 'QA/QC Management', columns, [{}, full]);
    const formulas = new WorkbookFormulas([zones, sheet], '2026-11-10');
    const bad: string[] = [];
    for (const row of sheet.rows) {
      for (const column of columns.filter((item) => item.type === 'formula')) {
        const value = formulas.value(sheet, row, column);
        if (isFormulaError(value)) bad.push(`${column.box} › ${column.name}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
