// From the system: Staff_Attention_UI/src/modules/sheet/univerFreeze.ts, as it is there.
import { RANGE_TYPE, type FUniver, type IDisposable } from '@univerjs/presets';

// Univer's freeze commands and the Freeze submenus on the row and column
// headers' right-click menus.
const CANCEL_FROZEN = 'sheet.command.cancel-frozen';
const COLUMN_HEADER_FREEZE_MENU = 'sheet.column-header-menu.sheet-frozen';
const ROW_HEADER_FREEZE_MENU = 'sheet.row-header-menu.sheet-frozen';
const SET_COLUMN_FROZEN = 'sheet.command.set-col-frozen';
const SET_ROW_FROZEN = 'sheet.command.set-row-frozen';
// What the Freeze items run: its `type` 1 rows, 2 columns, 3 the first
// row, 4 the first column, none both (to the current cell).
const SET_SELECTION_FROZEN = 'sheet.command.set-selection-frozen';

/** Rows and columns freeze apart, as in Google Sheets: on a row header's
 * Freeze, freeze the rows picked (through the last) or unfreeze the rows;
 * on a column header's, the same for columns — the other kept as it is.
 * `firstColumn` is the first shown column, which "Freeze first column"
 * freezes through (columns before it are hidden). */
export function installFreezeMenus(univerAPI: FUniver, firstColumn: () => number): IDisposable {
  const activeSheet = () => univerAPI.getActiveWorkbook()?.getActiveSheet();
  const freezeRows = (rows: number) => {
    const sheet = activeSheet();
    if (!sheet) return;
    sheet.setFreeze({
      ...sheet.getFreeze(),
      startRow: rows > 0 ? rows : -1,
      ySplit: rows,
    });
  };
  const freezeColumns = (columns: number) => {
    const sheet = activeSheet();
    if (!sheet) return;
    sheet.setFreeze({
      ...sheet.getFreeze(),
      startColumn: columns > 0 ? columns : -1,
      xSplit: columns,
    });
  };

  univerAPI
    .createMenu({
      action: SET_ROW_FROZEN,
      icon: 'FreezeRowIcon',
      id: SET_ROW_FROZEN,
      order: 1,
      title: 'Freeze selected rows',
    })
    .appendTo(ROW_HEADER_FREEZE_MENU);
  univerAPI
    .createMenu({
      action: () => freezeRows(0),
      icon: 'CancelFreezeIcon',
      id: CANCEL_FROZEN,
      order: 5,
      title: 'Unfreeze rows',
    })
    .appendTo(ROW_HEADER_FREEZE_MENU);
  univerAPI
    .createMenu({
      action: SET_COLUMN_FROZEN,
      icon: 'FreezeColumnIcon',
      id: SET_COLUMN_FROZEN,
      order: 2,
      title: 'Freeze selected columns',
    })
    .appendTo(COLUMN_HEADER_FREEZE_MENU);
  univerAPI
    .createMenu({
      action: () => freezeColumns(0),
      icon: 'CancelFreezeIcon',
      id: CANCEL_FROZEN,
      order: 5,
      title: 'Unfreeze columns',
    })
    .appendTo(COLUMN_HEADER_FREEZE_MENU);

  // Univer freezes to the current cell — above the first row picked, before
  // the first column — and drops the other's freeze.
  return univerAPI.addEvent(univerAPI.Event.BeforeCommandExecute, (event) => {
    if (event.id !== SET_SELECTION_FROZEN) return;
    const type = (event.params as { type?: number } | undefined)?.type;
    if (type === 3) {
      event.cancel = true;
      freezeRows(1);
      return;
    }
    if (type === 4) {
      event.cancel = true;
      freezeColumns(firstColumn() + 1);
      return;
    }
    const range = activeSheet()?.getSelection()?.getActiveRange()?.getRange();
    if (!range) return;
    if (range.rangeType === RANGE_TYPE.ROW && (!type || type === 1)) {
      event.cancel = true;
      freezeRows(range.endRow + 1);
    } else if (range.rangeType === RANGE_TYPE.COLUMN && (!type || type === 2)) {
      event.cancel = true;
      freezeColumns(range.endColumn + 1);
    }
  });
}
