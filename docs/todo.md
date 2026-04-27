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

### v1 — uniform arrays, append-only (shipped)

Landed:

- `addEntity` / `removeEntity` on `BinaryDocument`, dispatching to format-adapter byte-builders (`buildAddEntryBytes` / `buildRemoveEntryBytes`) → reparse → `replaceParseResult`. Undo/redo, dirty tracking, and snapshot refresh all reuse the structural-edit pipeline.
- `ArrayFieldSpec` carries `addable`, `removable`, `defaultElement`. The spec is the single source of truth — format adapters look up capability from the spec rather than maintaining a parallel table. The MAP `varSectionSpec` annotates `addable: true, removable: true, defaultElement: () => 0`; new addable formats opt in by annotating their own array specs.
- Tree state marks groups `addable: true` (with `arrayPath`) and entries `removable: true` (with `entryPath`). Adapter predicates (`isAddableArray`, `isRemovableEntry`) drive the UI without per-format branching in the tree builder.
- Inline UI in the webview: persistent `+ Add entry` row at the bottom of every addable group, `✕` at the right edge of every removable entry — always visible, not hover-revealed. Clicks post `addEntry` / `removeEntry` to the host.
- MAP coverage: `Global Variables` and `Local Variables` (uniform `int32` arrays, count mirrored in header). Append-only.
- Tests: unit coverage on the adapter byte-builders, the document API (including undo/redo round-trips), and the tree-state metadata. Full `pnpm test:all` is green.

Deferred to v2 (see below): selection model and VSCode commands. Both naturally bundle with the context menu, which already needed selection — pulling them apart would force a selection model with no other v1 consumer.

Out of scope for v1: variant arrays, insert-at-index, multi-select, context menu, bulk ops, copy/paste, move up/down, `minSize`/`maxSize` validation gating (spec carries `defaultElement` only so far).

### v2 — selection, commands, variant arrays, ordering, context menu

#### v2.1 — selection model + commands (shipped)

- Webview tracks a single-selected node and applies an always-visible `.selected` highlight to the focused row (both group headers and field rows). Selection survives re-render after add/remove/undo/redo.
- Host-side `BinaryEditorSelectionTracker` mirrors per-panel selection plus active-panel state, fed by webview `selectionChanged` messages and `onDidChangeViewState`.
- VSCode commands `bgforge.binaryEditor.addEntry` and `bgforge.binaryEditor.removeEntry` resolve the active context from the tracker and dispatch to `BinaryDocument.addEntity` / `removeEntity`. Both appear in the Command Palette under "Binary Editor", gated by a when-clause that scopes them to the binary editor view.

#### v2.2 — context menu

- Right-click context menu on tree nodes mirroring inline `+ Add entry` / `✕ Remove`, plus the v2.4 ordering actions once they land. Reuses the selection model.
- Keyboard equivalent (Shift+F10 / context-menu key) opens the same menu on the focused row.

#### v2.3 — variant picker + min/max validation

- Variant-picker component invoked when an array's spec declares `variants` (e.g., MAP object types: critter, exit-grid, generic). Used identically by inline `+`, context menu, and command. Surfaced via `vscode.window.showQuickPick`.
- `minSize` / `maxSize` enforcement from the array spec: refuse remove at minimum, refuse add at maximum, surface via the field-error channel.

#### v2.4 — ordering

- Insert-at-index: `Add before` / `Add after` on entry rows. Required for collections where slot index is identity (global var index referenced from scripts).
- Move up / move down on entry rows; structural pathway covers any cross-record offset adjustments.

#### v2.5 — MAP objects coverage

- Per-elevation, variant-shaped records including critter / exit-grid / inventory. Drives the variant-picker abstraction from v2.3 against a real format with multiple shapes.

#### v2.6 — script slots coverage

- Capacity-batched script extents. Shares the variant + ordering machinery; the byte-builder owns extent-capacity growth and `extentNext` linkage when a batch fills.

### v3 — bulk ops, multi-select, scripting

- Multi-select in tree state (range select, ctrl-click).
- Bulk ops surfaced in toolbar and context menu: delete selected, duplicate selected, move selected.
- Cross-file copy/paste of entries (clipboard carries spec-typed payload; paste validates against target array's spec).
- Scripted-operation hook for extensions: a stable API to enumerate addable arrays and run `EntityOperation`s programmatically. Enables modder workflows like "apply patcher to every CRE in a directory."
- Format coverage broadens to whatever IE/Fallout formats are wired up by then (`SAVE.DAT`, `GAM`, `CRE`, `ARE`, `TLK`, …). Each format opts in by annotating its `arraySpec`s — no UI changes required.
