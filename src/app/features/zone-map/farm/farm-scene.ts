import type { ZoneCell, ZoneLayout, ZoneSection } from '@shared/map/zone-layout';

/**
 * The drawn farm's layout, as the system's Zone Map lays it out (Staff_Attention_UI,
 * zone-map/FarmCanvas/farmScene.ts): each section of a zone a block, a field of beds. A block whose
 * beds have outlines on the satellite is laid out by those (north up, to scale: "make it as the
 * satellite map but in animation, same coordinate"), a bed with no outline where its row and column put it
 * among the others; the rest as the sheet has them, by row and column, zone by zone. Pure: the 3D scene is built from it.
 */

/** A plot bed's size and the walkway between beds. */
export const PLOT_W = 52;
export const PLOT_H = 40;
export const PLOT_GAP = 6;
/** The field's edge around its beds. */
export const BLOCK_PAD = 10;
/** Room over a block for the tag naming it. */
export const BLOCK_TAG_ROOM = 40;
/** Room between a zone's blocks (the lower one's tag sits in it), and between zones, when laid out by themselves. */
const SECTION_GAP = 64;
const AREA_GAP = 120;

/** Metres in a degree of latitude, and of longitude at the equator. */
const M_PER_LAT = 110_574;
const M_PER_LNG = 111_320;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FarmPlace {
  x: number;
  y: number;
}

/** A zone block: one section of a zone, drawn as a field of beds. */
export interface FarmBlock {
  id: string;
  areaCode: string;
  areaName: string;
  section: ZoneSection;
  w: number;
  h: number;
  /**
   * Laid out as its plots lie on the satellite (`geoLaidBlocks`), not by the sheet's rows and columns: its
   * place on the farm, each bed by its plot's id, and the field under them; its tag on its left when another
   * block lies right over it.
   */
  geo?: {
    beds: Record<string, Box>;
    fields: Box[];
    place: FarmPlace;
    tagLeft: boolean;
  };
}

/** What grows on a bed: the system's rule (a harvest has begun, or it's growing), here read from the plot's records. */
export type PlantStage = 'planting' | 'harvest' | null;

export function plantStage(cell: ZoneCell): PlantStage {
  if (cell.usage !== 'normal') return null;
  // A picking in the Harvest table means the harvest has begun, whatever the plant records say.
  if (cell.harvested) return 'harvest';
  if (!cell.records.length) return null;
  return cell.records.some((record) => /harvest/i.test(record.status)) ? 'harvest' : 'planting';
}

/** What the tag over a block says: its zone and number ("Zone A · 2"). */
export function blockTitle(block: FarmBlock) {
  const number = block.section.section;
  const name = block.areaName.trim();
  return number == null ? name || 'Zone' : `${name || 'Zone'} · ${number}`;
}

export function blockSize(section: { columns: number; rows: number }) {
  const columns = Math.max(1, section.columns);
  const rows = Math.max(1, section.rows);
  return {
    h: BLOCK_PAD * 2 + rows * PLOT_H + (rows - 1) * PLOT_GAP,
    w: BLOCK_PAD * 2 + columns * PLOT_W + (columns - 1) * PLOT_GAP,
  };
}

/** A plot's corner inside its block (rows and columns from 1). */
export function plotOffset(row: number, column: number) {
  return {
    x: BLOCK_PAD + (column - 1) * (PLOT_W + PLOT_GAP),
    y: BLOCK_PAD + (row - 1) * (PLOT_H + PLOT_GAP),
  };
}

/** A plot's bed inside its block by its cell. */
export function plotRect(cell: ZoneCell): Box {
  return { ...plotOffset(cell.row, cell.column), h: PLOT_H, w: PLOT_W };
}

/** A plot's bed in its block as drawn: where it lies on the satellite, for a block laid out by it; else its cell. */
export function bedRect(block: FarmBlock, cell: ZoneCell): Box {
  return block.geo?.beds[cell.id] ?? plotRect(cell);
}

/** How wide a block's tag is drawn, for its name. */
export function blockTagWidth(block: FarmBlock) {
  return Math.max(52, blockTitle(block).length * 6.2 + 22);
}

/** Every section with plots, in the map's order: zone by zone, then by section. */
export function farmBlocksOf(layout: ZoneLayout): FarmBlock[] {
  return layout.areas.flatMap((area) =>
    area.sections
      .filter((section) => section.cells.length)
      .map((section) => ({
        areaCode: area.zone,
        areaName: `Zone ${area.zone}`,
        id: `${area.zone}:${section.section ?? '-'}`,
        section,
        ...blockSize({ columns: Math.max(...section.cells.map((cell) => cell.column)), rows: section.rows }),
      })),
  );
}

function overlaps(first: Box, second: Box, gap: number) {
  return (
    first.x < second.x + second.w + gap &&
    second.x < first.x + first.w + gap &&
    first.y < second.y + second.h + gap &&
    second.y < first.y + first.h + gap
  );
}

/** The box round each run of boxes touching (a unit apart, or less), merged again where those overlap. */
function touchingRuns(boxes: Box[]): Box[] {
  let runs = boxes.map((box) => ({ ...box }));
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < runs.length && !merged; i += 1) {
      for (let j = i + 1; j < runs.length && !merged; j += 1) {
        if (overlaps(runs[i], runs[j], 1)) {
          const [a, b] = [runs[i], runs[j]];
          const x = Math.min(a.x, b.x);
          const y = Math.min(a.y, b.y);
          runs[i] = { h: Math.max(a.y + a.h, b.y + b.h) - y, w: Math.max(a.x + a.w, b.x + b.w) - x, x, y };
          runs = runs.filter((_, index) => index !== j);
          merged = true;
        }
      }
    }
  }
  return runs;
}

/** The value fitted to a bed's column and row over some beds (value ≈ a + b·column + c·row, least squares); null when they lie in one row or one column. */
function fitByRowColumn(points: readonly { column: number; row: number; value: number }[]): [number, number, number] | null {
  let [n, c, r, cc, rr, cr, v, cv, rv] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of points) {
    n += 1;
    c += p.column;
    r += p.row;
    cc += p.column * p.column;
    rr += p.row * p.row;
    cr += p.column * p.row;
    v += p.value;
    cv += p.column * p.value;
    rv += p.row * p.value;
  }
  // The normal equations, solved by Cramer's rule.
  const det3 = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const m = [
    [n, c, r],
    [c, cc, cr],
    [r, cr, rr],
  ];
  const det = det3(m);
  if (Math.abs(det) < 1e-9) return null;
  const rhs = [v, cv, rv];
  const solved = [0, 1, 2].map((k) => det3(m.map((line, i) => line.map((x, j) => (j === k ? rhs[i] : x)))) / det);
  return [solved[0], solved[1], solved[2]];
}

/**
 * Where a bed with no outline lies, from the beds of its block that have one (their boxes in metres): their centres
 * fitted to their columns and rows, a plane each way (so a block lying at an angle, or numbered the other way, is
 * followed), the bed's own column and row put in, at the drawn beds' usual size. Null when they can't tell: fewer
 * than three, or all in one row or one column.
 */
export function guessBed(known: readonly (readonly [ZoneCell, Box])[], cell: ZoneCell): Box | null {
  if (known.length < 3) return null;
  const centres = known.map(([bed, box]) => ({ column: bed.column, row: bed.row, x: box.x + box.w / 2, y: box.y + box.h / 2 }));
  const fx = fitByRowColumn(centres.map((p) => ({ ...p, value: p.x })));
  const fy = fitByRowColumn(centres.map((p) => ({ ...p, value: p.y })));
  if (!fx || !fy) return null;
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const w = median(known.map(([, box]) => box.w));
  const h = median(known.map(([, box]) => box.h));
  const x = fx[0] + fx[1] * cell.column + fx[2] * cell.row;
  const y = fy[0] + fy[1] * cell.column + fy[2] * cell.row;
  return { h, w, x: x - w / 2, y: y - h / 2 };
}

/**
 * The beds lying on the satellite, too, on the drawn farm: a block whose beds have outlines there is laid
 * out by them: each bed where its outline lies, the farm's north up, to scale (a typical plot about a cell's
 * size), a walkway in from its edge. A bed with no outline (most of its block's having one) goes where its row and
 * column put it among them (`guessBed`), so one plot not drawn doesn't throw its whole zone off the farm. Its field is
 * the box round each run of beds touching. Blocks mostly not drawn, or whose missing beds can't be placed, stay as they are.
 */
export function geoLaidBlocks(blocks: FarmBlock[]): FarmBlock[] {
  const shapeOf = (cell: ZoneCell) => (cell.outline.length >= 3 ? cell.outline : undefined);
  // Water and not-used cells aren't beds: they have no outline there.
  const bedsOf = (block: FarmBlock) => block.section.cells.filter((cell) => cell.usage === 'normal');
  const drawn = blocks.filter((block) => bedsOf(block).some((cell) => shapeOf(cell)));
  if (!drawn.length) return blocks;

  // Each outline's box in metres, east and south of the first corner.
  const corners = drawn.flatMap((block) => bedsOf(block).flatMap((cell) => shapeOf(cell) ?? []));
  const lat0 = Math.max(...corners.map(([lat]) => lat));
  const lng0 = Math.min(...corners.map(([, lng]) => lng));
  const across = M_PER_LNG * Math.cos(((corners.reduce((sum, [lat]) => sum + lat, 0) / corners.length) * Math.PI) / 180);
  const metres = (shape: [number, number][]): Box => {
    const xs = shape.map(([, lng]) => (lng - lng0) * across);
    const ys = shape.map(([lat]) => (lat0 - lat) * M_PER_LAT);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { h: Math.max(...ys) - y, w: Math.max(...xs) - x, x, y };
  };
  // Each block's beds in metres: as drawn, and one not drawn where its row and column put it among those that are.
  const inMetres = new Map<string, (readonly [ZoneCell, Box])[]>();
  for (const block of drawn) {
    const beds = bedsOf(block);
    const known = beds.filter((cell) => shapeOf(cell)).map((cell) => [cell, metres(shapeOf(cell)!)] as const);
    if (known.length * 2 < beds.length) continue;
    const placed = beds.map((cell) => [cell, shapeOf(cell) ? known.find(([bed]) => bed === cell)![1] : guessBed(known, cell)] as const);
    if (placed.every(([, box]) => box)) inMetres.set(block.id, placed as (readonly [ZoneCell, Box])[]);
  }
  const laid = drawn.filter((block) => inMetres.has(block.id));
  if (!laid.length) return blocks;

  const areas = laid
    .flatMap((block) => inMetres.get(block.id)!.map(([, box]) => box))
    .map((box) => box.w * box.h)
    .sort((a, b) => a - b);
  const median = areas[Math.floor(areas.length / 2)] || 1;
  const perUnit = Math.sqrt(median / ((PLOT_W + PLOT_GAP) * (PLOT_H + PLOT_GAP)));
  const units = (box: Box): Box => ({ h: box.h / perUnit, w: box.w / perUnit, x: box.x / perUnit, y: box.y / perUnit });

  const byId = new Map<string, FarmBlock>(
    laid.map((block): [string, FarmBlock] => {
      const shapes = inMetres.get(block.id)!.map(([cell, box]) => [cell, units(box)] as const);
      const x = Math.min(...shapes.map(([, box]) => box.x));
      const y = Math.min(...shapes.map(([, box]) => box.y));
      const w = Math.max(...shapes.map(([, box]) => box.x + box.w)) - x;
      const h = Math.max(...shapes.map(([, box]) => box.y + box.h)) - y;
      const beds: Record<string, Box> = {};
      for (const [cell, box] of shapes) {
        const inset = Math.min(PLOT_GAP / 2, box.w / 4, box.h / 4);
        beds[cell.id] = { h: box.h - inset * 2, w: box.w - inset * 2, x: box.x - x + inset, y: box.y - y + inset };
      }
      const fields = touchingRuns(shapes.map(([, box]) => ({ ...box, x: box.x - x, y: box.y - y })));
      return [block.id, { ...block, geo: { beds, fields, place: { x, y }, tagLeft: false }, h, w }];
    }),
  );
  // A tag over a block that lies right under another (zone B under zone A, a road's width apart) would hide that
  // one's beds: it goes left.
  const laidOut = [...byId.values()];
  for (const block of laidOut) {
    const { place } = block.geo!;
    const over = { h: BLOCK_TAG_ROOM, w: blockTagWidth(block), x: place.x, y: place.y - BLOCK_TAG_ROOM };
    block.geo!.tagLeft = laidOut.some((other) => other !== block && overlaps(over, { ...other.geo!.place, h: other.h, w: other.w }, 0));
  }
  return blocks.map((block) => byId.get(block.id) ?? block);
}

/** As the sheet lays them out: each zone a column, its sections one under another, starting at (0, 0). */
function autoPlaces(blocks: FarmBlock[]): Record<string, FarmPlace> {
  const places: Record<string, FarmPlace> = {};
  const areas = new Map<string, FarmBlock[]>();
  for (const block of blocks) areas.set(block.areaCode, [...(areas.get(block.areaCode) ?? []), block]);
  let x = 0;
  for (const column of areas.values()) {
    let y = 0;
    for (const block of column) {
      places[block.id] = { x, y };
      y += block.h + SECTION_GAP;
    }
    x += Math.max(...column.map((block) => block.w)) + AREA_GAP;
  }
  return places;
}

/** A block's box with the tag over it. */
function blockBox(block: FarmBlock, place: FarmPlace): Box {
  return { h: block.h + BLOCK_TAG_ROOM, w: block.w, x: place.x, y: place.y - BLOCK_TAG_ROOM };
}

/**
 * Where every block sits: where its plots lie on the satellite, for one laid out by it; else its own spot in the
 * sheet's layout, if nothing's there; else laid out under everything placed, so it never lands on top of anything.
 */
export function placeBlocks(blocks: FarmBlock[]): Record<string, FarmPlace> {
  const places: Record<string, FarmPlace> = {};
  const taken: Box[] = [];
  for (const block of blocks) {
    const place = block.geo?.place;
    if (!place) continue;
    places[block.id] = place;
    taken.push(blockBox(block, place));
  }
  const loose = blocks.filter((block) => !block.geo);
  if (!loose.length) return places;
  const ownSpots = autoPlaces(blocks);
  const stray: FarmBlock[] = [];
  for (const block of loose) {
    const spot = blockBox(block, ownSpots[block.id]);
    if (taken.some((box) => overlaps(spot, box, 16))) {
      stray.push(block);
    } else {
      places[block.id] = ownSpots[block.id];
      taken.push(spot);
    }
  }
  if (!stray.length) return places;
  const laidOut = autoPlaces(stray);
  const minX = Math.min(...taken.map((box) => box.x));
  const maxY = Math.max(...taken.map((box) => box.y + box.h));
  for (const block of stray) {
    places[block.id] = { x: laidOut[block.id].x + minX, y: laidOut[block.id].y + maxY + AREA_GAP };
  }
  return places;
}

/** The blocks, laid out as the web's drawn farm has them, and where each sits. */
export function layFarm(layout: ZoneLayout): { blocks: FarmBlock[]; places: Record<string, FarmPlace> } {
  const blocks = geoLaidBlocks(farmBlocksOf(layout));
  return { blocks, places: placeBlocks(blocks) };
}
