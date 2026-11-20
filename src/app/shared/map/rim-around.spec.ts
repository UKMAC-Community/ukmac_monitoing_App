import { rimAround } from './mac-map-3d';

describe('the white rim round the picked plot', () => {
  // A plot 20 m east-west by 10 m north-south ([lat, lng] corners), clockwise as a person might draw it.
  const lat0 = 12.12;
  const lng0 = 104.09;
  const mLat = 111320;
  const mLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const at = (east: number, north: number): [number, number] => [lat0 + north / mLat, lng0 + east / mLng];
  const plot = [at(-10, 5), at(10, 5), at(10, -5), at(-10, -5)];

  it('stands the same width out from every side, the plot itself the hole', () => {
    const [outer, hole] = rimAround(plot, 1.5);
    const east = outer.map(([lng]) => (lng - lng0) * mLng);
    const north = outer.map(([, lat]) => (lat - lat0) * mLat);
    expect(Math.max(...east)).toBeCloseTo(11.5, 3);
    expect(Math.min(...east)).toBeCloseTo(-11.5, 3);
    expect(Math.max(...north)).toBeCloseTo(6.5, 3);
    expect(Math.min(...north)).toBeCloseTo(-6.5, 3);
    // Both rings closed; the hole is the plot's own corners.
    expect(outer[0]).toEqual(outer.at(-1));
    expect(hole).toHaveLength(5);
    expect(hole.slice(0, 4).map(([lng, lat]) => [lat, lng])).toEqual([...plot].reverse());
  });

  it('is the same whichever way round the corners go', () => {
    const one = rimAround(plot, 1)[0].slice(0, 4).map(([lng, lat]) => `${lng.toFixed(9)},${lat.toFixed(9)}`).sort();
    const other = rimAround([...plot].reverse(), 1)[0].slice(0, 4).map(([lng, lat]) => `${lng.toFixed(9)},${lat.toFixed(9)}`).sort();
    expect(other).toEqual(one);
  });
});
