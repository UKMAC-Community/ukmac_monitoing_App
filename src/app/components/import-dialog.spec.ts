import { TestBed } from '@angular/core/testing';

import type { Column } from '../core/models';
import { loadExcel } from '../excel/exceljs';
import { makeSheet } from '../test-helpers';
import { ImportDialog } from './import-dialog';

// jsdom has no native <dialog> methods; the Modal only needs them to open and close.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
  };
}

const col = (key: string, name: string, extra: Partial<Column> = {}): Column => ({ key, name, type: 'text', ...extra });

/** A Chili Varieties-like table (Variety name required) and a nursery-batches file that lacks that column. */
async function nurseryFile() {
  const Excel = await loadExcel();
  const book = new Excel.Workbook();
  const data = book.addWorksheet('Nursery Batches');
  data.addRow(['Batch #', 'Total number', 'Supplier', 'Note']);
  data.addRow(['B-01', 500, 'Kampot Seeds', 'first sowing']);
  data.addRow(['B-02', 320, 'Kampot Seeds', '']);
  return (await book.xlsx.writeBuffer()) as ArrayBuffer;
}

describe('ImportDialog with a file that lacks a required column', () => {
  const varieties = makeSheet(7, 'Chili Varieties', [
    col('c1', 'Variety name', { required: true }),
    col('c2', 'Supplier'),
    col('c3', 'Note'),
  ]);

  async function open() {
    const fixture = TestBed.createComponent(ImportDialog);
    fixture.componentRef.setInput('sheet', varieties);
    fixture.componentRef.setInput('file', { fileName: 'nursery-batches.xlsx', bytes: await nurseryFile() });
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.steps')).toBeTruthy();
    });
    return fixture;
  }

  /** The four screens: 1 define the file, 2 match the columns, 3 check the rows, 4 import. */
  function goTo(fixture: Awaited<ReturnType<typeof open>>, step: 1 | 2 | 3 | 4) {
    fixture.componentInstance.step.set(step);
    fixture.detectChanges();
  }

  it('starts on saying where the names and the data are, with the file\'s first rows and what it found', async () => {
    const fixture = await open();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.steps .is-on')?.textContent).toContain('Define the file');
    expect(el.querySelector('app-import-layout')).toBeTruthy();
    expect(el.querySelector('app-column-matcher')).toBeNull();
    expect([...el.querySelectorAll('app-import-layout tr[data-row] .role')].map((item) => item.textContent?.trim())).toEqual(['Column names', 'Data starts', '']);
    expect(el.querySelector('app-import-layout .found')?.textContent).toMatch(/4\s+columns named.*2\s+rows of data/);
    expect(el.textContent).not.toContain("can't be imported yet");
  });

  it('goes on to the matching, where the file\'s columns are laid out against the table\'s', async () => {
    const fixture = await open();
    const el: HTMLElement = fixture.nativeElement;
    const next = () => [...el.querySelectorAll('button.btn-primary')].find((b) => b.textContent?.includes('Next'))! as HTMLButtonElement;
    expect(next().textContent).toContain('match columns');
    next().click();
    fixture.detectChanges();
    expect(el.querySelector('.steps .is-on')?.textContent).toContain('Match columns');
    expect(el.querySelector('app-column-matcher')).toBeTruthy();
    expect(el.querySelector('.lead')?.textContent).toContain('names on row 1 · data from row 2');
    expect(el.querySelector('.preview')).toBeNull();
    (el.querySelector('button.back') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('app-import-layout')).toBeTruthy();
  });

  it('shows the rows, with the missing column empty and a warning, instead of stopping', async () => {
    const fixture = await open();
    goTo(fixture, 3);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.alert-box.warning')?.textContent).toContain('“Variety name”');
    const heads = [...el.querySelectorAll('.preview th')].map((th) => th.textContent?.trim());
    expect(heads).toEqual(['Row', 'Supplier', 'Note', 'Variety name']);
    const rows = [...el.querySelectorAll('.preview tbody tr')];
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Kampot Seeds');
    // The missing column's cell is red on every row, and said once above rather than once per row.
    expect(el.querySelectorAll('.preview td.bad-cell').length).toBe(2);
    expect(el.querySelector('details.problems')).toBeNull();
  });

  it('brings the rows in only once the user ticks "with problems"', async () => {
    const fixture = await open();
    goTo(fixture, 4);
    const el: HTMLElement = fixture.nativeElement;
    const importButton = () => [...el.querySelectorAll('button.btn-primary')].find((b) => b.textContent?.includes('Import '))!;
    expect(importButton().textContent).toContain('Import 0 rows');
    const tick = el.querySelector<HTMLInputElement>('.final input.checkbox')!;
    tick.click();
    fixture.detectChanges();
    expect(importButton().textContent).toContain('Import 2 rows');
  });
});

/** A tab whose names are two rows (groups merged over them), a row of units under, then the data. */
async function groupedFile() {
  const Excel = await loadExcel();
  const book = new Excel.Workbook();
  const tab = book.addWorksheet('Nursery');
  tab.addRow(['Batch #', 'Healthy', null, 'Not Healthy', null]);
  tab.addRow([null, 'Plants', '%', 'Stem rot', 'Leaf rot']);
  tab.addRow(['', '(no.)', '(%)', '(no.)', '(no.)']);
  tab.addRow(['B-1', 90, 95, 3, 2]);
  tab.addRow(['B-2', 180, 90, 6, 4]);
  tab.mergeCells(1, 2, 1, 3);
  tab.mergeCells(1, 4, 1, 5);
  tab.mergeCells(1, 1, 2, 1);
  return (await book.xlsx.writeBuffer()) as ArrayBuffer;
}

describe('ImportDialog defining a file by hand', () => {
  const nursery = makeSheet(8, 'Nursery Batches', [
    col('c1', 'Batch #', { required: true }),
    col('c2', 'Plants', { type: 'number' }),
    col('c3', '%', { type: 'number' }),
  ]);

  async function open(file: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(ImportDialog);
    fixture.componentRef.setInput('sheet', nursery);
    fixture.componentRef.setInput('file', { fileName: 'nursery.xlsx', bytes: await groupedFile(), ...file });
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.steps')).toBeTruthy();
    });
    return fixture;
  }

  const settle = async (fixture: Awaited<ReturnType<typeof open>>) => {
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance.remapping()).toBe(false);
    });
  };

  const type = (el: HTMLElement, label: string, value: number) => {
    const input = el.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    input.value = String(value);
    input.dispatchEvent(new Event('change'));
  };

  it('guesses two rows of names from the merged groups, and reads the units row as data until it is moved down', async () => {
    const fixture = await open();
    const el: HTMLElement = fixture.nativeElement;
    expect(fixture.componentInstance.preview()?.layout).toEqual({ headerFrom: 1, headerTo: 2, dataFrom: 3 });
    expect(el.querySelector('app-import-layout .found')?.textContent).toMatch(/5\s+columns named.*3\s+rows of data/);
    expect([...el.querySelectorAll('app-import-layout tr[data-row] .role')].map((item) => item.textContent?.trim())).toEqual(['Column names', 'Column names', 'Data starts', '', '']);

    type(el, 'First row of data', 4);
    await settle(fixture);
    expect(fixture.componentInstance.preview()?.layout).toEqual({ headerFrom: 1, headerTo: 2, dataFrom: 4 });
    expect(el.querySelector('app-import-layout .found')?.textContent).toMatch(/2\s+rows of data/);
  });

  it('takes a row number that does not fit as the nearest one that does, and never lets the data start inside the names', async () => {
    const fixture = await open();
    const el: HTMLElement = fixture.nativeElement;
    type(el, 'First row of data', 1);
    await settle(fixture);
    expect(fixture.componentInstance.preview()?.layout.dataFrom).toBe(3);
    expect(el.querySelector<HTMLInputElement>('input[aria-label="First row of data"]')!.value).toBe('3');
    type(el, 'First row of column names', 4);
    await settle(fixture);
    // The names moved down a row at a time: the span stays and the data follows right under it.
    expect(fixture.componentInstance.preview()?.layout).toEqual({ headerFrom: 4, headerTo: 5, dataFrom: 6 });
    expect(el.querySelector('app-import-layout .found.is-bad')?.textContent).toContain('no data');
  });

  it('marks a row by clicking its number: the names, then (on the other choice) where the data starts', async () => {
    const fixture = await open();
    const el: HTMLElement = fixture.nativeElement;
    const num = (row: number) => el.querySelector<HTMLButtonElement>(`tr[data-row="${row}"] .num`)!;
    num(2).click();
    await settle(fixture);
    expect(fixture.componentInstance.preview()?.layout).toEqual({ headerFrom: 2, headerTo: 2, dataFrom: 3 });
    num(1).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); // not after the names: a single row again
    await settle(fixture);
    expect(fixture.componentInstance.preview()?.layout.headerFrom).toBe(1);
    num(2).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); // after the names: they take both
    await settle(fixture);
    expect(fixture.componentInstance.preview()?.layout).toEqual({ headerFrom: 1, headerTo: 2, dataFrom: 3 });
    const choices = el.querySelectorAll<HTMLButtonElement>('app-import-layout .segment');
    choices[1].click();
    fixture.detectChanges();
    num(4).click();
    await settle(fixture);
    expect(fixture.componentInstance.preview()?.layout).toEqual({ headerFrom: 1, headerTo: 2, dataFrom: 4 });
  });

  it('goes back to the file\'s own layout with "Find them again"', async () => {
    const fixture = await open();
    const el: HTMLElement = fixture.nativeElement;
    const again = () => [...el.querySelectorAll('app-import-layout button')].find((b) => b.textContent?.includes('Find them again')) as HTMLButtonElement;
    expect(again().disabled).toBe(true);
    type(el, 'First row of data', 5);
    await settle(fixture);
    expect(again().disabled).toBe(false);
    again().click();
    await settle(fixture);
    expect(fixture.componentInstance.preview()?.layout).toEqual({ headerFrom: 1, headerTo: 2, dataFrom: 3 });
  });

  it('keeps the matches by position when the data start moves, and imports only the rows from there', async () => {
    const fixture = await open();
    const el: HTMLElement = fixture.nativeElement;
    type(el, 'First row of data', 4);
    await settle(fixture);
    fixture.componentInstance.step.set(3);
    fixture.detectChanges();
    expect(el.querySelectorAll('.preview tbody tr').length).toBe(2);
  });

  it('opens straight on the matching when asked to (to see how the columns connect), with the rows already found', async () => {
    const fixture = await open({ startStep: 2 });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.steps .is-on')?.textContent).toContain('Match columns');
    expect(el.querySelector('app-column-matcher')).toBeTruthy();
    expect(el.querySelector('app-import-layout')).toBeNull();
    // Back leads to defining the file, as always.
    (el.querySelector('button.back') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('app-import-layout')).toBeTruthy();
  });

  describe('done again for a table that has its matches already', () => {
    const again = (extra: Record<string, unknown> = {}) => ({
      tab: 'Nursery',
      headerRow: 1,
      layout: { headerFrom: 1, headerTo: 1, dataFrom: 2 },
      matches: { c1: 1 },
      connect: { spreadsheetId: 'abc', spreadsheetTitle: 'Farm', tabTitle: 'Nursery' },
      ...extra,
    });

    it('opens on defining the file with the layout the table has, and starts from the matches it has, not the names', async () => {
      const fixture = await open(again());
      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.steps .is-on')?.textContent).toContain('Define the file');
      expect(fixture.componentInstance.preview()?.layout).toEqual({ headerFrom: 1, headerTo: 1, dataFrom: 2 });
      // Only "Batch #" (column 1) was matched: "Plants" and "%" are not matched by name here, as it was kept.
      expect(fixture.componentInstance.preview()?.matched.map((item) => [item.key, item.position])).toEqual([['c1', 1]]);
      // The names are one row, as the table was read: the person moves them on the next screen.
      type(el, 'Last row of column names', 2);
      await settle(fixture);
      expect(fixture.componentInstance.preview()?.layout).toEqual({ headerFrom: 1, headerTo: 2, dataFrom: 3 });
      // The matches by position stay when the names move.
      expect(fixture.componentInstance.preview()?.matched.map((item) => [item.key, item.position])).toEqual([['c1', 1]]);
    });

    it('goes back to matching by name with "Match by name"', async () => {
      const fixture = await open(again({ layout: { headerFrom: 1, headerTo: 2, dataFrom: 4 } }));
      const el: HTMLElement = fixture.nativeElement;
      fixture.componentInstance.step.set(2);
      fixture.detectChanges();
      const auto = [...el.querySelectorAll('app-column-matcher button')].find((b) => b.textContent?.includes('Match by name')) as HTMLButtonElement;
      auto.click();
      await settle(fixture);
      expect(fixture.componentInstance.preview()?.matched.map((item) => item.key).sort()).toEqual(['c1', 'c2', 'c3']);
    });

    it('is the same wizard when there is nothing known: no layout and no matches means the names decide', async () => {
      const fixture = await open(again({ layout: undefined, matches: {} }));
      expect(fixture.componentInstance.preview()?.layout).toEqual({ headerFrom: 1, headerTo: 2, dataFrom: 3 });
      expect(fixture.componentInstance.preview()?.matched.length).toBeGreaterThan(1);
    });
  });

  describe('a table kept connected to a Google tab', () => {
    const google = { tab: 'Nursery', headerRow: 1, connect: { spreadsheetId: 'abc', spreadsheetTitle: 'Farm', tabTitle: 'Nursery' } };

    async function importWith(layout?: { row: number }) {
      const fixture = await open(google);
      const el: HTMLElement = fixture.nativeElement;
      if (layout) {
        type(el, 'First row of data', layout.row);
        await settle(fixture);
      }
      const done: { headerMap: Record<string, string> | null; layout: unknown }[] = [];
      fixture.componentInstance.imported.subscribe((value) => done.push(value));
      const addRows = vi.fn().mockResolvedValue(undefined);
      (fixture.componentInstance as unknown as { store: { addRows: typeof addRows } }).store.addRows = addRows;
      fixture.componentInstance.includeProblems.set(true);
      await fixture.componentInstance.run();
      return done[0];
    }

    it('gives the link the names Sync will read the tab by, and the layout, since the names take two rows', async () => {
      const done = await importWith();
      expect(done.layout).toEqual({ headerFrom: 1, headerTo: 2, dataFrom: 3 });
      expect(Object.keys(done.headerMap!)).toEqual(['batch #', 'healthy › plants', 'healthy › %', 'not healthy › stem rot', 'not healthy › leaf rot']);
    });

    it('keeps no layout for a plain tab (names in its first row), so Sync goes on finding that row itself', async () => {
      const fixture = await open({ ...google, tab: 'Nursery Batches', bytes: await nurseryFile() });
      const done: { headerMap: Record<string, string> | null; layout: unknown }[] = [];
      fixture.componentInstance.imported.subscribe((value) => done.push(value));
      (fixture.componentInstance as unknown as { store: { addRows: () => Promise<void> } }).store.addRows = vi.fn().mockResolvedValue(undefined);
      fixture.componentInstance.includeProblems.set(true);
      await fixture.componentInstance.run();
      expect(done[0].layout).toBeNull();
      expect(Object.keys(done[0].headerMap!)).toEqual(['batch #', 'total number', 'supplier', 'note']);
    });

    it('keeps the layout when the data start was moved by hand', async () => {
      const done = await importWith({ row: 4 });
      expect(done.layout).toEqual({ headerFrom: 1, headerTo: 2, dataFrom: 4 });
    });
  });
});
