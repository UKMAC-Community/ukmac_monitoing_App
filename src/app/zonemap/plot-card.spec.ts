import type { Column } from '../core/models';
import { makeSheet } from '../test-helpers';
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
  it('names the zone of a plot that has a zone number', () => {
    expect(card('A1').lines[0]).toBe('Zone A · 1 · Not planted yet');
  });

  it('names a plot with no zone number by its area, not as a zone', () => {
    expect(card('O1').lines[0]).toBe('Old chili · Not planted yet');
  });
});
