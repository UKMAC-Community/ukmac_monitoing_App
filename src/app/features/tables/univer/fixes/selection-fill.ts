// From the system: Staff_Attention_UI/src/modules/sheet/univerSelectionFill.ts, as it is there.
import { SelectionControl } from '@univerjs/preset-sheets-core';
import { RANGE_TYPE } from '@univerjs/presets';

type Bounds = { endX: number; endY: number; startX: number; startY: number };
type CellBounds = Bounds & {
  endColumn: number;
  endRow: number;
  startColumn: number;
  startRow: number;
};
type RenderModel = Bounds & {
  currentCell?: (Bounds & { mergeInfo?: CellBounds }) | null;
  endColumn: number;
  endRow: number;
  highlightToSelection(): Bounds | undefined;
  rangeType: RANGE_TYPE;
  startColumn: number;
  startRow: number;
};
type Control = {
  _selectionRenderModel: RenderModel;
  _updateBackgroundControl(style: unknown): void;
};

/** Selecting whole rows (or columns), Univer makes the current cell the
 * whole first row — so that row is left unshaded, as the current cell is.
 * Shade all of the rows picked, the current cell too. Drawing only: the
 * selection itself stays Univer's, which Shift-click extends from. */
function patchSelectionFill() {
  const proto = SelectionControl.prototype as unknown as Control & {
    __wholeLineFill?: true;
  };
  if (proto.__wholeLineFill) return;
  proto.__wholeLineFill = true;
  const draw = proto._updateBackgroundControl;
  proto._updateBackgroundControl = function (this: Control, style) {
    const model = this._selectionRenderModel;
    const cell = model.currentCell;
    const line = cell?.mergeInfo;
    const wholeLine =
      cell &&
      line &&
      model.rangeType !== RANGE_TYPE.NORMAL &&
      ((line.startColumn === model.startColumn &&
        line.endColumn === model.endColumn &&
        line.startRow === line.endRow) ||
        (line.startRow === model.startRow &&
          line.endRow === model.endRow &&
          line.startColumn === line.endColumn));
    if (!wholeLine) return draw.call(this, style);
    // No current cell to leave out: the whole selection is shaded.
    model.highlightToSelection = () => undefined;
    try {
      draw.call(this, style);
    } finally {
      delete (model as Partial<RenderModel>).highlightToSelection;
    }
  };
}

patchSelectionFill();
