import { paginate, sheetBody } from './a4';

describe('a report laid out on A4 sheets', () => {
  it('knows the room a sheet has for its parts', () => {
    const portrait = sheetBody('portrait');
    const landscape = sheetBody('landscape');
    expect(Math.round(portrait.width)).toBe(718);
    expect(Math.round(landscape.width)).toBe(1047);
    expect(portrait.height).toBeGreaterThan(landscape.height);
  });

  it('puts parts one under another, and one that does not fit on the next sheet', () => {
    const sheets = paginate(
      [
        { key: 'cards', kind: 'whole', height: 300 },
        { key: 'chart-1', kind: 'whole', height: 400 },
        { key: 'chart-2', kind: 'whole', height: 400 },
      ],
      1000,
      20,
    );
    expect(sheets.map((sheet) => sheet.map((slice) => slice.key))).toEqual([['cards', 'chart-1'], ['chart-2']]);
  });

  it('splits a table between its rows, its title again on each sheet, its tail after the last row', () => {
    const rows = Array.from({ length: 10 }, () => 50);
    const sheets = paginate([{ key: 'cards', kind: 'whole', height: 300 }, { key: 'data', kind: 'rows', heading: 60, rows, tail: 30 }], 600, 20);
    // Sheet 1: 300 + 20 + 60 heading + 4 rows (200) = 580. Sheet 2: 60 + 6 rows (300) + 30 tail = 390.
    expect(sheets).toEqual([
      [
        { key: 'cards', from: 0, to: 0, first: true, last: true },
        { key: 'data', from: 0, to: 4, first: true, last: false },
      ],
      [{ key: 'data', from: 4, to: 10, first: false, last: true }],
    ]);
  });

  it('starts a table on a new sheet when not even its title and first row fit', () => {
    const sheets = paginate([{ key: 'cards', kind: 'whole', height: 520 }, { key: 'summary', kind: 'rows', heading: 60, rows: [40, 40], tail: 30 }], 600, 20);
    expect(sheets.map((sheet) => sheet.map((slice) => slice.key))).toEqual([['cards'], ['summary']]);
  });

  it('puts the tail on a sheet of its own when it does not fit after the last row', () => {
    const sheets = paginate([{ key: 'data', kind: 'rows', heading: 50, rows: [100, 100, 100, 100, 100], tail: 80 }], 560, 20);
    expect(sheets).toEqual([[{ key: 'data', from: 0, to: 5, first: true, last: false }], [{ key: 'data', from: 5, to: 5, first: false, last: true }]]);
  });

  it('gives a part taller than a sheet a sheet to itself, and always has one sheet', () => {
    expect(paginate([], 500, 20)).toEqual([[]]);
    const sheets = paginate([{ key: 'a', kind: 'whole', height: 100 }, { key: 'tall', kind: 'whole', height: 900 }, { key: 'b', kind: 'whole', height: 100 }], 500, 20);
    expect(sheets.map((sheet) => sheet.map((slice) => slice.key))).toEqual([['a'], ['tall'], ['b']]);
  });
});
