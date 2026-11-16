// From the system: Staff_Attention_UI/src/modules/sheet/univerBarFocusHandback.ts, as it is there.
import { IEditorBridgeService, IEditorService } from '@univerjs/preset-sheets-core';
import {
  DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY,
  DOCS_NORMAL_EDITOR_UNIT_ID_KEY,
  EDITOR_ACTIVATED,
  IContextService,
  type IDisposable,
  type Univer,
} from '@univerjs/presets';

/**
 * Typing in a cell keeps the cursor after each letter, also once the
 * formula bar has been typed in (the user, 2026-10-19: "Hello" came out
 * "elloH", "=dsfd" came out "dsfd="). Univer ends typing in the bar (Esc,
 * Enter, a cell clicked) still counting the bar as its focused editor. The
 * next typing in a cell takes that focus back after the first letter is
 * in, and taking it puts the cell's old cursor (before the letter) back
 * over the new one. So as typing in the bar ends, the cell's editor gets
 * the focus back, as it has before the bar's ever clicked: nothing is
 * typed then, so no cursor moves.
 */
export function installBarFocusHandback(univer: Univer): IDisposable {
  const injector = univer.__getInjector();
  const bridge = injector.get(IEditorBridgeService);
  const editors = injector.get(IEditorService);
  const contexts = injector.get(IContextService);
  let typingEnded: ReturnType<typeof setTimeout> | undefined;
  const handBack = () => {
    if (bridge.isVisible().visible || editors.getFocusId() !== DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY)
      return;
    editors.focus(DOCS_NORMAL_EDITOR_UNIT_ID_KEY);
    // Focusing says a cell's being typed in; none is.
    contexts.setContextValue(EDITOR_ACTIVATED, false);
  };
  // After Univer's own handling of the end.
  const typing = bridge.visible$.subscribe(({ visible }) => {
    if (visible) return;
    clearTimeout(typingEnded);
    typingEnded = setTimeout(handBack, 0);
  });
  return {
    dispose() {
      clearTimeout(typingEnded);
      typing.unsubscribe();
    },
  };
}
