import { TestBed } from '@angular/core/testing';

import type { KpiVisual } from '../core/models';
import type { ChartPoint } from './dashboard-model';
import { KpiChart } from './kpi-chart';

const points: ChartPoint[] = [
  { label: 'Chili', value: 400 },
  { label: 'Cow', value: 260 },
  { label: 'Goat', value: 180 },
  { label: 'Bean', value: 140 },
];

describe('KpiChart: the newer charts', () => {
  beforeAll(() => {
    // jsdom has no layout: the chart keeps its default width.
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };
  });

  function draw(visual: KpiVisual, data: ChartPoint[] = points, extra: { value?: number | null; goal?: number | null } = {}) {
    const fixture = TestBed.createComponent(KpiChart);
    fixture.componentRef.setInput('points', data);
    fixture.componentRef.setInput('visual', visual);
    if (extra.value !== undefined) fixture.componentRef.setInput('value', extra.value);
    if (extra.goal !== undefined) fixture.componentRef.setInput('goal', extra.goal);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('area: the line, and the area under it closed to the axis', () => {
    const el = draw('area');
    const area = el.querySelector('polygon')!.getAttribute('points')!.split(' ');
    const line = el.querySelector('polyline')!.getAttribute('points')!.split(' ');
    expect(line.length).toBe(4);
    expect(area.length).toBe(line.length + 2); // down to the axis at each end
    expect(el.querySelectorAll('circle').length).toBe(4);
  });

  it('waterfall: a step per group rising from where the one before ended, then a Total of them all', () => {
    const el = draw('waterfall');
    const bars = [...el.querySelectorAll('rect')];
    expect(bars.length).toBe(5);
    expect(el.textContent).toContain('Total');
    expect(el.textContent).toContain('980'); // 400 + 260 + 180 + 140
    // Each step starts where the last ended: the first bar's top is above the second's bottom... (each rises).
    const tops = bars.map((bar) => Number(bar.getAttribute('y')));
    expect(tops[1]).toBeLessThan(tops[0]);
  });

  it('funnel: the largest first, each narrower than the one before', () => {
    const el = draw('funnel', [...points].reverse());
    const widths = [...el.querySelectorAll('rect')].map((rect) => Number(rect.getAttribute('width')));
    expect(widths.length).toBe(4);
    expect([...widths].sort((a, b) => b - a)).toEqual(widths);
    expect(el.querySelector('title')?.textContent).toContain('Chili');
  });

  it('treemap: a box per group, the biggest group the biggest box, all inside the chart', () => {
    const el = draw('treemap');
    const boxes = [...el.querySelectorAll('rect')].map((rect) => ({ w: Number(rect.getAttribute('width')), h: Number(rect.getAttribute('height')) }));
    expect(boxes.length).toBe(4);
    const areas = boxes.map((box) => box.w * box.h);
    expect(areas[0]).toBe(Math.max(...areas));
    expect(Math.round(areas.reduce((a, b) => a + b, 0))).toBeGreaterThan(0);
  });

  it('radar: a spoke per group and the shape of their values; fewer than three groups say so', () => {
    const el = draw('radar');
    expect(el.querySelectorAll('line').length).toBe(4);
    expect(el.querySelectorAll('polygon').length).toBe(5); // four rings and the shape
    expect(draw('radar', points.slice(0, 2)).textContent).toContain('at least 3 groups');
  });

  it('gauge: the number, a dial filled to it, and a tick at the goal; red under the goal, green at it', () => {
    const under = draw('gauge', [], { value: 28254, goal: 30000 });
    expect(under.textContent).toContain('28,254');
    expect(under.textContent).toContain('Goal: 30,000');
    const colour = (el: HTMLElement) => el.querySelectorAll('path')[1].getAttribute('stroke');
    const met = draw('gauge', [], { value: 31000, goal: 30000 });
    expect(colour(under)).not.toBe(colour(met));
    expect(under.querySelector('line')).toBeTruthy();
    // No goal: no tick.
    expect(draw('gauge', [], { value: 5, goal: null }).querySelector('line')).toBeNull();
  });

  it('lollipop: negative and positive values sit on opposite sides of a shared zero baseline', () => {
    const el = draw('lollipop', [{ label: 'Loss', value: -10 }, { label: 'Gain', value: 20 }]);
    const zero = Number(el.querySelector('.zero')!.getAttribute('x1'));
    const dots = [...el.querySelectorAll('.comparison-point')].map((dot) => Number(dot.getAttribute('cx')));
    expect(dots.some((x) => x < zero)).toBe(true);
    expect(dots.some((x) => x > zero)).toBe(true);
    expect(el.querySelector('svg')!.getAttribute('aria-label')).toBe('Lollipop chart');
    expect([...el.querySelectorAll('title')].map((t) => t.textContent)).toContain('Loss: -10');
    expect(el.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it('dot: retains zero values, excludes non-finite values, and bounds large category lists without summing averages', () => {
    const el = draw('dot', [{ label: 'Invalid', value: NaN }, ...Array.from({ length: 14 }, (_, i) => ({ label: `Group ${i}`, value: i }))]);
    expect(el.querySelectorAll('.comparison-point').length).toBe(12);
    expect(el.textContent).toContain('12 largest of 14 groups');
    expect(el.textContent).not.toContain('Other');
    expect(el.innerHTML).not.toMatch(/NaN|Infinity/);
    const zeros = draw('dot', [{ label: 'Zero', value: 0 }]);
    expect(zeros.querySelectorAll('.comparison-point').length).toBe(1);
    expect(zeros.querySelector('title')!.textContent).toBe('Zero: 0');
    expect(zeros.innerHTML).not.toMatch(/NaN|Infinity/);
    const extremes = draw('dot', [{ label: 'Low', value: -Number.MAX_VALUE }, { label: 'High', value: Number.MAX_VALUE }]);
    for (const circle of extremes.querySelectorAll('.comparison-point')) expect(Number.isFinite(Number(circle.getAttribute('cx')))).toBe(true);
  });

  it('pareto: ranks contributions and reaches a cumulative 100% on a separate percentage scale', () => {
    const el = draw('pareto', [{ label: 'Small', value: 10 }, { label: 'Large', value: 60 }, { label: 'Middle', value: 30 }]);
    expect([...el.querySelectorAll('.pareto-bar title')].map((t) => t.textContent)).toEqual(['Large: 60', 'Middle: 30', 'Small: 10']);
    expect([...el.querySelectorAll('.cumulative-point title')].map((t) => t.textContent)).toEqual(['Large: cumulative 60.0%', 'Middle: cumulative 90.0%', 'Small: cumulative 100.0%']);
    expect(el.querySelector('.cumulative-line')).toBeTruthy();
    expect(el.innerHTML).not.toMatch(/NaN|Infinity/);
    const many = draw('pareto', Array.from({ length: 20 }, (_, i) => ({ label: `Group ${i}`, value: 1 })));
    expect(many.querySelectorAll('.pareto-bar').length).toBe(12);
    expect([...many.querySelectorAll('.cumulative-point title')].at(-1)!.textContent).toContain('100.0%');
    expect(many.textContent).toContain('Remaining groups combined');
  });

  it('polar: equal-angle areas, rather than radii, are proportional to positive values', () => {
    const el = draw('polar', [{ label: 'Nine', value: 9 }, { label: 'One', value: 1 }, { label: 'Zero', value: 0 }]);
    const paths = [...el.querySelectorAll('.polar-sector')].map((p) => p.getAttribute('d')!);
    expect(paths.length).toBe(2);
    const radii = paths.map((path) => Number(path.match(/ A ([\d.]+)/)![1]));
    expect((radii[0] / radii[1]) ** 2).toBeCloseTo(9);
    expect(el.textContent).toContain('90.0%');
    expect(el.innerHTML).not.toMatch(/NaN|Infinity/);
    expect(draw('polar', [{ label: 'Only group', value: 3 }]).querySelector('.polar-sector')!.getAttribute('d')).toContain('A 1 1 0 1 1');
  });

  it('share charts explain unsuitable negative or all-zero data and new charts retain the empty state', () => {
    for (const type of ['pareto', 'polar'] as const) {
      for (const values of [[-1, 2], [0, 0]]) {
        const el = draw(type, values.map((value, i) => ({ label: `Group ${i}`, value })));
        expect(el.querySelector('svg')).toBeNull();
        expect(el.textContent).toContain('non-negative values with a positive total');
      }
    }
    for (const type of ['lollipop', 'dot', 'pareto', 'polar'] as const) {
      expect(draw(type, []).textContent).toContain('No rows to chart yet.');
    }
  });
});
