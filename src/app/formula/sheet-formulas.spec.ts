import { makeSheet, qaQcColumns } from '../test-helpers';
import { formatFormulaValue, isFormulaError } from './evaluate-formula';
import { WorkbookFormulas } from './sheet-formulas';

const zones = makeSheet(1, 'Zones', [
  { key: 'c1', name: 'Zone', type: 'text' },
  { key: 'c2', name: 'Plot', type: 'text' },
  { key: 'c3', name: 'Plant capacity', type: 'number' },
], [
  { c1: 'A', c2: 'A1', c3: '400' },
  { c1: 'A', c2: 'A2', c3: '340' },
  { c1: 'B', c2: 'B1' },
]);

describe('WorkbookFormulas', () => {
  const qc = makeSheet(2, 'QA/QC Management', qaQcColumns(), [
    { c1: '2026-06-01', c2: 'A1', c9: '18' },
    { c2: 'A2' },
  ]);
  const formulas = new WorkbookFormulas([zones, qc], '2026-11-03');
  const value = (row: number, key: string) => {
    const column = qc.columns.find((item) => item.key === key)!;
    return formatFormulaValue(formulas.value(qc, qc.rows[row], column));
  };

  it("dates each stage from the row's own Date, not the stage's", () => {
    expect(value(0, 'c4')).toBe('2026-06-01');
    expect(value(0, 'c7')).toBe('2026-06-08');
  });

  it('works out days after transplant from the stage date in its box', () => {
    expect(value(0, 'c5')).toBe('0');
    expect(value(0, 'c8')).toBe('7');
  });

  it('dead plants are the 20 a block less the live ones, blank until counted', () => {
    expect(value(0, 'c10')).toBe('2');
    expect(value(1, 'c10')).toBe('');
    expect(value(1, 'c4')).toBe('');
  });

  it("hides a stage's date until it's 3 days ahead", () => {
    const later = new WorkbookFormulas([zones, qc], '2026-06-01');
    const column = qc.columns.find((item) => item.key === 'c7')!;
    expect(formatFormulaValue(later.value(qc, qc.rows[0], column))).toBe('');
  });

  it("reads another table's column for LOOKUP and SUMIF", () => {
    const sheet = makeSheet(3, 'Harvest', [
      { key: 'c1', name: 'Zone', type: 'link', source: "'Zones'[Plot]" },
      { key: 'c2', name: 'Capacity', type: 'formula', formula: "=LOOKUP('Zones'[Plant capacity], 'Zones'[Plot], [Zone], 0)" },
      { key: 'c3', name: 'Zone total', type: 'formula', formula: "=SUMIF('Zones'[Plant capacity], 'Zones'[Zone], \"A\")" },
    ], [{ c1: 'A2' }, { c1: 'Q9' }]);
    const book = new WorkbookFormulas([zones, sheet], '2026-11-03');
    expect(book.value(sheet, sheet.rows[0], sheet.columns[1])).toBe(340);
    expect(book.value(sheet, sheet.rows[1], sheet.columns[1])).toBe(0);
    expect(book.value(sheet, sheet.rows[0], sheet.columns[2])).toBe(740);
  });

  it('gives #NAME? for a column that is not there and #CYCLE! for a loop', () => {
    const sheet = makeSheet(4, 'Loop', [
      { key: 'c1', name: 'A', type: 'formula', formula: '=[B]+1' },
      { key: 'c2', name: 'B', type: 'formula', formula: '=[A]+1' },
      { key: 'c3', name: 'C', type: 'formula', formula: '=[Nope]' },
    ], [{}]);
    const book = new WorkbookFormulas([sheet], '2026-11-03');
    const cycle = book.value(sheet, sheet.rows[0], sheet.columns[0]);
    expect(isFormulaError(cycle) && cycle.code).toBe('#CYCLE!');
    const missing = book.value(sheet, sheet.rows[0], sheet.columns[2]);
    expect(isFormulaError(missing) && missing.code).toBe('#NAME?');
  });

  it('offers a link column its source values, each once', () => {
    const plots = formulas.linkOptions({ table: 'zones', column: 'plot' });
    expect(plots).toEqual(['A1', 'A2', 'B1']);
    expect(formulas.linkOptions({ table: 'Zones', column: 'Zone' })).toEqual(['A', 'B']);
  });
});
