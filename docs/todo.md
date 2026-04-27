# TODO

## Binary editor: add/remove entities

Allow users to add and remove entries in variable-length collections inside structured binary files (e.g., add or remove a global variable from a `.map` file). The mechanism is generic over file formats and driven by spec metadata, so new formats opt in by annotating their `arraySpec`s.

### Long-term shape

A single `EntityOperation` abstraction in the document layer (`addEntity`, `removeEntity`, `moveEntity`, `duplicateEntity`) is the only surface that mutates structural state. All UI surfaces dispatch to it; no surface implements its own logic. Underneath, operations build new bytes and reparse via the existing structural-edit pathway (`buildStructuralTransitionBytes` + `parse`), which means undo/redo, snapshot refresh, and canonical-document rebuild all reuse the field-edit pipeline.

UI surfaces, with disjoint roles:

| Surface                                                      | Role                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inline (per-array, per-row)                                  | `+ Add entry` row at end of an addable array; `✕` at the right edge of each removable row. Single-target, frequent ops. Always visible.                                                                                                                                                       |
| Toolbar (above tree)                                         | File-level actions (validate, revert, export snapshot), view toggles (expand all, numeric format), search, and selection-aware bulk ops once multi-select lands. Per-array `+`/`✕` do **not** live here — locality wins as the count of addable collections grows (a `GAM` resource has 30+). |
| Context menu (right-click on tree node)                      | Mirrors inline; adds duplicate, move up/down, paste, "delete N selected".                                                                                                                                                                                                                     |
| Commands (`bgforge.binaryEditor.addEntry`, `removeEntry`, …) | Keybindings, Command Palette, scripted/extension use.                                                                                                                                                                                                                                         |

Spec metadata extension: each `arraySpec` may declare `addable`, `removable`, `defaultElement`, `variants?`, `countSource`, `minSize?`, `maxSize?`. Adding a format = annotating its specs; no per-format UI work.

### v1 — uniform arrays, append-only

Scope:

- `EntityOperation` abstraction in `binaryEditor-document.ts`, dispatching through `buildStructuralTransitionBytes` + reparse.
- `arraySpec` metadata: `addable`, `removable`, `defaultElement`, `countSource` (path to the count field updated atomically with the section).
- Tree-state selection model in the webview (single-select, keyboard navigable). Required by commands and by future multi-select.
- Inline UI: `+ Add entry` row appended to an addable array group; persistent `✕` at the right edge of each removable row. Always visible, not hover-revealed.
- VSCode commands: `bgforge.binaryEditor.addEntry`, `bgforge.binaryEditor.removeEntry`. Operate on the currently selected node.
- MAP coverage: `Global Variables`, `Local Variables` (uniform `int32` arrays, count in header).
- Append-only — `+` always tacks onto the end of the array; the new entry's value defaults from `defaultElement` (`0` for int globals/locals).
- Validation: enforce `minSize`/`maxSize` from spec; refuse remove when at minimum, refuse add when at maximum, surface via existing field-error channel.
- Undo/redo: reuse the structural-edit `replaceParseResult` pathway. No new undo machinery.
- Tests: unit (operation correctness, count update, undo/redo round-trip), integration (round-trip a `.map`: add → save → reparse → remove → save → reparse), webview rendering (button presence on addable arrays, absence on non-addable).

Out of scope for v1: variant arrays, insert-at-index, multi-select, context menu, bulk ops, copy/paste, move up/down.

### v2 — variant arrays, ordering, context menu

- Variant-picker component invoked when an array's spec declares `variants` (e.g., MAP object types: critter, exit-grid, generic). Used identically by inline `+`, context menu, and command. Surfaced via a quick-pick.
- Insert-at-index: `Add before` / `Add after` on entry rows. Required for collections where slot index is identity (global var index referenced from scripts).
- Move up / move down on entry rows. Tracks `countSource` invariants and any cross-record offset adjustments via the structural pathway.
- Context menu (right-click) mirroring inline actions plus the new ordering actions.
- Format coverage: MAP objects (per-elevation, variant-shaped records including critter/exit-grid/inventory). Script slots within capacity-batched extents come with this phase since they share the variant + ordering machinery (and need extent-capacity growth handled in `countSource`).

### v3 — bulk ops, multi-select, scripting

- Multi-select in tree state (range select, ctrl-click).
- Bulk ops surfaced in toolbar and context menu: delete selected, duplicate selected, move selected.
- Cross-file copy/paste of entries (clipboard carries spec-typed payload; paste validates against target array's spec).
- Scripted-operation hook for extensions: a stable API to enumerate addable arrays and run `EntityOperation`s programmatically. Enables modder workflows like "apply patcher to every CRE in a directory."
- Format coverage broadens to whatever IE/Fallout formats are wired up by then (`SAVE.DAT`, `GAM`, `CRE`, `ARE`, `TLK`, …). Each format opts in by annotating its `arraySpec`s — no UI changes required.
