import type { Reading, Status } from './analysis-readings';
import { countScale, shareOf, zoneStatuses } from './zone-status';

const reading = (status: Status): Reading => ({ stage: '1', check: 'Leaf', label: 'Leaf', target: '', status, result: '' });
const readings = (...statuses: Status[]) => statuses.map(reading);

// Plots A1, A2 in zone 1; B1 in zone 2; Z9 with no zone number; C1 has no reading yet.
const zones: Record<string, string> = { A1: '1', A2: '1', B1: '2', C1: '10' };
const zoneOf = (plot: string) => zones[plot] ?? null;

describe('the QA/QC checks by zone number', () => {
  const tally = zoneStatuses(
    new Map([
      ['A1', readings('GREEN', 'GREEN', 'RED')],
      ['B1', readings('YELLOW', 'GREEN')],
      ['A2', readings('GREEN', 'YELLOW')],
      ['Z9', readings('RED')],
      ['C1', []],
    ]),
    zoneOf,
  );

  it('adds each plot\'s checks to its zone number, the numbers in order and a plot with none last', () => {
    expect(tally.zones.map((zone) => [zone.zone, zone.GREEN, zone.YELLOW, zone.RED, zone.total])).toEqual([
      ['1', 3, 1, 1, 5],
      ['2', 1, 1, 0, 2],
      ['', 0, 0, 1, 1],
    ]);
  });

  it('leaves out a zone with no checks yet, and counts all the zones together', () => {
    expect(tally.zones.some((zone) => zone.zone === '10')).toBe(false);
    expect([tally.all.GREEN, tally.all.YELLOW, tally.all.RED, tally.all.total]).toEqual([4, 2, 2, 8]);
  });

  it('writes a share of the zone\'s green, yellow and red as the farm\'s sheet does', () => {
    expect(shareOf(120, 200)).toBe('60.0%');
    expect(shareOf(50, 200)).toBe('25.0%');
    expect(shareOf(1, 3)).toBe('33.3%');
    expect(shareOf(0, 0)).toBe('');
  });

  it('orders zone numbers as numbers: 2 before 10', () => {
    const two = zoneStatuses(new Map([['C1', readings('GREEN')], ['B1', readings('RED')]]), zoneOf);
    expect(two.zones.map((zone) => zone.zone)).toEqual(['2', '10']);
  });
});

describe('the graph\'s count axis', () => {
  it('rounds the top up over the largest count, about five steps of 1, 2, 2.5 or 5 times a power of ten', () => {
    expect(countScale(233)).toEqual({ max: 250, ticks: [0, 50, 100, 150, 200, 250] });
    expect(countScale(62)).toEqual({ max: 80, ticks: [0, 20, 40, 60, 80] });
    expect(countScale(11)).toEqual({ max: 15, ticks: [0, 5, 10, 15] }); // no 2.5 steps: a count is whole
    expect(countScale(1000)).toEqual({ max: 1000, ticks: [0, 200, 400, 600, 800, 1000] });
  });

  it('keeps whole steps for small counts, and an axis when there is nothing', () => {
    expect(countScale(3)).toEqual({ max: 3, ticks: [0, 1, 2, 3] });
    expect(countScale(0)).toEqual({ max: 1, ticks: [0, 1] });
  });
});
