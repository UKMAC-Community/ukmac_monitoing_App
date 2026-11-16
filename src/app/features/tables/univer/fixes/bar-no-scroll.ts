// From the system: Staff_Attention_UI/src/modules/sheet/univerBarNoScroll.ts, as it is there.
import { IEditorService, IRenderManagerService, type IRender } from '@univerjs/preset-sheets-core';
import {
  DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY,
  type IDisposable,
  type Univer,
} from '@univerjs/presets';

/**
 * The formula bar's text stays where it's drawn (the user, 2026-10-19: in
 * the bar it sat too high, cut off at the top, "like a new extra line").
 * Its one line is a little taller than the bar, and a click in the bar
 * starts Univer's scrolling while selecting, which scrolled the bar down by
 * what doesn't fit — and it stayed so until the page was opened again.
 * One line has nowhere to scroll to: the bar goes back to its top. Text of
 * several lines (Alt+Enter) scrolls as Univer has it.
 */
export function installBarNoScroll(univer: Univer): IDisposable {
  const injector = univer.__getInjector();
  const renders = injector.get(IRenderManagerService);
  const editors = injector.get(IEditorService);
  const oneLine = () => {
    const text =
      editors.getEditor(DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY)?.getDocumentData().body?.dataStream ??
      '';
    return !/[\r\n]/.test(text.replace(/\r\n$/, ''));
  };
  let watching: { unsubscribe(): void } | undefined;
  const watch = (render: IRender) => {
    if (render.unitId !== DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY) return;
    const viewport = render.scene.getViewport('viewMain');
    if (!viewport) return;
    watching?.unsubscribe();
    watching = viewport.onScrollAfter$.subscribeEvent(() => {
      if (viewport.viewportScrollY !== 0 && oneLine())
        viewport.scrollToViewportPos({ viewportScrollY: 0 });
    });
  };
  const bar = renders.getRenderUnitById(DOCS_FORMULA_BAR_EDITOR_UNIT_ID_KEY);
  if (bar) watch(bar);
  // The bar is drawn anew as it's put back on the page.
  const created = renders.created$.subscribe(watch);
  return {
    dispose() {
      created.unsubscribe();
      watching?.unsubscribe();
    },
  };
}
