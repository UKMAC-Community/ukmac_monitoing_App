import { TestBed } from '@angular/core/testing';

import type { Cells, Column } from '../core/models';
import qaQc from '../sheet/fixtures/qa-qc-columns.json';
import { makeSheet } from '../test-helpers';
import { checkKey, fillOf, OVERALL, QaQcMap, shortName, stageKey, STATUS_COLOURS } from './qa-qc-map';

const columns = qaQc as Column[];
const key = (stage: number, group: string | undefined, name: string) =>
  columns.find((column) => (stage ? (column.box ?? '').startsWith(`${stage} ·`) : !column.box) && (column.group ?? '') === (group ?? '') && column.name === name)!.key;
const LEAF = 'Seedling Leaf Stage (No.)';

function record(zone: string, leaf: [string, string, string], live: string): Cells {
  return {
    [key(0, undefined, 'Date')]: '2026-05-10',
    [key(0, undefined, 'Zone')]: zone,
    [key(1, LEAF, '4–5, good')]: leaf[0],
    [key(1, LEAF, '3, >5')]: leaf[1],
    [key(1, LEAF, 'Disease')]: leaf[2],
    [key(2, 'Plant Survival (No.)', 'Live plant')]: live,
  };
}

const zoneColumns: Column[] = ['Zone', 'Plot', 'Zone number', 'Row', 'Column', 'Plot status', 'Status name', 'Outline'].map((name, index) => ({
  key: `z${index + 1}`,
  name,
  type: ['Zone number', 'Row', 'Column'].includes(name) ? 'number' : 'text',
}));
// An outline as the Zones table keeps it: "lat,lng;lat,lng".
const square = (lat: number) => `${lat},100;${lat},100.001;${lat + 0.001},100.001;${lat + 0.001},100`;
const zones = makeSheet(
  1,
  'Zones',
  zoneColumns,
  [
    ...['A1', 'A2', 'B1'].map((plot, index) => ({ z1: 'A', z2: plot, z3: '1', z4: String(index + 1), z5: '1', z6: 'Active', z8: square(13 + index * 0.01) })),
    // A pond (water) with an outline: drawn, but with no stack.
    { z1: 'Pond', z2: 'P1', z4: '1', z5: '1', z6: 'Water', z7: 'Pond', z8: square(13.1) },
  ],
  'zones',
);

/** The farm's own words for the stages, as the QA/QC table's headings give them. */
const STAGE_NAMES = ['Transplant', 'Establishment', 'Vegetative', 'Flowering', 'Fruit set', 'First Harvest', 'Maturity', 'Harvest', 'Plant Health', 'End of Cycles'];
const SURVIVAL = 'Plant Survival (≥95%)';
const LEAF_CHECK = 'Seedling Leaf (%)';

describe('QaQcMap: the analysis as layers stacked on each plot, in 3D', () => {
  function make(extra: Cells = {}, sheetList = [zones]) {
    const sheet = makeSheet(
      11,
      'QA/QC Management',
      columns,
      [
        { ...record('A1', ['18', '1', '1'], '18'), ...extra }, // leaf 90% GREEN; survival 18 / (18 + dead 2) = 90%: YELLOW
        record('A2', ['2', '1', '17'], '20'), // leaf: the biggest bucket is Disease: RED; survival GREEN
      ],
      'qa-qc-management',
    );
    const fixture = TestBed.createComponent(QaQcMap);
    fixture.componentRef.setInput('sheet', sheet);
    fixture.componentRef.setInput('sheets', [...sheetList, sheet]);
    fixture.componentRef.setInput('mac', { macName: 'Pursat', latitude: null, longitude: null });
    return fixture.componentInstance;
  }
  const shapeOf = (map: QaQcMap, plot: string) => map.shapes().find((shape) => shape.label === plot)!;
  const fills = (map: QaQcMap, plot: string) => shapeOf(map, plot).stack!.map((pane) => pane.fill);
  const GREEN = STATUS_COLOURS.GREEN.fill;
  const YELLOW = STATUS_COLOURS.YELLOW.fill;
  const RED = STATUS_COLOURS.RED.fill;

  it('opens on a layer for each stage, the first stage at the bottom and the last on top', () => {
    const map = make();
    expect(map.panes().map((pane) => pane.label)).toEqual(STAGE_NAMES);
    expect(map.summary()).toBe('Each stage (10 layers)');
    expect(map.picks()).toEqual([]);
  });

  it("names each stage as the farm does, and says its number and days after transplanting under it", () => {
    const map = make();
    expect(map.stages().map((stage) => stage.title)).toEqual(STAGE_NAMES);
    expect(map.stages()[1]).toMatchObject({ name: 'Stage 2 (7 DAT)', no: 2, title: 'Establishment', sub: 'Stage 2 · 7 DAT' });
    expect(map.stages()[9]).toMatchObject({ no: 10, title: 'End of Cycles', sub: 'Stage 10 · End of cycle' });
    // A stage layer is named by its word; its hover says the rest.
    expect(map.panes()[3]).toMatchObject({ kind: 'stage', label: 'Flowering', title: expect.stringContaining('Stage 4 · 45 DAT') });
    // A check names the stage it is in.
    map.toggle(checkKey('Stage 1 (0 DAT)', LEAF_CHECK));
    expect(map.panes()[0]).toMatchObject({ kind: 'check', label: 'Seedling Leaf (%)', where: 'Stage 1 · Transplant' });
  });

  it('stacks the plots with a QC record, each layer the colour of what the analysis says there, an empty frame where nothing is entered', () => {
    const map = make();
    // A1: stage 1 green (its leaf check), stage 2 yellow (survival 90%); the rest have nothing entered. A2: red, then green.
    expect(fills(map, 'A1')).toEqual([GREEN, YELLOW, null, null, null, null, null, null, null, null]);
    expect(fills(map, 'A2')).toEqual([RED, GREEN, null, null, null, null, null, null, null, null]);
    expect(shapeOf(map, 'A1').stack!.map((pane) => pane.label)).toEqual(STAGE_NAMES);
    // Each layer says what it says in a word (told where it is pointed at on the map), and the plot's name has a dot of its overall.
    expect(shapeOf(map, 'A1').stack!.slice(0, 3).map((pane) => pane.note)).toEqual(['Green', 'Yellow', 'No reading yet']);
    expect(shapeOf(map, 'A1').badge).toBe(YELLOW);
    expect(shapeOf(map, 'A2').badge).toBe(RED);
    expect(shapeOf(map, 'B1').badge).toBeUndefined();
    // What a plot says where it is pointed at (its name may not show): a plot without a record, a plot with one, water.
    expect(shapeOf(map, 'B1').hint).toBe('No QC record yet');
    expect(shapeOf(map, 'A1').hint).toBe('Yellow overall: point at a layer');
    expect(shapeOf(map, 'Pond').hint).toBe('Water');
    // A plot with no QC record has no stack (a pale bed), and water is as the Zone Map draws it.
    expect(shapeOf(map, 'B1').stack).toBeUndefined();
    expect(shapeOf(map, 'B1').fill).toBe('#e2e8f0');
    expect(shapeOf(map, 'Pond')).toMatchObject({ fill: '#dbeafe' });
    expect(shapeOf(map, 'Pond').stack).toBeUndefined();
    expect(fillOf(null)).toBe(STATUS_COLOURS.NONE.fill);
    expect(map.stackedCount()).toBe(2);
    // The map opens on the two plots with a record.
    expect(map.stackedIds()).toEqual([shapeOf(map, 'A1').id, shapeOf(map, 'A2').id]);
  });

  it('tells which layer is on top: the key lists the layers top first, numbered from the bottom, with how many plots are green, yellow and red', () => {
    const map = make();
    const rows = map.keyRows();
    expect(rows.map((row) => row.level)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(rows[0]).toMatchObject({ label: 'End of Cycles', scored: 0, segments: [], barTitle: 'No plot has a reading here yet' });
    expect(rows.at(-1)).toMatchObject({ label: 'Transplant', scored: 2, barTitle: '1 green, 1 red of 2 plots' });
    // Each row's bar: its plots in green, yellow and red.
    expect(rows.at(-1)!.segments.map((item) => [item.key, item.count])).toEqual([['GREEN', 1], ['RED', 1]]);
    expect(rows.at(-2)!.segments.map((item) => [item.key, item.count])).toEqual([['GREEN', 1], ['YELLOW', 1]]);
  });

  it('stacks what is ticked in the order ticked (the first at the bottom): a stage is one layer, the worst of its checks', () => {
    const map = make();
    // Ticked stage 2 first, then a stage 1 check: the stage goes at the bottom.
    map.toggle(stageKey('Stage 2 (7 DAT)'));
    map.toggle(checkKey('Stage 1 (0 DAT)', LEAF_CHECK));
    expect(map.panes().map((pane) => pane.label)).toEqual(['Establishment', 'Seedling Leaf (%)']);
    expect(map.panes()[1]).toMatchObject({ kind: 'check', where: 'Stage 1 · Transplant' });
    expect(map.order(stageKey('Stage 2 (7 DAT)'))).toBe(1);
    expect(map.order(checkKey('Stage 1 (0 DAT)', LEAF_CHECK))).toBe(2);
    expect(map.order(stageKey('Stage 3 (30 DAT)'))).toBe(0);
    expect(map.summary()).toBe('2 layers');
    expect(fills(map, 'A1')).toEqual([YELLOW, GREEN]);
    expect(fills(map, 'A2')).toEqual([GREEN, RED]);
    // The key follows: the last ticked is the top.
    expect(map.keyRows().map((row) => [row.level, row.label])).toEqual([[1, 'Seedling Leaf (%)'], [0, 'Establishment']]);
    // A check's layer says on the map which stage it is of.
    expect(shapeOf(map, 'A1').stack!.map((pane) => pane.label)).toEqual(['Establishment', 'Seedling Leaf (%) (Stage 1 · Transplant)']);
    // One taken off again.
    map.toggle(stageKey('Stage 2 (7 DAT)'));
    expect(map.panes().map((pane) => pane.label)).toEqual(['Seedling Leaf (%)']);
    expect(map.summary()).toBe('Seedling Leaf (%)');
    expect(map.keyRows().map((row) => row.label)).toEqual(['Seedling Leaf (%)']);
    // The overall can be a layer too (the worst of every check): on top of the leaf check, as it was ticked last.
    map.toggle(OVERALL);
    expect(map.panes().map((pane) => pane.label)).toEqual(['Seedling Leaf (%)', 'Overall']);
    expect(fills(map, 'A1')).toEqual([GREEN, YELLOW]);
    expect(fills(map, 'A2')).toEqual([RED, RED]);
    // Everything let go: a layer for each stage again.
    map.clear();
    expect(map.panes()).toHaveLength(10);
  });

  it("tells a plot's layers when it is picked, top first; a layer that is not green says which of its checks are not", () => {
    const map = make();
    map.pickedPlot.set(shapeOf(map, 'A2').id);
    const detail = map.detail()!;
    expect(detail).toMatchObject({ title: 'A2', where: 'Zone A · 1', overall: 'RED', note: '', checks: 2 });
    expect(detail.counts.map((item) => [item.key, item.count, item.word])).toEqual([['RED', 1, 'red'], ['GREEN', 1, 'green']]);
    expect(detail.layers.map((layer) => layer.level)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(detail.layers[0]).toMatchObject({ label: 'End of Cycles', status: null, word: 'No reading yet', items: [] });
    // The bottom layer is red: it says which of its checks are not green.
    const first = detail.layers.at(-1)!;
    expect(first).toMatchObject({ label: 'Transplant', status: 'RED', word: 'Red' });
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({ check: 'Seedling Leaf (%)', fill: RED });
    expect(first.items[0].result).toContain('plants');
    // The one above it is green: nothing more to say.
    expect(detail.layers.at(-2)).toMatchObject({ label: 'Establishment', status: 'GREEN', items: [] });
    // A yellow layer says its yellow check too (A1's survival is 90%).
    map.pickedPlot.set(shapeOf(map, 'A1').id);
    const yellow = map.detail()!.layers.at(-2)!;
    expect(yellow).toMatchObject({ label: 'Establishment', status: 'YELLOW' });
    expect(yellow.items.map((item) => item.check)).toEqual(['Plant Survival']);
    // A plot with no record says so; closing it lets go.
    map.pickedPlot.set(shapeOf(map, 'B1').id);
    expect(map.detail()).toMatchObject({ title: 'B1', overall: null, note: 'No QC record for this plot yet.', layers: [] });
    map.pickedPlot.set(null);
    expect(map.detail()).toBeNull();
  });

  it("names a check by its own label (two 'Fruit Length' checks differ) and says its Value when it has no Actual Result", () => {
    const flowers = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [key(4, 'Plant Flowering – Flowers per Plant (No.)', `P#${index + 1}`), '12']));
    const map = make(flowers);
    map.pickedPlot.set(shapeOf(map, 'A1').id);
    // As a layer of its own, a check says its result on its own line: Plant Flowering has a Value (the share of plants with flowers)
    // and no Actual Result, so the Value is what it reads.
    const flowering = map.stages().find((stage) => stage.name === 'Stage 4 (45 DAT)')!.checks.find((check) => check.label === 'Plant Flowering')!;
    map.toggle(checkKey('Stage 4 (45 DAT)', flowering.key));
    expect(map.detail()!.layers[0]).toMatchObject({ label: 'Plant Flowering', result: '100%', items: [] });
  });

  it('puts a card over the plot picked: its worst, and how its checks divide', () => {
    const map = make();
    expect(map.card()).toBeNull();
    map.pickedPlot.set(shapeOf(map, 'A2').id);
    expect(map.card()).toMatchObject({ title: 'A2', color: RED });
    expect(map.card()!.lines).toEqual(['Red overall', '1 red · 1 green checks']);
    map.pickedPlot.set(shapeOf(map, 'A1').id);
    expect(map.card()!.lines).toEqual(['Yellow overall', '1 yellow · 1 green checks']);
    map.pickedPlot.set(shapeOf(map, 'B1').id);
    expect(map.card()!.lines).toEqual(['No QC record yet']);
    expect(map.card()!.color).toBe(STATUS_COLOURS.NONE.fill);
  });

  it('lights one layer up from the key (the pointer over its row) and lets go', () => {
    const map = make();
    expect(map.hover()).toBeNull();
    map.hover.set(1);
    expect(map.hover()).toBe(1);
    map.hover.set(null);
    expect(map.hover()).toBeNull();
    // And the other way: a layer pointed at on the map marks its row on the key.
    expect(map.pointed()).toBeNull();
  });

  it('offers the overall, the stages and their checks, each with how many plots are green, yellow and red', () => {
    const map = make();
    expect(map.stages().find((stage) => stage.name === 'Stage 2 (7 DAT)')!.checks.map((check) => check.key)).toEqual([SURVIVAL, 'New Growth (Visible growth, upright)']);
    // Each check has its own name and its target apart, and two checks of one name differ by it.
    expect(map.stages().find((stage) => stage.name === 'Stage 2 (7 DAT)')!.checks[0]).toEqual({ key: SURVIVAL, label: 'Plant Survival', target: '≥95%' });
    const pests = map.stages().find((stage) => stage.name === 'Stage 9 (75–150 DAT)')!.checks;
    expect(pests.map((check) => check.label)).toEqual(['Pest/Disease (W1–W10)', 'Pest/Disease (W11–W21)']);
    expect(map.checkCounts('Stage 2 (7 DAT)', SURVIVAL).map((item) => [item.key, item.count])).toEqual([['GREEN', 1], ['YELLOW', 1]]);
    expect(map.checkCounts('Stage 1 (0 DAT)', LEAF_CHECK).map((item) => [item.key, item.count])).toEqual([['GREEN', 1], ['RED', 1]]);
    const stage1 = map.stages().find((stage) => stage.name === 'Stage 1 (0 DAT)')!;
    expect(map.stageCounts(stage1).map((item) => [item.key, item.count])).toEqual([['GREEN', 1], ['RED', 1]]);
    // A1's worst is yellow, A2's red.
    expect(map.overallCounts().map((item) => [item.key, item.count])).toEqual([['YELLOW', 1], ['RED', 1]]);
  });

  it("has the map at the middle of the plots when the MAC has no place of its own, and none with no outlines", () => {
    expect(make().place()).toMatchObject({ lat: expect.any(Number), lng: expect.any(Number) });
    const noOutlines = makeSheet(1, 'Zones', zoneColumns, [{ z1: 'A', z2: 'A1', z3: '1', z4: '1', z5: '1', z6: 'Active' }], 'zones');
    expect(make({}, [noOutlines]).place()).toBeNull();
  });

  it('names a check without its target', () => {
    expect(shortName('Plant Vigor Score (Avg.) (≥4/5 Preferred)')).toBe('Plant Vigor Score');
    expect(shortName('Seedling Leaf (%)')).toBe('Seedling Leaf');
    expect(shortName('Stage 3')).toBe('Stage 3');
  });
});
