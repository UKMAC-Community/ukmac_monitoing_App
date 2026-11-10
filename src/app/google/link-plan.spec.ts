import type { Column } from '../core/models';
import { buildSyncWorkbook } from '../excel/sync-workbook';
import { readExcelSheets } from '../excel/sheet-from-excel';
import batchColumns from '../sheet/fixtures/batches-columns.json';
import { makeSheet, qaQcColumns } from '../test-helpers';
import { planLinks, tabNameOf } from './link-plan';

const batches = makeSheet(2, 'Batches', batchColumns as Column[], [
  { c1: 'B1', c2: 'Mali' },
  { c1: 'B2', c2: 'RED SKY 88' },
]);
const qa = makeSheet(11, 'QA/QC Management', qaQcColumns(), [{ c1: '2026-06-01', c2: 'A1', c9: '18' }]);
const soil = makeSheet(5, 'Soil Preparation', [{ key: 'c1', name: 'Date', type: 'date' }, { key: 'c2', name: 'Zone', type: 'text' }, { key: 'c3', name: 'Note', type: 'text' }], []);

describe('linking the MAC\'s tables to the tabs of the Google Sheet made from the input workbook', () => {
  it('finds every table\'s tab, with no column the table lacks, the empty table too', async () => {
    const { bytes } = await buildSyncWorkbook([batches, qa, soil]);
    const plan = planLinks([batches, qa, soil], await readExcelSheets(bytes));
    expect(plan.noTab).toEqual([]);
    expect(plan.different).toEqual([]);
    expect(plan.ready.map((item) => [item.table.title, item.tab.name, item.tab.rows.length])).toEqual([
      ['Batches', 'Batches', 2],
      ['QA/QC Management', 'QA-QC Management', 1],
      ['Soil Preparation', 'Soil Preparation', 0],
    ]);
    // What is linked is by the tab's own headers.
    const batchMap = plan.ready[0].headerMap;
    expect(Object.values(batchMap).sort()).toEqual(['c1', 'c2']);
  });

  it('names a tab as the workbook does ("/" cannot be in a tab name)', () => {
    expect(tabNameOf(qa)).toBe('QA-QC Management');
  });

  it('reports a table whose tab is missing, and one whose tab has columns the table does not', async () => {
    const { bytes } = await buildSyncWorkbook([batches]);
    const tabs = await readExcelSheets(bytes);
    // A tab an editor added a column to.
    tabs[0].headers.push('Supplier phone');
    tabs[0].rows.forEach((row) => row.push(''));
    const plan = planLinks([batches, soil], tabs);
    expect(plan.ready).toEqual([]);
    expect(plan.noTab.map((table) => table.title)).toEqual(['Soil Preparation']);
    expect(plan.different.map((item) => [item.table.title, item.extra])).toEqual([['Batches', ['Supplier phone']]]);
  });
});
