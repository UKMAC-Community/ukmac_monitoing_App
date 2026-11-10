// From the system: Staff_Attention_UI/src/modules/sheet/univerFormulaBarSync.ts, as it is there.
import { IEditorBridgeService } from '@univerjs/preset-sheets-core';
import type { IDisposable, Univer } from '@univerjs/presets';

/**
 * The formula bar shows the picked cell, always, once nothing is being
 * typed (the user, 2026-10-14: "I want to make it mirror"; 2026-10-17: after
 * G3's =[Test1]+[Test4] it "still fix that one" as other cells were
 * picked). Univer's hidden cell editor holds the picked cell's text, and a
 * text starting with "=" (row 3's =LINK(…), =[A]+[B]) makes it decide a
 * formula is being typed with the cursor where a cell could be pointed at:
 * a moment after the pick it holds the editor open for pointing — and while
 * it holds, Univer leaves the formula bar on that cell as others are
 * picked. A hold with nothing being typed is let go — as each picked cell
 * arrives, and as typing ends — and the bar filled again. These follow the
 * editor bridge itself: Univer's SelectionChanged event never reached this.
 */
export function installFormulaBarSync(univer: Univer): IDisposable {
  const bridge = univer.__getInjector().get(IEditorBridgeService);
  let typingEnded: ReturnType<typeof setTimeout> | undefined;
  const release = () => {
    if (bridge.isVisible().visible || !bridge.isForceKeepVisible()) return;
    bridge.disableForceKeepVisible();
    bridge.refreshEditCellState();
  };
  // A cell picked while held: the bar skipped it. Once this pick is done
  // with (the release sends the cell again, which finds nothing held).
  const picked = bridge.currentEditCellState$.subscribe((state) => {
    if (state) queueMicrotask(release);
  });
  // Typing ended: after Univer's own handling of the end, which may hold
  // it again.
  const typing = bridge.visible$.subscribe(({ visible }) => {
    if (visible) return;
    clearTimeout(typingEnded);
    typingEnded = setTimeout(release, 0);
  });
  return {
    dispose() {
      clearTimeout(typingEnded);
      picked.unsubscribe();
      typing.unsubscribe();
    },
  };
}
