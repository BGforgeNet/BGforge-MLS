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

#### v2.2 — context menu (shipped)

- Right-click on an addable group header or a removable entry opens the VSCode-native webview context menu via `data-vscode-context` + `contributes.menus.webview/context`. Items dispatch to the v2.1 commands; `Shift+F10` and the keyboard menu key open the same menu.

#### v2.4 — ordering (shipped)

- `buildInsertEntryBytes(parseResult, entryPath, position)` and `buildMoveEntryBytes(parseResult, entryPath, direction)` on the adapter. `BinaryDocument` exposes `insertEntityBefore` / `insertEntityAfter` / `moveEntityUp` / `moveEntityDown` (each one undo-able through the existing pipeline).
- VSCode commands `bgforge.binaryEditor.insertEntryBefore` / `insertEntryAfter` / `moveEntryUp` / `moveEntryDown`, all surfaced in the Command Palette and webview context menu (grouped separately from add/remove for readability).

### Out of scope: object-array and script-slot mutations

Add / remove / reorder is intentionally limited to **header-counted uniform-int32 arrays** (Global Variables, Local Variables). MAP object arrays and script-slot extents stay read-only at the structural level — fields inside individual already-decoded records remain editable through the field-edit pipeline; only the array length and ordering are locked.

The constraint is structural, not a missing feature. Two MAP regions cannot be deterministically encoded after a structural mutation:

**Object records (per-elevation `objects[]`).** Each record's wire layout depends on its PID type tag. For the Item, Scenery, Wall, and Tile types the parser stops at the data-header boundary because the rest of the record's payload is described by the corresponding `.pro` file. PROs are not packaged alongside `.map` files in the user mod trees this editor targets, so the parser cannot determine where each affected record ends. Once the parser stops mid-elevation, every byte from that point to EOF — including elev 1 / elev 2 in their entirety — is captured as a single opaque trailer (`objects-tail`). A structural mutation in the elev 0 prefix shifts that trailer by an unknown number of bytes per inserted record, and on reparse the trailer's bytes get interpreted at the wrong offsets; subsequent objects (and elev 1 / elev 2) silently realign to garbage. Without per-record byte widths, there is no encoding the canonical doc can produce that round-trips through a re-parse.

**Script extents.** Each extent carries 16 fixed slot positions regardless of its `count` field. The canonical doc keeps all 16 per extent so files round-trip byte-identically with no edits, but each slot's serialised width is selected by `getScriptType` on its sid byte, and the padding slots (`count..15`) carry whatever sid bits the engine had in scratch memory at the time of the original write. Replacing a padding slot with a real one only stays width-neutral when the padding's accidental sid happens to match the script type the caller wants; otherwise the extent grows or shrinks. The writer's opaque-range mechanism replays trailing ranges (`objects-tail`, `script-section-tail`) at their original parse-time offsets, so a downstream shift would clobber or under-fill the trailer. Supporting structural script mutations therefore requires both the width-matching logic and a writer refactor that anchors trailing opaque ranges at the structural-end offset rather than the original offset — the same refactor that would unblock object-array mutations for Misc / Critter / Exit-Grid records.

Files where the script section overflows on parse (a `count` field driving the parser past EOF, or a malformed SID padding byte forcing a wider read than remains) are still parseable for display: the parser anchors a `script-section-tail` opaque range from the failing extent's start through EOF and the writer replays it verbatim. The byte-identity round-trip is preserved; the file just isn't structurally mutable downstream of the anchor.

**What this rules out:**

- Object add/remove/reorder on any elevation.
- Variant picker + min/max validation (had only object arrays as a consumer).
- Script slot add/remove/reorder; extent capacity growth.
- A `variantArraySpec` primitive promotion (had only object arrays + script slots as candidate consumers; with both excluded, there are no consumers to constrain the design).

**What stays editable:**

- Field values on every decoded record — header fields, individual variable values, tile pair fields, fully-decoded object fields, fully-decoded script slot fields. Field edits are width-preserving and don't shift any opaque region.
- Globals / Locals: full add / remove / insert-before / insert-after / move-up / move-down. These arrays sit upstream of any opaque region in the file layout, so mutations on them can never invalidate a downstream opaque trailer's offset.

**Verification gate.** A byte-identity round-trip test (`binary/test/canonical-roundtrip.test.ts`) exercises every fixture: `parser.serialize(parser.parse(bytes))` must equal the original bytes. Any future change that breaks identity for a previously-passing fixture fails CI.

### v3 — bulk ops, multi-select, scripting

- Multi-select in tree state (range select, ctrl-click).
- Bulk ops surfaced in toolbar and context menu: delete selected, duplicate selected, move selected.
- Cross-file copy/paste of entries (clipboard carries spec-typed payload; paste validates against target array's spec).
- Scripted-operation hook for extensions: a stable API to enumerate addable arrays and run `EntityOperation`s programmatically. Enables modder workflows like "apply patcher to every CRE in a directory."
- Format coverage broadens to whatever IE/Fallout formats are wired up by then (`SAVE.DAT`, `GAM`, `CRE`, `ARE`, `TLK`, …). Each format opts in by annotating its `arraySpec`s — no UI changes required.
