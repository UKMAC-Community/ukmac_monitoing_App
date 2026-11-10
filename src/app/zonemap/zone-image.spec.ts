import type { MapShape } from '../components/mac-map';
import { planMapPicture } from './zone-image';

const shape = (id: string, points: [number, number][], extra: Partial<MapShape> = {}): MapShape => ({
  id,
  points,
  fill: '#F2A03D',
  stroke: '#c28030',
  label: id,
  ...extra,
});

// Two plots side by side, the second further north (made-up coordinates).
const west = shape('A1', [[10.0, 100.0], [10.0, 100.001], [9.999, 100.001], [9.999, 100.0]], { group: 'Zone A · 1', groupColor: '#c28030' });
const east = shape('B1', [[10.002, 100.002], [10.002, 100.003], [10.001, 100.003], [10.001, 100.002]], { group: 'Zone B · 2', groupColor: '#3c8c3c' });

describe('the map picture of the Zones', () => {
  it('puts north up and east right, at the size of the ground, in the width asked', () => {
    const plan = planMapPicture([west, east], 1000)!;
    expect(plan.width).toBe(1000);
    const [a, b] = plan.shapes;
    expect(b.at[0]).toBeGreaterThan(a.at[0]); // east is to the right
    expect(b.at[1]).toBeLessThan(a.at[1]); // north is higher up
    // 0.001° of longitude and of latitude are about as long, so a plot is about as wide as it is tall.
    expect(a.size[0] / a.size[1]).toBeCloseTo(1.0, 1);
    expect(plan.height).toBeGreaterThan(plan.shapes[0].size[1]);
  });

  it('has a key with each zone once, in order, in the colours of the map', () => {
    const plan = planMapPicture([east, west, { ...west, id: 'A2' }], 1000)!;
    expect(plan.legend).toEqual([
      { text: 'Zone A · 1', color: '#c28030' },
      { text: 'Zone B · 2', color: '#3c8c3c' },
    ]);
  });

  it('draws nothing when there is no plot with an outline', () => {
    expect(planMapPicture([], 1000)).toBeNull();
    expect(planMapPicture([shape('A1', [[1, 1], [2, 2]])], 1000)).toBeNull();
  });
});
