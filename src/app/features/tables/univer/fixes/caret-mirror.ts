// From the system: Staff_Attention_UI/src/modules/sheet/univerCaretMirror.ts, as it is there.
import {
  DocSelectionManagerService,
  IEditorBridgeService,
  IEditorService,
} from '@univerjs/preset-sheets-core';
import {
  DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY,
  DOCS_NORMAL_EDITOR_UNIT_ID_KEY,
  type IDisposable,
  type IDocumentData,
  type Univer,
} from '@univerjs/presets';

/** Each of the two editors a cell is typed in, and the other one. */
const TWIN: Record<string, string> = {
  [DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY]: DOCS_NORMAL_EDITOR_UNIT_ID_KEY,
  [DOCS_NORMAL_EDITOR_UNIT_ID_KEY]: DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY,
};

/**
 * The cursor in the same place in the cell and in the formula bar (the
 * user, 2026-10-19: in the bar it was after =LINK(zone, in the cell still
 * after =LINK( — "make it mirror"). Univer copies what's typed in one to the
 * other, but not where the cursor is: as it moves in the one typed in, the
 * other's goes there too, unfocused. Left alone while their texts differ,
 * and while nothing's being typed: Univer keeps its hidden cell editor
 * focused as cells are picked, and a cursor copied into the formula bar
 * then blinked there with no typing (found while looking into the bar's
 * text drawn too high as typing started — the user, 2026-10-19: "i want
 * to make it normal").
 */
export function installCaretMirror(univer: Univer): IDisposable {
  const injector = univer.__getInjector();
  const editors = injector.get(IEditorService);
  const selections = injector.get(DocSelectionManagerService);
  const bridge = injector.get(IEditorBridgeService);
  const textOf = (editor: { getDocumentData(): IDocumentData }) =>
    editor.getDocumentData().body?.dataStream ?? '';

  const mirror = () => {
    if (!bridge.isVisible().visible) return;
    for (const [fromId, twinId] of Object.entries(TWIN)) {
      const from = editors.getEditor(fromId);
      const twin = editors.getEditor(twinId);
      if (!from?.isFocus() || !twin || textOf(from) !== textOf(twin)) continue;
      const ranges = from
        .getSelectionRanges()
        .map(({ endOffset, startOffset }) => ({ endOffset, startOffset }));
      const now = twin.getSelectionRanges();
      const same =
        now.length === ranges.length &&
        now.every(
          (range, at) =>
            range.startOffset === ranges[at].startOffset &&
            range.endOffset === ranges[at].endOffset,
        );
      if (ranges.length && !same) twin.setSelectionRanges(ranges, false);
      return;
    }
  };

  // Once the move is done: a click says where the cursor went before the
  // editor clicked takes the focus.
  let queued: ReturnType<typeof setTimeout> | undefined;
  const moved = selections.textSelection$.subscribe((selection) => {
    if (!selection || !TWIN[selection.unitId] || queued) return;
    queued = setTimeout(() => {
      queued = undefined;
      mirror();
    }, 0);
  });
  return {
    dispose() {
      clearTimeout(queued);
      moved.unsubscribe();
    },
  };
}
