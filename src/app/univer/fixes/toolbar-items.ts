// From the system: Staff_Attention_UI/src/modules/sheet/univerToolbarItems.ts, as it is there.
// Univer's toolbar, cut down to the everyday tools (undo / redo, font size,
// bold, italic, colours, borders, align, wrap, merge, number format, Σ,
// filter, sort) so it fits on one row with no ⋮ overflow — the app's own
// "?" and History at its end stay in sight. Freeze stays in the row and
// column headers' right-click menus. Used by the full sheet and the column
// designer alike (the user, 2026-10-14: the designer's "?" was lost under
// its ⋮).
const HIDDEN_TOOLBAR_ITEMS = [
  'ui.operation.activate-format-painter',
  'ui.command.clear-formatting',
  'base-ui.operation.toggle-shortcut-panel',
  'ui.operation.open-feature-search',
  'sheet.command.set-range-font-family',
  'sheet.command.set-range-font-increase',
  'sheet.command.set-range-font-decrease',
  'sheet.command.set-range-underline',
  'sheet.command.set-range-stroke',
  'sheet.command.set-vertical-text-align',
  'sheet.command.set-shrink-to-fit',
  'sheet.command.set-text-rotation',
  'sheet.command.add-range-protection-from-toolbar',
  'sheet.command.numfmt.set.percent',
  'sheet.command.numfmt.set.currency',
  'sheet.command.numfmt.add.decimal.command',
  'sheet.command.numfmt.subtract.decimal.command',
  ...[
    'financial',
    'logical',
    'text',
    'date',
    'lookup',
    'math',
    'statistical',
    'engineering',
    'information',
    'database',
  ].map((category) => `formula-ui.operation.insert-function.${category}`),
  'sheet.toolbar.sheet-frozen',
  'sheet.menu.zoom-ratio',
  'base-ui.operation.toggle-fullscreen',
  'sheet.command.toggle-gridlines',
];

/** The core preset's `menu` option that hides them. */
export const HIDDEN_TOOLBAR_MENU = Object.fromEntries(
  HIDDEN_TOOLBAR_ITEMS.map((id) => [id, { hidden: true }]),
);
