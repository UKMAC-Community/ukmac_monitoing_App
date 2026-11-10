import type { Column } from '../core/models';
import type { ExcelSheetData } from '../excel/sheet-from-excel';
import { tableFromSheet } from '../excel/sheet-from-excel';
import { cellsFor, headerMapOf, mappingFromLink, matchHeaders, newColumns } from './sheet-sync';

const tab = (headers: string[], rows: string[][], dateLike: boolean[] = headers.map(() => false)): ExcelSheetData => ({
  name: 'Zones',
  headerRow: 1,
  layout: { headerFrom: 1, headerTo: 1, dataFrom: 2 },
  auto: { headerFrom: 1, headerTo: 1, dataFrom: 2 },
  headers,
  rows,
  dateLike,
});

const col = (key: string, name: string, type: Column['type'] = 'text', extra: Partial<Column> = {}): Column => ({ key, name, type, ...extra });

describe('a Google Sheet tab read into a table', () => {
  it('fills the columns that go by the same names, in whatever order the tab has them', () => {
    const columns = [col('c1', 'Plot'), col('c2', 'Area', 'number'), col('c3', 'Planted on', 'date')];
    const { matched, fresh } = matchHeaders(columns, ['planted ON', 'Plot', 'Area'], {});
    expect([...matched].map(([index, column]) => [index, column.key])).toEqual([
      [0, 'c3'],
      [1, 'c1'],
      [2, 'c2'],
    ]);
    expect(fresh).toEqual([]);
  });

  it('keeps filling a column that was renamed here, by what the link remembers', () => {
    const columns = [col('c1', 'Plot ID'), col('c2', 'Area')];
    const sheet = tab(['Plot', 'Area'], []);
    expect(matchHeaders(columns, sheet.headers, {}).fresh).toEqual([0]);
    const { matched, fresh } = matchHeaders(columns, sheet.headers, { plot: 'c1' });
    expect(fresh).toEqual([]);
    expect(matched.get(0)?.key).toBe('c1');
  });

  it('leaves a header out for good when the link remembers it was left out on purpose', () => {
    const columns = [col('c1', 'Plot'), col('c2', 'Area', 'number')];
    const { matched, fresh } = matchHeaders(columns, ['Plot', 'Surveyor', 'Colour'], { surveyor: '' });
    expect([...matched.keys()]).toEqual([0]);
    // "Surveyor" was left out on purpose: not filled, not added. "Colour" is new to the link: added.
    expect(fresh).toEqual([2]);
  });

  it('still understands a link saved when a header kept its "*" (names are compared without it now)', () => {
    const columns = [col('c1', 'Plot'), col('c2', 'Area', 'number')];
    const remembered = { 'plot id *': 'c1', 'surveyor *': '' };
    const { matched, fresh } = matchHeaders(columns, ['Plot ID *', 'Surveyor *', 'Area'], remembered);
    expect([...matched].map(([index, column]) => [index, column.key])).toEqual([
      [0, 'c1'],
      [2, 'c2'],
    ]);
    expect(fresh).toEqual([]); // "Surveyor *" is still left out, not added as a column
    expect(headerMapOf(['Plot ID *', 'Surveyor *', 'Area'], matched, remembered)).toEqual({ 'plot id': 'c1', surveyor: '', area: 'c2' });
  });

  it('remembers what was left out: all of it when connecting, only what already was when syncing', () => {
    const columns = [col('c1', 'Plot'), col('c2', 'Area', 'number')];
    const headers = ['Plot', 'Surveyor', 'Colour'];
    const { matched } = matchHeaders(columns, headers, {});
    expect(headerMapOf(headers, matched, {}, true)).toEqual({ plot: 'c1', surveyor: '', colour: '' });
    expect(headerMapOf(headers, matched, { surveyor: '' })).toEqual({ plot: 'c1', surveyor: '' });
    expect(headerMapOf(headers, matched)).toEqual({ plot: 'c1' });
  });

  it('adds a column for a header the table has none for, typed from its values', () => {
    const sheet = tab(['Plot', 'Harvested on', 'Weight (kg)'], [['A1', '2026-06-16', '12.5'], ['A2', '2026-06-17', '9']], [false, true, false]);
    const { matched, fresh } = matchHeaders([col('c1', 'Plot')], sheet.headers, {});
    expect(fresh).toEqual([1, 2]);
    expect(newColumns(sheet, fresh).map((c) => [c.key, c.name, c.type])).toEqual([
      ['', 'Harvested on', 'date'],
      ['', 'Weight (kg)', 'number'],
    ]);
    expect(matched.size).toBe(1);
  });

  it("leaves a formula column's name out, and a repeated header goes to its column once", () => {
    const columns = [col('c1', 'Plot'), col('c2', 'Double', 'formula', { formula: '=[Plot] * 2' })];
    const { matched, fresh } = matchHeaders(columns, ['Plot', 'Double', 'Plot'], {});
    expect([...matched.keys()]).toEqual([0]);
    expect(fresh).toEqual([]);
  });

  it('checks each value against its column: numbers without commas, dates day first, problems counted', () => {
    const columns = [col('c1', 'Plot'), col('c2', 'Area', 'number'), col('c3', 'Planted on', 'date'), col('c4', 'Healthy', 'yesno')];
    const sheet = tab(['Plot', 'Area', 'Planted on', 'Healthy'], [['A1', '1,200', '16/06/2026', 'Yes'], ['A2', 'lots', '2026-06-17', ''], ['', '', '', '']]);
    const { matched } = matchHeaders(columns, sheet.headers, {});
    const { rows, problems } = cellsFor(matched, sheet, () => []);
    expect(rows[0]).toEqual({ c1: 'A1', c2: '1200', c3: '2026-06-16', c4: 'true' });
    expect(rows[1]).toEqual({ c1: 'A2', c2: 'lots', c3: '2026-06-17' });
    expect(rows[2]).toEqual({});
    expect(problems).toBe(1);
  });

  it('checks a link column against the values of the table it points to', () => {
    const columns = [col('c1', 'Zone', 'link', { source: "'Zones'[Zone]" })];
    const sheet = tab(['Zone'], [['zone a'], ['Zone Z']]);
    const { matched } = matchHeaders(columns, sheet.headers, {});
    const { rows, problems } = cellsFor(matched, sheet, () => ['Zone A', 'Zone B']);
    expect(rows).toEqual([{ c1: 'Zone A' }, { c1: 'Zone Z' }]);
    expect(problems).toBe(1);
  });

  it('a table made from a tab matches that tab again (headers as the reader gives them: cleaned, repeats numbered)', () => {
    const sheet = tab(['Plot A', 'Weight (kg)', 'Notes', 'Notes 2', 'Planted on'], [['A1', '3', 'x', 'y', '2026-06-16']], [false, false, false, false, true]);
    const { columns } = tableFromSheet(sheet);
    const { matched, fresh } = matchHeaders(columns, sheet.headers, {});
    expect(fresh).toEqual([]);
    expect(matched.size).toBe(5);
    expect(headerMapOf(sheet.headers, matched)).toEqual({
      'plot a': 'n1',
      'weight (kg)': 'n2',
      notes: 'n3',
      'notes 2': 'n4',
      'planted on': 'n5',
    });
  });
});

describe('the matches a linked table has, for doing the import again', () => {
  const columns = [col('c1', 'Plot ID'), col('c2', 'Area', 'number'), col('c3', 'Note')];

  it('gives each matched column the worksheet column that fills it: by what the link remembers, then by name', () => {
    // The tab's names at worksheet columns 2, 3, 5 (4 is empty); "Plot" fills the renamed "Plot ID", "Area" matches by name.
    const mapping = mappingFromLink(columns, ['Plot', 'Area', 'Remarks'], [2, 3, 5], { plot: 'c1' });
    expect(mapping).toEqual({ c1: 2, c2: 3 });
  });

  it('leaves out what the link left out on purpose, and what no name matches', () => {
    const mapping = mappingFromLink(columns, ['Plot', 'Area', 'Note'], [1, 2, 3], { plot: 'c1', area: '', note: '' });
    expect(mapping).toEqual({ c1: 1 });
    expect(mappingFromLink(columns, ['Something'], [1], {})).toEqual({});
  });
});
