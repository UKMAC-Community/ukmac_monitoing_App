import { TestBed } from '@angular/core/testing';

import type { Cells, Column } from '../core/models';
import { WorkbookFormulas } from '../formula/sheet-formulas';
import progress from '../sheet/fixtures/nursery-columns.json';
import { makeSheet } from '../test-helpers';
import { SheetDashboard } from './sheet-dashboard';

const columns = progress as Column[];
const key = (name: string) => columns.find((column) => column.name === name)!.key;

function row(batch: string, start: string, total: number): Cells {
  return { [key('Batch number')]: batch, [key('Supply date start')]: start, [key('Total number')]: String(total), [key('Healthy number')]: String(total), [key('Stem rot')]: '1' };
}

describe('a chart tile\'s Batch | Month switch', () => {
  beforeAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };
  });

  function mount() {
    const sheet = makeSheet(3, 'Nursery Progress', columns, [row('B1', '2026-07-05', 100), row('B2', '2026-07-20', 50), row('B3', '2026-08-02', 200)], 'nursery-batches');
    const fixture = TestBed.createComponent(SheetDashboard);
    fixture.componentRef.setInput('sheet', sheet);
    fixture.componentRef.setInput('formulas', new WorkbookFormulas([sheet], '2026-11-10'));
    fixture.componentRef.setInput('part', 'top');
    fixture.detectChanges();
    const tile = (title: string) => [...(fixture.nativeElement as HTMLElement).querySelectorAll('article.tile')].find((element) => element.querySelector('h3')?.textContent?.trim() === title) as HTMLElement | undefined;
    return { fixture, tile };
  }

  it('opens on batch, and switches the chart and its title to month on a click', () => {
    const { fixture, tile } = mount();
    const batchTile = tile('Seedlings by batch')!;
    expect(batchTile).toBeTruthy();
    const buttons = () => [...batchTile.querySelectorAll('.segmented button')] as HTMLButtonElement[];
    expect(buttons().map((button) => [button.textContent?.trim(), button.getAttribute('aria-pressed')])).toEqual([['Batch', 'true'], ['Month', 'false']]);
    expect(batchTile.textContent).toContain('B3');
    buttons()[1].click();
    fixture.detectChanges();
    const monthTile = tile('Seedlings by month')!;
    expect(monthTile).toBeTruthy();
    expect(tile('Seedlings by batch')).toBeUndefined();
    expect(monthTile.textContent).toContain('Jul 2026');
    expect(monthTile.textContent).not.toContain('B3');
    expect([...monthTile.querySelectorAll('.segmented button')].map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    // The other chart has its own switch, still on batch.
    expect(tile('Unhealthy seedlings by batch')).toBeTruthy();
  });
});
