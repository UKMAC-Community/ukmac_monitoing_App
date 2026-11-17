import type { MapShape } from './mac-map';

/**
 * The farm's look drawn on the satellite: each plot a sandy field with raised beds along its long side, young plants or chilli
 * bushes heavy with red on them where it is planted, bare tilled beds where it is not, water, and the plots not in use left as
 * they are. The same look as the Farm view (its palette), laid on the plots' own outlines, so it is "the farm, on the imagery".
 * Pure: the map draws what this makes, as extrusions standing on the plot's own bed.
 */

/** What a plot is, for how its beds look. */
export type BedKind = 'tilled' | 'planting' | 'harvest' | 'water' | 'unused';

export const BED_COLORS = {
  bed: '#c99c6a',
  /** The bed's own colour once planted (young green) and once harvest has begun (golden), so the stage shows from far out, before the plants are close enough to see. */
  bedPlanting: '#a9d18a',
  bedHarvest: '#f1b866',
  chili: '#e5432f',
  field: '#ead7b1',
  furrow: '#a37650',
  leaf: '#4f9e3f',
  sprout: '#7cc35f',
  water: '#69bdf0',
};

export interface BedFeature {
  type: 'Feature';
  properties: { id: string; part: 'field' | 'bed' | 'plant' | 'water'; colour: string; base: number; top: number };
  geometry: { type: 'Polygon'; coordinates: [number, number][][] };
}

const M_PER_LAT = 110_574;
const M_PER_LNG = 111_320;
/** The beds' pitch across the plot (m), a bed's share of it, and the length a stretch of plants takes with its gap (m). */
const BED_PITCH = 3;
const BED_SHARE = 0.62;
const PLANT_PITCH = 5;
const PLANT_SHARE = 0.74;
/** Under this a plot is too small to lay beds on (m). */
const TOO_SMALL = 6;

/** The beds, plants and water of every plot that has a kind, standing on `base` (the plot's own height, m). */
export function plotBeds(shapes: readonly MapShape[], base: number): BedFeature[] {
  return shapes.flatMap((shape) => (shape.bed && shape.bed !== 'unused' && shape.points.length >= 3 ? bedsOf(shape, shape.bed, base) : []));
}

function bedsOf(shape: MapShape, kind: Exclude<BedKind, 'unused'>, base: number): BedFeature[] {
  const lat0 = shape.points.reduce((sum, point) => sum + point[0], 0) / shape.points.length;
  const lng0 = shape.points.reduce((sum, point) => sum + point[1], 0) / shape.points.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const metres = shape.points.map(([lat, lng]) => ({ x: (lng - lng0) * k * M_PER_LNG, y: (lat - lat0) * M_PER_LAT }));

  // The plot's direction: along its longest edge.
  let angle = 0;
  let longest = -1;
  metres.forEach((point, index) => {
    const next = metres[(index + 1) % metres.length];
    const length = Math.hypot(next.x - point.x, next.y - point.y);
    if (length > longest) {
      longest = length;
      angle = Math.atan2(next.y - point.y, next.x - point.x);
    }
  });
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const us = metres.map((point) => point.x * cos + point.y * sin);
  const vs = metres.map((point) => -point.x * sin + point.y * cos);
  const [u0, u1] = [Math.min(...us), Math.max(...us)];
  const [v0, v1] = [Math.min(...vs), Math.max(...vs)];
  // Beds run along the longer side: `l` is along it, `s` across.
  const alongU = u1 - u0 >= v1 - v0;
  const [l0, l1, s0, s1] = alongU ? [u0, u1, v0, v1] : [v0, v1, u0, u1];

  // A rectangle in (along, across), as a ring of [lat, lng] corners → GeoJSON [lng, lat].
  const rect = (a0: number, a1: number, c0: number, c1: number): [number, number][] => {
    const corners = [
      [a0, c0],
      [a1, c0],
      [a1, c1],
      [a0, c1],
    ];
    const ring = corners.map(([a, c]) => {
      const u = alongU ? a : c;
      const v = alongU ? c : a;
      const x = u * cos - v * sin;
      const y = u * sin + v * cos;
      return [lng0 + x / (k * M_PER_LNG), lat0 + y / M_PER_LAT] as [number, number];
    });
    return [...ring, ring[0]];
  };
  const feature = (part: BedFeature['properties']['part'], ring: [number, number][], colour: string, from: number, to: number): BedFeature => ({
    type: 'Feature',
    properties: { id: shape.id, part, colour, base: base + from, top: base + to },
    geometry: { type: 'Polygon', coordinates: [ring] },
  });

  const length = l1 - l0;
  const width = s1 - s0;
  if (Math.min(length, width) < TOO_SMALL) return [];
  const fieldIn = Math.min(length, width) * 0.06;
  const [f0, f1, g0, g1] = [l0 + fieldIn, l1 - fieldIn, s0 + fieldIn, s1 - fieldIn];

  if (kind === 'water') return [feature('water', rect(f0, f1, g0, g1), BED_COLORS.water, 0, 0.6)];

  const out: BedFeature[] = [feature('field', rect(f0, f1, g0, g1), BED_COLORS.field, 0, 0.4)];
  // The beds sit inside the field with room round them.
  const room = Math.min(length, width) * 0.1;
  const [b0, b1, c0, c1] = [f0 + room, f1 - room, g0 + room, g1 - room];
  const across = Math.max(2, Math.floor((c1 - c0) / BED_PITCH));
  const pitch = (c1 - c0) / across;
  const bedWidth = pitch * BED_SHARE;
  const stretches = Math.max(1, Math.floor((b1 - b0) / PLANT_PITCH));
  const step = (b1 - b0) / stretches;
  for (let bed = 0; bed < across; bed += 1) {
    const mid = c0 + pitch * (bed + 0.5);
    const [s_a, s_b] = [mid - bedWidth / 2, mid + bedWidth / 2];
    out.push(feature('bed', rect(b0, b1, s_a, s_b), kind === 'tilled' ? BED_COLORS.furrow : kind === 'harvest' ? BED_COLORS.bedHarvest : BED_COLORS.bedPlanting, 0.4, 1.6));
    if (kind === 'tilled') continue;
    const plantWidth = bedWidth * 0.7;
    for (let at = 0; at < stretches; at += 1) {
      const start = b0 + step * at + (step * (1 - PLANT_SHARE)) / 2;
      const end = start + step * PLANT_SHARE;
      // A harvest has begun: bushes heavy with red among the green.
      const ripe = kind === 'harvest' && (at + bed) % 3 === 0;
      const colour = kind === 'planting' ? BED_COLORS.sprout : ripe ? BED_COLORS.chili : BED_COLORS.leaf;
      const top = kind === 'planting' ? 3.4 : ripe ? 4.6 : 4.2;
      out.push(feature('plant', rect(start, end, mid - plantWidth / 2, mid + plantWidth / 2), colour, 1.6, top));
    }
  }
  return out;
}
