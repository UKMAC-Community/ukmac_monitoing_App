// From the system: Staff_Attention_UI/src/modules/sheet/univerUndoKeys.ts, as it is there.
import { IShortcutService, KeyCode, MetaKeys } from '@univerjs/preset-sheets-core';
import {
  EDITOR_ACTIVATED,
  FOCUSING_FX_BAR_EDITOR,
  FOCUSING_UNIVER_EDITOR,
  RedoCommand,
  UndoCommand,
  type IContextService,
  type IDisposable,
  type Univer,
} from '@univerjs/presets';

/** As Univer's own undo keys: on the grid, not while a cell or the formula
 * bar is being typed in (the text has its own undo there). */
function onTheGrid(context: IContextService) {
  return (
    context.getContextValue(FOCUSING_UNIVER_EDITOR) &&
    !(context.getContextValue(EDITOR_ACTIVATED) || context.getContextValue(FOCUSING_FX_BAR_EDITOR))
  );
}

/** Undo with Ctrl+Z and redo with Ctrl+Shift+Z everywhere (user,
 * 2026-10-06). Univer binds Cmd+Z / Cmd+Shift+Z on a Mac and Ctrl+Z /
 * Ctrl+Y elsewhere; this adds the Control keys on a Mac and Ctrl+Shift+Z
 * elsewhere, beside those. */
export function installUndoKeys(univer: Univer): IDisposable {
  const shortcuts = univer.__getInjector().get(IShortcutService);
  const added = [
    shortcuts.registerShortcut({
      id: UndoCommand.id,
      mac: KeyCode.Z | MetaKeys.MAC_CTRL,
      preconditions: onTheGrid,
    }),
    shortcuts.registerShortcut({
      binding: KeyCode.Z | MetaKeys.CTRL_COMMAND | MetaKeys.SHIFT,
      id: RedoCommand.id,
      mac: KeyCode.Z | MetaKeys.MAC_CTRL | MetaKeys.SHIFT,
      preconditions: onTheGrid,
    }),
  ];
  return { dispose: () => added.forEach((shortcut) => shortcut.dispose()) };
}
