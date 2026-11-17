import type { Column } from '@core/models';
import { makeSheet } from '@shared/testing/test-helpers';
import { buildJourney } from './plot-journey';

const col = (key: string, name: string, extra: Partial<Column> = {}): Column => ({ key, name, type: 'text', ...extra });

const progress = makeSheet(
  4,
  'Plant Progress',
  [col('a', 'ID', { type: 'number' }), col('b', 'Zone plot', { type: 'link' }), col('c', 'Record date', { type: 'date' }), col('d', 'Plant count', { type: 'number' }), col('e', 'Status')],
  [
    { a: '1', b: 'B12', c: '2026-07-20', d: '1200', e: 'Vegetative' },
    { a: '2', b: 'B12', c: '2026-07-04', d: '1239', e: 'Planted' },
    { a: '3', b: 'A1', c: '2026-07-05', d: '900', e: 'Planted' },
  ],
  'zone-records',
);
const harvest = makeSheet(
  10,
  'Harvest',
  [col('a', 'ID', { type: 'number' }), col('b', 'Zone plot', { type: 'link' }), col('c', 'Date harvest', { type: 'date' }), col('d', 'Harvest yield', { type: 'number' }), col('e', 'Chili type')],
  [
    { a: '1', b: 'b12', c: '2026-10-05', d: '1,250', e: 'ripe' },
    { a: '2', b: 'B12', c: '2026-09-28', d: '40', e: 'unripe' },
  ],
  'harvest',
);
const irrigation = makeSheet(6, 'Irrigation', [col('a', 'ID', { type: 'number' }), col('b', 'Date', { type: 'date' }), col('c', 'Zone', { type: 'link' }), col('d', 'Note')], [{ a: '1', b: '2026-07-10', c: 'B12', d: 'Drip, 2 h' }], 'irrigation');

describe('a plot from planting to harvest', () => {
  const journey = buildJourney('B12', [progress, harvest, irrigation]);

  it('lists only that plot\'s rows, in the order they happened, each with its date', () => {
    expect(journey.events.map((event) => [event.label, event.date])).toEqual([
      ['Plant Progress', '2026-07-04'],
      ['Irrigation', '2026-07-10'],
      ['Plant Progress', '2026-07-20'],
      ['Harvest', '2026-09-28'],
      ['Harvest', '2026-10-05'],
    ]);
  });

  it('says each row\'s other columns, without the plot or its number repeated', () => {
    expect(journey.events[0].facts).toEqual([
      { name: 'Plant count', value: '1239' },
      { name: 'Status', value: 'Planted' },
    ]);
    expect(journey.events[1].facts).toEqual([{ name: 'Note', value: 'Drip, 2 h' }]);
  });

  it('counts every table of the group, the empty ones too', () => {
    expect(journey.counts.find((item) => item.kind === 'progress')?.count).toBe(2);
    expect(journey.counts.find((item) => item.kind === 'harvest')?.count).toBe(2);
    expect(journey.counts.find((item) => item.kind === 'pruning')?.count).toBe(0);
    expect(journey.counts.length).toBe(8);
  });

  it('works out when it was planted, its plants now, the first and last harvest, and the yield', () => {
    expect(journey.planted).toBe('2026-07-04');
    expect(journey.plants).toBe('1200');
    expect(journey.firstHarvest).toBe('2026-09-28');
    expect(journey.lastHarvest).toBe('2026-10-05');
    expect(journey.yield).toBe(1290);
  });

  it('is empty for a plot with no rows, or a table not there', () => {
    const none = buildJourney('Z99', [progress]);
    expect(none.events).toEqual([]);
    expect(none.planted).toBe('');
    expect(buildJourney('B12', []).events).toEqual([]);
  });
});
