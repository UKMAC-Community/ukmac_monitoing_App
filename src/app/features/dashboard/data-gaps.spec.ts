import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import type { Column } from '@core/models';
import { makeSheet } from '@shared/testing/test-helpers';
import { columnRecords, gapSentence, tableGaps } from './data-gaps';
import { DataGaps } from './data-gaps-panel';

const columns: Column[] = [
  { key: 'c1', name: 'Zone', type: 'text', required: true },
  { key: 'c2', name: 'Plants', type: 'number' },
  { key: 'c3', name: 'Variety', type: 'text' },
  { key: 'c4', name: 'Doubled', type: 'formula', formula: '=[Plants]*2' },
  { key: 'c5', name: 'ID', type: 'number', auto: true },
  { key: 'c6', name: 'Checked', type: 'yesno' },
];

const records = makeSheet(1, 'Plant Progress', columns, [
  { c1: 'A1', c2: '10', c6: 'false' },
  { c1: 'A2', c2: '' },
  { c1: 'A3', c2: '5', c3: '   ' },
]);
const empty = makeSheet(2, 'Pruning', columns, []);
const done = makeSheet(3, 'Zones', [{ key: 'z1', name: 'Zone', type: 'text' }], [{ z1: 'A' }, { z1: 'B' }]);

describe('tableGaps: what a table still lacks', () => {
  it('counts each typed-in column on how many records it has a value, a blank or spaces being none', () => {
    const gaps = tableGaps(records);
    expect(gaps.rows).toBe(3);
    const by = (name: string) => gaps.columns.find((column) => column.name === name)!;
    expect([by('Zone'), by('Plants'), by('Variety'), by('Checked')].map((column) => [column.state, column.filled, column.missing])).toEqual([
      ['complete', 3, 0],
      ['partly', 2, 1],
      ['missing', 0, 3],
      ['partly', 1, 2], // "No" is an answer, but only one record has one
    ]);
  });

  it('leaves out a note and a file link: not the data, and fine left blank', () => {
    const harvest = makeSheet(9, 'Harvest', [
      { key: 'h1', name: 'Yield', type: 'number' },
      { key: 'h2', name: 'Note', type: 'text' },
      { key: 'h3', name: 'Main file link:', type: 'text' },
      { key: 'h4', name: 'Remarks', type: 'text' },
    ], [{ h1: '5' }]);
    expect(tableGaps(harvest).columns.map((column) => column.name)).toEqual(['Yield']);
  });

  it('leaves out the worked-out and the numbered columns, nobody types them', () => {
    expect(tableGaps(records).columns.map((column) => column.name)).not.toContain('Doubled');
    expect(tableGaps(records).columns.map((column) => column.name)).not.toContain('ID');
  });

  it('puts what needs input first (nothing entered, then the emptiest), the complete last', () => {
    const gaps = tableGaps(records);
    expect(gaps.columns.map((column) => column.state)).toEqual(['missing', 'partly', 'partly', 'complete']);
    expect(gaps.columns[1].name).toBe('Checked'); // 33% before Plants' 67%
    expect([gaps.none, gaps.partly, gaps.complete]).toEqual([1, 2, 1]);
  });

  it('says it in plain words', () => {
    expect(gapSentence(tableGaps(records))).toBe('Plant Progress has 3 records, and 1 column with nothing entered and 2 columns only partly filled.');
    expect(gapSentence(tableGaps(empty))).toBe('Pruning has no records yet, so every column is still empty.');
    expect(gapSentence(tableGaps(done))).toBe('All good: every column of Zones has a value on all 2 records.');
  });
});

describe('columnRecords: which records have it and which not', () => {
  it('splits the records on the column, naming each by what else is entered on it (the required column first)', () => {
    const { missing, filled } = columnRecords(records, 'c2');
    expect(missing.map((record) => [record.number, record.label])).toEqual([[2, 'A2']]);
    expect(filled.map((record) => [record.number, record.label, record.value])).toEqual([[1, 'A1', '10'], [3, 'A3', '5']]);
  });

  it('shows a yes / no answer as the sheet does, and a blank or spaces as not input', () => {
    const { missing, filled } = columnRecords(records, 'c6');
    expect(filled.map((record) => [record.number, record.value])).toEqual([[1, 'No']]);
    expect(missing.map((record) => record.number)).toEqual([2, 3]);
    expect(columnRecords(records, 'c3').missing.length).toBe(3);
  });
});

describe('the Missing data panel', () => {
  function mount() {
    localStorage.removeItem('ukmac.data-check.shape');
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(DataGaps);
    fixture.componentRef.setInput('sheets', [{ ...done, heading: 'Setup' }, { ...records, heading: 'Planting' }, { ...empty, heading: 'Planting' }]);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  /** The board of tables is first; a click on a table's card opens its columns. */
  function open(fixture: ReturnType<typeof mount>['fixture'], el: HTMLElement, title: string) {
    const card = ([...el.querySelectorAll('button.line')] as HTMLButtonElement[]).find((line) => line.textContent?.includes(title))!;
    card.click();
    fixture.detectChanges();
  }

  it('starts on the tables grouped as the menu has them (Farm Layout, then Farm Progress), not the columns', () => {
    const { el } = mount();
    expect([...el.querySelectorAll('.section-label')].map((label) => label.textContent?.trim())).toEqual(['Farm Layout', 'Farm Progress']);
    expect([...el.querySelectorAll('.sec-name')].map((head) => head.textContent?.trim())).toEqual(['Planting']);
    expect([...el.querySelectorAll('.group .line .name')].map((name) => name.textContent)).toEqual(['Zones', 'Plant Progress', 'Pruning']);
    expect(el.querySelector('.lane')).toBeNull();
    expect(el.querySelector('.tab')).toBeNull();
    expect(el.querySelector('.lead')).toBeNull();
    expect(el.textContent).toContain('No records');
    expect(el.textContent).toContain('3 columns to fill');
  });

  it('opens a table\'s columns on its card, with a tab for each table and a way back to the board', () => {
    const { fixture, el } = mount();
    open(fixture, el, 'Plant Progress');
    const tabs = [...el.querySelectorAll('.tab')].map((tab) => tab.textContent?.replace(/\s+/g, ' ').trim());
    expect(tabs).toEqual(['Zones Complete', 'Plant Progress3 to fill', 'PruningNo records']);
    expect(el.querySelector('.tab[aria-selected="true"]')?.textContent).toContain('Plant Progress');
    expect(el.querySelector('.lead')?.textContent).toContain('1 column with nothing entered');
    // A board: a lane for each state, the columns as cards in the lane they belong to.
    const lane = (state: string) => [...el.querySelectorAll(`.lane.is-${state} .line .name`)].map((name) => name.textContent);
    expect(lane('missing')).toEqual(['Variety']);
    expect(lane('partly')).toEqual(['Checked', 'Plants']);
    expect(lane('complete').length).toBe(1);
    expect([...el.querySelectorAll('.lane-count')].map((count) => count.textContent?.trim())).toEqual(['1', '2', '1']);
    // Each column shows how many of the records are filled as a ring and a fraction, and how many are missing.
    expect(el.querySelector('.line .count .fraction')?.textContent?.trim()).toBe('0/3');
    expect(el.querySelector('.line .count .gone')?.textContent?.trim()).toBe('3 missing');
    expect(el.querySelector('.line app-gap-ring .pct')?.textContent?.trim()).toBe('0%');
    // The table as a whole: every cell (records × columns), how many are filled.
    expect(el.querySelector('.overview .fraction')?.textContent?.replace(/\s/g, '')).toMatch(/^\d+\/\d+$/);
    expect(el.querySelector('a.open')?.getAttribute('href')).toBe('/mac/1/table/1');
    (el.querySelector('button.back') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.tab')).toBeNull();
    expect(el.querySelectorAll('.group').length).toBe(2);
  });

  it('links each column card to the column in the table (the table opens scrolled to it and lit)', () => {
    const { fixture, el } = mount();
    open(fixture, el, 'Plant Progress');
    const links = [...el.querySelectorAll<HTMLAnchorElement>('a.goto')];
    expect(links.length).toBe(4);
    expect(links[0].getAttribute('href')).toMatch(/^\/mac\/1\/table\/1\?column=c\d+$/);
    expect(links[0].getAttribute('aria-label')).toContain('in Plant Progress');
  });

  it('shows another table on its tab, with no board when it has no records', () => {
    const { fixture, el } = mount();
    open(fixture, el, 'Plant Progress');
    expect(el.querySelectorAll('.line').length).toBe(4);
    ([...el.querySelectorAll('.tab')][2] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.lead')?.textContent).toContain('no records yet');
    expect(el.querySelectorAll('.line').length).toBe(0);
    expect(el.querySelector('.board')).toBeNull();
  });

  it('opens the records under a column: those not input first, then those input with what was entered', () => {
    const { fixture, el } = mount();
    open(fixture, el, 'Plant Progress');
    const lines = () => [...el.querySelectorAll('button.line')] as HTMLButtonElement[];
    const plants = lines().find((line) => line.textContent?.includes('Plants'))!;
    plants.click();
    fixture.detectChanges();
    expect([...el.querySelectorAll('.rec')].map((rec) => rec.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['#2A2Not input']);
    ([...el.querySelectorAll('.records .segment')][1] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect([...el.querySelectorAll('.rec')].map((rec) => rec.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['#1A110', '#3A35']);
    plants.click();
    fixture.detectChanges();
    expect(el.querySelector('.records')).toBeNull();
  });

  it('shows the table itself, as the table page does: its records with something missing, each empty cell marked, and keeps the choice', () => {
    const { fixture, el } = mount();
    open(fixture, el, 'Plant Progress');
    const shape = (name: string) => ([...el.querySelectorAll('.segmented .segment')] as HTMLButtonElement[]).find((button) => button.textContent?.includes(name))!;
    shape('As the table').click();
    fixture.detectChanges();
    expect(el.querySelector('.board')).toBeNull();
    // Every record lacks a Variety, so all three are listed.
    expect(el.querySelectorAll('app-sheet-table tbody tr').length).toBe(3);
    expect(el.querySelector('.table-note')?.textContent?.replace(/\s+/g, ' ')).toContain('3 of 3 records have something missing');
    // Plants on one record, Variety on all three, Checked on two; the formula and the ID are never missing.
    expect([...el.querySelectorAll('.gap-count')].map((count) => count.textContent?.trim())).toEqual(['1 missing', '3 missing', '2 missing']);
    expect(el.querySelectorAll('td.is-gap').length).toBe(6);
    expect(localStorage.getItem('ukmac.data-check.shape')).toBe('table');
    // A column's count clicked: its records missing it on top, lit; clicked again, the usual order.
    const first = () => el.querySelector('app-sheet-table tbody tr td')?.textContent?.trim();
    expect(first()).toBe('A1');
    const plants = () => ([...el.querySelectorAll('.gap-count')] as HTMLButtonElement[])[0];
    plants().click();
    fixture.detectChanges();
    expect(first()).toBe('A2');
    expect(plants().classList).toContain('on');
    plants().click();
    fixture.detectChanges();
    expect(first()).toBe('A1');
    shape('By column').click();
    fixture.detectChanges();
    expect(el.querySelector('app-sheet-table')).toBeNull();
    expect(el.querySelector('.board')).not.toBeNull();
  });
});
