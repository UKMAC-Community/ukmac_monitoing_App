import type { Column } from '@core/models';
import { makeSheet } from '@shared/testing/test-helpers';
import { buildZoneLayout, plotCard } from './zone-layout';

const columns: Column[] = ['Zone', 'Plot', 'Zone number', 'Row', 'Column', 'Plot status'].map((name, index) => ({
  key: `c${index + 1}`,
  name,
  type: ['Zone number', 'Row', 'Column'].includes(name) ? 'number' : 'text',
}));
const layout = buildZoneLayout(
  makeSheet(1, 'Zones', columns, [
    { c1: 'A', c2: 'A1', c3: '1', c4: '1', c5: '1', c6: 'Active' },
    { c1: 'Old chili', c2: 'O1', c4: '1', c5: '1', c6: 'Active' },
  ], 'zones'),
  null,
);
const card = (plot: string) => plotCard(layout.cells.find((cell) => cell.plot === plot)!);

describe('a plot\'s card on the map', () => {
  it('says the day a plot was planted and its latest record, without its status', () => {
    const records = makeSheet(2, 'Plant Progress', ['Zone plot', 'Record date', 'Plant count', 'Status'].map((name, index) => ({ key: `r${index + 1}`, name, type: name === 'Record date' ? 'date' : 'text' }) as Column), [
      { r1: 'A1', r2: '2026-03-20', r3: '1500', r4: 'Transplant' },
      { r1: 'A1', r2: '2026-06-09', r3: '1527', r4: 'Cycle complete' },
    ], 'zone-records');
    const withRecords = buildZoneLayout(makeSheet(1, 'Zones', columns, [{ c1: 'A', c2: 'A1', c3: '1', c4: '1', c5: '1', c6: 'Active' }], 'zones'), records);
    const lines = plotCard(withRecords.cells[0]).lines;
    expect(lines[0]).toBe('Planted 20/03/2026');
    expect(lines[1]).toBe('Latest 09/06/2026 · 1527 plants');
    expect(lines.join(' ')).not.toContain('Cycle complete');
  });

  it('names the zone of a plot that has a zone number', () => {
    expect(card('A1').lines[0]).toBe('Zone A · 1 · Not planted yet');
  });

  it('names a plot with no zone number by its area, not as a zone', () => {
    expect(card('O1').lines[0]).toBe('Old chili · Not planted yet');
  });
});
