import type { Column } from '@core/models';
import { makeSheet } from '@shared/testing/test-helpers';
import { activePlots, doneDateColumn, stageStatus, stageStatuses } from './stage-status';

const TODAY = '2026-11-18';

// The Zones table: three plots in use, one unused.
const zones = makeSheet(1, 'Zones', [
  { key: 'c1', name: 'Zone', type: 'text' },
  { key: 'c2', name: 'Plot', type: 'text' },
  { key: 'c5', name: 'Zone number', type: 'number' },
  { key: 'c6', name: 'Row', type: 'number' },
  { key: 'c7', name: 'Column', type: 'number' },
  { key: 'c8', name: 'Plot status', type: 'text' },
], [
  { c1: 'A', c2: 'A1', c5: '1', c6: '1', c7: '1', c8: 'Active' },
  { c1: 'A', c2: 'A2', c5: '1', c6: '1', c7: '2', c8: 'Active' },
  { c1: 'B', c2: 'B1', c5: '2', c6: '1', c7: '1', c8: 'Active' },
  { c1: 'B', c2: 'B2', c5: '2', c6: '1', c7: '2', c8: 'Unused' },
], 'zones');
const active = activePlots(zones);

const zone: Column = { key: 'c2', name: 'Zone', type: 'link', source: "'Zones'[Plot]" };
const round: Column = { key: 'c5', name: 'Application', type: 'text' };

// A log of rounds as the farm's sheet lists them: every round of every plot up front, the day filled in once done.
// Fertilizer's own Date stayed empty; its day is in "applied".
const fertilizerColumns: Column[] = [
  { key: 'c4', name: 'ID', type: 'number', auto: true },
  { key: 'c1', name: 'Date', type: 'date' },
  zone,
  round,
  { key: 'c6', name: 'applied', type: 'date' },
];

describe('A stage’s status, from what has been entered', () => {
  it('counts the active plots as the Zone Map does', () => {
    expect([...active].sort()).toEqual(['a1', 'a2', 'b1']);
  });

  it('is Not started with nothing entered', () => {
    expect(stageStatus(makeSheet(5, 'Irrigation', fertilizerColumns, []), active, TODAY)).toEqual({ state: 'not-started', percent: null, late: 0, detail: 'Nothing entered yet' });
    // A row that only carries the ID the app numbers is not input.
    expect(stageStatus(makeSheet(5, 'Irrigation', fertilizerColumns, [{ c4: '1' }]), active, TODAY).state).toBe('not-started');
  });

  it('dates a round by the date column most filled in', () => {
    const sheet = makeSheet(6, 'Fertilizer', fertilizerColumns, [{ c2: 'A1', c6: '2026-06-15' }, { c2: 'A1' }]);
    expect(doneDateColumn(sheet)!.name).toBe('applied');
  });

  it('measures planned rounds: done, skipped (a later round of the plot done) and left to do', () => {
    const sheet = makeSheet(6, 'Fertilizer', fertilizerColumns, [
      { c2: 'A1', c5: '1st', c6: '2026-06-15' },
      { c2: 'A1', c5: '2nd' }, // skipped: the 3rd was done
      { c2: 'A1', c5: '3rd', c6: '2026-07-15' },
      { c2: 'A1', c5: '4th' },
      { c2: 'B1', c5: '1st', c6: '2026-06-16' },
      { c2: 'B1', c5: '2nd' },
      { c2: 'B1', c5: '3rd' },
      { c2: 'B1', c5: '4th' },
    ]);
    expect(stageStatus(sheet, active, TODAY)).toEqual({ state: 'in-progress', percent: 50, late: 0, detail: '3 of 8 rounds done · 1 skipped · 4 to do' });
  });

  it('is Not started while no planned round is done, and Done once none is left', () => {
    const none = makeSheet(6, 'Fertilizer', fertilizerColumns, [{ c2: 'A1', c5: '1st' }, { c2: 'A1', c5: '2nd' }]);
    expect(stageStatus(none, active, TODAY)).toMatchObject({ state: 'not-started', percent: 0, detail: '2 rounds planned, none done yet' });
    const all = makeSheet(6, 'Fertilizer', fertilizerColumns, [{ c2: 'A1', c5: '1st' }, { c2: 'A1', c5: '2nd', c6: '2026-07-01' }]);
    expect(stageStatus(all, active, TODAY)).toEqual({ state: 'done', percent: null, late: 0, detail: '1 of 2 rounds done · 1 skipped' });
  });

  it('never shows 100% short of Done', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ c2: `P${i}`, c5: '1st', c6: i < 999 ? '2026-06-15' : '' }));
    expect(stageStatus(makeSheet(6, 'Fertilizer', fertilizerColumns, rows), active, TODAY).percent).toBe(99);
  });

  it('leaves out a round marked not applicable, and counts a planned day gone by as late', () => {
    const pruning = makeSheet(8, 'Pruning', [
      zone,
      { key: 'c7', name: 'Round name', type: 'text' },
      { key: 'c9', name: 'Applicable', type: 'yesno' },
      { key: 'c10', name: 'Planned date', type: 'date' },
      { key: 'c11', name: 'Date', type: 'date' },
    ], [
      { c2: 'A1', c7: '1st Pruning', c9: 'true', c10: '2026-07-08', c11: '2026-07-08' },
      { c2: 'A1', c7: '2nd Pruning', c9: 'true', c10: '2026-11-01' }, // late
      { c2: 'A1', c7: '3rd Pruning', c9: 'true', c10: '2026-12-01' }, // not yet due
      { c2: 'B1', c7: '1st Pruning', c9: 'false', c10: '2026-07-08' }, // not applicable
    ]);
    expect(doneDateColumn(pruning)!.name).toBe('Date');
    expect(stageStatus(pruning, active, TODAY)).toEqual({ state: 'in-progress', percent: 33, late: 1, detail: '1 of 3 rounds done · 2 to do · 1 late' });
  });

  it('counts a round as done by its Applied where the tab gives no day (Fertilizer: TRUE / FALSE)', () => {
    const fertigation = makeSheet(7, 'Fertigation', [
      { key: 'c1', name: 'Date', type: 'date' },
      zone,
      round,
      { key: 'c8', name: 'Applied', type: 'yesno' },
    ], [
      { c2: 'A1', c5: '1', c8: 'true' },
      { c2: 'A1', c5: '2', c8: 'false' }, // skipped: the 3rd was given
      { c2: 'A1', c5: '3', c8: 'true' },
      { c2: 'B1', c5: '1', c8: 'true' },
      { c2: 'B1', c5: '2', c8: 'false' }, // still to do
    ]);
    expect(stageStatus(fertigation, active, TODAY)).toEqual({ state: 'in-progress', percent: 80, late: 0, detail: '3 of 5 rounds done · 1 skipped · 1 to do' });
  });

  it('is Done once every round of a table of rounds is done', () => {
    const pesticides = makeSheet(9, 'Pesticides', [zone, round, { key: 'c1', name: 'Date', type: 'date' }], [
      { c2: 'A1', c5: '1', c1: '2026-07-12' },
      { c2: 'A1', c5: '2', c1: '2026-08-12' },
    ]);
    expect(stageStatus(pesticides, active, TODAY)).toEqual({ state: 'done', percent: null, late: 0, detail: '2 of 2 rounds done' });
  });

  it('measures a once-per-plot stage by the active plots with a record', () => {
    const progress = makeSheet(4, 'Plant Progress', [zone, { key: 'c3', name: 'Record date', type: 'date' }], [
      { c2: 'A1', c3: '2026-06-01' },
      { c2: 'A2', c3: '2026-06-01' },
      { c2: 'B2', c3: '2026-06-02' }, // an unused plot doesn't count
    ], 'zone-records');
    expect(stageStatus(progress, active, TODAY)).toEqual({ state: 'in-progress', percent: 66, late: 0, detail: '2 of 3 active plots have a record · 1 plot without one' });
    progress.rows.push({ ...progress.rows[0], rowId: 99, data: { c2: 'B1', c3: '2026-06-03' } });
    expect(stageStatus(progress, active, TODAY)).toMatchObject({ state: 'done', detail: 'Every active plot (3) has a record' });
  });

  it('keeps any other log In progress, with its records, its last day so far and any dated after today', () => {
    const harvest = makeSheet(10, 'Harvest', [{ ...zone, name: 'Zone plot' }, { key: 'c7', name: 'Date harvest', type: 'date' }], [
      { c2: 'A1', c7: '2026-11-17' },
      { c2: 'B1', c7: '2026-09-01' },
      { c2: 'B1', c7: '2027-02-28' },
    ], 'harvest');
    expect(stageStatus(harvest, active, TODAY)).toEqual({ state: 'in-progress', percent: null, late: 0, detail: '3 records · last 17/11/2026 · 1 dated after today' });
  });

  it('works every table of a MAC out, by its id', () => {
    const statuses = stageStatuses([zones, makeSheet(5, 'Irrigation', fertilizerColumns, [])], TODAY);
    expect(statuses.get(5)!.state).toBe('not-started');
    expect(statuses.get(1)!.state).toBe('in-progress');
  });
});
