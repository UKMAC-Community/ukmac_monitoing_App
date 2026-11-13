import { DestroyRef, Directive, ElementRef, effect, inject, input } from '@angular/core';

/** How long a number takes to count up, as the web's CountUp. */
const DURATION = 900;

/** A shown number taken apart: what is before and after it ("$", "%"), its value, its decimals, and whether it has thousands commas. */
export interface ShownNumber {
  before: string;
  value: number;
  decimals: number;
  grouped: boolean;
  after: string;
}

/** The number in a shown value ("102,800", "95.3", "4.15%"); none for anything else (a date, "12 / 30", "—"). */
export function readShownNumber(text: string): ShownNumber | null {
  const match = /^([^\d-]*)(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)([^\d]*)$/.exec(text.trim());
  if (!match) return null;
  const [, before, number, after] = match;
  const value = Number(number.replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  return { before, value, decimals: number.split('.')[1]?.length ?? 0, grouped: number.includes(','), after };
}

/** The number written as the value was: its decimals, its commas, its "$" and "%". */
export function writeShownNumber(shape: ShownNumber, value: number) {
  const text = value.toLocaleString('en-US', { minimumFractionDigits: shape.decimals, maximumFractionDigits: shape.decimals, useGrouping: shape.grouped });
  return shape.before + text + shape.after;
}

/**
 * A KPI's number counting up to its value, slowing as it lands (the web's CountUp: 900 ms, eased out), from 0 when it
 * first shows and from the number before when it changes (a filter, an edit). Written as the value is written: its
 * decimals, commas, "%". Anything that isn't one number (a date, "—") is shown as it is; so is everything for someone
 * who asked for less motion.
 */
@Directive({ selector: '[appCountUp]' })
export class CountUp {
  readonly appCountUp = input.required<string>();

  private readonly el = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  private frame = 0;
  /** The number on show now (mid-count, or landed), where the next count starts. */
  private shown: number | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.frame));
    effect(() => this.count(this.appCountUp()));
  }

  private count(text: string) {
    cancelAnimationFrame(this.frame);
    const shape = readShownNumber(text);
    const moving = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches === true;
    if (!shape || !moving || typeof requestAnimationFrame === 'undefined') {
      this.el.textContent = text;
      this.shown = shape?.value ?? null;
      return;
    }
    const from = this.shown ?? 0;
    const to = shape.value;
    if (from === to) {
      this.el.textContent = text;
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / DURATION);
      const eased = 1 - (1 - progress) ** 3;
      this.shown = from + (to - from) * eased;
      // The last frame is the value exactly as it came (no rounding of its own).
      this.el.textContent = progress < 1 ? writeShownNumber(shape, this.shown) : text;
      if (progress < 1) this.frame = requestAnimationFrame(step);
      else this.shown = to;
    };
    this.el.textContent = writeShownNumber(shape, from);
    this.frame = requestAnimationFrame(step);
  }
}
