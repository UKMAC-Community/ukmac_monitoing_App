import type { ZoneCell } from '@shared/map/zone-layout';
import type { Reading, Status } from './analysis-readings';
import { checkCells, latestStageCounts, latestStageOf, plotStatuses, tallyOf, tallyRing, tallyWords } from './check-view';

const cell = (id: string, plot: string, usage = 'normal', outline = 4, section: number | null = 1) =>
  ({ id, plot, usage, section, outline: Array.from({ length: outline }, (_, i) => [13 + i, 100] as [number, number]) }) as unknown as ZoneCell;
const reading = (check: string, status: Status, stage = 'Stage 1 (0 DAT)'): Reading => ({ stage, check, label: check, target: '', status, result: '' });

describe('the QA/QC map seen by check', () => {
  // A pond, a plot with no outline and an old plot in no zone are not drawn.
  const cells = [cell('1', 'A1'), cell('2', 'A2'), cell('3', 'A3'), cell('4', 'P1', 'water'), cell('5', 'A5', 'normal', 0), cell('6', 'Old', 'normal', 4, null)];
  const readings = new Map([
    ['A1', [reading('Leaf', 'GREEN'), reading('Vigor', 'YELLOW')]],
    ['A2', [reading('Leaf', 'RED'), reading('Vigor', 'GREEN')]],
  ]);

  it("colours only the zones' plots that have an outline", () => {
    expect(checkCells(cells).map((item) => item.plot)).toEqual(['A1', 'A2', 'A3']);
  });

  it('gives each plot the worst of its readings under the pick, none where it has none', () => {
    const shown = checkCells(cells);
    expect([...plotStatuses(shown, readings, () => true)]).toEqual([['1', 'YELLOW'], ['2', 'RED'], ['3', null]]);
    expect([...plotStatuses(shown, readings, (item) => item.check === 'Leaf')]).toEqual([['1', 'GREEN'], ['2', 'RED'], ['3', null]]);
  });

  it("finds each plot's newest stage by the stages' order, whatever order its readings come in", () => {
    const order = ['S1', 'S2', 'S3'];
    const late = [reading('Fruit', 'GREEN', 'S3'), reading('Leaf', 'RED', 'S1'), reading('Vigor', 'YELLOW', 'S2')];
    expect(latestStageOf(late, order)).toBe('S3');
    expect(latestStageOf(late, ['S3', 'S2', 'S1'])).toBe('S1');
    // A stage not in the list is not counted; no readings at all is no stage.
    expect(latestStageOf([reading('Leaf', 'RED', 'Old')], order)).toBeNull();
    expect(latestStageOf([], order)).toBeNull();
  });

  it("colours each plot by the worst of its newest stage's checks only, an older red left out", () => {
    const order = ['S1', 'S2'];
    const latest = (item: Reading, all: readonly Reading[]) => item.stage === latestStageOf(all, order);
    const byStage = new Map([
      // Red at the start, all green at its newest stage.
      ['A1', [reading('Leaf', 'RED', 'S1'), reading('Fruit', 'GREEN', 'S2'), reading('Size', 'GREEN', 'S2')]],
      // Not past the first stage yet.
      ['A2', [reading('Leaf', 'YELLOW', 'S1')]],
      ['A3', [reading('Leaf', 'GREEN', 'S1'), reading('Fruit', 'GREEN', 'S2'), reading('Size', 'RED', 'S2')]],
    ]);
    const shown = checkCells(cells);
    expect([...plotStatuses(shown, byStage, latest)]).toEqual([['1', 'GREEN'], ['2', 'YELLOW'], ['3', 'RED']]);
    expect([...plotStatuses(shown, byStage, () => true)]).toEqual([['1', 'RED'], ['2', 'YELLOW'], ['3', 'RED']]);
    // Which stages the plots are at, in the stages' order; a plot with no reading is at none.
    expect(latestStageCounts(shown, byStage, order)).toEqual([
      { stage: 'S1', plots: 1 },
      { stage: 'S2', plots: 2 },
    ]);
    expect(latestStageCounts(shown, new Map(), order)).toEqual([]);
  });

  it('counts the plots green, yellow, red and with no reading, and says it in words', () => {
    const tally = tallyOf(plotStatuses(checkCells(cells), readings, () => true));
    expect(tally).toEqual({ GREEN: 0, YELLOW: 1, RED: 1, NONE: 1, plots: 3 });
    expect(tallyWords(tally)).toBe('1 yellow, 1 red and 1 with no reading, of 3 plots');
    expect(tallyWords({ GREEN: 1, YELLOW: 0, RED: 0, NONE: 0, plots: 1 })).toBe('1 green, of 1 plot');
  });

  it('draws the tally as a ring, each colour its share', () => {
    const fills = { GREEN: 'g', YELLOW: 'y', RED: 'r', NONE: 'n' };
    expect(tallyRing({ GREEN: 1, YELLOW: 0, RED: 1, NONE: 2, plots: 4 }, fills)).toBe('conic-gradient(g 0.00% 25.00%, r 25.00% 50.00%, n 50.00% 100.00%)');
    expect(tallyRing({ GREEN: 0, YELLOW: 0, RED: 0, NONE: 0, plots: 0 }, fills)).toBe('n');
  });
});
