/**
 * A table's report on A4 pages (as the web's Export Studio lays them): what a sheet is, and how the parts picked are laid
 * out over as many sheets as they need — a part that can't be split (the KPI cards, a chart) moves to the next sheet when
 * it doesn't fit; a table is split between its rows, its title and column names again on each sheet it runs on to.
 */

export type A4Orientation = 'portrait' | 'landscape';

export const MM_TO_PX = 96 / 25.4;

/** A4 each way, and the sheet's own layout (mm): a 10 mm margin, the band on top, the page number under the body. */
export const SHEET = {
  marginMm: 10,
  headerMm: 16,
  footerMm: 8,
  /** Between two parts on the same sheet. */
  gapMm: 6,
  paper: {
    portrait: { widthMm: 210, heightMm: 297 },
    landscape: { widthMm: 297, heightMm: 210 },
  } satisfies Record<A4Orientation, { widthMm: number; heightMm: number }>,
};

/** The body of a sheet in px: what the parts get. */
export function sheetBody(orientation: A4Orientation) {
  const paper = SHEET.paper[orientation];
  return {
    width: (paper.widthMm - SHEET.marginMm * 2) * MM_TO_PX,
    height: (paper.heightMm - SHEET.marginMm * 2 - SHEET.headerMm - SHEET.footerMm) * MM_TO_PX,
  };
}

/** A part as it was measured at the sheet's width: one block, or a table (its title and column names, each row, what follows the last). */
export type Measured =
  | { key: string; kind: 'whole'; height: number }
  | { key: string; kind: 'rows'; heading: number; rows: number[]; tail: number };

/** What of a part one sheet shows: all of it, or a table's rows `from`–`to` (end left out); `first`/`last`: its first or last sheet. */
export interface Slice {
  key: string;
  from: number;
  to: number;
  first: boolean;
  last: boolean;
}

/**
 * The parts over sheets `available` px tall, `gap` px between two on a sheet, in the order given. A part too tall for a whole
 * sheet gets one to itself (cut at its foot). A table starts on a new sheet when not even its title and first row fit;
 * its tail (totals, how many rows) goes on after its last row, or on the next sheet. There is always at least one sheet.
 */
export function paginate(parts: readonly Measured[], available: number, gap: number): Slice[][] {
  const sheets: Slice[][] = [[]];
  let used = 0;
  const sheet = () => sheets[sheets.length - 1];
  const turn = () => {
    sheets.push([]);
    used = 0;
  };
  const room = () => available - used - (sheet().length ? gap : 0);
  const put = (slice: Slice, height: number) => {
    used += (sheet().length ? gap : 0) + height;
    sheet().push(slice);
  };
  for (const part of parts) {
    if (part.kind === 'whole') {
      if (sheet().length && part.height > room()) turn();
      put({ key: part.key, from: 0, to: 0, first: true, last: true }, part.height);
      continue;
    }
    const { rows, heading, tail } = part;
    if (!rows.length) {
      if (sheet().length && heading + tail > room()) turn();
      put({ key: part.key, from: 0, to: 0, first: true, last: true }, heading + tail);
      continue;
    }
    if (sheet().length && heading + rows[0] > room()) turn();
    let from = 0;
    let height = heading;
    let first = true;
    const base = () => room();
    let limit = base();
    for (let index = 0; index < rows.length; index++) {
      if (index > from && height + rows[index] > limit) {
        put({ key: part.key, from, to: index, first, last: false }, height);
        turn();
        first = false;
        from = index;
        height = heading;
        limit = base();
      }
      height += rows[index];
    }
    if (height + tail > limit) {
      put({ key: part.key, from, to: rows.length, first, last: false }, height);
      turn();
      put({ key: part.key, from: rows.length, to: rows.length, first: false, last: true }, heading + tail);
    } else {
      put({ key: part.key, from, to: rows.length, first, last: true }, height + tail);
    }
  }
  return sheets;
}
