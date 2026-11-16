import { TestBed } from '@angular/core/testing';

import type { Cells, Column } from '@core/models';
import qaQc from '@shared/sheet/fixtures/qa-qc-columns.json';
import { makeSheet } from '@shared/testing/test-helpers';
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
  beforeEach(() => localStorage.clear());

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

  const button = (el: HTMLElement, label: RegExp) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => label.test(b.textContent ?? ''))!;
  const stageHeads = (el: HTMLElement) => [...el.querySelectorAll('thead tr:first-child .fold-label')].map((label) => label.textContent?.trim());
  const open = (el: HTMLElement) => [...el.querySelectorAll('thead tr:first-child th.group')].filter((th) => th.querySelector('.fold[aria-expanded="true"]')).map((th) => th.querySelector('.fold-label')?.textContent?.trim());

  it('is one table with a group of columns for each stage, the first stage open and the rest folded to their first column', () => {
    const { el } = mount();
    expect(el.querySelectorAll('table').length).toBe(1);
    expect(stageHeads(el)).toEqual([
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
    expect(open(el)).toEqual(['Stage 1 (0 DAT)']);
    // A row for each plot, the plot's own columns first, then GREEN / YELLOW / RED as pills.
    expect(el.querySelectorAll('tbody tr').length).toBe(2);
    expect([...el.querySelectorAll('thead tr:nth-child(3) th')].slice(0, 2).map((th) => th.textContent?.trim())).toEqual(['Zone', 'Planting Date']);
    const pills = [...el.querySelectorAll('tbody tr:first-child .pill')].map((pill) => [pill.textContent?.trim(), pill.className]);
    expect(pills[0]).toEqual(['GREEN', 'pill green']);
    // The formulas under the names.
    expect([...el.querySelectorAll('thead tr.formulas th')].some((th) => th.textContent?.includes('IFS('))).toBe(true);
  });

  it('folds and opens a stage from its heading, and Fold all / Open all do every stage', () => {
    const { fixture, el } = mount();
    const width = () => el.querySelectorAll('thead tr:nth-child(3) th').length;
    const folded = width();
    (el.querySelectorAll('thead tr:first-child .fold')[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(open(el)).toEqual(['Stage 1 (0 DAT)', 'Stage 2 (7 DAT)']);
    expect(width()).toBeGreaterThan(folded);
    button(el, /Open all/).click();
    fixture.detectChanges();
    expect(open(el).length).toBe(10);
    expect(button(el, /Open all/).disabled).toBe(true);
    button(el, /Fold all/).click();
    fixture.detectChanges();
    expect(open(el)).toEqual([]);
    expect(button(el, /Fold all/).disabled).toBe(true);
    // Folded: the plot's own columns and one column for each stage.
    expect(width()).toBe(2 + 10);
  });

  it('shows one stage at a time from its chip (opened), and the formulas can be hidden', () => {
    const { fixture, el } = mount();
    const chip = [...el.querySelectorAll<HTMLButtonElement>('.jump .chip')].find((b) => b.textContent?.includes('Stage 2 (7 DAT)'))!;
    chip.click();
    fixture.detectChanges();
    expect(stageHeads(el)).toEqual(['Stage 2 (7 DAT)']);
    expect(open(el)).toEqual(['Stage 2 (7 DAT)']);
    button(el, /formulas/i).click();
    fixture.detectChanges();
    expect(el.querySelectorAll('thead tr').length).toBe(3);
    (el.querySelector('.jump .chip') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(stageHeads(el).length).toBe(10);
  });

  it('counts, on each stage chip, the plots with a reading', () => {
    const { el } = mount();
    const chips = [...el.querySelectorAll('.jump .chip')].map((chip) => chip.textContent?.replace(/\s+/g, ' ').trim());
    expect(chips.slice(0, 4)).toEqual(['All', 'Stage 1 (0 DAT) 2', 'Stage 2 (7 DAT) 2', 'Stage 3 (30 DAT) 0']);
  });

  it('lists the plots needing action first once a stage is picked (yellow before green), else the plot order', () => {
    const rows = [record('A1', '2026-05-10', '19', ['18', '1', '1']), record('A2', '2026-05-13', '18', ['18', '1', '1'])];
    const sheet = makeSheet(11, 'QA/QC Management', columns, rows, 'qa-qc-management');
    const fixture = TestBed.createComponent(QaQcAnalysis);
    fixture.componentRef.setInput('sheet', sheet);
    fixture.componentRef.setInput('sheets', [sheet]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const plots = () => [...el.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td')?.textContent?.trim());
    expect(plots()).toEqual(['A1', 'A2']);
    [...el.querySelectorAll<HTMLButtonElement>('.jump .chip')].find((b) => b.textContent?.includes('Stage 2 (7 DAT)'))!.click();
    fixture.detectChanges();
    expect(plots()).toEqual(['A2', 'A1']); // A2 is yellow in Stage 2: first
  });

  it('remembers which stages were left open for the table', () => {
    const first = mount();
    (first.el.querySelectorAll('thead tr:first-child .fold')[1] as HTMLButtonElement).click();
    first.fixture.detectChanges();
    expect(JSON.parse(localStorage.getItem('ukmac.qaqc-open.11')!)).toEqual(['Stage 1 (0 DAT)', 'Stage 2 (7 DAT)']);
    first.fixture.destroy();
    const again = mount();
    expect(open(again.el)).toEqual(['Stage 1 (0 DAT)', 'Stage 2 (7 DAT)']);
  });

  it('says so when there are no QC records yet', () => {
    const sheet = makeSheet(11, 'QA/QC Management', columns, [], 'qa-qc-management');
    const fixture = TestBed.createComponent(QaQcAnalysis);
    fixture.componentRef.setInput('sheet', sheet);
    fixture.componentRef.setInput('sheets', [sheet]);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No QC records yet');
  });

  it('shows the first plots of a long list, and "Show all" lists the rest (and "Show fewer" goes back)', () => {
    const rows = Array.from({ length: 25 }, (_, i) => record(`A${i + 1}`, '2026-05-10', '18', ['18', '1', '1']));
    const sheet = makeSheet(11, 'QA/QC Management', columns, rows, 'qa-qc-management');
    const fixture = TestBed.createComponent(QaQcAnalysis);
    fixture.componentRef.setInput('sheet', sheet);
    fixture.componentRef.setInput('sheets', [sheet]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const count = () => el.querySelectorAll('tbody tr').length;
    expect(count()).toBe(10);
    expect(el.querySelector('.more-note')?.textContent).toContain('Showing 10 of 25 plots');
    (el.querySelector('.more button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(count()).toBe(25);
    expect(el.querySelector('.more button')?.textContent?.trim()).toBe('Show fewer');
    (el.querySelector('.more button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(count()).toBe(10);
  });
});
