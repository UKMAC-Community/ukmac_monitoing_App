import { parseTsv, toTsv } from './tsv';

describe('TSV (copy and paste with Excel)', () => {
  it('reads rows and cells, with quoted cells holding tabs and new lines', () => {
    expect(parseTsv('A1\t18\nA2\t"two\nlines"\r\n')).toEqual([
      ['A1', '18'],
      ['A2', 'two\nlines'],
    ]);
    expect(parseTsv('one')).toEqual([['one']]);
    expect(parseTsv('a\t\tc')).toEqual([['a', '', 'c']]);
  });

  it('writes what it reads', () => {
    const rows = [['say "hi"', 'x\ty'], ['', 'z']];
    expect(parseTsv(toTsv(rows))).toEqual(rows);
  });
});
