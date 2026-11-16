import { TestBed } from '@angular/core/testing';

import { Pager } from './pager';

function render(total: number, always: boolean) {
  const fixture = TestBed.createComponent(Pager);
  fixture.componentRef.setInput('total', total);
  fixture.componentRef.setInput('always', always);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('Pager', () => {
  it('stays hidden for a short list unless it is told to always show', () => {
    expect(render(7, false).querySelector('.pager')).toBeNull();
    expect(render(7, true).querySelector('.pager')).not.toBeNull();
  });

  it('shows page 1 (with the buttons off) when everything fits on one page', () => {
    const el = render(7, true);
    expect(el.querySelector('.range')?.textContent?.trim()).toBe('1–7 of 7');
    const pages = [...el.querySelectorAll('button.pg')];
    expect(pages.map((b) => b.textContent?.trim())).toEqual(['1']);
    expect(pages[0].getAttribute('aria-current')).toBe('page');
    expect((el.querySelector('[aria-label="Previous page"]') as HTMLButtonElement).disabled).toBe(true);
    expect((el.querySelector('[aria-label="Next page"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows page 1 for an empty list too', () => {
    const el = render(0, true);
    expect(el.querySelector('.range')?.textContent?.trim()).toBe('0–0 of 0');
    expect([...el.querySelectorAll('button.pg')].map((b) => b.textContent?.trim())).toEqual(['1']);
  });
});
