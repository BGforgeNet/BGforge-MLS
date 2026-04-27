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

#### v2.3 — variant picker + min/max validation (deferred)

To ship together with v2.5 since MAP objects are the natural consumer for variants and the only place an immediate min/max bound applies (per-elevation max, total-objects bound).

- Variant-picker UI: `vscode.window.showQuickPick` listing variants from the format's variants registry. Used identically by inline `+`, context menu, and command.
- `minSize` / `maxSize` enforcement from the array spec: refuse remove at minimum, refuse add at maximum, surface via the field-error channel.

#### v2.5 — MAP objects coverage

- Per-elevation, variant-shaped records (Misc, Critter, Item, Scenery, Wall, Tile, Exit Grid). Each variant has its own default skeleton.

##### Skeleton-construction rule

Default skeletons are **null-byte-padded across the board** — every numeric field starts at `0`. Override only where the format's structure forces a non-zero value, namely:

- **Type-discriminator bits the parser uses to recognise the variant.** For MAP objects the PID's upper byte encodes the type tag (`pid >> 24`); each variant's skeleton must set those bits so the round-trip reparse keeps the variant identity. Other fields the parser doesn't read for type discrimination (frame, fid, coordinates, flags, light, sid, etc.) stay zero.
- **Presence/absence of optional sub-records** controlled by the variant: `critterData` only for critters, `exitGrid` only for exit-grid misc objects, `objectData` where the type carries it. Where the sub-record is _present_, its fields default to zero.
- **Linked counts and capacities the writer depends on** (e.g. an empty inventory needs `inventoryLength: 0` and `inventoryCapacity: 0`, not arbitrary numbers).

Anything else — sensible defaults for in-game rendering, "interesting" starting values — is out of scope. The user is expected to fill in real values after insertion through the existing field editors. The guarantee is: the skeleton serialises, reparses cleanly, and identifies as the requested variant. Nothing more.

- Recursive inventory entries: objects carry inventories of `{quantity, object}` pairs. "+ Add inventory item" reuses the same variant-picker pathway against the inventory's nested object.

##### Where variants live (Option B for v2.5)

The current `arraySpec` primitive describes a uniform array of one scalar element type — globals/locals/tile fields use it directly. MAP objects don't fit that shape: object records are variable-size and self-recursive, and the per-elevation objects array isn't an `arraySpec` today. The spec migration history moved fixed object _chunks_ (`objectBaseSpec`, `inventoryHeaderSpec`, `critterDataSpec`, `exitGridSpec`) into spec form; the array layer stayed in the orchestrator (`parse-objects.ts`).

For v2.5, variants live in a sibling **variants registry** module under `specs/` rather than inside `arraySpec`:

```text
binary/src/map/specs/object-variants.ts
  export const objectVariants = [
    { id, label, pidTypeBits, defaultElement: () => MapCanonicalObject },
    ...
  ] as const;
```

Format adapter + entity-ops import the registry the same way they import `varSectionSpec` today. The format still owns its truth — the registry lives in `specs/`, alongside the wire-chunk specs — it's just not threaded through the existing `arraySpec` primitive.

Carrying the wider design rule forward: for any addable array, the format's `specs/` directory is the single source of truth. Two encodings are permitted: (a) capability metadata on `arraySpec` for uniform arrays (already shipped), (b) a sibling registry module for variant or otherwise non-uniform arrays (introduced in v2.5).

#### v2.6 — script slots coverage

- Capacity-batched script extents. Shares the variant + ordering machinery; the byte-builder owns extent-capacity growth and `extentNext` linkage when a batch fills.

##### Spec-system promotion (Option A) — follow-up after v2.6

Once v2.5 (MAP objects) and v2.6 (script slots) both ship with sibling variant registries, the spec system gets a second concrete consumer that constrains the design. Promote the registry idiom into a first-class `variantArraySpec` primitive:

```text
variantArraySpec({
  discriminator,           // field that selects the variant on read
  variants: [{ id, label, struct, defaultElement }, ...],
})
```

This drives typed-binary read/write through the discriminator, derived zod with discriminated unions, derived presentation, and derived domain ranges — all variant-aware. Migration is mechanical: each `*-variants.ts` registry moves into the matching `arraySpec(...)` call and consumers shift one import.

Don't do this before v2.6 lands: with only one consumer (objects), the primitive risks being shaped for that one case and bent on the second. Two consumers in hand is the right time.

### v3 — bulk ops, multi-select, scripting

- Multi-select in tree state (range select, ctrl-click).
- Bulk ops surfaced in toolbar and context menu: delete selected, duplicate selected, move selected.
- Cross-file copy/paste of entries (clipboard carries spec-typed payload; paste validates against target array's spec).
- Scripted-operation hook for extensions: a stable API to enumerate addable arrays and run `EntityOperation`s programmatically. Enables modder workflows like "apply patcher to every CRE in a directory."
- Format coverage broadens to whatever IE/Fallout formats are wired up by then (`SAVE.DAT`, `GAM`, `CRE`, `ARE`, `TLK`, …). Each format opts in by annotating its `arraySpec`s — no UI changes required.
