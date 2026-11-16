import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { pickedSegment, SegmentedThumb } from './segmented-thumb';

@Component({
  imports: [SegmentedThumb],
  template: `
    <div class="segmented is-sm" role="group">
      @for (name of names; track name; let i = $index) {
        <button type="button" class="segment" [attr.aria-pressed]="picked() === i">{{ name }}</button>
      }
    </div>
  `,
})
class Host {
  readonly names = ['Pie', 'Column', 'Line'];
  readonly picked = signal<number | null>(0);
}

describe('SegmentedThumb: the thumb that slides to the picked segment', () => {
  // jsdom has no layout: each segment is given the place a real one would have (Pie at 2, 34 wide; Column after it, 59 wide…).
  const places = [{ x: 2, w: 34 }, { x: 38, w: 59 }, { x: 99, w: 44 }];
  const own = (name: string) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
  const originals = ['offsetParent', 'offsetLeft', 'offsetTop', 'offsetWidth', 'offsetHeight'].map((name) => [name, own(name)] as const);
  const place = (element: HTMLElement) => places[[...(element.parentElement?.children ?? [])].indexOf(element)] ?? { x: 0, w: 0 };

  beforeAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };
    const define = (name: string, get: (element: HTMLElement) => unknown) =>
      Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get() { return get(this as HTMLElement); } });
    define('offsetParent', (element) => element.parentElement);
    define('offsetLeft', (element) => place(element).x);
    define('offsetTop', () => 2);
    define('offsetWidth', (element) => place(element).w);
    define('offsetHeight', () => 24);
  });
  afterAll(() => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    }
  });

  function open() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, control: el.querySelector<HTMLElement>('.segmented')! };
  }

  /** The observers report in a microtask after the attribute changes. */
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve));

  it('finds the picked segment however it is marked', () => {
    const control = document.createElement('div');
    control.innerHTML = '<button class="segment">A</button><button class="segment active">B</button>';
    expect(pickedSegment(control)?.textContent).toBe('B');
    control.innerHTML = '<button class="segment" aria-checked="true">A</button>';
    expect(pickedSegment(control)?.textContent).toBe('A');
    control.innerHTML = '<button class="segment">A</button>';
    expect(pickedSegment(control)).toBeNull();
  });

  it('puts the thumb under the picked segment, and moves it when another is picked', async () => {
    const { fixture, control } = open();
    const thumb = () => ['x', 'y', 'w', 'h'].map((name) => control.style.getPropertyValue(`--thumb-${name}`));
    // Measured once it is drawn (under the first segment, which is picked).
    await settle();
    expect(control.classList.contains('has-thumb')).toBe(true);
    expect(thumb()).toEqual(['2px', '2px', '34px', '24px']);
    fixture.componentInstance.picked.set(1);
    fixture.detectChanges();
    await settle();
    expect(thumb()).toEqual(['38px', '2px', '59px', '24px']);
    fixture.componentInstance.picked.set(2);
    fixture.detectChanges();
    await settle();
    expect(thumb()).toEqual(['99px', '2px', '44px', '24px']);
  });

  it('keeps the system look (the raised segment) when none is picked', async () => {
    const { fixture, control } = open();
    fixture.componentInstance.picked.set(1);
    fixture.detectChanges();
    await settle();
    expect(control.classList.contains('has-thumb')).toBe(true);
    fixture.componentInstance.picked.set(null);
    fixture.detectChanges();
    await settle();
    expect(control.classList.contains('has-thumb')).toBe(false);
  });
});
