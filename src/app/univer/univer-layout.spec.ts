import type { Column, Row } from '../core/models';
import { FormulaError } from '../formula/evaluate-formula';
import {
  buildWorkbookData,
  CELL_NUMBER,
  CELL_TEXT,
  computedCell,
  DATA_SHEET_ID,
  diffRecords,
  formulaRowLabel,
  fromGridCell,
  gridPlan,
  headerLayout,
  isoToSerial,
  orderChanged,
  serialToIso,
  SPARE_COLUMNS,
  SPARE_ROWS,
  toGridCell,
  type GridRecord,
} from './univer-layout';

const col = (
  key: string,
  name: string,
  type: Column['type'],
  extra: Partial<Column> = {},
): Column => ({ key, name, type, ...extra });

const row = (rowId: number, data: Record<string, string>, position = rowId): Row => ({
  rowId,
  sheetId: 1,
  position,
  data,
  importId: null,
  createdAt: '',
  updatedAt: '',
});

describe('dates and day numbers', () => {
  it('goes both ways on Excel’s epoch', () => {
    expect(isoToSerial('2026-06-16')).toBe(46189);
    expect(serialToIso(46189)).toBe('2026-06-16');
    expect(isoToSerial('1900-03-01')).toBe(61);
    expect(serialToIso(46189.75)).toBe('2026-06-16');
    expect(isoToSerial('2026-02-31')).toBeNull();
  });
});

describe('values in and out of the grid', () => {
  const number = col('c1', 'Kg', 'number');
  const percent = col('c2', 'Flowering', 'percentage');
  const date = col('c3', 'Date', 'date');
  const yesno = col('c4', 'Done', 'yesno');
  const choice = col('c5', 'Grade', 'choice', { options: ['Good', 'Poor'] });
  const text = col('c6', 'Note', 'text');

  it('holds each kept value as a sheet would', () => {
    expect(toGridCell(number, '12.5')).toEqual({ v: 12.5, t: CELL_NUMBER });
    expect(toGridCell(percent, '86.4')).toEqual({ v: 0.864, t: CELL_NUMBER });
    expect(toGridCell(date, '2026-06-16')).toEqual({ v: 46189, t: CELL_NUMBER });
    expect(toGridCell(yesno, 'true')).toEqual({ v: 'Yes', t: CELL_TEXT });
    expect(toGridCell(text, '001')).toEqual({ v: '001', t: CELL_TEXT });
    expect(toGridCell(number, 'ten')).toEqual({ v: 'ten', t: CELL_TEXT });
    expect(toGridCell(text, '')).toBeNull();
  });

  it('reads each back to what was kept', () => {
    const kept: [Column, string][] = [
      [number, '12.5'],
      [number, '-0.25'],
      [percent, '86.4'],
      [percent, '33.333'],
      [date, '2026-06-16'],
      [yesno, 'true'],
      [yesno, 'false'],
      [choice, 'Good'],
      [text, '001'],
      [number, 'ten'],
    ];
    for (const [column, value] of kept)
      expect(fromGridCell(column, toGridCell(column, value)).value).toBe(value);
  });

  it('reads what was typed or pasted as the app’s table does', () => {
    expect(fromGridCell(date, { v: '16/06/2026', t: CELL_TEXT })).toEqual({ value: '2026-06-16' });
    expect(fromGridCell(percent, { v: '45%', t: CELL_TEXT })).toEqual({ value: '45' });
    expect(fromGridCell(number, { v: '1,234.50', t: CELL_TEXT })).toEqual({ value: '1234.5' });
    expect(fromGridCell(yesno, { v: 'y', t: CELL_TEXT })).toEqual({ value: 'true' });
    expect(fromGridCell(choice, { v: 'good', t: CELL_TEXT })).toEqual({ value: 'Good' });
    expect(fromGridCell(choice, { v: 'ok', t: CELL_TEXT }).error).toContain('Not in the list');
    expect(fromGridCell(number, { v: true, t: 3 }).error).toBe('Use a number');
  });

  it('shows a formula column’s value, rounded as the table shows it', () => {
    expect(computedCell(2 / 3)).toMatchObject({ v: 0.667, t: CELL_NUMBER });
    expect(computedCell('2026-06-16')).toMatchObject({
      v: 46189,
      t: CELL_NUMBER,
      s: 'computed-date',
    });
    expect(computedCell(new FormulaError('#NAME?', 'No column'))).toMatchObject({
      v: '#NAME?',
      s: 'computed-error',
    });
    expect(computedCell(true)).toMatchObject({ v: 'Yes' });
  });
});

describe('the header', () => {
  it('merges a box over its columns and a name down to the last header row', () => {
    const columns = [
      col('c1', 'Zone', 'link', { source: "'Zones'[Plot]" }),
      col('c2', 'Date', 'date', { box: 'Stage 1' }),
      col('c3', 'Value', 'number', { box: 'Stage 1', group: 'Leaf' }),
      col('c4', 'Status', 'text', { box: 'Stage 1', group: 'Leaf' }),
    ];
    const layout = headerLayout(columns);
    expect(layout.rows).toBe(3);
    expect(layout.cells).toContainEqual({ row: 0, column: 1, kind: 'group', text: 'Stage 1' });
    expect(layout.cells).toContainEqual({ row: 1, column: 2, kind: 'group', text: 'Leaf' });
    expect(layout.merges).toContainEqual({ startRow: 0, endRow: 0, startColumn: 1, endColumn: 3 });
    expect(layout.merges).toContainEqual({ startRow: 1, endRow: 1, startColumn: 2, endColumn: 3 });
    expect(layout.merges).toContainEqual({ startRow: 0, endRow: 2, startColumn: 0, endColumn: 0 });
    expect(layout.merges).toContainEqual({ startRow: 1, endRow: 2, startColumn: 1, endColumn: 1 });
  });

  it('has two rows at least, and the formula row says each column’s rule', () => {
    expect(headerLayout([col('c1', 'Name', 'text')]).rows).toBe(2);
    expect(formulaRowLabel(col('c1', 'Weight', 'number', { required: true, unit: 'kg' }))).toBe(
      'Number, Required, unit kg',
    );
    expect(formulaRowLabel(col('c2', 'Zone', 'link', { source: "'Zones'[Plot]" }))).toBe(
      "=LINK('Zones'[Plot])",
    );
    expect(formulaRowLabel(col('c3', 'Gap', 'formula', { formula: '=20-[Live plant]' }))).toBe(
      '=20-[Live plant]',
    );
  });
});

describe('the workbook', () => {
  it('lays out the header, the formula row, the records and room for more', () => {
    const columns = [
      col('c1', 'Variety', 'text', { required: true }),
      col('c2', 'Plants', 'number'),
      col('c3', 'Double', 'formula', { formula: '=[Plants]*2' }),
    ];
    const rows = [row(7, { c1: 'Bird’s Eye', c2: '10' }), row(9, { c1: 'Kampot' })];
    const { plan, data } = buildWorkbookData({
      unitId: 'u1',
      title: 'Chili Varieties',
      columns,
      rows,
      computed: (r) => (r.data['c2'] ? Number(r.data['c2']) * 2 : null),
      linkOptions: () => [],
      fontFamily: '',
      frozenColumns: 1,
    });
    const sheet = data.sheets[DATA_SHEET_ID];
    expect(plan.recordsFrom).toBe(3);
    expect(plan.idColumn).toBe(3 + SPARE_COLUMNS);
    expect(sheet.rowCount).toBe(3 + 2 + SPARE_ROWS);
    expect(sheet.cellData[0][0]).toMatchObject({ v: 'Variety *' });
    expect(sheet.cellData[2][1]).toMatchObject({ v: 'Number', s: 'formula-label' });
    expect(sheet.cellData[3][0]).toMatchObject({ v: 'Bird’s Eye', s: 'col-text' });
    expect(sheet.cellData[3][1]).toMatchObject({ v: 10, t: CELL_NUMBER });
    expect(sheet.cellData[3][2]).toMatchObject({ v: 20, s: 'computed' });
    expect(sheet.cellData[3][plan.idColumn]).toMatchObject({ v: '7' });
    expect(sheet.cellData[4][plan.idColumn]).toMatchObject({ v: '9' });
    expect(sheet.cellData[5][plan.idColumn]).toBeUndefined();
    expect(sheet.columnData[plan.idColumn]).toMatchObject({ hd: 1 });
    expect(sheet.freeze).toMatchObject({ ySplit: 3, xSplit: 1 });
    expect(sheet.mergeData).toContainEqual({
      startRow: 0,
      endRow: 1,
      startColumn: 0,
      endColumn: 0,
    });
  });

  it('gives a choice column its list to pick from', () => {
    const columns = [col('c1', 'Grade', 'choice', { options: ['Good', 'Poor, wilted'] })];
    const { data } = buildWorkbookData({
      unitId: 'u1',
      title: 'T',
      columns,
      rows: [],
      computed: () => null,
      linkOptions: () => [],
      fontFamily: '',
      frozenColumns: 0,
    });
    const rules = JSON.parse(data.resources[0].data)[DATA_SHEET_ID];
    expect(rules).toHaveLength(1);
    expect(JSON.parse(rules[0].formula1)).toEqual(['Good', 'Poor, wilted']);
    expect(rules[0].ranges[0]).toMatchObject({ startRow: 3, startColumn: 0, endColumn: 0 });
  });
});

describe('what to save', () => {
  const columns = [
    col('c1', 'Name', 'text'),
    col('c2', 'Kg', 'number'),
    col('c3', 'Twice', 'formula', { formula: '=[Kg]*2' }),
  ];
  const rows = [
    row(1, { c1: 'A', c2: '1' }),
    row(2, { c1: 'B', c2: '1,000' }),
    row(3, { c1: 'C' }),
  ];
  const record = (r: number, idText: string, c1?: string, c2?: number | string): GridRecord => ({
    row: r,
    idText,
    cells: {
      c1: c1 === undefined ? null : { v: c1, t: CELL_TEXT },
      c2:
        c2 === undefined
          ? null
          : typeof c2 === 'number'
            ? { v: c2, t: CELL_NUMBER }
            : { v: c2, t: CELL_TEXT },
    },
  });

  it('sends only what changed — a value kept as typed isn’t “fixed” behind the person’s back', () => {
    const diff = diffRecords(
      [record(3, '1', 'A', 1), record(4, '2', 'B', '1,000'), record(5, '3', 'C changed')],
      rows,
      columns,
    );
    expect(diff.changes).toEqual([{ rowId: 3, key: 'c1', value: 'C changed' }]);
    expect(diff.additions).toEqual([]);
    expect(diff.deletions).toEqual([]);
  });

  it('finds new rows, deleted ones and a copied record, and the order they stand in', () => {
    const diff = diffRecords(
      [
        record(3, '3', 'C'),
        record(4, '', 'New', 5),
        record(5, '1', 'A', 1),
        record(6, '1', 'A', 1),
        record(7, '42'),
      ],
      rows,
      columns,
    );
    expect(diff.order).toEqual([3, 1]);
    expect(diff.additions).toEqual([
      { row: 4, values: { c1: 'New', c2: '5' } },
      { row: 6, values: { c1: 'A', c2: '1' } },
    ]);
    expect(diff.deletions).toEqual([2]);
    expect(diff.staleIds).toEqual([7]);
    expect(orderChanged(diff.order, rows)).toBe(true);
    expect(orderChanged([1, 3], rows)).toBe(false);
  });

  it('empties a cell cleared in the grid', () => {
    const diff = diffRecords(
      [record(3, '1', 'A'), record(4, '2', 'B', '1,000'), record(5, '3', 'C')],
      rows,
      columns,
    );
    expect(diff.changes).toEqual([{ rowId: 1, key: 'c2', value: null }]);
  });

  it('lets a record go once its row is emptied, but keeps one that was empty before', () => {
    const withEmpty = [...rows, row(4, {})];
    const diff = diffRecords(
      [record(3, '1', 'A', 1), record(4, '2'), record(5, '3', 'C'), record(6, '4')],
      withEmpty,
      columns,
    );
    expect(diff.deletions).toEqual([2]);
    expect(diff.staleIds).toEqual([4]);
    expect(diff.order).toEqual([1, 3, 4]);
    expect(diff.changes).toEqual([]);
  });
});
