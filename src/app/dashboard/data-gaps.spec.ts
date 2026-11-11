import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import type { Column } from '../core/models';
import { makeSheet } from '../test-helpers';
import { columnRecords, gapSentence, tableGaps } from './data-gaps';
import { DataGaps } from './data-gaps-panel';

const columns: Column[] = [
  { key: 'c1', name: 'Zone', type: 'text', required: true },
  { key: 'c2', name: 'Plants', type: 'number' },
  { key: 'c3', name: 'Note', type: 'text' },
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
    expect([by('Zone'), by('Plants'), by('Note'), by('Checked')].map((column) => [column.state, column.filled, column.missing])).toEqual([
      ['complete', 3, 0],
      ['partly', 2, 1],
      ['missing', 0, 3],
      ['partly', 1, 2], // "No" is an answer, but only one record has one
    ]);
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
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(DataGaps);
    fixture.componentRef.setInput('sheets', [done, records, empty]);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('has a tab for each table with what it needs, and opens on the first that needs input', () => {
    const { el } = mount();
    const tabs = [...el.querySelectorAll('.tab')].map((tab) => tab.textContent?.replace(/\s+/g, ' ').trim());
    expect(tabs).toEqual(['Zones Complete', 'Plant Progress3 to fill', 'PruningNo records']);
    expect(el.querySelector('.tab[aria-selected="true"]')?.textContent).toContain('Plant Progress');
    expect(el.querySelector('.lead')?.textContent).toContain('1 column with nothing entered');
    // Only what needs input is listed; the complete ones are asked for.
    expect([...el.querySelectorAll('.line .name')].map((name) => name.textContent)).toEqual(['Note', 'Checked', 'Plants']);
    expect(el.querySelector('.line .count')?.textContent?.trim()).toBe('none of 3 filled');
    expect(el.querySelector('a.open')?.getAttribute('href')).toBe('/mac/1/table/1');
  });

  it('shows the complete columns on request, and another table on its tab', () => {
    const { fixture, el } = mount();
    (el.querySelector('.chip') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.line').length).toBe(4);
    ([...el.querySelectorAll('.tab')][2] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.lead')?.textContent).toContain('no records yet');
    expect(el.querySelectorAll('.line').length).toBe(0);
  });

  it('opens the records under a column: those not input first, then those input with what was entered', () => {
    const { fixture, el } = mount();
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
});
