import { suggestedDashboard } from '../dashboard/dashboard-model';
import type { Column, Row } from '../core/models';
import { matchHeaders } from '../google/sheet-sync';
import { makeSheet } from '../test-helpers';
import { CELL_TEXT, columnStyleId, diffRecords, gridStyles, type GridRecord } from '../univer/univer-layout';
import { alignsRight, isEntryColumn } from './columns';

/** A table with an ID the app numbers, then the person's own columns. */
const id: Column = { key: 'c1', name: 'ID', type: 'number', auto: true, aliases: ['Id', 'No', 'No.'] };
const columns: Column[] = [id, { key: 'c2', name: 'Name', type: 'text' }, { key: 'c3', name: 'Weight', type: 'number' }];

describe('an ID column the app numbers', () => {
  it('is not one a person fills in', () => {
    expect(isEntryColumn(id)).toBe(false);
    expect(isEntryColumn(columns[1])).toBe(true);
  });

  it('is not matched or added as a column when a file or Google Sheet has an ID or No column', () => {
    const headers = ['No', 'Name', 'Weight', 'Extra'];
    const { matched, fresh } = matchHeaders(columns, headers, {});
    expect([...matched.values()].map((column) => column.name)).toEqual(['Name', 'Weight']);
    // "No" is the ID's other name: the file's numbers are not used and no column is made for them; "Extra" is added.
    expect(fresh.map((index) => headers[index])).toEqual(['Extra']);
  });

  it('is not added up in the dashboard a hand-made table starts with', () => {
    const sheet = makeSheet(1, 'Fruit', columns, [{ c1: '1', c2: 'A', c3: '5' }]);
    const dashboard = suggestedDashboard(sheet);
    const used = [...dashboard.kpis.map((kpi) => kpi.column), ...dashboard.summaries.flatMap((summary) => summary.measures.map((measure) => measure.column))];
    expect(used).toContain('c3');
    expect(used).not.toContain('c1');
  });

  it('is never sent from the open sheet: a row added there has none, and a blanked ID is not a change', () => {
    const rows: Row[] = [{ rowId: 1, sheetId: 1, position: 1, data: { c1: '1', c2: 'A' }, importId: null, createdAt: '', updatedAt: '' }];
    const record = (row: number, idText: string, name: string, number?: string): GridRecord => ({
      row,
      idText,
      cells: { c1: null, c2: { v: name, t: CELL_TEXT }, c3: number === undefined ? null : { v: number, t: CELL_TEXT } },
    });
    const diff = diffRecords([record(3, '1', 'A'), record(4, '', 'New', '7')], rows, columns);
    expect(diff.changes).toEqual([]);
    expect(diff.additions).toEqual([{ row: 4, values: { c2: 'New', c3: '7' } }]);
  });

  it('lines up left in the table and in the sheet, where the numbers beside it line up right', () => {
    expect(alignsRight(id)).toBe(false);
    expect(alignsRight(columns[2])).toBe(true);
    const styles = gridStyles(columns, '');
    expect(columnStyleId(id)).toBe('col-auto');
    expect(styles['col-auto']).toMatchObject({ ht: 1, n: { pattern: '0' } });
    // The other number column keeps Univer's own (right) alignment.
    expect(styles[columnStyleId(columns[2])]['ht']).toBeUndefined();
  });
});
