import type { MapShape } from '../components/mac-map';
import { mapCentre } from './zone-layout';

const plot = (points: [number, number][]): MapShape => ({ id: 'a', points, fill: '#fff', stroke: '#000', label: 'A1' });
// Made-up plots: the outlines span latitude 10.000–10.004 and longitude 100.000–100.010.
const plots = [plot([[10.0, 100.0], [10.0, 100.004], [10.002, 100.004]]), plot([[10.004, 100.006], [10.004, 100.01], [10.002, 100.01]])];

describe('where the satellite map looks', () => {
  it("is the MAC's own place when it has one", () => {
    expect(mapCentre({ latitude: 1.5, longitude: 2.5 }, plots)).toEqual({ lat: 1.5, lng: 2.5 });
  });

  it('is the middle of the plots when the MAC has no place (a MAC opened from a file)', () => {
    const at = mapCentre({ latitude: null, longitude: null }, plots)!;
    expect(at.lat).toBeCloseTo(10.002, 6);
    expect(at.lng).toBeCloseTo(100.005, 6);
  });

  it('is nothing when there is neither a place nor a plot with a shape', () => {
    expect(mapCentre({ latitude: null, longitude: null }, [])).toBeNull();
    expect(mapCentre({ latitude: null, longitude: null }, [plot([[1, 1], [2, 2]])])).toBeNull();
    expect(mapCentre({ latitude: 12, longitude: null }, [])).toBeNull();
  });
});
