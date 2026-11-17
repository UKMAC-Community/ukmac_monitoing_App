import { TestBed } from '@angular/core/testing';

import type { Column } from '@core/models';
import { WorkbookFormulas } from '@shared/formula/sheet-formulas';
import { makeSheet } from '@shared/testing/test-helpers';
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

  /** A table opened as a person left it (all open) unless it is `fresh`: seen for the first time. */
  function show(fresh = false) {
    if (!fresh && localStorage.getItem('ukmac.folded.41') === null) localStorage.setItem('ukmac.folded.41', '[]');
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

  it('offers a fold on each stage only, not on the groups inside it', () => {
    const { el, heads } = show();
    expect(heads().length).toBe(8);
    expect(el.querySelectorAll('tr.boxes:first-of-type button.fold').length).toBe(3);
    expect(el.querySelectorAll('tr.boxes:nth-of-type(2) button.fold').length).toBe(0);
    expect(el.querySelectorAll('tr.boxes:nth-of-type(2) th.group').length).toBe(5);
  });

  it('begins a table of stages with the first stage open and the rest folded, a hairline before each stage', () => {
    const { el, heads } = show(true);
    expect(heads().length).toBe(6); // c1, c2, c3, c4 (Stage 1 open), c5, c7
    expect(el.querySelectorAll('tr.boxes:first-of-type th.box.is-folded').length).toBe(2);
    // The hairline begins each stage (not the first column, which belongs to none).
    const edges = [...el.querySelectorAll('thead tr:last-child th.edge')].map((th) => th.textContent?.trim());
    expect(edges).toEqual(['Leaf', 'Leaf', 'Leaf']);
    expect(el.querySelectorAll('tbody tr:first-child td.edge').length).toBe(3);
  });

  it('keeps what a person opened, so it is not folded again', () => {
    const { heads, button, fixture } = show(true);
    button('Open all').click();
    fixture.detectChanges();
    expect(heads().length).toBe(8);
    expect(JSON.parse(localStorage.getItem('ukmac.folded.41')!)).toEqual([]);
  });

  it('writes a numbered stage as "Stage 1 · …"', () => {
    const numbered = makeSheet(42, 'QA/QC', [col('a', 'Date'), col('b', 'Leaf', { box: '1 · Transplant (0 DAT)' }), col('c', 'Vigor', { box: '1 · Transplant (0 DAT)' })], []);
    const fixture = TestBed.createComponent(SheetTable);
    fixture.componentRef.setInput('sheet', numbered);
    fixture.componentRef.setInput('rows', numbered.rows);
    fixture.componentRef.setInput('formulas', new WorkbookFormulas([numbered], '2026-11-10'));
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('th.box button')?.textContent?.trim()).toBe('Stage 1 · Transplant (0 DAT)');
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

  it('folds a group by itself only in a table with no stages', () => {
    const plain = makeSheet(43, 'Nursery', [col('a', 'Total', { group: 'Seedlings' }), col('b', 'Healthy', { group: 'Seedlings' }), col('c', 'Note')], []);
    const fixture = TestBed.createComponent(SheetTable);
    fixture.componentRef.setInput('sheet', plain);
    fixture.componentRef.setInput('rows', plain.rows);
    fixture.componentRef.setInput('formulas', new WorkbookFormulas([plain], '2026-11-10'));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('th.group button.fold').length).toBe(1);
  });

  it('keeps the ID and the Batch group beside whichever group is picked (a table with no stages)', () => {
    const nursery = makeSheet(44, 'Nursery Progress', [col('id', 'ID'), col('b', 'Batch number', { group: 'Batch' }), col('v', 'Variety name', { group: 'Batch' }), col('t', 'Total number', { group: 'Seedlings' }), col('s', 'Supply date', { group: 'Supply' })], [{ id: '1', b: 'B1', v: 'VN', t: '5', s: '2026-07-01' }]);
    const fixture = TestBed.createComponent(SheetTable);
    fixture.componentRef.setInput('sheet', nursery);
    fixture.componentRef.setInput('rows', nursery.rows);
    fixture.componentRef.setInput('formulas', new WorkbookFormulas([nursery], '2026-11-16'));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const heads = () => [...el.querySelectorAll('thead tr:last-child th')].map((th) => th.textContent?.trim());
    const chip = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('.jump .chip')].find((item) => item.textContent?.trim().startsWith(label))!;
    chip('Supply').click();
    fixture.detectChanges();
    expect(heads()).toEqual(['ID', 'Batch number', 'Variety name', 'Supply date']);
    chip('Seedlings').click();
    fixture.detectChanges();
    expect(heads()).toEqual(['ID', 'Batch number', 'Variety name', 'Total number']);
  });

  it('brings a column asked for into view: every column shown, its fold opened, and its header and cells lit for a while', () => {
    vi.useFakeTimers();
    try {
      const { fixture, el, button } = show();
      button('Fold all').click();
      fixture.detectChanges();
      const folded = el.querySelectorAll('thead tr:last-child th').length;
      fixture.componentRef.setInput('focusColumn', 'c3'); // the second column of Stage 1's first group, hidden by the fold
      fixture.detectChanges();
      expect(el.querySelectorAll('thead tr:last-child th').length).toBeGreaterThan(folded);
      expect(el.querySelector('th[data-col="c3"]')?.classList).toContain('is-lit');
      expect(el.querySelectorAll('tbody td.is-lit').length).toBe(2);
      vi.advanceTimersByTime(5100);
      fixture.detectChanges();
      expect(el.querySelector('th.is-lit')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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
