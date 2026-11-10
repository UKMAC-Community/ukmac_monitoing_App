// From the system: Staff_Attention_UI/src/modules/sheet/univerFreezeLine.ts, as it is there.
import { HeaderFreezeRenderController } from '@univerjs/preset-sheets-core';

// A shade darker than the gridlines: the frozen edge shows, quietly.
const LINE_COLOR = '#C9CED6';

type Bar = {
  height: number;
  left: number;
  top: number;
  transformByState(state: Partial<Record<'height' | 'left' | 'top' | 'width', number>>): void;
  width: number;
};
type Controller = {
  _columnFreezeHeaderRect?: Bar;
  _columnFreezeMainRect?: Bar;
  _createFreeze(direction?: number, config?: FreezeConfig): unknown;
  _freezeNormalHeaderColor: string;
  _getFreeze(): FreezeConfig | null | undefined;
  _rowFreezeHeaderRect?: Bar;
  _rowFreezeMainRect?: Bar;
  _themeChange(theme: unknown): void;
};
type FreezeConfig = { startColumn: number; startRow: number };

/** Univer draws the frozen rows' and columns' edge as a 2px grey bar; draw
 * it as a thin light line (its own width halved — 1px on screen), as plain
 * as the grid. With nothing frozen, Univer's drag handle stays as it is. */
function patchFreezeLine() {
  const proto = HeaderFreezeRenderController.prototype as unknown as Controller & {
    __thinFreezeLine?: true;
  };
  if (proto.__thinFreezeLine || typeof proto._createFreeze !== 'function') return;
  proto.__thinFreezeLine = true;

  const themeChange = proto._themeChange;
  proto._themeChange = function (this: Controller, theme) {
    themeChange.call(this, theme);
    this._freezeNormalHeaderColor = LINE_COLOR;
  };

  const create = proto._createFreeze;
  proto._createFreeze = function (this: Controller, direction = 0, config) {
    const result = create.call(this, direction, config);
    const freeze = config ?? this._getFreeze();
    const rows = direction === 0;
    const frozen = rows ? freeze?.startRow : freeze?.startColumn;
    if (!frozen || frozen < 1) return result;
    const bars = rows
      ? [this._rowFreezeHeaderRect, this._rowFreezeMainRect]
      : [this._columnFreezeHeaderRect, this._columnFreezeMainRect];
    for (const bar of bars) {
      if (!bar) continue;
      // Kept on the edge: the bar ends where the frozen part does.
      if (rows) {
        const thin = bar.height / 2;
        bar.transformByState({ height: thin, top: bar.top + thin });
      } else {
        const thin = bar.width / 2;
        bar.transformByState({ left: bar.left + thin, width: thin });
      }
    }
    return result;
  };
}

patchFreezeLine();
