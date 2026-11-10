import type { Cells, Column } from '../../core/models';
import { makeSheet } from '../../test-helpers';
import { buildZoneLayout } from '../zone-layout';
import { buildFarm, bedState } from './farm-build';
import { BLOCK_PAD, blockSize, blockTitle, farmBlocksOf, geoLaidBlocks, layFarm, PLOT_GAP, PLOT_H, PLOT_W, plantStage, placeBlocks } from './farm-scene';

const zoneColumns: Column[] = ['Zone', 'Plot', 'Plant capacity', 'Note', 'Zone number', 'Row', 'Column', 'Plot status', 'Status name', 'Outline'].map((name, index) => ({
  key: `z${index}`,
  name,
  type: 'text' as const,
}));
const recordColumns: Column[] = ['Zone plot', 'Record date', 'Plant count', 'Plant type', 'Status', 'Note'].map((name, index) => ({ key: `r${index}`, name, type: 'text' as const }));

/** A plot of the Zones table: zone, plot, section number, row, column, status, and its outline as "lat,lng;lat,lng…". */
function plot(zone: string, name: string, section: number | null, row: number, column: number, status = 'Active', outline = ''): Cells {
  return { z0: zone, z1: name, z4: section === null ? '' : String(section), z5: String(row), z6: String(column), z7: status, z9: outline };
}

/** A square outline of `size` degrees with its top-left at (lat, lng). */
function square(lat: number, lng: number, size = 0.00009) {
  return [[lat, lng], [lat, lng + size], [lat - size, lng + size], [lat - size, lng]].map((p) => p.join(',')).join(';');
}

function layoutOf(zones: Cells[], records: Cells[] = []) {
  return buildZoneLayout(makeSheet(1, 'Zones', zoneColumns, zones, 'zones'), makeSheet(2, 'Zone Records', recordColumns, records, 'zone-records'));
}

describe('the drawn farm\'s layout, as the system lays it out', () => {
  // Zone A: sections 1 and 3 of 3 columns × 2 rows; zone B: section 2 of 2 × 1, and an unnumbered one of unused cells.
  const sheetLayout = layoutOf([
    ...[1, 2].flatMap((row) => [1, 2, 3].map((column) => plot('A', `A${row}-${column}`, 1, row, column))),
    ...[1, 2].flatMap((row) => [1, 2, 3].map((column) => plot('A', `A3${row}-${column}`, 3, row, column))),
    plot('B', 'B1', 2, 1, 1),
    plot('B', 'B2', 2, 1, 2),
    plot('B', 'x1', null, 1, 1, 'Unused'),
  ]);

  it('makes a block of each section, sized by its columns and rows, in the map\'s order', () => {
    const blocks = farmBlocksOf(sheetLayout);
    expect(blocks.map((block) => block.id)).toEqual(['A:1', 'A:3', 'B:-', 'B:2']); // unnumbered first, as the sheet sorts them
    const a1 = blocks[0];
    expect(a1).toMatchObject(blockSize({ columns: 3, rows: 2 }));
    expect(a1.w).toBe(BLOCK_PAD * 2 + 3 * PLOT_W + 2 * PLOT_GAP);
    expect(a1.h).toBe(BLOCK_PAD * 2 + 2 * PLOT_H + PLOT_GAP);
    expect(blockTitle(a1)).toBe('Zone A · 1');
    expect(blockTitle(blocks[2])).toBe('Zone B'); // an unnumbered section is named by its zone
  });

  it('with no outlines lays the blocks out by the sheet: a zone a column, its sections one under another', () => {
    const { blocks, places } = layFarm(sheetLayout);
    expect(blocks.every((block) => !block.geo)).toBe(true);
    const [a1, a3, b0] = [places['A:1'], places['A:3'], places['B:-']];
    expect(a1).toEqual({ x: 0, y: 0 });
    expect(a3.x).toBe(0);
    expect(a3.y).toBeGreaterThan(blocks[0].h); // under the first, with a gap
    expect(b0.x).toBeGreaterThan(blocks[0].w); // zone B a column over, past zone A
    // None of them lands on another (each with the tag's room over it).
    const list = blocks.map((block) => ({ ...places[block.id], w: block.w, h: block.h }));
    for (const [i, first] of list.entries()) {
      for (const second of list.slice(i + 1)) {
        const apart = first.x + first.w <= second.x || second.x + second.w <= first.x || first.y + first.h <= second.y || second.y + second.h <= first.y;
        expect(apart).toBe(true);
      }
    }
  });

  it('lays a block out by its plots\' outlines when every bed has one: north up, to scale, a field round the beds touching', () => {
    // Two plots side by side and one below them, touching, 0.00009° (about 10 m) across.
    const geo = layoutOf([
      plot('A', 'a', 1, 1, 1, 'Active', square(12.1409, 104.0848)),
      plot('A', 'b', 1, 1, 2, 'Active', square(12.1409, 104.08489)),
      plot('A', 'c', 1, 2, 1, 'Active', square(12.14081, 104.0848)),
    ]);
    const [block] = geoLaidBlocks(farmBlocksOf(geo));
    expect(block.geo).toBeTruthy();
    const [a, b, c] = ['a', 'b', 'c'].map((name) => geo.cells.find((cell) => cell.plot === name)!);
    const beds = block.geo!.beds;
    // To scale: a typical plot about a cell's size (a walkway in from its edge).
    expect(beds[a.id].w).toBeGreaterThan(PLOT_W * 0.8);
    expect(beds[a.id].w).toBeLessThan(PLOT_W + PLOT_GAP);
    // North up: the plot further north (a, b) is higher on the layout (a smaller y) than the one south of it (c); b is east of a.
    expect(beds[a.id].y).toBeLessThan(beds[c.id].y);
    expect(beds[b.id].x).toBeGreaterThan(beds[a.id].x);
    // The three touch: one field round them.
    expect(block.geo!.fields.length).toBe(1);
    expect(placeBlocks([block])['A:1']).toEqual(block.geo!.place);
  });

  it('keeps a block laid by the sheet when one of its beds has no outline', () => {
    const mixed = layoutOf([plot('A', 'a', 1, 1, 1, 'Active', square(12.1409, 104.0848)), plot('A', 'b', 1, 1, 2)]);
    expect(geoLaidBlocks(farmBlocksOf(mixed))[0].geo).toBeUndefined();
  });
});

describe('what grows on each bed, and the scene built from it', () => {
  const records: Cells[] = [
    { r0: 'H1', r1: '2026-05-01', r2: '200', r3: 'Bird\'s Eye', r4: 'Harvesting' },
    { r0: 'H1', r1: '2026-03-01', r2: '200', r3: 'Bird\'s Eye', r4: 'Planted' },
    { r0: 'P1', r1: '2026-05-02', r2: '120', r3: 'Bird\'s Eye', r4: 'Growing' },
  ];
  const layout = layoutOf(
    [
      plot('A', 'H1', 1, 1, 1), // harvest
      plot('A', 'P1', 1, 1, 2), // planting
      plot('A', 'S1', 1, 1, 3), // soil: nothing planted
      plot('A', 'U1', 1, 2, 1, 'Unused'), // not used
      plot('A', 'W1', 1, 2, 2, 'Water'), // water
    ],
    records,
  );
  const cell = (name: string) => layout.cells.find((item) => item.plot === name || item.label === name)!;

  it('reads a bed\'s stage from its plot: harvest once a harvest has begun, planting while it grows, soil when bare', () => {
    expect(plantStage(cell('H1'))).toBe('harvest');
    expect(plantStage(cell('P1'))).toBe('planting');
    expect(plantStage(cell('S1'))).toBeNull();
    expect(bedState(cell('S1'))).toBe('soil');
    expect(bedState(cell('U1'))).toBe('unused');
    expect(plantStage(cell('U1'))).toBeNull();
  });

  it('builds a bed for each plot but water, plants where there is something planted, and a tag for each block', () => {
    const { blocks, places } = layFarm(layout);
    const farm = buildFarm(blocks, places);
    try {
      expect(farm.stats.beds).toBe(4); // H1, P1, S1, U1 (the water is sunk, not a bed)
      expect(farm.stats.byState).toEqual({ harvest: 1, planting: 1, soil: 1, unused: 1 });
      expect(farm.stats.plants).toBe(2 * 12); // twelve to a planted bed
      expect(farm.bedCells.map((item) => item.plot)).toEqual(['H1', 'P1', 'S1', 'U1']);
      expect(farm.beds?.count).toBe(4);
      expect([...farm.bedTops.keys()].sort()).toEqual(farm.bedCells.map((item) => item.id).sort());
      expect(farm.labels.map((label) => label.text)).toEqual(['Zone A · 1']);
      // The ground has a margin of grass, and the content is what's inside it.
      expect(farm.bounds.minX).toBeLessThan(farm.content.minX);
      expect(farm.content.maxX - farm.content.minX).toBeGreaterThan(blocks[0].w - 1);
      // It moves: the wind leans the plants and blows the leaves, with nothing to call.
      expect(() => farm.animate(3.5)).not.toThrow();
    } finally {
      farm.dispose();
    }
  });
});
