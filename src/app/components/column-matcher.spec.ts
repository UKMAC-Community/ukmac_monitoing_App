import { TestBed } from '@angular/core/testing';

import type { Column } from '../core/models';
import type { FileColumn } from '../excel/excel-template';
import { ColumnMatcher, nameParts } from './column-matcher';

const col = (key: string, name: string, extra: Partial<Column> = {}): Column => ({ key, name, type: 'text', ...extra });

const targets = [col('c1', 'Variety name', { required: true }), col('c2', 'Origin'), col('c3', 'Description')];
const fileColumns: FileColumn[] = [
  { position: 1, header: 'Name of kind *', sample: 'Thai Bird Eye', values: [{ row: 2, text: 'Thai Bird Eye' }, { row: 3, text: 'Kampot Long' }], stage: 0, parts: ['Name of kind *'] },
  { position: 2, header: 'Where from', sample: 'Thailand', values: [{ row: 2, text: 'Thailand' }], stage: 0, parts: ['Where from'] },
  { position: 4, header: 'Notes', sample: '', values: [], stage: 0, parts: ['Notes'] }, // positions skip empty header cells
];

/** A press and release without moving: a click, as the matcher sees it. */
function press(element: Element) {
  element.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 5, clientY: 5, bubbles: true }));
  window.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 5, clientY: 5 }));
}

describe('ColumnMatcher', () => {
  function setup(mapping: Record<string, number> = {}) {
    const fixture = TestBed.createComponent(ColumnMatcher);
    fixture.componentRef.setInput('fileColumns', fileColumns);
    fixture.componentRef.setInput('targets', targets);
    fixture.componentRef.setInput('mapping', mapping);
    fixture.componentRef.setInput('tableTitle', 'Chili Varieties');
    const changes: Record<string, number>[] = [];
    fixture.componentInstance.mappingChange.subscribe((map) => changes.push(map));
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    return { fixture, el, changes };
  }

  it('lists the file\'s columns and the table\'s, and says how many are matched', () => {
    const { el } = setup({ c2: 2 });
    expect([...el.querySelectorAll('[data-pos] .name')].map((item) => item.textContent)).toEqual(['Name of kind *', 'Where from', 'Notes']);
    expect([...el.querySelectorAll('[data-key] .name')].map((item) => item.textContent)).toEqual(['Variety name', 'Origin', 'Description']);
    expect(el.querySelector('.count')?.textContent).toContain('1 of 3 matched');
    expect(el.querySelector('[data-key="c1"] .req')).toBeTruthy();
  });

  it('matches a file column to a table column by clicking one, then the other', () => {
    const { fixture, el, changes } = setup();
    press(el.querySelector('[data-pos="1"]')!);
    fixture.detectChanges();
    expect(el.querySelector('[data-pos="1"]')!.classList).toContain('picked');
    press(el.querySelector('[data-key="c1"]')!);
    fixture.detectChanges();
    expect(changes.at(-1)).toEqual({ c1: 1 });
    expect(el.querySelector('.count')?.textContent).toContain('1 of 3');
  });

  it('lets a file column fill only one table column: the second match takes it off the first', () => {
    const { fixture, el, changes } = setup({ c1: 1 });
    press(el.querySelector('[data-key="c3"]')!); // a table column first, then the file column
    press(el.querySelector('[data-pos="1"]')!);
    fixture.detectChanges();
    expect(changes.at(-1)).toEqual({ c3: 1 });
  });

  it('takes a match off by clicking its line, and clears them all', () => {
    const { fixture, el, changes } = setup({ c1: 1, c2: 2 });
    // The lines are drawn where the rows sit; a jsdom page has no layout, so give the rows places to be.
    fixture.componentInstance.coords.set({ w: 100, file: { 1: 10, 2: 40, 4: 70 }, table: { c1: 10, c2: 40, c3: 70 } });
    fixture.detectChanges();
    expect(el.querySelectorAll('path.line').length).toBe(2);
    (el.querySelector('path.hit') as SVGPathElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(changes.at(-1)).toEqual({ c2: 2 });
    [...el.querySelectorAll('button')].find((button) => button.textContent?.includes('Clear'))!.click();
    fixture.detectChanges();
    expect(changes.at(-1)).toEqual({});
    expect(el.querySelector('.count')?.textContent).toContain('0 of 3');
  });

  describe('showing what a column holds', () => {
    const values = (el: HTMLElement, selector: string) => [...el.querySelectorAll(`${selector} .val`)].map((item) => [...item.children].map((part) => part.textContent).join(' '));

    it('opens a file column under its name on a click, with its first values and their rows, and shuts it on the next', () => {
      const { fixture, el } = setup();
      expect(el.querySelector('.peek')).toBeNull();
      press(el.querySelector('[data-pos="1"]')!);
      fixture.detectChanges();
      expect(values(el, '[data-pos="1"]')).toEqual(['Row 2 Thai Bird Eye', 'Row 3 Kampot Long']);
      press(el.querySelector('[data-pos="1"]')!);
      fixture.detectChanges();
      expect(el.querySelector('.peek')).toBeNull();
    });

    it('says so when nothing is under the heading, and keeps one open per side', () => {
      const { fixture, el } = setup();
      press(el.querySelector('[data-pos="4"]')!);
      fixture.detectChanges();
      expect(el.querySelector('[data-pos="4"] .none')?.textContent).toContain('Nothing under this heading');
      press(el.querySelector('[data-pos="2"]')!);
      fixture.detectChanges();
      expect(el.querySelectorAll('[data-pos] .peek')).toHaveLength(1);
      expect(values(el, '[data-pos="2"]')).toEqual(['Row 2 Thailand']);
    });

    it('opens a table column on the values of the file column that fills it, or says nothing fills it yet', () => {
      const { fixture, el } = setup({ c2: 2 });
      press(el.querySelector('[data-key="c2"]')!);
      fixture.detectChanges();
      expect(el.querySelector('[data-key="c2"] .from')?.textContent).toContain('Where from');
      expect(values(el, '[data-key="c2"]')).toEqual(['Row 2 Thailand']);
      press(el.querySelector('[data-key="c3"]')!);
      fixture.detectChanges();
      expect(el.querySelector('[data-key="c2"] .peek')).toBeNull();
      expect(el.querySelector('[data-key="c3"] .none')?.textContent).toContain('Nothing fills it yet');
    });

    it('shows the column a match lands on, with what now fills it, and still makes the match', () => {
      const { fixture, el, changes } = setup();
      press(el.querySelector('[data-pos="1"]')!);
      press(el.querySelector('[data-key="c1"]')!);
      fixture.detectChanges();
      expect(changes.at(-1)).toEqual({ c1: 1 });
      expect(values(el, '[data-key="c1"]')).toEqual(['Row 2 Thai Bird Eye', 'Row 3 Kampot Long']);
      // Matching onto a column that is already open leaves it open.
      press(el.querySelector('[data-pos="2"]')!);
      press(el.querySelector('[data-key="c1"]')!);
      fixture.detectChanges();
      expect(values(el, '[data-key="c1"]')).toEqual(['Row 2 Thailand']);
    });

    it('does not open a column that was only dragged', () => {
      const { fixture, el } = setup();
      document.elementFromPoint = () => null; // jsdom has no layout to ask
      const from = el.querySelector('[data-pos="1"]')!;
      from.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 5, clientY: 5, bubbles: true }));
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 60, clientY: 40 }));
      window.dispatchEvent(new MouseEvent('pointerup', { clientX: 60, clientY: 40 }));
      fixture.detectChanges();
      expect(el.querySelector('.peek')).toBeNull();
    });
  });
});

describe('a long name in a narrow list', () => {
  it('keeps its end, from a word\'s start, so names that differ only there can be told apart', () => {
    const a = 'Transplant Stage_Observe in 20 plants/ Seedling Leaf Stage (No.) › 3, >5';
    const [start, end] = nameParts(a);
    expect(start + end).toBe(a);
    expect(end).toBe(' Stage (No.) › 3, >5');
    expect(nameParts('Transplant Stage_Observe in 20 plants/ Seedling Leaf Stage (No.) › 4–5')[1]).toBe(' Stage (No.) › 4–5');
  });

  it('leaves a short name whole, and cuts a long one with no spaces near its end by characters', () => {
    expect(nameParts('Total number')).toEqual(['Total number', '']);
    const long = 'x'.repeat(60);
    const [start, end] = nameParts(long);
    expect(start + end).toBe(long);
    expect(end.length).toBe(14);
  });
});

describe('the width of the lists', () => {
  const KEY = 'ukmac.matcher-width';
  beforeEach(() => localStorage.removeItem(KEY));
  afterEach(() => localStorage.removeItem(KEY));

  function setup() {
    const fixture = TestBed.createComponent(ColumnMatcher);
    fixture.componentRef.setInput('fileColumns', fileColumns);
    fixture.componentRef.setInput('targets', targets);
    fixture.componentRef.setInput('mapping', {});
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const slide = (value: number) => {
      const input = el.querySelector<HTMLInputElement>('input[type="range"]')!;
      input.value = String(value);
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    /** The widths (px) of the three columns of the diagram: the file's list, the lines, the table's list. */
    const columns = () => [...el.querySelector<HTMLElement>('.diagram')!.style.gridTemplateColumns.matchAll(/(\d+)px/g)].map((found) => Number(found[1]));
    return { fixture, el, slide, columns };
  }

  it('starts wider than before, and a slider makes the two lists as wide as the person likes', () => {
    const { slide, columns } = setup();
    expect(columns()).toEqual([340, 110, 340]);
    slide(600);
    expect(columns()).toEqual([600, 110, 600]);
  });

  it('keeps the width for the next import, and keeps it between the least and the most', () => {
    const first = setup();
    first.slide(520);
    expect(localStorage.getItem(KEY)).toBe('520');
    expect(setup().columns()).toEqual([520, 110, 520]);
    first.slide(5000);
    expect(localStorage.getItem(KEY)).toBe('720');
    first.slide(10);
    expect(localStorage.getItem(KEY)).toBe('240');
  });

  it('goes back to the default for a saved width that is not a number or is too small to use', () => {
    localStorage.setItem(KEY, 'wide');
    expect(setup().columns()).toEqual([340, 110, 340]);
    localStorage.setItem(KEY, '12');
    expect(setup().columns()).toEqual([340, 110, 340]);
  });
});

describe('the stages in the matcher', () => {
  const staged: Column[] = [
    col('c1', 'Date', { type: 'date', required: true }),
    col('c2', '0 DAT Transplant', { type: 'date', box: '1 · Transplant (0 DAT)' }),
    col('c3', '4–5, good', { type: 'number', box: '1 · Transplant (0 DAT)', group: 'Seedling Leaf Stage (No.)' }),
    col('c4', '30 DAT Vegetative', { type: 'date', box: '3 · Vegetative (30 DAT)' }),
    col('c5', 'P#1', { type: 'number', box: '3 · Vegetative (30 DAT)', group: 'Plant Vigor Score (1–5)' }),
    col('c6', 'P#2', { type: 'number', box: '3 · Vegetative (30 DAT)', group: 'Plant Vigor Score (1–5)' }),
  ];
  const inFile: FileColumn[] = [
    { position: 1, header: 'Planting Date', sample: '', values: [], stage: 0, parts: ['Planting Date'] },
    { position: 3, header: '0 DAT Transplant', sample: '', values: [], stage: 1, parts: ['Stage 1_', '0 DAT Transplant', '0 DAT Transplant'] },
    { position: 4, header: 'Seedling Leaf Stage (No.) › 4-5, good', sample: '', values: [], stage: 1, parts: ['Banner', 'Seedling Leaf Stage (No.)', '4-5, good'] },
    { position: 17, header: '30 DAT Vegetative', sample: '', values: [], stage: 3, parts: ['Stage 3_', '30 DAT Vegetative', '30 DAT Vegetative'] },
    { position: 18, header: 'Plant Vigor Score (1-5 Score) › P#1', sample: '', values: [], stage: 3, parts: ['Banner', 'Plant Vigor Score (1-5 Score)', 'P#1'] },
    { position: 19, header: 'Plant Vigor Score (1-5 Score) › P#2', sample: '', values: [], stage: 3, parts: ['Banner', 'Plant Vigor Score (1-5 Score)', 'P#2'] },
  ];

  function setup(mapping: Record<string, number> = {}, file: FileColumn[] = inFile, targetList: Column[] = staged) {
    const fixture = TestBed.createComponent(ColumnMatcher);
    fixture.componentRef.setInput('fileColumns', file);
    fixture.componentRef.setInput('targets', targetList);
    fixture.componentRef.setInput('mapping', mapping);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const chip = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('.stage-chip')].find((item) => item.textContent?.trim().startsWith(label))!;
    const shown = (selector: string) => [...el.querySelectorAll(`${selector} .name`)].map((item) => item.textContent);
    return { fixture, el, chip, shown };
  }

  it('shows a chip for All, the row\'s own columns and each stage, with how many of the table\'s columns are matched', () => {
    const { el } = setup({ c2: 3, c4: 17 });
    const chips = [...el.querySelectorAll('.stage-chip')].map((item) => item.textContent?.replace(/\s+/g, ' ').trim());
    expect(chips).toEqual(['All', 'Row 0/1', 'Stage 1 1/2', 'Stage 3 1/3']);
  });

  it('shows only that stage\'s columns in both lists when a chip is pressed, and all again on All', () => {
    const { fixture, el, chip, shown } = setup();
    expect(shown('[data-pos]')).toHaveLength(6);
    chip('Stage 3').click();
    fixture.detectChanges();
    expect(shown('[data-pos]')).toEqual(['30 DAT Vegetative', 'Plant Vigor Score (1-5 Score) › P#1', 'Plant Vigor Score (1-5 Score) › P#2']);
    expect(shown('[data-key]')).toEqual(['30 DAT Vegetative', 'P#1', 'P#2']);
    expect(chip('Stage 3').classList).toContain('on');
    chip('Row').click();
    fixture.detectChanges();
    expect(shown('[data-pos]')).toEqual(['Planting Date']);
    expect(shown('[data-key]')).toEqual(['Date']);
    chip('All').click();
    fixture.detectChanges();
    expect(shown('[data-pos]')).toHaveLength(6);
    expect(el.querySelectorAll('[data-key]')).toHaveLength(6);
  });

  it('matches within a stage as it does anywhere, and the chip counts follow', () => {
    const { fixture, el, chip, changes } = (() => {
      const made = setup();
      const found: Record<string, number>[] = [];
      made.fixture.componentInstance.mappingChange.subscribe((map) => found.push(map));
      return { ...made, changes: found };
    })();
    chip('Stage 3').click();
    fixture.detectChanges();
    press(el.querySelector('[data-pos="18"]')!);
    press(el.querySelector('[data-key="c5"]')!);
    fixture.detectChanges();
    expect(changes.at(-1)).toEqual({ c5: 18 });
    expect(chip('Stage 3').textContent?.replace(/\s+/g, ' ').trim()).toBe('Stage 3 1/3');
  });

  it('heads each group in the lists, when shown by stage, so the same P#1 under two groups can be told apart', () => {
    const { fixture, el, chip } = setup();
    chip('Stage 3').click();
    fixture.detectChanges();
    const labels = (side: number) => [...el.querySelectorAll('.panel')[side].querySelectorAll('.group-label')].map((item) => item.textContent?.trim());
    expect(labels(0)).toEqual(['Plant Vigor Score (1-5 Score)']);
    expect(labels(1)).toEqual(['Plant Vigor Score (1–5)']);
    // A heading is not a column: it can't be picked or matched, and a table without stages has none.
    expect(el.querySelectorAll('.group-label[data-key], .group-label[data-pos]')).toHaveLength(0);
    expect(setup({}, inFile.map((file) => ({ ...file, stage: 0 }))).el.querySelector('.group-label')).toBeNull();
  });

  it('lets go of a column picked in a stage that is no longer shown', () => {
    const { fixture, el, chip } = setup();
    press(el.querySelector('[data-pos="18"]')!);
    fixture.detectChanges();
    expect(el.querySelector('.picked')).toBeTruthy();
    chip('Stage 1').click();
    fixture.detectChanges();
    expect(el.querySelector('.picked')).toBeNull();
    // Nor does the next click, on the table's column of stage 1, make a match with the hidden one.
    press(el.querySelector('[data-key="c3"]')!);
    fixture.detectChanges();
    expect(el.querySelector('.count')?.textContent).toContain('0 of 6 matched');
  });

  it('shows no chips for a file with no stages, or a table with no boxes: as before', () => {
    expect(setup({}, inFile.map((file) => ({ ...file, stage: 0 }))).el.querySelector('.stages')).toBeNull();
    expect(setup({}, inFile, staged.map(({ box: _box, ...rest }) => rest)).el.querySelector('.stages')).toBeNull();
  });
});
