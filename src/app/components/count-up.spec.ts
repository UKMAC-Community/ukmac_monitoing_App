import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { CountUp, readShownNumber, writeShownNumber } from './count-up';

@Component({ imports: [CountUp], template: `<span [appCountUp]="value()"></span>` })
class Host {
  readonly value = signal('102,800');
}

describe('CountUp: a KPI number counting up', () => {
  it('reads the number in a shown value, and writes others the same way', () => {
    const area = readShownNumber('102,800')!;
    expect(area).toEqual({ before: '', value: 102800, decimals: 0, grouped: true, after: '' });
    expect(writeShownNumber(area, 51234.6)).toBe('51,235');
    const width = readShownNumber('2,235.5')!;
    expect(writeShownNumber(width, 1000)).toBe('1,000.0');
    expect(writeShownNumber(readShownNumber('4.15%')!, 2)).toBe('2.00%');
    expect(readShownNumber('-12')!.value).toBe(-12);
    // Not one number: shown as it is.
    for (const text of ['2026-11-10', '12 / 30', '—', '', 'Mali']) expect(readShownNumber(text), text).toBeNull();
  });

  describe('in a page', () => {
    let frames: FrameRequestCallback[] = [];
    let now = 0;
    const original = { matchMedia: window.matchMedia, raf: window.requestAnimationFrame, now: performance.now };

    beforeEach(() => {
      frames = [];
      now = 0;
      window.matchMedia = ((query: string) => ({ matches: query.includes('no-preference') })) as typeof window.matchMedia;
      window.requestAnimationFrame = (callback) => frames.push(callback);
      vi.spyOn(performance, 'now').mockImplementation(() => now);
    });
    afterEach(() => {
      window.matchMedia = original.matchMedia;
      window.requestAnimationFrame = original.raf;
      vi.restoreAllMocks();
    });

    const run = (ms: number) => {
      now = ms;
      const due = frames;
      frames = [];
      for (const frame of due) frame(ms);
    };

    it('counts up from 0 to the value, then from there to a new one, landing on it exactly', () => {
      const fixture = TestBed.createComponent(Host);
      fixture.detectChanges();
      const span = (fixture.nativeElement as HTMLElement).querySelector('span')!;
      expect(span.textContent).toBe('0');
      run(450);
      const midway = Number(span.textContent!.replace(/,/g, ''));
      expect(midway).toBeGreaterThan(51400); // eased out: past half way at half the time
      expect(midway).toBeLessThan(102800);
      run(900);
      expect(span.textContent).toBe('102,800');
      // A filter: it counts from the number on show to the new one.
      fixture.componentInstance.value.set('51,400');
      fixture.detectChanges();
      expect(span.textContent).toBe('102,800');
      run(1350);
      expect(Number(span.textContent!.replace(/,/g, ''))).toBeLessThan(102800);
      run(1800);
      expect(span.textContent).toBe('51,400');
    });

    it('shows a value that is not one number as it is, and everything at once for less motion', () => {
      const fixture = TestBed.createComponent(Host);
      fixture.componentInstance.value.set('2026-11-10');
      fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('span')!.textContent).toBe('2026-11-10');
      window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;
      const still = TestBed.createComponent(Host);
      still.detectChanges();
      expect((still.nativeElement as HTMLElement).querySelector('span')!.textContent).toBe('102,800');
    });
  });
});
