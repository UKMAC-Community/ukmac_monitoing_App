import { TestBed } from '@angular/core/testing';

import type { Column } from '../core/models';
import { WorkbookFormulas } from '../formula/sheet-formulas';
import columns from '../sheet/fixtures/zone-records-columns.json';
import { makeSheet } from '../test-helpers';
import type { CrossFilter } from './dashboard-model';
import { SheetDashboard } from './sheet-dashboard';

const records = columns as Column[];
const key = (name: string) => records.find((column) => column.name === name)!.key;
const zones = makeSheet(1, 'Zones', [
  { key: 'c1', name: 'Zone', type: 'text' },
  { key: 'c2', name: 'Plot', type: 'text' },
  { key: 'c5', name: 'Zone number', type: 'number' },
], [{ c1: 'A', c2: 'A1', c5: '1' }, { c1: 'A', c2: 'A2', c5: '1' }, { c1: 'B', c2: 'B1', c5: '2' }, { c1: 'B', c2: 'B9', c5: '4' }]);
const row = (plot: string, day: string, plants: string, dead: string) => ({ [key('Zone plot')]: plot, [key('Day number')]: day, [key('Record date')]: '2026-07-11', [key('Plant count')]: plants, [key('Dead plant')]: dead });
const sheet = makeSheet(4, 'Plant Progress', records, [row('A1', '1', '1000', '20'), row('A2', '2', '500', '1'), row('B1', '1', '300', '2'), row('B9', '2', '200', '0')], 'zone-records');
const book = new WorkbookFormulas([zones, sheet], '2026-11-10');

const zoneOne: CrossFilter = { sheetId: 4, source: 'suggested-kpi-4', column: key('Zone number'), part: 'value', keys: ['1'], labels: ['1'], name: 'Zone number' };

describe('clicking a group filters the other visuals (as Power BI does)', () => {
  beforeAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };
  });

  function mount(filter: CrossFilter | null) {
    const fixture = TestBed.createComponent(SheetDashboard);
    fixture.componentRef.setInput('sheet', sheet);
    fixture.componentRef.setInput('formulas', book);
    fixture.componentRef.setInput('filter', filter);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const emitted: (CrossFilter | null)[] = [];
    fixture.componentInstance.filterChange.subscribe((change) => emitted.push(change));
    const big = () => [...el.querySelectorAll('.kpi-card .big')].map((node) => node.textContent?.trim());
    return { fixture, el, emitted, big };
  }

  it('shows every record with nothing clicked', () => {
    expect(mount(null).big()).toEqual(['4', '2,000', '0', '23']);
  });

  it('keeps only zone 1 in the cards, the other chart and the table, but all the bars in the chart clicked', () => {
    const { el, big } = mount(zoneOne);
    expect(big()[0]).toBe('2'); // records
    expect(big()[1]).toBe('1,500'); // plants
    expect(big()[3]).toBe('21'); // dead
    // The chart clicked still has every bar (zone 1 lit, the rest dimmed) ...
    const bars = [...el.querySelectorAll('svg rect.dim, svg rect.hit')].filter((r) => r.closest('article')?.querySelector('h3')?.textContent?.includes('by zone number'));
    expect(bars.length).toBeGreaterThanOrEqual(3);
    // ... and the table only works out zone 1.
    const rows = [...el.querySelectorAll('table tbody tr')];
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('1,500');
  });

  it('a bar clicked asks for the filter, and the same bar clicked again lets it go', () => {
    const { fixture, el, emitted } = mount(null);
    const tile = [...el.querySelectorAll('article.tile')].find((t) => t.querySelector('h3')?.textContent?.includes('by zone number'))!;
    (tile.querySelector('rect.hit') as unknown as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(emitted.length).toBe(1);
    expect(emitted[0]).toMatchObject({ sheetId: 4, column: key('Zone number'), keys: ['1'], labels: ['1'], name: 'Zone number' });
    fixture.componentRef.setInput('filter', { ...emitted[0]! });
    fixture.detectChanges();
    (tile.querySelector('rect.hit') as unknown as SVGElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(emitted[1]).toBeNull();
  });

  it('a table row clicked asks for the filter too; in Edit dashboard nothing is filtered', () => {
    const { el, emitted } = mount(null);
    (el.querySelector('tbody tr.hit') as HTMLElement).click();
    expect(emitted[0]).toMatchObject({ keys: ['1'] });
    const studio = mount(null);
    studio.fixture.componentRef.setInput('selectable', true);
    studio.fixture.detectChanges();
    expect(studio.el.querySelector('tbody tr.hit')).toBeNull();
    expect(studio.el.querySelector('svg rect.hit')).toBeNull();
  });
});
