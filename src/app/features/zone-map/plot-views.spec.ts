import type { Column } from '@core/models';
import { makeSheet } from '@shared/testing/test-helpers';
import { amountOf, missingPlots, NO_DATA, plotViews, sayOf } from './plot-views';

const col = (key: string, name: string, type: Column['type'] = 'text'): Column => ({ key, name, type });

// Plant Progress: A1 has two records (the later one counts), A2 one with no variety of its own (its batch's is used).
const progress = makeSheet(4, 'Plant Progress', [col('b', 'Nursery batch'), col('v', 'Plant type'), col('p', 'Zone plot'), col('d', 'Record date', 'date'), col('s', 'Status')], [
  { b: 'NB-01', v: 'Mali', p: 'A1', d: '2026-06-08', s: 'Growing' },
  { b: 'NB-01', v: 'Mali', p: 'A1', d: '2026-09-01', s: 'Harvesting' },
  { b: 'NB-02', v: '', p: 'A2', d: '2026-06-09', s: 'Growing' },
  { b: 'NB-03', v: 'Daineang', p: 'B1', d: '2026-06-10', s: 'Growing' },
], 'zone-records');
const batches = makeSheet(16, 'Batch', [col('n', 'Batch number'), col('v', 'Variety name')], [{ n: 'NB-02', v: 'Daineang' }], 'batches');
// Fungicide: every round listed up front; a round is reached when it is dated.
const fertigation = makeSheet(7, 'Fungicide', [col('p', 'Zone'), col('a', 'Application'), col('d', 'Date', 'date')], [
  { p: 'A1', a: '1st Application', d: '2026-06-20' },
  { p: 'A1', a: '2nd Application', d: '2026-07-03' },
  { p: 'A1', a: '10th Application', d: '' },
  { p: 'A2', a: '1st Application', d: '2026-06-21' },
  { p: 'A2', a: '2nd Application', d: '' },
  { p: 'B1', a: '1st Application', d: '' },
], 'fungicide');
const harvest = makeSheet(10, 'Harvest', [col('p', 'Zone plot'), col('k', 'Chili type'), col('d', 'Date harvest', 'date'), col('y', 'Harvest yield', 'number')], [
  { p: 'A1', k: 'ripe', d: '2026-09-19', y: '5' },
  { p: 'A1', k: 'unripe', d: '2027-02-05', y: '6' },
  { p: 'B1', k: 'ripe', d: '2026-10-01', y: '2' },
], 'harvest');
const irrigation = makeSheet(6, 'Irrigation', [col('d', 'Date', 'date'), col('p', 'Zone'), col('n', 'Note')], [], 'irrigation');
const zones = makeSheet(1, 'Zones', [col('z', 'Zone'), col('p', 'Plot')], [{ z: 'A', p: 'A1' }], 'zones');

const views = plotViews([zones, progress, batches, fertigation, harvest, irrigation]);
const left = ['fertigation', 'pruning', 'pesticides'].map((key) => makeSheet(40, key, [col('p', 'Zone'), col('d', 'Date', 'date')], [{ p: 'A1', d: '2026-07-01' }], key));
const view = (key: string) => views.find((item) => item.key === key)!;

describe('the Zone Map shown by variety, batch and each table', () => {
  it('lists the variety, the batch, Plant Progress, then each table of the plots\' work (not Zones)', () => {
    expect(views.map((item) => item.label)).toEqual(['Variety', 'Nursery batch', 'Plant Progress', 'Fungicide', 'Harvest', 'Irrigation']);
  });

  it('leaves Fertigation, Pruning and Pesticides out of the list', () => {
    const shown = plotViews([zones, progress, ...left]).map((item) => item.label);
    expect(shown).toEqual(['Variety', 'Nursery batch', 'Plant Progress']);
  });

  it('gives each plot the variety of its latest record, a record with none its batch\'s, each variety a colour', () => {
    const variety = view('variety');
    expect(sayOf(variety, 'A1')?.text).toBe('Mali');
    expect(sayOf(variety, 'a2')?.text).toBe('Daineang');
    expect(variety.legend.map((item) => [item.label, item.count])).toEqual([['Daineang', 2], ['Mali', 1]]);
    expect(sayOf(variety, 'A1')?.colour).not.toBe(sayOf(variety, 'B1')?.colour);
    expect(variety.summary).toBe('2 varieties');
  });

  it('gives Plant Progress each plot\'s latest status', () => {
    expect(sayOf(view('table:4'), 'A1')?.text).toBe('Harvesting');
    expect(sayOf(view('batch'), 'A1')?.text).toBe('NB-01');
  });

  it('says each batch\'s variety beside it in the legend', () => {
    expect(view('batch').legend.map((item) => [item.label, item.note])).toEqual([['NB-01', 'Mali'], ['NB-02', 'Daineang'], ['NB-03', 'Daineang']]);
    expect(view('variety').legend.every((item) => item.note === undefined)).toBe(true);
  });

  it('lists the statuses in the crop\'s order, not by how many plots, each its stage\'s colour', () => {
    const statuses = ['Harvesting', 'Harvesting', 'Harvesting', 'Establishing', 'Establishing', 'Fruit set', 'Cycle complete', 'Flowering', 'Vegetative'];
    const crop = makeSheet(4, 'Plant Progress', [col('p', 'Zone plot'), col('s', 'Status')], statuses.map((status, at) => ({ p: `P${at}`, s: status })), 'zone-records');
    const stages = plotViews([crop]).find((item) => item.label === 'Plant Progress')!;
    expect(stages.legend.map((item) => [item.label, item.count])).toEqual([
      ['Establishing', 2],
      ['Vegetative', 1],
      ['Flowering', 1],
      ['Fruit set', 1],
      ['Harvesting', 3],
      ['Cycle complete', 1],
    ]);
    expect(new Set(stages.legend.map((item) => item.colour)).size).toBe(6);
    expect(stages.summary).toBe('6 stages');
  });

  it('gives a table of rounds the latest round each plot has reached, a round listed but not done not counting', () => {
    const fert = view('table:7');
    expect(fert.kind).toBe('rounds');
    expect(sayOf(fert, 'A1')).toEqual(fieldsOf({ text: '2nd Application', short: '2nd' }));
    expect(sayOf(fert, 'A2')?.short).toBe('1st');
    // B1 has its rounds listed, none done: no data.
    expect(sayOf(fert, 'B1')).toBeUndefined();
    expect(fert.legend.map((item) => [item.label, item.count])).toEqual([['1st Application', 1], ['2nd Application', 1]]);
    // Further on is darker: the 2nd's shade differs from the 1st's.
    expect(fert.legend[0].colour).not.toBe(fert.legend[1].colour);
    expect(fert.summary).toBe('up to 2nd Application');
  });

  it('gives a table with no rounds each plot\'s latest date and how many', () => {
    const crop = view('table:10');
    expect(crop.kind).toBe('dates');
    expect(sayOf(crop, 'A1')).toEqual(fieldsOf({ text: '11', short: '11', more: '2 harvests · latest 05/02/2027', details: ['Ripe 5 · Unripe 6'] }));
    expect(crop.summary).toBe('up to 11 a plot');
  });

  it('colours a harvest table one colour a plot, darker the more kg, with ripe and unripe told apart', () => {
    const crop = view('table:10');
    expect(sayOf(crop, 'A1')!.colour).not.toBe(sayOf(crop, 'B1')!.colour);
    expect(sayOf(crop, 'A1')!.details).toEqual(['Ripe 5 · Unripe 6']);
    expect(sayOf(crop, 'B1')!.details).toEqual(['Ripe 2 · Unripe 0']);
    expect(crop.legend.reduce((sum, item) => sum + item.count, 0)).toBe(2);
  });

  it('adds up what a harvest table weighs for each plot', () => {
    const crop = view('table:10');
    expect(crop.amount?.label).toBe('Harvest yield');
    expect(amountOf(crop, 'A1')).toBe(11);
    expect(amountOf(crop, 'b1')).toBe(2);
    expect(amountOf(crop, 'C9')).toBe(0);
    expect(amountOf(view('table:7'), 'A1')).toBe(0);
  });

  it('lists the plots in use a view has nothing for; a table with no rows has every plot missing', () => {
    expect(missingPlots(view('table:7'), ['A1', 'A2', 'B1', 'B2'])).toEqual(['B1', 'B2']);
    expect(missingPlots(view('table:6'), ['A1', 'B1'])).toEqual(['A1', 'B1']);
    expect(view('table:6').summary).toBe('nothing dated yet');
    expect(NO_DATA).toMatch(/^#/);
  });
});

/** The fields given, whatever else it has. */
function fieldsOf(fields: Record<string, string | string[]>) {
  return expect.objectContaining(fields);
}
