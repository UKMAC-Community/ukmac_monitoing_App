import { TestBed } from '@angular/core/testing';

import type { Cells, Column } from '@core/models';
import { makeSheet } from '@shared/testing/test-helpers';
import { ApplicationTable } from './application-table';
import { applicationPivot } from './application-view';

// The Fungicide table as the farm's sheet has it: the disease before the date.
const columns: Column[] = [
  { key: 'c2', name: 'Zone', type: 'link' },
  { key: 'c5', name: 'Application', type: 'text' },
  { key: 'c6', name: 'Disease', type: 'text' },
  { key: 'c1', name: 'Date', type: 'date' },
  { key: 'c7', name: 'Chemical', type: 'text' },
  { key: 'c8', name: 'Dose', type: 'text' },
];
const row = (zone: string, application: string, disease: string, date: string): Cells => ({ c2: zone, c5: application, c6: disease, c1: date, c7: 'Mancozeb', c8: '2 g/L' });
const sheet = makeSheet(18, 'Fungicide', columns, [row('A1', '1st Application', 'Anthracnose', '2026-06-22'), row('A1', '2nd Application', 'Powdery Mildew', '2026-07-03')], 'pesticides');

describe('ApplicationTable', () => {
  function render() {
    const fixture = TestBed.createComponent(ApplicationTable);
    fixture.componentRef.setInput('sheet', sheet);
    fixture.componentRef.setInput('pivot', applicationPivot(sheet, sheet.rows));
    fixture.detectChanges();
    return fixture;
  }
  const heads = (el: HTMLElement) => [...el.querySelectorAll('thead tr:last-child th')].map((th) => th.textContent?.trim());

  it('puts the date first under each application, then the rest in the table order', () => {
    const el = render().nativeElement as HTMLElement;
    expect(heads(el)).toEqual(['Date', 'Disease', 'Chemical', 'Dose', 'Date', 'Disease', 'Chemical', 'Dose']);
    expect([...el.querySelectorAll('tbody tr:first-child td')].map((td) => td.textContent?.trim()).slice(0, 3)).toEqual(['A1', '22/06/2026', 'Anthracnose']);
  });

  it('folds an application to that same first column', () => {
    const fixture = render();
    fixture.componentInstance.toggle('1st Application');
    fixture.detectChanges();
    expect(heads(fixture.nativeElement)).toEqual(['Date', 'Date', 'Disease', 'Chemical', 'Dose']);
  });
});
