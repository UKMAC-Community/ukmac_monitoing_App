import type { Column } from '@core/models';
import { makeSheet } from '@shared/testing/test-helpers';
import { runRag } from './assistant-rag';

const col = (key: string, name: string, extra: Partial<Column> = {}): Column => ({ key, name, type: 'text', ...extra });
const TODAY = '2026-11-20';

const zones = makeSheet(
  1,
  'Zones',
  [col('a', 'ID', { type: 'number' }), col('b', 'Zone'), col('c', 'Plot'), col('d', 'Zone number', { type: 'number' })],
  [
    { a: '1', b: 'A', c: 'A1', d: '1' },
    { a: '2', b: 'A', c: 'A2', d: '1' },
    { a: '3', b: 'A', c: 'A3', d: '1' },
    { a: '4', b: 'B', c: 'B1', d: '2' },
    { a: '5', b: 'B', c: 'B2', d: '2' },
    { a: '6', b: 'C', c: 'C1', d: '3' },
  ],
  'zones',
);
const planting = makeSheet(
  3,
  'Planting Date',
  [col('a', 'Zone plot', { type: 'link' }), col('b', 'Planting date', { type: 'date' })],
  [
    { a: 'A1', b: '2026-06-01' },
    { a: 'B1', b: '2026-06-01' },
  ],
  'planting-date',
);
const harvest = makeSheet(
  10,
  'Harvest',
  [col('a', 'Zone plot', { type: 'link' }), col('b', 'Chili type', { type: 'choice' }), col('c', 'Date harvest', { type: 'date' }), col('d', 'Harvest yield', { type: 'number' })],
  [
    { a: 'A1', b: 'ripe', c: '2026-11-02', d: '100' },
    { a: 'A1', b: 'unripe', c: '2026-11-02', d: '20' },
    { a: 'A2', b: 'ripe', c: '2026-11-03', d: '300' },
    { a: 'B1', b: 'ripe', c: '2026-10-05', d: '50' },
    { a: 'B2', b: 'ripe', c: '2026-11-20', d: '10' },
    { a: 'A1', b: 'ripe', c: '2026-05-01', d: '7' },
    { a: '', b: 'ripe', c: '2026-11-04', d: '5' },
  ],
  'harvest',
);
const progress = makeSheet(
  4,
  'Plant Progress',
  [col('a', 'Zone plot', { type: 'link' }), col('b', 'Record date', { type: 'date' }), col('c', 'Plant count', { type: 'number' }), col('d', 'Dead plant', { type: 'number' })],
  [
    { a: 'A1', b: '2026-07-01', c: '1000', d: '10' },
    { a: 'A2', b: '2026-07-01', c: '900', d: '5' },
  ],
  'zone-records',
);
const sheets = [zones, planting, harvest, progress];
const ask = (question: string, before = null as null | { sheet: string | null; filters: string[]; kinds: string[] }) => runRag(question, sheets, TODAY, before);

describe('counting', () => {
  it('"how many zone plot in the zone" counts the plots, zone by zone (what went wrong with a day lookup before)', () => {
    const rag = ask('how many zone plot in the zone');
    expect(rag.queries).toHaveLength(1);
    expect(rag.queries[0].title).toBe('Count of Plot in Zones');
    expect(rag.queries[0].lines).toEqual(['6 plots in total', 'By Zone — A: 3', 'By Zone — B: 2', 'By Zone — C: 1']);
    expect(rag.context).toContain('QUERY RESULTS');
    expect(rag.direct).toBeNull();
  });
  it('counts the records of a table, filtered by a value it names', () => {
    const rag = ask('how many ripe harvests are there?');
    expect(rag.queries[0].lines[0]).toBe('6 records in total');
    expect(rag.queries[0].sql).toContain('Chili type = ripe');
  });
  it('a zone named in the question picks the plots of that zone, in another table through the plot', () => {
    const rag = ask('how many harvest records in zone A');
    expect(rag.queries[0].lines[0]).toBe('4 records in total');
  });
  it('counts only the days it is asked about', () => {
    expect(ask('how many harvest records on 2 Nov').queries[0].lines[0]).toBe('2 records in total');
    expect(ask('how many harvests in November').queries[0].lines[0]).toBe('5 records in total');
  });
});

describe('totals, averages and the most', () => {
  it('"how many plants are dead" adds up the column that holds that count', () => {
    const rag = ask('how many plants are dead');
    expect(rag.queries[0].title).toBe('Total of Dead plant');
    expect(rag.queries[0].lines[0]).toBe('15 (from 2 records)');
  });
  it('adds up a column, optionally for a period', () => {
    expect(ask('total harvest yield').queries[0].lines[0]).toBe('492 (from 7 records)');
    expect(ask('total harvest yield in November').queries[0].lines[0]).toBe('435 (from 5 records)');
  });
  it('averages', () => {
    expect(ask('what is the average harvest yield').queries[0].lines[0]).toBe('70.29 (from 7 records)');
  });
  it('groups by a column the question names, also one of another table (the zone, through the plot)', () => {
    const byPlot = ask('total harvest yield per plot').queries[0];
    expect(byPlot.title).toBe('Total of Harvest yield by Plot');
    expect(byPlot.lines.slice(0, 2)).toEqual(['A2: 300', 'A1: 127']);
    const byZone = ask('total harvest yield by zone').queries[0];
    expect(byZone.lines.slice(0, 3)).toEqual(['A: 427', 'B: 60', '(none): 5']);
  });
  it('which plot harvested the most', () => {
    const top = ask('which plot harvested the most').queries[0];
    expect(top.title).toBe('Total of Harvest yield by Plot');
    expect(top.lines[0]).toBe('A2: 300');
  });
  it('the least, among records', () => {
    expect(ask('what is the lowest harvest yield').queries[0].lines[0]).toContain('5');
  });
});

describe('what happened, and what does not fit', () => {
  it('a day brings that day from every table, by plot', () => {
    const rag = ask('what happened on 2 Nov');
    expect(rag.queries[0].title).toBe('Searched every table for the day or plot');
    expect(rag.context).toContain('RECORDS:');
    expect(rag.context).toContain('PLOT A1');
    expect(rag.records).toBe(2);
  });
  it('checks every table for records that do not fit', () => {
    const rag = ask('does anything not fit?');
    expect(rag.queries[0].warn).toBe(true);
    expect(rag.notes.join('\n')).toContain('Harvest: 1 record is dated before the plot was planted, e.g. A1 01/05/2026 (planted 01/06/2026)');
    expect(rag.notes.join('\n')).toContain('Harvest: 1 record has no plot');
    expect(rag.direct).toContain('found 2 things that don\'t fit:');
    expect(rag.direct).toContain('• Harvest: 1 record has no plot');
  });
  it('looks for empty cells in the table named', () => {
    const rag = ask('what is missing in harvest');
    expect(rag.queries[0].lines).toEqual(['Zone plot: 1 of 7 empty']);
  });
});

describe('a question the queries cannot take', () => {
  it('searches the records for its words, else says it found nothing itself', () => {
    expect(ask('tell me about A2').queries[0].title).toContain('Searched');
    const none = ask('hello there');
    expect(none.found).toBe(false);
    expect(none.direct).toContain("couldn't find anything");
  });
  it('a follow-up keeps the table of the question before', () => {
    const first = ask('how many harvest records in zone A');
    const next = ask('and what about that in zone B', first.carry);
    expect(next.queries[0].lines[0]).toBe('2 records in total');
    expect(next.understood.join(' ')).toContain('Carried over');
  });
});
