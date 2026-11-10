import { TestBed } from '@angular/core/testing';

import type { Column } from '../core/models';
import { WorkbookFormulas } from '../formula/sheet-formulas';
import { makeSheet } from '../test-helpers';
import { SheetTable } from './sheet-table';

const col = (key: string, name: string, extra: Partial<Column> = {}): Column => ({ key, name, type: 'text', ...extra });

// A date up front, then three stages (two groups in the first), as a QA/QC table lays them out.
const columns: Column[] = [
  col('c1', 'Date'),
  col('c2', 'Leaf', { box: 'Stage 1', group: 'Seedling' }),
  col('c3', 'Vigor', { box: 'Stage 1', group: 'Seedling' }),
  col('c4', 'Note', { box: 'Stage 1', group: 'Other' }),
  col('c5', 'Leaf', { box: 'Stage 2', group: 'Seedling' }),
  col('c6', 'Vigor', { box: 'Stage 2', group: 'Seedling' }),
  col('c7', 'Leaf', { box: 'Stage 3', group: 'Seedling' }),
  col('c8', 'Vigor', { box: 'Stage 3', group: 'Seedling' }),
];
const sheet = makeSheet(41, 'QA/QC', columns, [
  { c1: 'a', c2: 'b', c3: 'c', c4: 'd', c5: 'e', c6: 'f', c7: 'g', c8: 'h' },
  { c1: 'i', c2: 'j', c3: 'k', c4: 'l', c5: 'm', c6: 'n', c7: 'o', c8: 'p' },
]);

describe('SheetTable: boxes and groups that fold', () => {
  beforeEach(() => {
    localStorage.clear();
    // jsdom has no layout to scroll.
    HTMLElement.prototype.scrollTo = () => {};
  });

  function show() {
    const fixture = TestBed.createComponent(SheetTable);
    fixture.componentRef.setInput('sheet', sheet);
    fixture.componentRef.setInput('rows', sheet.rows);
    fixture.componentRef.setInput('formulas', new WorkbookFormulas([sheet], '2026-11-07'));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const heads = () => [...el.querySelectorAll('thead tr:last-child th')].map((th) => th.textContent?.trim());
    const click = (selector: string, at = 0) => {
      (el.querySelectorAll<HTMLElement>(selector)[at]).click();
      fixture.detectChanges();
    };
    const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;
    return { fixture, el, heads, click, button };
  }

  it('offers a fold on every named box and group of two or more columns', () => {
    const { el, heads } = show();
    expect(heads().length).toBe(8);
    // Three boxes, and the "Seedling" groups of two columns (the one-column "Other" has nothing to fold).
    expect(el.querySelectorAll('tr.boxes:first-of-type button.fold').length).toBe(3);
    expect(el.querySelectorAll('tr.boxes:nth-of-type(2) button.fold').length).toBe(3);
  });

  it('folds a box to its first column, its name still over it, and opens it again', () => {
    const { el, heads, click } = show();
    click('tr.boxes:first-of-type button.fold', 0); // Stage 1
    expect(heads().length).toBe(6); // c1, c2, c5, c6, c7, c8
    const box = el.querySelector<HTMLTableCellElement>('tr.boxes:first-of-type th.box.is-folded')!;
    expect(box.colSpan).toBe(1);
    expect(box.textContent).toContain('Stage 1');
    expect(box.querySelector('button')!.title).toBe('Open the group');
    expect(el.querySelectorAll('tbody tr:first-child td').length).toBe(6);
    click('tr.boxes:first-of-type button.fold', 0);
    expect(heads().length).toBe(8);
  });

  it('shows no fold for a group inside a folded box, and folds a group by itself', () => {
    const { el, heads, click } = show();
    click('tr.boxes:nth-of-type(2) button.fold', 1); // Stage 2's "Seedling" group
    expect(heads().length).toBe(7);
    click('tr.boxes:first-of-type button.fold', 0); // Stage 1 folded
    expect(el.querySelectorAll('tr.boxes:nth-of-type(2) th.group button.fold').length).toBe(2); // Stage 1's group has none now
  });

  it('folds all, opens all, and keeps what is folded for the table', () => {
    const { fixture, el, heads, button } = show();
    button('Fold all').click();
    fixture.detectChanges();
    expect(heads().length).toBe(4); // the date, then the first column of each of the three stages
    expect(button('Fold all').disabled).toBe(true);
    expect(JSON.parse(localStorage.getItem('ukmac.folded.41')!).length).toBeGreaterThan(0);
    // The table shown again keeps its folds.
    const again = show();
    expect(again.heads().length).toBe(heads().length);
    button('Open all').click();
    fixture.detectChanges();
    expect(heads().length).toBe(8);
    expect(JSON.parse(localStorage.getItem('ukmac.folded.41')!)).toEqual([]);
    expect(el.querySelectorAll('th.is-folded').length).toBe(0);
  });

  it('shows only one stage, opened, when its chip is pressed, and everything again on All', async () => {
    vi.useFakeTimers();
    try {
      const { fixture, heads, button, el } = show();
      button('Fold all').click();
      fixture.detectChanges();
      const chip = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('.jump .chip')].find((item) => item.textContent?.trim().startsWith(label))!;
      const boxes = () => [...el.querySelectorAll('th.box')].map((cell) => cell.textContent?.trim()).filter(Boolean);
      const before = boxes().length;
      expect(before).toBeGreaterThan(1);
      chip('Stage 2').click();
      fixture.detectChanges();
      // Only stage 2's box is in the header now, and it is open (its groups' columns are all there).
      expect(boxes()).toHaveLength(1);
      expect(boxes()[0]).toContain('Stage 2');
      expect(el.querySelectorAll('th.box.is-folded').length).toBe(0);
      expect(chip('Stage 2').classList).toContain('active');
      expect(heads().length).toBeLessThan(8);
      chip('All').click();
      fixture.detectChanges();
      expect(boxes()).toHaveLength(before);
      expect(chip('All').classList).toContain('active');
      await vi.advanceTimersByTimeAsync(100);
    } finally {
      vi.useRealTimers();
    }
  });
});
