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

  it('line: names every point when its label is short enough to fit under it', () => {
    const days = Array.from({ length: 10 }, (_, index) => ({ label: `D${index + 1}`, value: 100 + index }));
    const el = draw('line', days);
    const names = [...el.querySelectorAll('svg text.axis')].map((text) => text.textContent?.trim());
    for (const day of days) expect(names).toContain(day.label);
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

  it('column timeline: a place for every day that scrolls sideways, a bar only on the days with rows', () => {
    const days: ChartPoint[] = Array.from({ length: 30 }, (_, index) => {
      const day = String(index + 1).padStart(2, '0');
      const has = index === 0 || index === 9 || index === 29;
      return { key: `2026-07-${day}`, label: `${day}/07/2026`, value: has ? 100 : 0, ...(has ? {} : { empty: true }) };
    });
    const fixture = TestBed.createComponent(KpiChart);
    fixture.componentRef.setInput('points', days);
    fixture.componentRef.setInput('visual', 'column');
    fixture.componentRef.setInput('timeline', true);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('rect').length).toBe(3);
    // Every one of the 30 days is named (the year on the first only), the axis is kept apart from what scrolls.
    const named = [...el.querySelectorAll('.day-scroll text.axis')].map((text) => text.textContent?.trim());
    expect(named.length).toBe(30);
    expect(named[0]).toBe('01/07/2026');
    expect(named[1]).toBe('02/07');
    expect(el.querySelectorAll('.day-axis text.axis').length).toBe(5);
    // Wider than the room there is (30 days × the room each needs), so it scrolls.
    const svg = el.querySelector('.day-scroll svg')!;
    expect(Number(svg.getAttribute('width'))).toBeGreaterThan(30 * 60);
    // Without the timeline, the 30 points are grouped to 12 as before.
    const plain = TestBed.createComponent(KpiChart);
    plain.componentRef.setInput('points', days.map(({ empty, ...point }) => point));
    plain.componentRef.setInput('visual', 'column');
    plain.detectChanges();
    expect((plain.nativeElement as HTMLElement).querySelectorAll('rect').length).toBe(12);
  });
});

describe('KpiChart: zone colours', () => {
  beforeAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };
  });

  const zones: ChartPoint[] = [
    { label: '1', value: 146 },
    { label: '2', value: 99 },
    { label: '10', value: 40 },
    { label: '(blank)', value: 0 },
  ];

  function fills(visual: KpiVisual, zoneColours: boolean) {
    const fixture = TestBed.createComponent(KpiChart);
    fixture.componentRef.setInput('points', zones);
    fixture.componentRef.setInput('visual', visual);
    fixture.componentRef.setInput('zoneColours', zoneColours);
    fixture.detectChanges();
    return [...(fixture.nativeElement as HTMLElement).querySelectorAll('rect')]
      .map((rect) => rect.getAttribute('fill'))
      .filter((fill) => !!fill && fill !== 'transparent');
  }

  it('column: each zone number is painted as the Zone Map paints it, the blank one plain', () => {
    const colours = fills('column', true);
    expect(colours.slice(0, 3)).toEqual(['#F2A03D', '#5BAD5B', '#E83CF5']);
    expect(colours[3]).not.toBe('#F2A03D');
  });

  it('bar: the same colours', () => {
    expect(fills('bar', true).slice(0, 3)).toEqual(['#F2A03D', '#5BAD5B', '#E83CF5']);
  });

  it('without the flag every column keeps the one colour', () => {
    expect(new Set(fills('column', false)).size).toBe(1);
  });
});
