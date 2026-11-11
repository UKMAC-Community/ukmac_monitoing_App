import type { Column, RetiredColumn } from '../core/models';
import before from './fixtures/qa-qc-columns-before.json';
import current from './fixtures/qa-qc-columns.json';
import { columnIdentity, columnsToLimit, columnsToRemove, isUntouched, missingTemplateColumns, retiredColumns, upgradesItself, withTemplateColumns } from './template-columns';

/** A QA/QC table made before the template followed the old sheet (72 columns), and the template now (287: the sheet's own columns). */
const old = before as Column[];
const template = current as Column[];
const templateIds = new Set(template.map(columnIdentity));
/** What the template dropped, as the app is told it: the old columns it no longer has. */
const retired: RetiredColumn[] = old.filter((column) => !templateIds.has(columnIdentity(column))).map(({ box, group, name }) => ({ box, group, name }));
/** The columns of the table the template still has, and what it gains. */
const STAYING = old.length - retired.length;
const NEW = template.length - STAYING;

const col = (name: string, extra: Partial<Column> = {}): Column => ({ key: '', name, type: 'number', ...extra });
/** A column of the table by its stage box (by its number), group and name. */
const at = (columns: Column[], stage: string, group: string | undefined, name: string) =>
  columns.findIndex((column) => column.box?.startsWith(`${stage} ·`) && (column.group ?? '') === (group ?? '') && column.name === name);

describe('what the template changed in the QA/QC table', () => {
  it('drops 39 columns of the old form and keeps the other 33: no planned dates or days, no plant averages, no pest totals, no QC record', () => {
    expect(retired).toHaveLength(39);
    expect(STAYING).toBe(33);
    expect(retired.filter((column) => column.box === 'QC record')).toHaveLength(2);
    expect(retired.filter((column) => column.name === 'Date')).toHaveLength(10);
    expect(retired.filter((column) => column.name === 'Days after transplant')).toHaveLength(10);
    expect(retired.filter((column) => column.group === 'Plant average')).toHaveLength(10);
    // What the dashboards read stays; the sums and checks the sheet does not have are gone.
    const names = template.map((column) => column.name);
    for (const gone of ['Harvested', 'Harvest rounds', 'Yield per plant']) expect(names).not.toContain(gone);
    expect(names.filter((name) => name.endsWith(' check'))).toEqual([]);
    for (const needed of ['Live plant', 'Dead plant', 'Marketable', 'Zone']) expect(names).toContain(needed);
  });

  it('gives each stage the sheet\'s observation date first, and the sheet\'s groups, 20 plants to a measure', () => {
    const stage3 = template.filter((column) => column.box?.startsWith('3 ·'));
    expect(stage3[0]).toMatchObject({ name: '30 DAT Vegetative', type: 'date' });
    expect(stage3).toHaveLength(1 + 100);
    expect(stage3.slice(1, 21).map((column) => [column.group, column.name])).toEqual(Array.from({ length: 20 }, (_, index) => ['Plant Vigor Score (1–5)', `P#${index + 1}`]));
    expect(stage3.slice(41, 61).map((column) => column.name)).toEqual(Array.from({ length: 20 }, (_, index) => `${index + 1}A`));
  });
});

describe('bringing a QA/QC table up to date with the template', () => {
  it('finds the columns the template has gained, and none the table has', () => {
    const missing = missingTemplateColumns(old, template);
    expect(missing).toHaveLength(NEW);
    expect(NEW).toBe(254);
    const names = missing.map((column) => column.name);
    expect(names).toContain('Flower abortion');
    expect(names).toContain('1st Date');
    expect(names).toContain('5th Harvest');
    expect(names).toContain('W1 Date');
    expect(names).toContain('W21');
    expect(names).toContain('Notes');
    expect(names).toContain('30 DAT Vegetative');
    expect(names.filter((name) => name.endsWith(' check'))).toHaveLength(0);
    expect(names.filter((name) => /P#\d+$/.test(name))).toHaveLength(140);
    expect(names.filter((name) => /^\d+[AB]$/.test(name))).toHaveLength(40);
    expect(missingTemplateColumns(old, old)).toEqual([]);
  });

  it('takes off the old columns that hold no value, and leaves one that does', () => {
    expect(retiredColumns(old, retired)).toHaveLength(39);
    expect(columnsToRemove(old, retired, () => false)).toHaveLength(39);
    const vigor = old.find((column) => column.name === 'Vigor score (1–5)')!;
    const going = columnsToRemove(old, retired, (column) => column.key === vigor.key);
    expect(going).toHaveLength(38);
    expect(going.map((column) => column.key)).not.toContain(vigor.key);
    // Nothing the template still has is ever taken off, even if no row has a value in it.
    expect(columnsToRemove(old, retired, () => false).every((column) => !templateIds.has(columnIdentity(column)))).toBe(true);
    // A table with nothing the template dropped has nothing to take off.
    expect(columnsToRemove(template, retired, () => false)).toEqual([]);
  });

  it('makes the table the template exactly, in the template\'s order, when every old column is empty', () => {
    const merged = withTemplateColumns(old, template, columnsToRemove(old, retired, () => false));
    expect(merged).toHaveLength(template.length);
    expect(merged.map(columnIdentity)).toEqual(template.map(columnIdentity));
    // The columns it had and the template still has keep their keys: their cells stay with them.
    const kept = merged.filter((column) => column.key !== '');
    expect(kept).toHaveLength(STAYING);
    expect(kept.map((column) => column.key)).toEqual(old.filter((column) => templateIds.has(columnIdentity(column))).map((column) => column.key));
    expect(merged.filter((column) => column.key === '')).toHaveLength(NEW);
  });

  it('keeps every column that holds a value: each of the table\'s columns is there once, or is an empty one the template dropped', () => {
    // Two of the old averages have values: those stay, among the new columns.
    const full = new Set(old.filter((column) => ['Vigor score (1–5)', 'Plant height'].includes(column.name)).map((column) => column.key));
    const removable = columnsToRemove(old, retired, (column) => full.has(column.key));
    const merged = withTemplateColumns(old, template, removable);
    const gone = new Set(removable.map((column) => column.key));
    for (const column of old) {
      const there = merged.filter((item) => item.key === column.key);
      expect(there, column.name).toHaveLength(gone.has(column.key) ? 0 : 1);
    }
    expect(merged.filter((column) => full.has(column.key))).toHaveLength(2);
    expect(merged).toHaveLength(template.length + 2);
    expect(new Set(merged.map(columnIdentity)).size).toBe(merged.length);
    // The old ones that stay keep the order they had among themselves.
    const order = (columns: Column[]) => columns.filter((column) => column.key && !gone.has(column.key)).map((column) => column.key);
    expect(order(merged)).toEqual(order(old));
  });

  it('puts each new column in its own stage, next to the ones it goes with', () => {
    const merged = withTemplateColumns(old, template, columnsToRemove(old, retired, () => false));
    const flowers = 'Plant Flowering – Flowers per Plant (No.)';
    expect(at(merged, '4', 'Flower Abortion', 'Flower abortion')).toBe(at(merged, '4', flowers, 'P#20') + 1);
    expect(at(merged, '4', flowers, 'P#1')).toBe(at(merged, '4', undefined, '45 DAT Flowering') + 1);
    const health = '9';
    const weekly = 'Pest/Disease Status 0–70 DAT (No. affected)';
    expect(at(merged, health, weekly, 'W1 Date')).toBe(at(merged, health, undefined, '75–150 DAT Plant Health') + 1);
    expect(at(merged, health, 'Pest/Disease Status 0–150 DAT (No. affected)', 'W21')).toBe(at(merged, health, weekly, 'W1 Date') + 41);
    const end = '10';
    expect(at(merged, end, 'Cumulative Yield', '1st Date')).toBe(at(merged, end, 'Cumulative Yield', 'Total plant') + 1);
    // Every new column is inside its stage's run of columns.
    for (const column of merged.filter((item) => item.key === '' && item.box)) {
      const same = merged.map((item, index) => (item.box === column.box ? index : -1)).filter((index) => index >= 0);
      expect(same.at(-1)! - same[0]).toBe(same.length - 1);
    }
  });

  it('adds and takes off nothing the second time', () => {
    const once = withTemplateColumns(old, template, columnsToRemove(old, retired, () => false));
    const saved = once.map((column, index) => ({ ...column, key: column.key || `n${index}` }));
    expect(missingTemplateColumns(saved, template)).toEqual([]);
    expect(columnsToRemove(saved, retired, () => false)).toEqual([]);
    expect(columnsToLimit(saved, template)).toEqual([]);
    expect(withTemplateColumns(saved, template)).toEqual(saved);
  });

  it('knows a table that is just what the template made, now or before, from one the person changed', () => {
    expect(isUntouched(old, template, retired)).toBe(true);
    expect(isUntouched(template, template, retired)).toBe(true);
    expect(isUntouched([...old, col('My own column', { key: 'c900' })], template, retired)).toBe(false);
    expect(isUntouched(old.map((column) => (column.name === 'Live plant' ? { ...column, name: 'Alive' } : column)), template, retired)).toBe(false);
    expect(isUntouched([], template, retired)).toBe(true);
  });

  it('leaves a column of the table\'s own where it is, and does not add back what is the same under another spacing or case', () => {
    const mine = [col('Date', { key: 'c1', type: 'date' }), col('My note', { key: 'c2', type: 'text' }), col('weekly  checks', { key: 'c3', box: 'Own box' })];
    const merged = withTemplateColumns(mine, [col('Date', { type: 'date' }), col('Wet', { type: 'number' })]);
    expect(merged.map((column) => column.name)).toEqual(['Date', 'Wet', 'My note', 'weekly  checks']);
    expect(columnIdentity(col('  Total   Plant ', { box: ' A ' }))).toBe(columnIdentity(col('total plant', { box: 'a' })));
    expect(missingTemplateColumns([col('Total  plant', { key: 'c1', group: 'Yield' })], [col('total Plant', { group: ' yield ' })])).toEqual([]);
  });

  it('copes with a table that lost columns, had them moved, or has no template columns at all', () => {
    // Stage 3 deleted by the person, and Date moved to the end: the rest is still placed in its stage.
    const trimmed = old.filter((column) => !(column.box ?? '').startsWith('3 ·'));
    const moved = [...trimmed.slice(1), trimmed[0]];
    const merged = withTemplateColumns(moved, template, columnsToRemove(moved, retired, () => false));
    // The columns of the deleted stage come back (they are the template's), the person's order of the rest stays.
    const staying = (columns: Column[]) => columns.filter((column) => column.key !== '' && templateIds.has(columnIdentity(column))).map((column) => column.key);
    expect(staying(merged)).toEqual(staying(moved));
    expect(new Set(merged.map(columnIdentity)).size).toBe(merged.length);
    expect(withTemplateColumns([], template)).toHaveLength(template.length);
    expect(withTemplateColumns(old, [])).toEqual(old);
  });

  describe('the limits of the template (least and most)', () => {
    const named = (columns: Column[], name: string) => columns.find((column) => column.name === name)!;
    /** The columns of the table the template still has that get a limit or another name from it. */
    const gaining = old.filter((column) => templateIds.has(columnIdentity(column)) && (column.type === 'number' || column.type === 'percentage' || ['Date', 'Zone'].includes(column.name)));

    it('gives the columns the table had, that had no limit, the template\'s: counts 0 or more', () => {
      expect(columnsToLimit(old, template).map((column) => column.key).sort()).toEqual(gaining.map((column) => column.key).sort());
      const merged = withTemplateColumns(old, template);
      const live = named(merged, 'Live plant');
      expect([live.min, live.max]).toEqual([0, undefined]);
      expect(named(merged, 'Zone').min).toBeUndefined();
      expect(merged.filter((column) => column.type === 'formula' || column.type === 'date').every((column) => column.min === undefined && column.max === undefined)).toBe(true);
      // The scores and percentages are the new per-plant and abortion columns'.
      const vigor = merged.filter((column) => column.group === 'Plant Vigor Score (1–5)');
      expect(vigor).toHaveLength(20);
      expect(vigor.every((column) => column.min === 1 && column.max === 5)).toBe(true);
      expect([named(merged, 'Flower abortion').min, named(merged, 'Flower abortion').max]).toEqual([0, 100]);
    });

    it('does not override a limit the person set, and does not need to be done twice', () => {
      const mine = old.map((column) => (column.name === 'Live plant' ? { ...column, min: -5, max: 25 } : column));
      const merged = withTemplateColumns(mine, template);
      const live = named(merged, 'Live plant');
      expect([live.min, live.max]).toEqual([-5, 25]);
      expect(columnsToLimit(mine, template).map((column) => column.name)).not.toContain('Live plant');
      const saved = merged.map((column, index) => ({ ...column, key: column.key || `n${index}` }));
      expect(columnsToLimit(saved, template)).toEqual([]);
      expect(withTemplateColumns(saved, template)).toEqual(saved);
    });

    it('gives the row\'s Date and Zone the names the sheet calls them (Planting Date, Block), without doubling one the person added', () => {
      const merged = withTemplateColumns(old, template);
      expect(named(merged, 'Date').aliases).toEqual(['Planting Date']);
      expect(named(merged, 'Zone').aliases).toEqual(['Block']);
      const mine = old.map((column) => (column.name === 'Zone' ? { ...column, aliases: ['plot', 'BLOCK'] } : column));
      expect(named(withTemplateColumns(mine, template), 'Zone').aliases).toEqual(['plot', 'BLOCK']);
      expect(columnsToLimit(mine, template).map((column) => column.name)).not.toContain('Zone');
    });

    it('fills only the half of a limit that is missing', () => {
      const [one] = withTemplateColumns([col('Score', { key: 'c1', min: 2 })], [col('Score', { min: 1, max: 5 })]);
      expect([one.min, one.max]).toEqual([2, 5]);
    });
  });

  describe('a table that brings itself up to date', () => {
    it('does, when it is the older layout with no rows and nothing of the person\'s own', () => {
      expect(upgradesItself(old, 0, template, retired)).toBe(true);
    });

    it('does not, with a row in it, or a column the person added, renamed or took away from the old layout', () => {
      expect(upgradesItself(old, 1, template, retired)).toBe(false);
      expect(upgradesItself([...old, col('My own column', { key: 'c900' })], 0, template, retired)).toBe(false);
      expect(upgradesItself(old.map((column) => (column.name === 'Live plant' ? { ...column, name: 'Alive' } : column)), 0, template, retired)).toBe(false);
      expect(upgradesItself([], 0, template, retired)).toBe(false);
    });

    it('never does again once it is up to date, so what the person deletes or clears after stays so', () => {
      const merged = withTemplateColumns(old, template, columnsToRemove(old, retired, () => false));
      const saved = merged.map((column, index) => ({ ...column, key: column.key || `n${index}` }));
      expect(upgradesItself(saved, 0, template, retired)).toBe(false);
      // A column deleted from it (the template would add it back if asked): still not by itself.
      const deleted = saved.filter((column) => column.name !== 'Notes');
      expect(missingTemplateColumns(deleted, template)).toHaveLength(1);
      expect(upgradesItself(deleted, 0, template, retired)).toBe(false);
      // Nor when a limit is cleared.
      const cleared = saved.map((column) => (column.name === 'Live plant' ? { ...column, min: undefined } : column));
      expect(upgradesItself(cleared, 0, template, retired)).toBe(false);
    });

    it('does not for a table that has the old columns but also rows, however few', () => {
      expect(retiredColumns(old, retired).length).toBeGreaterThan(0);
      expect(upgradesItself(old, 12, template, retired)).toBe(false);
    });
  });
});
