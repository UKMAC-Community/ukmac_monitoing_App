import { showsPlot, type ZoneCell } from '@shared/map/zone-layout';
import { type Reading, type Status, worst } from './analysis-readings';

/**
 * The QA/QC map seen by check: one thing picked (each plot's latest stage, the overall, a stage or a single check) and every plot on the map in the colour it
 * says there. The map's colours and the list's counts both come from here, so "4 red" in the list is the 4 red plots on the map.
 */

/** The plots the map draws and colours: the zones' plots with an outline, as the MAC's map shows them (no water, greenhouses or the rest). */
export function checkCells(cells: readonly ZoneCell[]): ZoneCell[] {
  return cells.filter((cell) => showsPlot(cell, 'zones') && cell.outline.length >= 3);
}

/** Whether a pick takes one of a plot's readings, seeing all of that plot's readings (the latest stage depends on them). */
export type ReadingMatch = (reading: Reading, all: readonly Reading[]) => boolean;

/** The readings of one plot a pick takes. */
export function readingsUnder(all: readonly Reading[], match: ReadingMatch): Reading[] {
  return all.filter((reading) => match(reading, all));
}

/** The newest stage a plot has a reading in, by the stages' order (first to last); null when it has none. */
export function latestStageOf(readings: readonly Reading[], stageOrder: readonly string[]): string | null {
  let latest: string | null = null;
  let at = -1;
  for (const reading of readings) {
    const index = stageOrder.indexOf(reading.stage);
    if (index > at) {
      at = index;
      latest = reading.stage;
    }
  }
  return latest;
}

/** How many plots are at each stage as their newest, in the stages' order (plots with no reading left out). */
export function latestStageCounts(cells: readonly ZoneCell[], readings: ReadonlyMap<string, readonly Reading[]>, stageOrder: readonly string[]): { stage: string; plots: number }[] {
  const counts = new Map<string, number>();
  for (const cell of cells) {
    const stage = latestStageOf(readings.get(cell.plot) ?? [], stageOrder);
    if (stage) counts.set(stage, (counts.get(stage) ?? 0) + 1);
  }
  return stageOrder.filter((stage) => counts.has(stage)).map((stage) => ({ stage, plots: counts.get(stage)! }));
}

/** What one pick says of each plot (by its id): the worst of its readings that `match`; null where it has none yet. */
export function plotStatuses(cells: readonly ZoneCell[], readings: ReadonlyMap<string, readonly Reading[]>, match: ReadingMatch): Map<string, Status | null> {
  const statuses = new Map<string, Status | null>();
  for (const cell of cells) statuses.set(cell.id, worst(readingsUnder(readings.get(cell.plot) ?? [], match).map((reading) => reading.status)));
  return statuses;
}

/** How the plots divide on one pick: green (OK), yellow (to watch), red (a problem), and none (no reading yet). */
export interface CheckTally {
  GREEN: number;
  YELLOW: number;
  RED: number;
  NONE: number;
  plots: number;
}

export function tallyOf(statuses: ReadonlyMap<string, Status | null>): CheckTally {
  const tally: CheckTally = { GREEN: 0, YELLOW: 0, RED: 0, NONE: 0, plots: statuses.size };
  for (const status of statuses.values()) tally[status ?? 'NONE'] += 1;
  return tally;
}

/** A tally in words, for a hover: "90 green, 3 yellow, 4 red and 5 with no reading, of 102 plots". */
export function tallyWords(tally: CheckTally): string {
  const parts = [
    tally.GREEN ? `${tally.GREEN} green` : '',
    tally.YELLOW ? `${tally.YELLOW} yellow` : '',
    tally.RED ? `${tally.RED} red` : '',
    tally.NONE ? `${tally.NONE} with no reading` : '',
  ].filter(Boolean);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] ?? 'nothing');
  return `${list}, of ${tally.plots} plot${tally.plots === 1 ? '' : 's'}`;
}

/** A small ring of the tally (green, yellow, red, then grey for no reading), as a CSS conic gradient. */
export function tallyRing(tally: CheckTally, fills: Record<Status | 'NONE', string>): string {
  if (!tally.plots) return fills.NONE;
  let at = 0;
  const stops = (['GREEN', 'YELLOW', 'RED', 'NONE'] as const)
    .filter((key) => tally[key])
    .map((key) => {
      const from = at;
      at += (tally[key] / tally.plots) * 100;
      return `${fills[key]} ${from.toFixed(2)}% ${at.toFixed(2)}%`;
    });
  return `conic-gradient(${stops.join(', ')})`;
}
