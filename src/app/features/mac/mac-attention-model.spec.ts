import type { Column } from '@core/models';
import { makeSheet } from '@shared/testing/test-helpers';
import { needsYou, recordsLine } from './mac-attention-model';

const col = (key: string, name: string, extra: Partial<Column> = {}): Column => ({ key, name, type: 'text', ...extra });

describe('needsYou', () => {
  const plants = makeSheet(
    4,
    'Plant Progress',
    [col('c1', 'Zone plot', { required: true }), col('c2', 'Status'), col('c3', 'Replant date'), col('c4', 'Note')],
    [
      { c1: 'A1', c2: 'ok' },
      { c1: 'A2', c2: '' },
      { c1: 'A3', c2: 'ok' },
    ],
  );
  const done = makeSheet(5, 'Batch', [col('c1', 'Batch number'), col('c2', 'Variety')], [{ c1: 'B1', c2: 'Mali' }]);
  const none = makeSheet(6, 'Harvest', [col('c1', 'Zone plot')], []);

  it('lists a column with nothing entered by its name alone, and a partly filled one with the records that lack it', () => {
    const [need] = needsYou([plants, done, none]);
    expect(need.title).toBe('Plant Progress');
    expect(need.emptyColumns).toEqual(['Replant date']);
    expect(need.partly).toEqual([{ key: 'c2', name: 'Status', missing: 1, total: 3, records: ['A2'], more: 0 }]);
    // A note is not data, and is not asked for.
    expect(need.emptyColumns).not.toContain('Note');
  });

  it('leaves out a table with everything filled in and a table with no records yet', () => {
    expect(needsYou([plants, done, none]).map((need) => need.title)).toEqual(['Plant Progress']);
  });

  it('puts the table lacking the most first, and names a few records and says how many more', () => {
    const many = makeSheet(7, 'Pruning', [col('c1', 'Zone plot'), col('c2', 'Date')], Array.from({ length: 10 }, (_, at) => ({ c1: `A${at + 1}`, c2: at < 5 ? '' : '2026-07-01' })));
    const needs = needsYou([plants, many]);
    expect(needs.map((need) => need.title)).toEqual(['Pruning', 'Plant Progress']);
    expect(needs[0].partly[0]).toMatchObject({ missing: 5, records: ['A1', 'A2', 'A3', 'A4'], more: 1 });
  });

  it('names a column most records lack without listing them, and lists the records of one a few lack', () => {
    // 10 plots: Date lacking in 9 (the column is what's missing), Batch in 2 (two plots left out).
    const rows = Array.from({ length: 10 }, (_, at) => ({ c1: `A${at + 1}`, c2: at === 9 ? '2026-07-01' : '', c3: at < 2 ? '' : 'B1' }));
    const [need] = needsYou([makeSheet(7, 'Pruning', [col('c1', 'Zone plot'), col('c2', 'Date'), col('c3', 'Batch number')], rows)]);
    expect(need.mostly).toEqual([{ name: 'Date', missing: 9, total: 10 }]);
    expect(need.partly).toEqual([{ key: 'c3', name: 'Batch number', missing: 2, total: 10, records: ['A1', 'A2'], more: 0 }]);
    expect(need.moreColumns).toBe(0);
  });

  it('says how much of the table is filled in, never 100 while something is missing', () => {
    // 3 records × Zone plot, Status, Replant date: 3 + 2 + 0 of 9.
    expect(needsYou([plants])[0].filled).toBe(55);
  });

  it('writes the records lacking a column in one line, what they share said once', () => {
    expect(recordsLine(['06/07/2026 · A13', '06/07/2026 · A14', '06/07/2026 · A15'], 86)).toBe('06/07/2026 · A13, A14, A15 and 86 more');
    expect(recordsLine(['B · 2', 'A · 4'], 0)).toBe('B · 2, A · 4');
    expect(recordsLine(['A1'], 0)).toBe('A1');
  });

  it('changes its signature when what is missing changes', () => {
    const before = needsYou([plants])[0].signature;
    const filled = makeSheet(4, 'Plant Progress', plants.columns, [{ c1: 'A1', c2: 'ok' }, { c1: 'A2', c2: 'ok' }, { c1: 'A3', c2: 'ok' }]);
    expect(needsYou([filled])[0].signature).not.toBe(before);
  });
});
