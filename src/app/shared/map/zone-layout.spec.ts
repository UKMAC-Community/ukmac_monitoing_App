import type { Cells, Column } from '@core/models';
import { makeSheet } from '@shared/testing/test-helpers';
import { buildZoneLayout, formatOutline, notInUseKinds } from './zone-layout';

const columns: Column[] = ['Zone', 'Plot', 'Zone number', 'Row', 'Column', 'Plot status', 'Status name', 'Outline'].map((name, index) => ({
  key: `c${index + 1}`,
  name,
  type: name === 'Zone number' || name === 'Row' || name === 'Column' ? 'number' : 'text',
}));
const row = (zone: string, plot: string, status: string, name = ''): Cells => ({
  c1: zone, c2: plot, c3: '', c4: '1', c5: '1', c6: status, c7: name, c8: formatOutline([[1, 1], [1, 2], [2, 2]]),
});

describe('notInUseKinds', () => {
  it('says what the not-in-use plots are: greenhouses, chicken, forest…, and land of a chili zone left empty, most first', () => {
    const layout = buildZoneLayout(
      makeSheet(1, 'Zones', columns, [
        row('A', 'A1', 'Active'),
        row('B', '', 'Unused'),
        row('B', '', 'Unused'),
        row('Greenhouse 1', 'Greenhouse 1', 'Unused'),
        row('Greenhouse 2', 'Greenhouse 2', 'Unused'),
        row('Greenhouse 3', 'Greenhouse 3', 'Unused'),
        row('Chicken', 'Chicken 1', 'Unused', 'Chicken'),
        row('Pond', 'Pond 1', 'Water', 'Pond'),
      ], 'zones'),
      null,
    );
    expect(notInUseKinds(layout.cells)).toEqual([
      { count: 3, kind: 'Greenhouse' },
      { count: 2, kind: 'Zone B · empty land' },
      { count: 1, kind: 'Chicken' },
    ]);
  });
});
