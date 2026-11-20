import type { Column } from '@core/models';
import { makeSheet } from '@shared/testing/test-helpers';
import { buildJourney, foldHarvests, type JourneyEvent } from './plot-journey';

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

describe('a harvest says both its ripe and unripe yield', () => {
  const split = makeSheet(
    11,
    'Harvest',
    [
      col('a', 'Zone plot', { type: 'link' }),
      col('b', 'Date harvest', { type: 'date' }),
      col('c', 'Chili type'),
      col('d', 'Harvest yield', { type: 'number' }),
      col('e', 'Ripe yield', { type: 'formula', formula: '=IF([Chili type]="ripe",[Harvest yield],"")' }),
      col('f', 'Unripe yield', { type: 'formula', formula: '=IF([Chili type]="unripe",[Harvest yield],"")' }),
    ],
    [
      { a: 'B12', b: '2027-02-11', c: 'ripe', d: '88.8' },
      { a: 'B12', b: '2027-02-12', c: 'unripe', d: '20.6' },
    ],
    'harvest',
  );

  it('puts null where the type has no yield', () => {
    const [ripe, unripe] = buildJourney('B12', [split]).events;
    expect(ripe.facts).toContainEqual({ name: 'Ripe yield', value: '88.8' });
    expect(ripe.facts).toContainEqual({ name: 'Unripe yield', value: 'null' });
    expect(unripe.facts).toContainEqual({ name: 'Ripe yield', value: 'null' });
    expect(unripe.facts).toContainEqual({ name: 'Unripe yield', value: '20.6' });
  });
});

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

describe('a plot picked many times', () => {
  const event = (kind: JourneyEvent['kind'], date: string): JourneyEvent => ({ kind, label: kind, icon: '', date, facts: [] });
  const events = [
    event('progress', '2026-07-01'),
    event('harvest', '2026-09-01'),
    event('harvest', '2026-09-10'),
    event('pruning', '2026-09-12'),
    event('harvest', '2026-09-20'),
    event('harvest', '2026-10-01'),
    event('harvest', '2026-10-10'),
    event('harvest', '2026-10-20'),
  ];
  const shown = (items: ReturnType<typeof foldHarvests>) => items.map((item) => (item.event ? `${item.event.kind} ${item.event.date}` : `fold ${item.fold!.count}${item.fold!.open ? ' open' : ''}`));

  it('shows its first harvest and its last two, the ones between folded away where they were', () => {
    expect(shown(foldHarvests(events, false))).toEqual(['progress 2026-07-01', 'harvest 2026-09-01', 'fold 3', 'pruning 2026-09-12', 'harvest 2026-10-10', 'harvest 2026-10-20']);
  });

  it('shows them all when asked, with the way back where they were folded', () => {
    expect(shown(foldHarvests(events, true))).toEqual([
      'progress 2026-07-01',
      'harvest 2026-09-01',
      'fold 3 open',
      'harvest 2026-09-10',
      'pruning 2026-09-12',
      'harvest 2026-09-20',
      'harvest 2026-10-01',
      'harvest 2026-10-10',
      'harvest 2026-10-20',
    ]);
  });

  it('folds nothing for three harvests or fewer', () => {
    const few = events.slice(0, 5);
    expect(shown(foldHarvests(few, false))).toEqual(few.map((item) => `${item.kind} ${item.date}`));
  });
});
