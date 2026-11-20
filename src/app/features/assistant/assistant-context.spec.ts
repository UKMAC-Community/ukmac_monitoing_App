import type { Column } from '@core/models';
import { makeSheet } from '@shared/testing/test-helpers';
import { buildRecords, daysAsked, parseDates } from './assistant-context';

const col = (key: string, name: string, extra: Partial<Column> = {}): Column => ({ key, name, type: 'text', ...extra });
const TODAY = '2026-11-20';

const planting = makeSheet(
  3,
  'Planting Date',
  [col('a', 'Zone plot', { type: 'link' }), col('b', 'Planting date', { type: 'date' })],
  [
    { a: 'B12', b: '2026-07-01' },
    { a: 'A1', b: '2026-08-15' },
  ],
  'planting-date',
);
const progress = makeSheet(
  4,
  'Plant Progress',
  [col('a', 'ID', { type: 'number' }), col('b', 'Zone plot', { type: 'link' }), col('c', 'Record date', { type: 'date' }), col('d', 'Plant count', { type: 'number' }), col('e', 'Status')],
  [
    { a: '1', b: 'B12', c: '2026-07-20', d: '1200', e: 'Vegetative' },
    { a: '2', b: 'B12', c: '2026-11-12', d: '1180', e: 'Fruiting' },
    { a: '3', b: 'A1', c: '2026-08-01', d: '900', e: 'Planted' },
  ],
  'zone-records',
);
const harvest = makeSheet(
  10,
  'Harvest',
  [col('a', 'Zone plot', { type: 'link' }), col('b', 'Date harvest', { type: 'date' }), col('c', 'Harvest yield', { type: 'number' })],
  [
    { a: 'B12', b: '2026-11-12', c: '88.5' },
    { a: '', b: '2026-11-12', c: '12' },
    { a: 'B12', b: '2027-01-01', c: '5' },
  ],
  'harvest',
);
const sheets = [planting, progress, harvest];

describe('the dates a question names', () => {
  it('reads each way of writing one', () => {
    expect(parseDates('what happened on 2026-11-12?', TODAY)).toEqual(['2026-11-12']);
    expect(parseDates('on 12/11/2026', TODAY)).toEqual(['2026-11-12']);
    expect(parseDates('on 12 Nov', TODAY)).toEqual(['2026-11-12']);
    expect(parseDates('on the 12th of November 2025', TODAY)).toEqual(['2025-11-12']);
    expect(parseDates('on Nov 12', TODAY)).toEqual(['2026-11-12']);
    expect(parseDates('what happened today', TODAY)).toEqual(['2026-11-20']);
    expect(parseDates('and yesterday?', TODAY)).toEqual(['2026-11-19']);
  });
  it('ignores a day that is not on the calendar, and words that only look like months', () => {
    expect(parseDates('on 31 Nov', TODAY)).toEqual([]);
    expect(parseDates('5 marked plants', TODAY)).toEqual([]);
    expect(parseDates('the 2026 season', TODAY)).toEqual([]);
  });
  it('keeps each date once, in the order written', () => {
    expect(parseDates('3 Nov, then 1 Nov, then 3 Nov again', TODAY)).toEqual(['2026-11-03', '2026-11-01']);
  });
  it('takes two dates with "between" as one stretch of days', () => {
    expect(daysAsked('between 10 Nov and 1 Nov', ['2026-11-10', '2026-11-01'])).toEqual([{ from: '2026-11-01', to: '2026-11-10' }]);
    expect(daysAsked('on 1 Nov and on 10 Nov', ['2026-11-01', '2026-11-10'])).toHaveLength(2);
  });
});

describe('the records handed to the assistant', () => {
  it('takes every record dated that day from every table, by plot', () => {
    const found = buildRecords('what happened on 12 Nov?', sheets, TODAY);
    expect(found.found).toBe(true);
    expect(found.records).toBe(3);
    expect(found.tables).toEqual([{ name: 'Plant Progress', count: 1 }, { name: 'Harvest', count: 2 }]);
    expect(found.text).toContain('PLOT B12 (planted 01/07/2026):');
    expect(found.text).toContain('- 12/11/2026 Plant Progress — Plant count: 1180; Status: Fruiting');
    expect(found.text).toContain('- 12/11/2026 Harvest — Harvest yield: 88.5');
    expect(found.text).not.toContain('20/07/2026');
  });
  it('puts records with no plot last, and the app notices them', () => {
    const found = buildRecords('what happened on 12 Nov?', sheets, TODAY);
    expect(found.text.indexOf('RECORDS WITH NO PLOT:')).toBeGreaterThan(found.text.indexOf('PLOT B12'));
    expect(found.notes).toEqual(['a Harvest record has no plot (12/11/2026)']);
  });
  it('notices a record before its plot was planted, and one in the future', () => {
    const early = buildRecords('what happened to A1 on 1 Aug', sheets, TODAY);
    expect(early.text).toContain('PLOT A1 (planted 15/08/2026):');
    expect(early.notes).toEqual(['Plant Progress of plot A1 is dated 14 days BEFORE the plot was planted (15/08/2026)']);
    const future = buildRecords('what is on 1 Jan 2027', sheets, TODAY);
    expect(future.notes).toContain('Harvest is dated 01/01/2027, in the future');
  });
  it('says so when nothing matches', () => {
    const none = buildRecords('what happened on 3 Mar 2020', sheets, TODAY);
    expect(none.records).toBe(0);
    expect(none.text).toContain('No record in any table matches');
  });
  it('a plot alone brings all its records, with a day it brings that plot on that day', () => {
    expect(buildRecords('tell me about B12', sheets, TODAY).records).toBe(5);
    const both = buildRecords('B12 on 12 Nov', sheets, TODAY);
    expect(both.records).toBe(2);
    expect(both.looked).toEqual(['the day 12/11/2026', 'plot B12']);
  });
  it('lists the tables when the question names no day or plot', () => {
    const list = buildRecords('how is the farm doing?', sheets, TODAY);
    expect(list.found).toBe(false);
    expect(list.text).toContain('- Harvest: 3 records, dated 12/11/2026 to 01/01/2027');
  });
});
