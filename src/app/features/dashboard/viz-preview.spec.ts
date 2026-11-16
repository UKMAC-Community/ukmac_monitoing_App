import { TestBed } from '@angular/core/testing';

import { STUDIO_TYPES, wellNames } from './studio-model';
import { VizPreview, VISUAL_PREVIEWS } from './viz-preview';

describe('VizPreview', () => {
  const anchor = new DOMRect(1000, 200, 220, 36);

  function show(type: (typeof STUDIO_TYPES)[number]['type']) {
    const fixture = TestBed.createComponent(VizPreview);
    fixture.componentRef.setInput('type', type);
    fixture.componentRef.setInput('anchor', anchor);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows each type\'s drawing, name, purpose and the fields it takes', () => {
    for (const item of STUDIO_TYPES) {
      const el = show(item.type);
      expect(el.querySelector('svg.art')?.children.length, item.type).toBeGreaterThan(0);
      expect(el.querySelector('.title')?.textContent).toBe(item.label);
      expect(el.querySelector('.text')?.textContent).toBe(VISUAL_PREVIEWS[item.type]);
      const wells = wellNames(item.type);
      expect([...el.querySelectorAll('.fields li')].map((li) => li.textContent)).toEqual([wells.axis, wells.values].filter(Boolean));
    }
  });

  it('plays the drawing again on its own, as a new drawing each time', async () => {
    vi.useFakeTimers();
    try {
      const fixture = TestBed.createComponent(VizPreview);
      fixture.componentRef.setInput('type', 'column');
      fixture.componentRef.setInput('anchor', anchor);
      fixture.detectChanges();
      const first = fixture.nativeElement.querySelector('svg.art');
      await vi.advanceTimersByTimeAsync(4600);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('svg.art')).not.toBe(first);
      fixture.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sits beside the grid of types, toward the page, and stays on the screen', () => {
    const fixture = TestBed.createComponent(VizPreview);
    fixture.componentRef.setInput('type', 'pie');
    fixture.componentRef.setInput('anchor', anchor);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const left = parseFloat(host.style.left);
    expect(left).toBeLessThan(anchor.left);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(parseFloat(host.style.top)).toBeGreaterThanOrEqual(8);
  });
});
