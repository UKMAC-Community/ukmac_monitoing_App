import type { Column } from '../core/models';
import { checkCell, excelHeaders, headerAliases, normalizeHeader, parseDateText, parseLinkSource, rangeProblem, rangeText } from './columns';

const col = (name: string, type: Column['type'], extra: Partial<Column> = {}): Column => ({ key: name, name, type, ...extra });

describe('dates', () => {
  it('reads the ways a farm writes a date, day first', () => {
    expect(parseDateText('2026-06-16')).toBe('2026-06-16');
    expect(parseDateText('16/06/2026')).toBe('2026-06-16');
    expect(parseDateText('6/7/2026')).toBe('2026-07-06');
    expect(parseDateText('16-6-26')).toBe('2026-06-16');
    expect(parseDateText('2026/6/16')).toBe('2026-06-16');
    expect(parseDateText('46189')).toBe('2026-06-16'); // Excel's day number
    expect(parseDateText('31/02/2026')).toBeNull();
    expect(parseDateText('soon')).toBeNull();
  });
});

describe('checkCell', () => {
  it('keeps numbers without commas, and says when one is not a number', () => {
    expect(checkCell(col('Kg', 'number'), '1,234.50')).toEqual({ value: '1234.5' });
    expect(checkCell(col('Kg', 'number'), 'ten').error).toBe('Use a number');
    expect(checkCell(col('Flowering', 'percentage'), '45%')).toEqual({ value: '45' });
  });

  it('matches a choice or a link without minding case, in its own spelling', () => {
    const choice = col('Grade', 'choice', { options: ['Good', 'Poor'] });
    expect(checkCell(choice, 'good')).toEqual({ value: 'Good' });
    expect(checkCell(choice, 'ok').error).toContain('Not in the list');
    const link = col('Zone', 'link', { source: "'Zones'[Plot]" });
    expect(checkCell(link, 'a1', ['A1', 'A2'])).toEqual({ value: 'A1' });
    expect(checkCell(link, 'Z9', ['A1']).error).toBe('Not in Zones › Plot');
  });

  it('reads yes and no', () => {
    expect(checkCell(col('Done', 'yesno'), 'Yes').value).toBe('true');
    expect(checkCell(col('Done', 'yesno'), 'n').value).toBe('false');
  });

  it('flags a blank required cell', () => {
    expect(checkCell(col('Date', 'date', { required: true }), ' ').error).toBe('This column needs a value');
  });
});

describe('a column\'s limits', () => {
  const vigor = col('Vigor', 'number', { min: 1, max: 5 });
  const count = col('Live plant', 'number', { min: 0 });
  const percent = col('Flowering', 'percentage', { min: 0, max: 100 });

  it('draw a value outside them red with what is allowed, and keep the value as typed', () => {
    expect(checkCell(vigor, '3.5')).toEqual({ value: '3.5' });
    expect(checkCell(vigor, '1')).toEqual({ value: '1' });
    expect(checkCell(vigor, '5')).toEqual({ value: '5' });
    expect(checkCell(vigor, '6')).toEqual({ value: '6', error: 'Use a number from 1 to 5' });
    expect(checkCell(vigor, '0.5')).toEqual({ value: '0.5', error: 'Use a number from 1 to 5' });
    expect(checkCell(count, '-2')).toEqual({ value: '-2', error: 'Use 0 or more' });
    expect(checkCell(count, '0')).toEqual({ value: '0' });
    expect(checkCell(count, '1,200')).toEqual({ value: '1200' });
    expect(checkCell(percent, '101%')).toEqual({ value: '101', error: 'Use a number from 0 to 100' });
    expect(checkCell(percent, '95%')).toEqual({ value: '95' });
  });

  it('leave a column with none, and a value that is not a number, as they were', () => {
    expect(checkCell(col('Free', 'number'), '-5')).toEqual({ value: '-5' });
    expect(checkCell(vigor, 'high')).toEqual({ value: 'high', error: 'Use a number' });
    expect(checkCell(vigor, '')).toEqual({ value: '' });
  });

  it('are said in words, one side or both', () => {
    expect(rangeText(vigor)).toBe('from 1 to 5');
    expect(rangeText(count)).toBe('0 or more');
    expect(rangeText({ max: 9 })).toBe('9 or less');
    expect(rangeText({})).toBe('');
    expect(rangeProblem({ max: 9 }, 10)).toBe('Use 9 or less');
    expect(rangeProblem({ min: 0, max: 0 }, 0)).toBeUndefined();
  });
});

describe('Excel headers', () => {
  it("are the server template's: box in front when a table has several, unit after", () => {
    const columns: Column[] = [
      col('Date', 'date', { key: 'c1' }),
      col('Zone', 'link', { key: 'c2' }),
      col('Disease', 'number', { key: 'c3', box: '1 · Transplant (0 DAT)', group: 'Seedling Leaf Stage (No.)' }),
      col('Date', 'formula', { key: 'c4', box: '1 · Transplant (0 DAT)' }),
      col('Disease', 'number', { key: 'c5', box: '8 · Harvest (75–150 DAT)', unit: 'kg' }),
    ];
    const headers = excelHeaders(columns);
    expect([...headers.values()]).toEqual([
      'Date',
      'Zone',
      '1 · Transplant (0 DAT) · Disease',
      '8 · Harvest (75–150 DAT) · Disease (kg)',
    ]);
    expect(headers.has('c4')).toBe(false); // a formula isn't typed in
  });

  it('adds the key where two columns would share a header', () => {
    const headers = excelHeaders([col('Note', 'text', { key: 'c1' }), col('Note', 'text', { key: 'c2' })]);
    expect([...headers.values()]).toEqual(['Note (c1)', 'Note (c2)']);
  });

  it('knows a column by its box path too', () => {
    const column = col('Live plant', 'number', { key: 'c9', box: '2 · Establishment (7 DAT)', group: 'Plant Survival (No.)' });
    expect(headerAliases(column, 'x')).toContain(normalizeHeader('2 · Establishment (7 DAT) › Plant Survival (No.) › Live plant'));
  });
});

describe('link sources', () => {
  it("reads 'Table'[Column] and Table[Column]", () => {
    expect(parseLinkSource("'Chili Varieties'[Variety name]")).toEqual({ table: 'Chili Varieties', column: 'Variety name' });
    expect(parseLinkSource('Zones[Plot]')).toEqual({ table: 'Zones', column: 'Plot' });
    expect(parseLinkSource("'Farmer''s plots'[Plot]")).toEqual({ table: "Farmer's plots", column: 'Plot' });
    expect(parseLinkSource('nonsense')).toBeNull();
  });
});
