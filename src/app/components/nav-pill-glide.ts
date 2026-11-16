import { afterNextRender, Directive, ElementRef, inject } from '@angular/core';

/** Where the pill was when a menu link was clicked, and when: the new page's pill glides from there. */
let last: { rect: DOMRect; at: number } | null = null;
let listening = false;

/** How long after a click the next pill counts as that click's page (a route that is slow to open shows no glide). */
const WITHIN = 1500;

function listen() {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  // In the capture phase, before the link's own handler navigates: the old page's pill is still there to measure.
  document.addEventListener(
    'click',
    (event) => {
      if (!(event.target as Element | null)?.closest?.('.sidebar a.nav-link')) return;
      const pill = document.querySelector('.sidebar .nav-pill');
      last = pill ? { rect: pill.getBoundingClientRect(), at: performance.now() } : null;
    },
    true,
  );
}

/**
 * The highlight behind the open page's row glides from the row it was on to the new one (the web's NavPill, one
 * `layoutId` for the sidebar): each row has its own pill, which appears when its page opens, so the new one is moved
 * back onto the old one's place (position and size) and let go. Nothing glides on the first page, from a click
 * somewhere else, or for someone who asked for less motion.
 */
@Directive({ selector: '.nav-pill' })
export class NavPillGlide {
  constructor() {
    const pill = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    listen();
    afterNextRender(() => {
      const from = last;
      last = null;
      if (!from || performance.now() - from.at > WITHIN || typeof pill.animate !== 'function') return;
      if (typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: no-preference)').matches) return;
      const to = pill.getBoundingClientRect();
      if (!to.width || !to.height) return;
      const dx = from.rect.left - to.left;
      const dy = from.rect.top - to.top;
      const sx = from.rect.width / to.width;
      const sy = from.rect.height / to.height;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return;
      const spring = getComputedStyle(document.documentElement).getPropertyValue('--ease-spring').trim() || 'ease-out';
      pill.animate(
        [
          { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
          { transformOrigin: '0 0', transform: 'none' },
        ],
        { duration: 380, easing: spring },
      );
    });
  }
}
