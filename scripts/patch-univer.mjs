import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PATCHES = [
  // Univer's conditional formatting (1.0.2, still in 1.1.0) moves a copied
  // rule's range to the paste with Rectangle.getPositionRange, which wants the
  // end as a distance from the start; it's handed the end itself. A rule that
  // doesn't start at the copy's top-left cell (a data bar on E1:F1 of A1:G3)
  // lands past the pasted cells, and the paste throws and does nothing.
  {
    name: "conditional formatting paste",
    package: "sheets-conditional-formatting-ui",
    broken: "getPositionRange(sourceRange, item.startRange)",
    fixed:
      "getPositionRange({ ...sourceRange, endRow: sourceRange.endRow - sourceRange.startRow, endColumn: sourceRange.endColumn - sourceRange.startColumn }, item.startRange)",
  },
  // The right-click menu (1.0.2): leaving an item with a submenu checks
  // where the pointer went with element.contains(relatedTarget). React gives
  // `window` there when the pointer leaves for something it doesn't render
  // (off the page, say), and contains(window) throws "parameter 1 is not of
  // type 'Node'" — the sheet's error screen (the user, 2026-10-21). Not a
  // node: gone from the menu.
  {
    name: "context menu pointer leave",
    package: "ui",
    broken: "const nextTarget = event.relatedTarget;",
    fixed:
      "const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;",
  },
];

for (const patch of PATCHES) {
  const root = new URL(
    `../node_modules/@univerjs/${patch.package}/`,
    import.meta.url,
  );
  for (const name of ["lib/es/index.js", "lib/cjs/index.js"]) {
    const file = new URL(name, root);
    const source = await readFile(file, "utf8");
    if (source.includes(patch.fixed) && !source.includes(patch.broken))
      continue;
    if (!source.includes(patch.broken))
      throw new Error(
        `Cannot locate the ${patch.name} patch in ${fileURLToPath(file)}: review it against this Univer version.`,
      );
    await writeFile(file, source.replaceAll(patch.broken, patch.fixed));
  }
}
