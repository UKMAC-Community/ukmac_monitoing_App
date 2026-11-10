import type { Column, RetiredColumn } from '../core/models';
import columns from './fixtures/zone-measurement-columns.json';
import { columnsToRemove, missingTemplateColumns, upgradesItself, withTemplateColumns } from './template-columns';

/** Zone Measurement as the template now makes it (a Rust test fails if this copy drifts). */
const template = columns as Column[];
/** What the template dropped when it followed the farm's design (a Rust test keeps this list as the template's own). */
const retired: RetiredColumn[] = ['Planned plot', 'Actual plot', 'Number each plot', 'Actual planting plot', 'Width', 'Length', 'Area'].map((name) => ({ name }));

/** A Zone Measurement table made before that: the nine columns it started with. */
const OLD_AREA = '=IF(OR([Width]="",[Length]=""),"",[Width]*[Length])';
function olderTable(): Column[] {
  return [
    { key: 'c1', name: 'Zone plot', type: 'link', source: "'Zones'[Plot]" },
    { key: 'c2', name: 'Planned plot', type: 'text' },
    { key: 'c3', name: 'Actual plot', type: 'text' },
    { key: 'c4', name: 'Number each plot', type: 'number' },
    { key: 'c5', name: 'Actual planting plot', type: 'text' },
    { key: 'c6', name: 'Width', type: 'number', unit: 'm' },
    { key: 'c7', name: 'Length', type: 'number', unit: 'm' },
    { key: 'c8', name: 'Area', type: 'formula', unit: 'm²', formula: OLD_AREA },
    { key: 'c9', name: 'Note', type: 'text' },
  ];
}

const names = (list: readonly Column[]) => list.map((column) => column.name);
const NEW_NAMES = ['Zone plot', 'Zone', 'Zone number', 'Area in plan', 'Actual width', 'Actual length', 'Actual area', 'Measure error', 'Error %', 'Note'];

describe('an older Zone Measurement table, brought up to the farm\'s design', () => {
  it('knows the template has the design\'s columns', () => {
    expect(names(template)).toEqual(NEW_NAMES);
  });

  it('upgrades itself when it has no rows and nothing of the person\'s own', () => {
    expect(upgradesItself(olderTable(), 0, template, retired)).toBe(true);
    // A column of the person's own, or a row, and it asks first instead.
    expect(upgradesItself([...olderTable(), { key: 'c10', name: 'Surveyor', type: 'text' }], 0, template, retired)).toBe(false);
    expect(upgradesItself(olderTable(), 3, template, retired)).toBe(false);
  });

  it('becomes the template when every old column is empty, keeping the plot and the note where they were', () => {
    const old = olderTable();
    const gone = columnsToRemove(old, retired, () => false);
    expect(names(gone)).toEqual(['Planned plot', 'Actual plot', 'Number each plot', 'Actual planting plot', 'Width', 'Length', 'Area']);
    const upgraded = withTemplateColumns(old, template, gone);
    expect(names(upgraded)).toEqual(NEW_NAMES);
    // What stays keeps its key (so its cells stay); what is new has none, and the table gives it one.
    expect(upgraded.find((column) => column.name === 'Zone plot')!.key).toBe('c1');
    expect(upgraded.find((column) => column.name === 'Note')!.key).toBe('c9');
    expect(upgraded.filter((column) => column.key === '')).toHaveLength(8);
  });

  it('has nothing left to do afterwards', () => {
    const old = olderTable();
    const upgraded = withTemplateColumns(old, template, columnsToRemove(old, retired, () => false)).map((column, index) => ({ ...column, key: `c${index + 1}` }));
    expect(missingTemplateColumns(upgraded, template)).toHaveLength(0);
    expect(columnsToRemove(upgraded, retired, () => false)).toHaveLength(0);
    expect(upgradesItself(upgraded, 0, template, retired)).toBe(false);
  });

  it('keeps an old column that holds measurements, and still gives the new ones', () => {
    const old = olderTable();
    const hasValue = (column: Column) => column.name === 'Width';
    const removable = columnsToRemove(old, retired, hasValue);
    expect(names(removable)).not.toContain('Width');
    const upgraded = withTemplateColumns(old, template, removable);
    expect(names(upgraded).filter((name) => name === 'Width')).toHaveLength(1);
    expect(names(upgraded)).toEqual(expect.arrayContaining(NEW_NAMES));
    expect(upgraded.find((column) => column.name === 'Width')!.key).toBe('c6');
  });
});
