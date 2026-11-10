/** PM-only, in-memory reproduction. No Tauri commands or live database writes. */
import '@angular/compiler';
import { createEnvironmentInjector, Injector, runInInjectionContext } from '@angular/core';
import assert from 'node:assert/strict';
import { Api } from '../../src/app/core/api';
import { Toasts } from '../../src/app/core/toast';
import { WorkbookStore } from '../../src/app/core/workbook-store';
import type { Row, Workbook } from '../../src/app/core/models';

function row(id: number, value: string): Row {
  return { rowId: id, sheetId: 1, position: id, data: { c1: value }, importId: null, createdAt: '', updatedAt: '' };
}

function fixture(): Workbook {
  return {
    mac: { macId: 1, macUuid: 'pm-fixture', macName: 'PM disposable fixture', macCode: 'PM-TEST', macLocation: null, latitude: null, longitude: null, startDate: null, endDate: null, crop: 'chili', note: null, createdAt: '', updatedAt: '', sheetCount: 1, rowCount: 2 },
    sheets: [{ sheetId: 1, macId: 1, title: 'Fixture', heading: 'Fixture', about: '', icon: null, templateKey: null, columns: [{ key: 'c1', name: 'Value', type: 'text' }], dashboard: null, displayOrder: 0, rowCount: 2, createdAt: '', updatedAt: '', rows: [row(1, 'first-original'), row(2, 'second-original')] }],
  };
}

function storeWith(api: object) {
  const errors: string[] = [];
  const injector = createEnvironmentInjector([
    { provide: Api, useValue: api },
    { provide: Toasts, useValue: { error: (message: string) => errors.push(message) } },
  ], Injector.NULL as any);
  const store = runInInjectionContext(injector, () => new WorkbookStore());
  store.workbook.set(fixture());
  return { store, errors, injector };
}

async function failedCellSave() {
  const { store, errors, injector } = storeWith({ updateCells: async () => { throw new Error('PM simulated write failure'); } });
  let rejected = false;
  try { await store.updateCells(1, [{ rowId: 1, key: 'c1', value: 'new value' }]); } catch { rejected = true; }
  const evidence = { scenario: 'failed cell save', promiseRejected: rejected, pendingCount: store.saving(), displayedValue: store.sheet(1)!.rows[0].data.c1, errorToastCount: errors.length };
  assert.equal(rejected, false, 'Current defect reproduction expects rejection to be swallowed');
  assert.equal(store.saving(), 0);
  assert.equal(errors.length, 1);
  console.log(JSON.stringify(evidence));
  injector.destroy();
}

async function failedReorder() {
  const { store, errors, injector } = storeWith({ reorderRows: async () => { throw new Error('PM simulated reorder failure'); } });
  let rejected = false;
  try { await store.reorderRows(1, [2, 1]); } catch { rejected = true; }
  const displayedOrder = store.sheet(1)!.rows.map((r) => r.rowId);
  assert.equal(rejected, true);
  assert.deepEqual(displayedOrder, [2, 1], 'Current defect reproduction expects failed optimistic order to remain');
  console.log(JSON.stringify({ scenario: 'failed row reorder', promiseRejected: rejected, pendingCount: store.saving(), displayedOrder, persistedFixtureOrder: [1, 2], storeErrorToastCount: errors.length }));
  injector.destroy();
}

async function overlappingSaves() {
  const pending: Array<{ resolve: (value: Row[]) => void; reject: (reason: Error) => void }> = [];
  const { store, injector } = storeWith({ updateCells: () => new Promise<Row[]>((resolve, reject) => pending.push({ resolve, reject })) });
  const first = store.updateCells(1, [{ rowId: 1, key: 'c1', value: 'first-edit' }]);
  const second = store.updateCells(1, [{ rowId: 2, key: 'c1', value: 'second-saved' }]);
  assert.equal(pending.length, 2);
  pending[1].resolve([row(2, 'second-saved')]);
  await second;
  assert.equal(store.sheet(1)!.rows.find((r) => r.rowId === 2)!.data.c1, 'second-saved');
  pending[0].reject(new Error('PM first write fails after the second succeeds'));
  await first;
  const displayedValue = store.sheet(1)!.rows.find((r) => r.rowId === 2)!.data.c1;
  assert.equal(displayedValue, 'second-original', 'Current defect reproduction expects unrelated successful edit to be reverted in memory');
  console.log(JSON.stringify({ scenario: 'overlapping saves, first fails after second succeeds', pendingCount: store.saving(), displayedSecondRow: displayedValue, persistedFixtureSecondRow: 'second-saved' }));
  injector.destroy();
}

await failedCellSave();
await failedReorder();
await overlappingSaves();
