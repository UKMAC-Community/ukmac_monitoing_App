import { TestBed } from '@angular/core/testing';

import type { Cells, Column } from '../core/models';
import qaQc from '../sheet/fixtures/qa-qc-columns.json';
import { makeSheet } from '../test-helpers';
import { QaQcAnalysis } from './qa-qc-analysis';

const columns = qaQc as Column[];
const key = (stage: number, group: string | undefined, name: string) =>
  columns.find((column) => (stage ? (column.box ?? '').startsWith(`${stage} ·`) : !column.box) && (column.group ?? '') === (group ?? '') && column.name === name)!.key;

function record(zone: string, date: string, live: string, leaf: [string, string, string]): Cells {
  const L = 'Seedling Leaf Stage (No.)';
  return {
    [key(0, undefined, 'Date')]: date,
    [key(0, undefined, 'Zone')]: zone,
    [key(1, L, '4–5, good')]: leaf[0],
    [key(1, L, '3, >5')]: leaf[1],
    [key(1, L, 'Disease')]: leaf[2],
    [key(2, 'Plant Survival (No.)', 'Live plant')]: live,
  };
}

describe('QaQcAnalysis', () => {
  beforeAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };
  });

  function mount() {
    const sheet = makeSheet(11, 'QA/QC Management', columns, [record('A1', '2026-05-10', '18', ['18', '1', '1']), record('A2', '2026-05-13', '19', ['12', '6', '2'])], 'qa-qc-management');
    const fixture = TestBed.createComponent(QaQcAnalysis);
    fixture.componentRef.setInput('sheet', sheet);
    fixture.componentRef.setInput('sheets', [sheet]);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('shows each stage as a table of its own, one under the other, a row for each plot, GREEN / YELLOW / RED as pills', () => {
    const { el } = mount();
    const stages = [...el.querySelectorAll('.stage')];
    expect(stages.map((stage) => stage.querySelector('.stage-name')?.textContent?.trim())).toEqual([
      'Stage 1 (0 DAT)',
      'Stage 2 (7 DAT)',
      'Stage 3 (30 DAT)',
      'Stage 4 (45 DAT)',
      'Stage 5 (60 DAT)',
      'Stage 6 (75 DAT)',
      'Stage 7 (75 DAT+)',
      'Stage 8 (75–150 DAT)',
      'Stage 9 (75–150 DAT)',
      'Stage 10 (End of cycle)',
    ]);
    const first = stages[0];
    expect(first.querySelectorAll('tbody tr').length).toBe(2);
    // Each table: the checks over their columns, and the formulas under the names.
    expect(first.querySelectorAll('thead tr').length).toBe(3);
    // The plot's own columns start every stage's table (the batch too, when Plant Progress gives one: not in this test).
    expect([...first.querySelectorAll('thead tr:nth-child(2) th')].slice(0, 2).map((th) => th.textContent?.trim())).toEqual(['Zone', 'Planting Date']);
    // The first pill is the leaf check's: 18 of the 20 plants have 4–5 true leaves, the biggest bucket, GREEN.
    const pills = [...first.querySelectorAll('tbody tr:first-child .pill')].map((pill) => [pill.textContent?.trim(), pill.className]);
    expect(pills[0]).toEqual(['GREEN', 'pill green']);
    const formulaRow = [...first.querySelectorAll('thead tr.formulas th')].map((th) => th.textContent?.trim());
    expect(formulaRow.some((text) => text?.includes('IFS('))).toBe(true);
  });

  it('shows one stage at a time from its chip, and the formulas can be hidden', () => {
    const { fixture, el } = mount();
    const chip = [...el.querySelectorAll<HTMLButtonElement>('.jump .chip')].find((button) => button.textContent?.trim() === 'Stage 2 (7 DAT)')!;
    chip.click();
    fixture.detectChanges();
    expect([...el.querySelectorAll('.stage-name')].map((title) => title.textContent?.trim())).toEqual(['Stage 2 (7 DAT)']);
    const toggle = [...el.querySelectorAll<HTMLButtonElement>('.head button')].find((button) => /formulas/i.test(button.textContent ?? ''))!;
    toggle.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('thead tr').length).toBe(2);
  });

  it('says so when there are no QC records yet', () => {
    const sheet = makeSheet(11, 'QA/QC Management', columns, [], 'qa-qc-management');
    const fixture = TestBed.createComponent(QaQcAnalysis);
    fixture.componentRef.setInput('sheet', sheet);
    fixture.componentRef.setInput('sheets', [sheet]);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No QC records yet');
  });

  describe('a long list of plots', () => {
    function mountMany(count: number) {
      const rows = Array.from({ length: count }, (_, i) => record(`A${i + 1}`, '2026-05-10', '18', ['18', '1', '1']));
      const sheet = makeSheet(11, 'QA/QC Management', columns, rows, 'qa-qc-management');
      const fixture = TestBed.createComponent(QaQcAnalysis);
      fixture.componentRef.setInput('sheet', sheet);
      fixture.componentRef.setInput('sheets', [sheet]);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      const first = () => el.querySelector('.stage')!;
      return { fixture, el, first, rows: () => first().querySelectorAll('tbody tr').length };
    }

    it('shows the first few plots of each stage, and "Show all" opens the rest (and "Show fewer" folds them back)', () => {
      const { fixture, first, rows } = mountMany(12);
      expect(rows()).toBe(5);
      expect(first().querySelector('.more-note')?.textContent).toContain('Showing 5 of 12 plots');
      (first().querySelector('.more button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(rows()).toBe(12);
      expect(first().querySelector('.more button')?.textContent?.trim()).toBe('Show fewer');
      (first().querySelector('.more button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(rows()).toBe(5);
    });

    it('a stage folds away from its title, and Collapse all / Expand all do every stage', () => {
      const { fixture, el, first, rows } = mountMany(3);
      expect(first().querySelector('.more')).toBeNull(); // few plots: nothing to extend
      (first().querySelector('.stage-toggle') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(first().querySelector('table')).toBeNull();
      const all = () => [...el.querySelectorAll('.head button')].find((b) => /all/i.test(b.textContent ?? '')) as HTMLButtonElement;
      expect(all().textContent).toContain('Collapse all');
      all().click();
      fixture.detectChanges();
      expect(el.querySelectorAll('.stage table').length).toBe(0);
      expect(all().textContent).toContain('Expand all');
      all().click();
      fixture.detectChanges();
      expect(rows()).toBe(3);
    });
  });
});
