import type { MapShape } from './mac-map';
import { BED_COLORS, plotBeds } from './plot-beds';

// A plot about 20 m across and 50 m long, near the farm (1° of latitude is about 110.6 km).
const LAT = 12.137;
const LNG = 104.095;
const EAST = 111_320 * Math.cos((LAT * Math.PI) / 180);
const plot = (bed: MapShape['bed'], id = 'A1'): MapShape => ({
  id,
  fill: '#fff',
  stroke: '#000',
  label: id,
  bed,
  points: [
    [LAT, LNG],
    [LAT + 50 / 110_574, LNG],
    [LAT + 50 / 110_574, LNG + 20 / EAST],
    [LAT, LNG + 20 / EAST],
  ],
});

describe('plotBeds', () => {
  it('lays a sandy field, beds along the long side and plants on them for a plot with plants', () => {
    const parts = plotBeds([plot('planting')], 3);
    const count = (part: string) => parts.filter((feature) => feature.properties.part === part).length;
    expect(count('field')).toBe(1);
    expect(count('bed')).toBeGreaterThanOrEqual(4);
    expect(count('bed')).toBeLessThanOrEqual(6);
    expect(count('plant')).toBeGreaterThan(count('bed'));
    expect(parts.filter((feature) => feature.properties.part === 'plant').every((feature) => feature.properties.colour === BED_COLORS.sprout)).toBe(true);
    // Everything stands on the plot's own height.
    expect(Math.min(...parts.map((feature) => feature.properties.base))).toBe(3);
  });

  it("runs the beds along the plot's long side", () => {
    const bed = plotBeds([plot('tilled')], 0).find((feature) => feature.properties.part === 'bed')!;
    const ring = bed.geometry.coordinates[0];
    const lngs = ring.map((point) => point[0]);
    const lats = ring.map((point) => point[1]);
    const north = (Math.max(...lats) - Math.min(...lats)) * 110_574;
    const east = (Math.max(...lngs) - Math.min(...lngs)) * EAST;
    expect(north).toBeGreaterThan(east * 5);
  });

  it('shows bare beds where nothing is planted, red among the green at harvest, a flat pool for water, and nothing where it is not in use', () => {
    expect(plotBeds([plot('tilled')], 3).some((feature) => feature.properties.part === 'plant')).toBe(false);
    const harvest = plotBeds([plot('harvest')], 3).filter((feature) => feature.properties.part === 'plant');
    expect(harvest.some((feature) => feature.properties.colour === BED_COLORS.chili)).toBe(true);
    expect(harvest.some((feature) => feature.properties.colour === BED_COLORS.leaf)).toBe(true);
    expect(plotBeds([plot('water')], 3).map((feature) => feature.properties.part)).toEqual(['water']);
    expect(plotBeds([plot('unused'), plot(undefined)], 3)).toEqual([]);
  });

  it('leaves a plot too small to lay beds on alone', () => {
    const tiny: MapShape = { ...plot('tilled'), points: [[LAT, LNG], [LAT + 0.00002, LNG], [LAT + 0.00002, LNG + 0.00002]] };
    expect(plotBeds([tiny], 3)).toEqual([]);
  });
});
