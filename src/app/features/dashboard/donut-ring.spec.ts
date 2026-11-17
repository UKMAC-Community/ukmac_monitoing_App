import { DONUT_IN, DONUT_OUT, DONUT_ROUND, ringPath } from './kpi-chart';

const numbers = (path: string) => (path.match(/-?\d+\.?\d*/g) ?? []).map(Number);

describe('donut ring', () => {
  it('draws a segment inside the ring, pulled in by half its rounding stroke so the rounded edge stays within it', () => {
    const path = ringPath(-Math.PI / 2, 0);
    expect(path.startsWith('M ') && path.endsWith('Z')).toBe(true);
    const points = numbers(path);
    // Every corner of the segment lies between the ring's two edges, less the stroke that is drawn round them.
    const corners = [points.slice(0, 2), points.slice(7, 9), points.slice(9, 11), points.slice(16, 18)];
    for (const [x, y] of corners) {
      const radius = Math.hypot(x, y);
      expect(radius).toBeGreaterThanOrEqual(DONUT_IN + DONUT_ROUND / 2 - 0.001);
      expect(radius).toBeLessThanOrEqual(DONUT_OUT - DONUT_ROUND / 2 + 0.001);
    }
  });

  it('leaves a gap between neighbouring segments', () => {
    const first = numbers(ringPath(0, Math.PI));
    const second = numbers(ringPath(Math.PI, Math.PI * 2));
    // The first ends before the second begins: their angles on the outer edge differ.
    const angleOf = (x: number, y: number) => Math.atan2(y, x);
    const firstEnd = angleOf(first[7], first[8]);
    const secondStart = angleOf(second[0], second[1]);
    expect(Math.abs(secondStart - firstEnd)).toBeGreaterThan(0.05);
  });

  it('is a ring of two circles for a whole turn, and a dot for a slice too thin for its gap', () => {
    expect((ringPath(0, Math.PI * 2).match(/ M /g) ?? []).length).toBe(1);
    const thin = numbers(ringPath(1, 1.001));
    expect(thin[0]).toBeCloseTo(thin[7], 2);
    expect(thin[1]).toBeCloseTo(thin[8], 2);
  });
});
