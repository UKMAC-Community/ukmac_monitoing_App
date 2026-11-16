import type { MapShape } from './mac-map';
import { darker, EMPTY_FRAME, flatFeatures, glassFeatures, paler, stackLevels, stackSizes, stackTop, type GlassFeature } from './plot-stack';

const LAT = 13;
const LNG = 100;
const M_LAT = 110574;
const M_LNG = 111320 * Math.cos((LAT * Math.PI) / 180);

/** A plot `width` metres across and `length` metres long, as the plots keep their corners ([lat, lng]). */
function plot(width: number, length: number, turn = 0): [number, number][] {
  const corners = [[0, 0], [width, 0], [width, length], [0, length]];
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return corners.map(([x, y]) => [LAT + (x * sin + y * cos) / M_LAT, LNG + (x * cos - y * sin) / M_LNG] as [number, number]);
}

/** A box with its four corners cut (as the plots on the farm are drawn): `cut` metres off each corner. */
function octagon(width: number, length: number, cut: number): [number, number][] {
  const hw = width / 2;
  const hl = length / 2;
  const corners = [[-hw + cut, -hl], [hw - cut, -hl], [hw, -hl + cut], [hw, hl - cut], [hw - cut, hl], [-hw + cut, hl], [-hw, hl - cut], [-hw, -hl + cut]];
  return corners.map(([x, y]) => [LAT + y / M_LAT, LNG + x / M_LNG] as [number, number]);
}

const shape = (id: string, points: [number, number][], stack?: MapShape['stack']): MapShape => ({ id, points, fill: '#eee', stroke: '#999', label: id, stack });

/** An outer ring's area in square metres (the shoelace sum over metres). */
function area(ring: number[][]) {
  const flat = ring.map(([lng, lat]) => [(lng - LNG) * M_LNG, (lat - LAT) * M_LAT]);
  return Math.abs(flat.reduce((sum, [x, y], index) => sum + x * flat[(index + 1) % flat.length][1] - flat[(index + 1) % flat.length][0] * y, 0)) / 2;
}
const turnOf = (ring: number[][]) =>
  Math.sign(ring.reduce((sum, [x, y], index) => sum + x * ring[(index + 1) % ring.length][1] - ring[(index + 1) % ring.length][0] * y, 0));

const GREEN = '#34a853';
const RED = '#ea4335';

describe('plot stack: layers on each other over a plot', () => {
  it('is a low bed with the panes spaced by how wide the plot is, the whole stack a little taller than the plot is wide, each pane a thin plate with air over the one under it', () => {
    const wide = plot(50, 100);
    const three = stackSizes(wide, 3);
    expect(three.side).toBeCloseTo(50, 0);
    expect(three.bed).toBeCloseTo(2, 3);
    // The tower stands in a little from the plot's edge (so towers side by side have room between them).
    expect(three.margin).toBeCloseTo(3, 3);
    expect(three.step).toBeCloseTo(7, 3);
    // The first pane floats a gap over the bed; the stack's top is its last pane's.
    expect(three.top).toBeCloseTo(three.bed + three.gap + 2 * three.step + three.thick, 5);
    // Ten panes stand closer together so the stack stays about 1.1 times the plot's width above its bed.
    const ten = stackSizes(wide, 10);
    expect(ten.step).toBeCloseTo(5.5, 3);
    expect(ten.top - ten.bed).toBeCloseTo(55, 2);
    // Plates are thin: most of each step is air.
    expect(ten.thick).toBeLessThan(ten.step / 3);
    expect(ten.gap).toBeGreaterThan(ten.thick * 2);
    // No panes: the bed's top.
    expect(stackSizes(wide, 0).top).toBeCloseTo(2, 3);
  });

  it("says where each layer floats: the first a gap over the bed, each one a step above the last, the middle of each between its base and top", () => {
    const points = plot(50, 100);
    const levels = stackLevels(points, 4);
    const size = stackSizes(points, 4);
    expect(levels).toHaveLength(4);
    expect(levels[0].base).toBeCloseTo(size.bed + size.gap, 5);
    expect(levels[3].top).toBeCloseTo(size.top, 5);
    levels.forEach((level, index) => {
      expect(level.mid).toBeCloseTo((level.base + level.top) / 2, 5);
      if (index) expect(level.base - levels[index - 1].base).toBeCloseTo(size.step, 5);
    });
    expect(stackLevels(points, 0)).toEqual([]);
  });

  it("measures a plot by how narrow it is across, whichever way it is turned", () => {
    expect(stackSizes(plot(20, 90), 4).side).toBeCloseTo(20, 0);
    expect(stackSizes(plot(20, 90, Math.PI / 6), 4).side).toBeCloseTo(20, 0);
    // A small plot is no tower.
    const small = stackSizes(plot(4, 6), 4);
    expect(small.bed).toBeGreaterThanOrEqual(0.4);
    expect(small.step).toBeGreaterThanOrEqual(0.8);
  });

  it('says how tall a shape stands: its stack, or nothing', () => {
    const points = plot(50, 100);
    expect(stackTop(shape('a', points))).toBe(0);
    expect(stackTop(shape('a', points, []))).toBe(0);
    expect(stackTop(shape('a', points, [{ fill: GREEN, label: 'One' }, { fill: RED, label: 'Two' }]))).toBeCloseTo(stackSizes(points, 2).top, 5);
  });

  /** The panes' sheets (a ring each) and their edges (a ring with a hole), told apart. */
  const parts = (features: GlassFeature[]) => ({
    sheets: features.filter((item) => item.geometry.coordinates.length === 1),
    edges: features.filter((item) => item.geometry.coordinates.length === 2),
  });

  it('draws one pane and one edge for each layer, the first lowest, each clear of the one under it', () => {
    const panes = [GREEN, RED, GREEN].map((fill, index) => ({ fill, label: `Layer ${index + 1}` }));
    const { sheets: glass, edges } = parts(glassFeatures([shape('a', plot(50, 100), panes)]));
    expect(glass).toHaveLength(3);
    expect(edges).toHaveLength(3);
    expect(glass.map((item) => item.properties.level)).toEqual([0, 1, 2]);
    expect(glass.map((item) => item.properties.colour)).toEqual([GREEN, RED, GREEN]);
    expect(glass.every((item) => item.properties.id === 'a')).toBe(true);
    for (let index = 1; index < glass.length; index++) {
      // Each pane starts above the top of the one before it: separate layers, not a solid block.
      expect(glass[index].properties.base).toBeGreaterThan(glass[index - 1].properties.top);
    }
    const size = stackSizes(plot(50, 100), 3);
    expect(glass[0].properties.base).toBeCloseTo(size.bed + size.gap, 5);
    expect(glass[2].properties.top).toBeCloseTo(size.top, 5);
    expect(glass[0].properties.top - glass[0].properties.base).toBeCloseTo(size.thick, 5);
  });

  it("puts each pane's sheet inside its edge, the edge a ring with the sheet as its hole, a shade darker than the pane", () => {
    const { sheets, edges } = parts(glassFeatures([shape('a', plot(50, 100), [{ fill: RED, label: 'Layer' }])]));
    const [edge] = edges;
    const [sheet] = sheets;
    const [outer, hole] = edge.geometry.coordinates;
    // The hole is wound the other way round, or MapLibre would read it as a second polygon.
    expect(turnOf(hole)).toBe(-turnOf(outer));
    expect(area(hole)).toBeLessThan(area(outer));
    // The sheet fills the hole.
    expect(area(sheet.geometry.coordinates[0])).toBeCloseTo(area(hole), 3);
    expect(edge.properties.colour).toBe(darker(RED));
    expect(darker(RED)).not.toBe(RED);
    expect(edge.properties.base).toBe(sheet.properties.base);
    expect(edge.properties.top).toBe(sheet.properties.top);
  });

  it('draws only a frame for a layer with nothing to show yet (the place is kept, so each layer is the same one on every plot)', () => {
    const { sheets: glass, edges } = parts(glassFeatures([shape('a', plot(50, 100), [{ fill: GREEN, label: 'One' }, { fill: null, label: 'Two' }, { fill: RED, label: 'Three' }])]));
    expect(edges).toHaveLength(3);
    expect(glass.map((item) => item.properties.level)).toEqual([0, 2]);
    expect(edges[1].properties).toMatchObject({ empty: 1, colour: EMPTY_FRAME, level: 1 });
    // Its place in the stack is where a pane would be.
    expect(edges[2].properties.base).toBeGreaterThan(edges[1].properties.top);
    expect(edges[1].properties.base).toBeGreaterThan(edges[0].properties.top);
  });

  it('has a paler colour for each, to fade the layers that are not picked out', () => {
    const [sheet] = parts(glassFeatures([shape('a', plot(50, 100), [{ fill: GREEN, label: 'One' }])])).sheets;
    expect(sheet.properties.dim).toBe(paler(GREEN));
    expect(paler(GREEN)).not.toBe(GREEN);
    // Not a colour it can read: left as it is.
    expect(darker('green')).toBe('green');
  });

  it('stands the panes almost straight up, each a touch inside the one under it', () => {
    const panes = [GREEN, GREEN, GREEN, GREEN].map((fill, index) => ({ fill, label: `Layer ${index + 1}` }));
    const sizes = parts(glassFeatures([shape('a', plot(50, 100), panes)])).sheets.map((item) => area(item.geometry.coordinates[0]));
    for (let index = 1; index < sizes.length; index++) expect(sizes[index]).toBeLessThan(sizes[index - 1]);
    expect(sizes[3] / sizes[0]).toBeGreaterThan(0.95);
  });

  it('draws the stack seen from above flat: a band for each layer inside the one under it, the last in the middle', () => {
    const panes = [GREEN, RED, null, GREEN].map((fill, index) => ({ fill, label: `Layer ${index + 1}` }));
    const flat = flatFeatures([shape('a', plot(50, 100), panes)]);
    expect(flat.map((item) => item.properties.level)).toEqual([0, 1, 2, 3]);
    expect(flat.every((item) => item.properties.id === 'a' && item.geometry.coordinates.length === 1)).toBe(true);
    const sizes = flat.map((item) => area(item.geometry.coordinates[0]));
    for (let index = 1; index < sizes.length; index++) expect(sizes[index]).toBeLessThan(sizes[index - 1]);
    // Bands wide enough to see: the middle one is still a good part of the plot, and the first is the plot less its margin all round.
    expect(sizes[0]).toBeGreaterThan(0.8 * 50 * 100);
    expect(sizes[0]).toBeLessThan(0.9 * 50 * 100);
    expect(sizes[3] / sizes[0]).toBeGreaterThan(0.2);
    expect(flat.map((item) => item.properties.colour)).toEqual([GREEN, RED, EMPTY_FRAME, GREEN]);
    expect(flat[0].properties).toMatchObject({ edge: darker(GREEN), dim: paler(GREEN), empty: 0 });
    // A layer with nothing to show yet is an outline alone.
    expect(flat[2].properties).toMatchObject({ empty: 1, edge: EMPTY_FRAME });
  });

  it('gives ten layers bands each wide enough to see on a big plot, and still a middle', () => {
    const panes = Array.from({ length: 10 }, (_, index) => ({ fill: index % 2 ? RED : GREEN, label: `Layer ${index + 1}` }));
    const sizes = flatFeatures([shape('a', plot(50, 100), panes)]).map((item) => area(item.geometry.coordinates[0]));
    expect(sizes).toHaveLength(10);
    // Each band is about two metres all round: the width drops by about four metres a layer.
    expect(Math.sqrt(sizes[0] / sizes[1])).toBeGreaterThan(1.02);
    expect(sizes[9] / sizes[0]).toBeGreaterThan(0.1);
  });

  it('keeps the bands of a box with its corners cut whole, however far in they go (a cut a few metres long is wiped out and the ring stays a box)', () => {
    const panes = Array.from({ length: 10 }, (_, index) => ({ fill: index % 2 ? RED : GREEN, label: `Layer ${index + 1}` }));
    const flat = flatFeatures([shape('a', octagon(50, 120, 5), panes)]);
    const sizes = flat.map((item) => area(item.geometry.coordinates[0]));
    for (let index = 1; index < sizes.length; index++) expect(sizes[index]).toBeLessThan(sizes[index - 1]);
    // The middle band: the plot less its margin and a band's width at each side for each of nine layers (a few square metres lost to rounded corners).
    const band = Math.min(2.5, Math.max(0.5, ((50 - 6) * 0.4) / 10));
    const gone = 3 + 9 * band;
    expect(sizes[9]).toBeGreaterThan(0.95 * (50 - 2 * gone) * (120 - 2 * gone));
    expect(sizes[9]).toBeLessThan(1.02 * (50 - 2 * gone) * (120 - 2 * gone));
    // No band turns back on itself: each ring goes the same way round all the way.
    for (const item of flat) {
      const ring = item.geometry.coordinates[0].map(([lng, lat]) => ({ x: (lng - LNG) * M_LNG, y: (lat - LAT) * M_LAT }));
      const turns = ring.slice(0, -1).map((point, i) => {
        const next = ring[(i + 1) % (ring.length - 1)];
        const after = ring[(i + 2) % (ring.length - 1)];
        return Math.sign((next.x - point.x) * (after.y - next.y) - (next.y - point.y) * (after.x - next.x));
      });
      expect(new Set(turns.filter((turn) => turn !== 0)).size).toBe(1);
    }
  });

  it('draws a plot that is not a box (an L) smaller about its middle rather than inside out', () => {
    const lShape: [number, number][] = [[0, 0], [0, 30], [10, 30], [10, 10], [30, 10], [30, 0]].map(([x, y]) => [LAT + y / M_LAT, LNG + x / M_LNG] as [number, number]);
    const panes = [GREEN, RED, GREEN].map((fill, index) => ({ fill, label: `Layer ${index + 1}` }));
    const sizes = flatFeatures([shape('a', lShape, panes)]).map((item) => area(item.geometry.coordinates[0]));
    expect(sizes[1]).toBeLessThan(sizes[0]);
    expect(sizes[2]).toBeLessThan(sizes[1]);
    expect(sizes[2]).toBeGreaterThan(0);
  });

  it('leaves out a shape with no stack (the maps that have none are as they were)', () => {
    const none = [shape('a', plot(50, 100)), shape('b', plot(50, 100), [])];
    expect(glassFeatures(none)).toEqual([]);
    expect(flatFeatures(none)).toEqual([]);
  });

  it('keeps each plot its own: the panes of two plots name their own', () => {
    const { sheets } = parts(glassFeatures([shape('a', plot(50, 100), [{ fill: GREEN, label: 'One' }]), shape('b', plot(40, 60), [{ fill: RED, label: 'One' }, { fill: RED, label: 'Two' }])]));
    expect(sheets.map((item) => [item.properties.id, item.properties.level])).toEqual([['a', 0], ['b', 0], ['b', 1]]);
  });

  it('stays valid for a plot turned', () => {
    const turned = plot(30, 80, 0.6);
    const stack = [{ fill: GREEN, label: 'One' }, { fill: RED, label: 'Two' }];
    for (const item of [...glassFeatures([shape('a', turned, stack)]), ...flatFeatures([shape('a', turned, stack)])]) {
      for (const ring of item.geometry.coordinates) {
        expect(ring.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))).toBe(true);
        // A ring is closed.
        expect(ring[0]).toEqual(ring[ring.length - 1]);
      }
    }
  });
});
