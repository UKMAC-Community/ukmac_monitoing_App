import { afterNextRender, DestroyRef, Directive, ElementRef, inject } from '@angular/core';

/** The segment of a segmented control that is picked: the one pressed, checked or active. */
export function pickedSegment(control: HTMLElement): HTMLElement | null {
  return control.querySelector<HTMLElement>('.segment[aria-pressed="true"], .segment[aria-checked="true"], .segment.active');
}

/**
 * A segmented control's raised thumb that slides to the segment picked (Pie | Column, Day | Month) instead of
 * changing colour in place, as an iOS control does. The thumb is the control's own `::before` (styles.css, `.has-thumb`);
 * this puts it where the picked segment is (`--thumb-x/y/w/h`, measured from the control, so it needs no animation
 * frame of its own) and keeps it there when the pick, the writing or the size changes. A control with no picked
 * segment (or not on screen) keeps the system's look, the picked segment drawn raised in place.
 */
@Directive({ selector: '.segmented' })
export class SegmentedThumb {
  private readonly control = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      this.place();
      // The pick is the segments' attributes; the writing and the size can change after it (a font arriving, a label changing).
      const changes = new MutationObserver(() => this.place());
      changes.observe(this.control, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-checked', 'class'] });
      const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.place());
      resize?.observe(this.control);
      destroyRef.onDestroy(() => {
        changes.disconnect();
        resize?.disconnect();
      });
    });
  }

  /** Puts the thumb under the picked segment, where the control's layout has it (not as a transform may be moving it). */
  place() {
    const picked = pickedSegment(this.control);
    const { classList, style } = this.control;
    if (!picked || picked.offsetParent !== this.control) {
      if (classList.contains('has-thumb')) classList.remove('has-thumb');
      return;
    }
    style.setProperty('--thumb-x', `${picked.offsetLeft}px`);
    style.setProperty('--thumb-y', `${picked.offsetTop}px`);
    style.setProperty('--thumb-w', `${picked.offsetWidth}px`);
    style.setProperty('--thumb-h', `${picked.offsetHeight}px`);
    // The observer watches the control's `class` too (a segment's), so the class is only written when it changes: no loop.
    if (!classList.contains('has-thumb')) classList.add('has-thumb');
  }
}
