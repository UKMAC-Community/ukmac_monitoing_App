import type { MapShape } from './mac-map';

/**
 * A plot's layers stacked on it in 3D (as the system's web map stacks the tables picked over a plot, "layer and layer"): each a
 * thin pane of its colour floating over the one under it, the first on the plot's bed and the last on top. Pure geometry, in
 * metres, so the map and the tests can both use it.
 */

/** A corner as the plots keep it: [latitude, longitude]. */
type Point = [number, number];
interface Flat {
  x: number;
  y: number;
}

const METRES_PER_LAT = 110574;
const metresPerLng = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** A layer with nothing to show yet is only a frame, in this colour. */
export const EMPTY_FRAME = '#94a3b8';

export function middleOf(points: readonly Point[]): Point {
  return [points.reduce((sum, point) => sum + point[0], 0) / points.length, points.reduce((sum, point) => sum + point[1], 0) / points.length];
}

const flatten = (middle: Point, points: readonly Point[]): Flat[] =>
  points.map(([lat, lng]) => ({ x: (lng - middle[1]) * metresPerLng(middle[0]), y: (lat - middle[0]) * METRES_PER_LAT }));

const unflatten = (middle: Point, flat: readonly Flat[]): Point[] =>
  flat.map(({ x, y }) => [middle[0] + y / METRES_PER_LAT, middle[1] + x / metresPerLng(middle[0])] as Point);

/** How thick a (convex) ring is: its narrowest width across, whichever way it is turned. */
function thickness(flat: readonly Flat[]): number {
  let narrowest = Infinity;
  flat.forEach((from, index) => {
    const to = flat[(index + 1) % flat.length];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (!length) return;
    const nx = -(to.y - from.y) / length;
    const ny = (to.x - from.x) / length;
    const across = Math.max(...flat.map((point) => Math.abs((point.x - from.x) * nx + (point.y - from.y) * ny)));
    narrowest = Math.min(narrowest, across);
  });
  return Number.isFinite(narrowest) ? narrowest : 0;
}

const cross = (a: Flat, b: Flat, c: Flat) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);

/** Whether a ring never turns back on itself (the plots are drawn as boxes with their corners cut). */
function isConvex(flat: readonly Flat[]): boolean {
  let sign = 0;
  for (let index = 0; index < flat.length; index++) {
    const turn = cross(flat[index], flat[(index + 1) % flat.length], flat[(index + 2) % flat.length]);
    if (Math.abs(turn) < 1e-9) continue;
    if (sign && Math.sign(turn) !== sign) return false;
    sign = Math.sign(turn);
  }
  return true;
}

/** What is left of a ring on the side of a line where `side` is not below zero (Sutherland–Hodgman, one line). */
function keepSide(ring: readonly Flat[], side: (point: Flat) => number): Flat[] {
  const kept: Flat[] = [];
  ring.forEach((from, index) => {
    const to = ring[(index + 1) % ring.length];
    const a = side(from);
    const b = side(to);
    if (a >= 0) kept.push(from);
    if (a >= 0 !== b >= 0) {
      const t = a / (a - b);
      kept.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    }
  });
  return kept;
}

/**
 * A ring drawn in `metres` all round (an even band, however long and narrow it is); never so far that it turns inside out. A convex ring
 * (a box with its corners cut, as the plots are) is cut by each of its sides moved in, so a short side that the move wipes out is gone
 * and the ring stays whole; any other ring is drawn smaller about its middle.
 */
function inset(flat: readonly Flat[], metres: number): Flat[] {
  if (metres <= 0 || flat.length < 3) return [...flat];
  const width = thickness(flat);
  const by = Math.min(metres, width * 0.45);
  if (!isConvex(flat)) {
    const shrink = Math.max(0.1, 1 - by / Math.max(width / 2, 0.01));
    return flat.map(({ x, y }) => ({ x: x * shrink, y: y * shrink }));
  }
  // Which side is in: the ring's turn (its signed area).
  const area = flat.reduce((sum, point, index) => {
    const next = flat[(index + 1) % flat.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  const turn = area > 0 ? 1 : -1;
  let ring = [...flat];
  flat.forEach((from, index) => {
    const to = flat[(index + 1) % flat.length];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (!length || ring.length < 3) return;
    const nx = (-(to.y - from.y) / length) * turn;
    const ny = ((to.x - from.x) / length) * turn;
    ring = keepSide(ring, (point) => (point.x - from.x) * nx + (point.y - from.y) * ny - by);
  });
  return ring.length >= 3 ? ring : flat.map(({ x, y }) => ({ x: x * 0.1, y: y * 0.1 }));
}

/** A ring with its corners rounded off a little (an arc at most `reach` metres from the corner), as the web's glass is. */
function rounded(flat: readonly Flat[], reach = 3, steps = 4): Flat[] {
  if (flat.length < 3) return [...flat];
  const out: Flat[] = [];
  flat.forEach((corner, index) => {
    const before = flat[(index + flat.length - 1) % flat.length];
    const after = flat[(index + 1) % flat.length];
    const toBefore = Math.hypot(before.x - corner.x, before.y - corner.y);
    const toAfter = Math.hypot(after.x - corner.x, after.y - corner.y);
    const radius = Math.min(reach, Math.min(toBefore, toAfter) * 0.4);
    if (!radius) return;
    const from = { x: corner.x + ((before.x - corner.x) / toBefore) * radius, y: corner.y + ((before.y - corner.y) / toBefore) * radius };
    const to = { x: corner.x + ((after.x - corner.x) / toAfter) * radius, y: corner.y + ((after.y - corner.y) / toAfter) * radius };
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      out.push({
        x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * corner.x + t ** 2 * to.x,
        y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * corner.y + t ** 2 * to.y,
      });
    }
  });
  return out.length >= 3 ? out : [...flat];
}

/** How a plot's stack is built, in metres, by its size: the bed, the gap under the first pane, how far each pane is above the one before, and how thick it is. */
export interface StackSizes {
  /** How wide the plot is across. */
  side: number;
  /** How far in from the plot's edge the stack stands: the bed shows all round it, and the stacks of plots side by side are clear of one another. */
  margin: number;
  bed: number;
  gap: number;
  step: number;
  thick: number;
  /** The top of the highest pane (the bed's top, with no panes). */
  top: number;
}

/**
 * A low bed with `count` thin panes over it, spaced so that the whole stack stays about as tall as a plot is wide (a little more)
 * however many there are (a few panes stand further apart; ten stand closer): each a thin plate with plenty of air over the one under
 * it, so that the layers can be told apart from far off, and each tower standing in a little from its plot's edge.
 */
export function stackSizes(points: readonly Point[], count: number): StackSizes {
  const side = thickness(flatten(middleOf(points), points));
  const bed = clamp(side * 0.04, 0.4, 2);
  const step = clamp(Math.min(side * 0.14, (side * 1.1) / Math.max(1, count)), 1, 10);
  const thick = Math.max(0.4, step * 0.24);
  const gap = step - thick;
  return { side, margin: clamp(side * 0.06, 0.4, 4), bed, gap, step, thick, top: count > 0 ? bed + gap + (count - 1) * step + thick : bed };
}

/** Where each layer floats (m), the first layer first: its base, its top and its middle (where a number is put beside it). */
export function stackLevels(points: readonly Point[], count: number): { base: number; top: number; mid: number }[] {
  const size = stackSizes(points, count);
  return Array.from({ length: count }, (_, level) => {
    const base = size.bed + size.gap + level * size.step;
    return { base, top: base + size.thick, mid: base + size.thick / 2 };
  });
}

/** The height a shape stands to on the map: the top of its stack, or none (0). */
export function stackTop(shape: Pick<MapShape, 'points' | 'stack'>): number {
  return shape.stack?.length && shape.points.length >= 3 ? stackSizes(shape.points, shape.stack.length).top : 0;
}

/** One pane (or the frame round it) as MapLibre draws it tipped back: the plot it belongs to, its place in the stack, its colour and where it floats (m). */
export interface GlassFeature {
  type: 'Feature';
  properties: { id: string; level: number; label: string; colour: string; dim: string; base: number; top: number; empty: number };
  geometry: { type: 'Polygon'; coordinates: number[][][] };
}

/** One layer as MapLibre draws it seen from above: flat, a band of its colour (`edge` the line round it, a shade darker). */
export interface FlatFeature {
  type: 'Feature';
  properties: { id: string; level: number; label: string; colour: string; dim: string; edge: string; edgeDim: string; empty: number };
  geometry: { type: 'Polygon'; coordinates: number[][][] };
}

function mix(hex: string, to: 0 | 255, ratio: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const value = parseInt(match[1], 16);
  const channel = (shift: number) => {
    const c = (value >> shift) & 255;
    return Math.round(c + (to - c) * ratio).toString(16).padStart(2, '0');
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/** A pane's edge: its colour a shade darker. */
export const darker = (hex: string) => mix(hex, 0, 0.16);
/** What a pane fades to while another layer is picked out. */
export const paler = (hex: string) => mix(hex, 255, 0.72);

const closed = (points: readonly Point[]) => [...points, points[0]].map(([lat, lng]) => [lng, lat]);

/**
 * The panes of every shape that has a stack, for MapLibre tipped back, each pane two features of one layer (so that what is in front hides
 * what is behind): its sheet, which lies inside its edge (a ring in a darker shade) and not under it, since two at one height over the
 * same ground flicker. The panes stand almost straight up, each a touch inside the one under it.
 */
export function glassFeatures(shapes: readonly MapShape[]): GlassFeature[] {
  const features: GlassFeature[] = [];
  for (const shape of shapes) {
    const stack = shape.stack;
    if (!stack?.length || shape.points.length < 3) continue;
    const middle = middleOf(shape.points);
    const ring = flatten(middle, shape.points);
    const size = stackSizes(shape.points, stack.length);
    const levels = stackLevels(shape.points, stack.length);
    const nest = clamp(size.side * 0.003, 0.08, 0.3);
    const lip = clamp(size.thick * 1.4, 0.3, 0.6);
    stack.forEach((pane, level) => {
      const outer = rounded(inset(ring, size.margin + nest * level));
      const inner = inset(outer, lip);
      const common = { id: shape.id, level, label: pane.label, base: levels[level].base, top: levels[level].top, empty: pane.fill ? 0 : 1 };
      const edge = pane.fill ? darker(pane.fill) : EMPTY_FRAME;
      // The edge is the outer ring with the inner as its hole (wound the other way round).
      features.push({
        type: 'Feature',
        properties: { ...common, colour: edge, dim: paler(edge) },
        geometry: { type: 'Polygon', coordinates: [closed(unflatten(middle, outer)), closed(unflatten(middle, inner)).reverse()] },
      });
      if (pane.fill) {
        features.push({
          type: 'Feature',
          properties: { ...common, colour: pane.fill, dim: paler(pane.fill) },
          geometry: { type: 'Polygon', coordinates: [closed(unflatten(middle, inner))] },
        });
      }
    });
  }
  return features;
}

/**
 * The same stacks seen from above, flat (the extruded panes would be one over another in the depth buffer, which cannot tell panes a few
 * metres apart from straight over them): each layer a band of its colour inside the one under it, the last in the middle, as the web's top
 * view draws its tables. A layer with nothing to show yet is its outline alone.
 */
export function flatFeatures(shapes: readonly MapShape[]): FlatFeature[] {
  const features: FlatFeature[] = [];
  for (const shape of shapes) {
    const stack = shape.stack;
    if (!stack?.length || shape.points.length < 3) continue;
    const middle = middleOf(shape.points);
    const ring = flatten(middle, shape.points);
    const { side, margin } = stackSizes(shape.points, stack.length);
    // Room for every layer's band: the middle one is left at least a fifth of the width the stack has, and no band is thinner than half a metre.
    const band = clamp(((side - 2 * margin) * 0.4) / stack.length, 0.5, 2.5);
    stack.forEach((pane, level) => {
      const edge = pane.fill ? darker(pane.fill) : EMPTY_FRAME;
      features.push({
        type: 'Feature',
        properties: { id: shape.id, level, label: pane.label, colour: pane.fill ?? EMPTY_FRAME, dim: paler(pane.fill ?? EMPTY_FRAME), edge, edgeDim: paler(edge), empty: pane.fill ? 0 : 1 },
        geometry: { type: 'Polygon', coordinates: [closed(unflatten(middle, rounded(inset(ring, margin + band * level))))] },
      });
    });
  }
  return features;
}
