# Binary Internals

See also: [README.md](README.md) (npm-facing, library and `fgbin` CLI usage) |
[docs/architecture.md](../docs/architecture.md) (system overview)

`@bgforge/binary` parses and serialises Fallout `.pro` / `.map` and Infinity Engine `.itm` / `.spl` (v1), `.eff` (v2),
`.cre` (v1), and `.dlg` (v1) files. Round-trips bytes <-> structured data <-> canonical JSON snapshots. Bundled `fgbin`
CLI uses the same code as the binary editor in the VSCode extension.

The IE `.itm` / `.spl` / `.eff` wire specs are generated from [IESDP](https://github.com/BGforgeNet/iesdp)'s
`_data/file_formats/` YAML by `scripts/ie-binary-update/`; effect-opcode lookups are generated from
`_opcodes/op<N>.html` frontmatter. Checked-in `.ts` outputs carry an `Auto-generated from IESDP ...` banner. Run
`scripts/ie-binary-update.sh` to refresh.

## Layered model

```
+----------------------------------------------------+
| Display tree (ParsedGroup) - editor + JSON snapshot|
| Canonical doc  (zod-validated)  - round-trip data  |
| Wire codec     (typed-binary)   - bytes <-> data   |
| Wire spec      (StructSpec)     - single source    |
+----------------------------------------------------+
```

One `StructSpec` per wire chunk drives every downstream artifact: typed-binary codec, zod canonical validator, display
walker, domain-range table. Hand-written downstream artifacts exist only where the canonical shape genuinely diverges
from the wire (e.g. MAP header `filename` is u8[16] on wire, `string` in canonical).

Two architectural splits:

- **Data layer vs presentation layer.** `FieldSpec` carries everything the data layer cares about (codec, enum/flags
  lookups, bit-packing layout, domain bounds, external references). `FieldPresentation` carries only display concerns
  (label override, unit, format hint). Same `enum`/`flags` table serves validation, codec output, and display.
- **Spec vs orchestrator.** The spec system describes one chunk of bytes. Orchestration - subtype dispatch, recursion,
  conditional presence, environmental safety (clamping malformed counts) - lives in each format's parser and canonical
  writer, not in spec primitives. See [Orchestrator vs spec](#orchestrator-vs-spec---what-stays-out-of-primitives).

## File layout

Directory level plus the modules other code is organised around. Each module's header describes it; read the
header before this list.

```
binary/src/
  index.ts                     # Public API surface; pinned by test/public-api.test.ts
  register-formats.ts          # Registers every parser and adapter, then installs setDomainRangeLookup
  registry.ts                  # parserRegistry (ext + family -> BinaryParser)
  format-adapter.ts            # BinaryFormatAdapter interface + formatAdapterRegistry
  types.ts                     # ParsedField, ParsedGroup, ParseResult, ParseOptions, ...
  layout-schema-types.ts       # Declarative editor layout: types + zod validator
  presentation-schema*.ts      # Presentation lookups (routed through the adapters) + their types
  binary-format-contract.ts    # Codec primitives and numeric-range helpers; cycle-free
  cross-ref-relationship.ts    # Declarative intra-file references (index refs, owner/slice partitions)
  json-snapshot*.ts            # Snapshot create/load/parse + sidecar path resolution
  max-file-sizes.ts            # Per-format size caps for parsing and snapshot expansion
  pid-resolver.ts, pro-resolver-loader.ts, parse-options.ts
                               # MAP pid -> subType resolution and the file-derived ParseOptions
  cli.ts                       # fgbin entry point

  spec/                        # Format-agnostic spec primitives, their derivations, and the shared
                               #   entry-mutation pipeline
  archive/                     # Installed IE game: KEY/BIF, TLK, IDS, 2DA, override resolution
  ie-common/                   # Shared IE pieces: the 48-byte effect spec, opcodes and their per-engine
                               #   readings, IE parse/serialize/snapshot factories, structure-op cores,
                               #   effect layout fragments
  pro/ map/ itm/ spl/ eff/ cre/ dlg/
                               # One directory per format, laid out alike: specs/, schemas.ts,
                               #   canonical-{schemas,reader,writer}.ts, format-adapter.ts, json-snapshot.ts,
                               #   index.ts (the parser), and where the format has them presentation-schema.ts,
                               #   layout-schema.ts, entity-ops.ts. DLG has a canonical writer but no reader,
                               #   presentation or layout; it adds build.ts.

  <format>/specs/<file>.overrides.ts
                               # Hand-written augmented spec per IE spec file. Imports the bare
                               # spec + format-specific lookups (ItmFlags / ItmType
                               # / SplFlags / etc.) and exports `<file>SpecAnnotated` with
                               # `enum:` / `flags:` / `ref:` attached. Parser walkStruct + zod
                               # canonical schemas import the annotated form.

binary/test/                   # Vitest unit tests; fixture paths resolve from test/repo-root.ts
```

## Spec primitives

### `FieldSpec`

```ts
type FieldSpec = ScalarFieldSpec | ArrayFieldSpec | CharsFieldSpec;
```

- **`ScalarFieldSpec`** - one number: a typed-binary `codec`, optionally narrowed by `domain`, named by `enum`
  (closed unless `enumOpen`) or `flags`, bit-packed via `packedAs` + `bitRange`, and tagged with a `role` (plus
  `derivedFrom`) when it is not plain user data.
- **`ArrayFieldSpec`** (`kind: "array"`) - scalar `element`s with a fixed or linked `count` (below), plus
  display and editing options for slot-shaped arrays.
- **`CharsFieldSpec`** (`kind: "chars"`) - N raw bytes surfaced as a `string` (below).

Any of the three can point outside the file (`ref`, `slotRef`, `flagsRef` - see External references) and carry
presentation-only members that never reach the codec. `binary/src/spec/types.ts` is the complete, documented
list of members.

### Three count variants

```ts
arraySpec({ element: { codec: i32 }, count: 44 }); // fixed
arraySpec({ element: { codec: i32 }, count: { fromField: "n" } }); // same-struct
arraySpec<H>({ element: { codec: i32 }, count: { fromCtx: (h: H) => h.numItems } }); // cross-struct
```

- **Fixed** - N elements always.
- **fromField** - N decoded earlier in the same struct. zod refinement enforces `array.length === doc.n` at save;
  `enforceDerivedFields(spec, doc, ctx)` is the pre-serialise sync helper that copies `doc.array.length` back into
  `doc.n`.
- **fromCtx** - N lives in another struct decoded earlier in the file (e.g. a header field driving a variable section's
  length). The orchestrator owns the binding and supplies the count through the read-time ctx; zod cannot refine across
  structs. The clamp/safety check belongs in the orchestrator too (e.g. `clampVarCount` in MAP's `parse-sections.ts`
  rejects malformed header counts before invoking the spec).

### Chars fields

Fixed-size ASCII string stored as N raw bytes on the wire. Covers IESDP `resref` (8 bytes) and `char array, length: N`
(signature, version, name fields).

```ts
charsSpec(8); // 8-byte resref
charsSpec(4); // 4-byte signature like 'ITM '
```

The spec primitive drives every artifact:

- **typed-binary**: read converts N bytes -> JS string verbatim (every byte = one Latin-1 char, including NULs); write
  encodes N bytes back, NUL-padding shorter values.
- **zod**: `z.string().max(N)` in canonical schemas; canonical doc has `string` at this field.
- **`SpecData<S>`**: chars fields project as `string`, not `number[]`.
- **walkStruct display**: trims trailing NULs so `"EFF\0\0\0\0\0"` renders as `"EFF"`. Interior NULs (rare; in
  IESDP-marked unused/garbage slots) are preserved verbatim so the display reflects the actual byte content.

Why all bytes (including NULs) round-trip through the canonical string: real-world IESDP-marked `unused` resref slots
ship with non-zero filler bytes past the first NUL; a NUL-trim-on-read approach loses those bytes and breaks byte-exact
round-trip. Preserve-all-on-the-wire is byte-perfect; cosmetic trimming happens only at display.

JSON-snapshot diff payoff: a resref change shows as a single line rather than one line per byte.

```diff
-  "replacement": "EFF_M01",
+  "replacement": "EFF_M02",
```

### Bit-packed fields

Multiple scalar entries share one wire codec read by tagging them with the same `packedAs` slot name and disjoint
`bitRange` slices. The canonical-doc shape stays flat - packed parts are peer scalar entries - so a 4-bit floor-flags
field reads as `floorFlags: number`, not as `tilePair.floor.flags`.

```ts
const tilePairSpec = {
  floorTileId: { codec: u32, packedAs: "tilePair", bitRange: [0, 12] },
  floorFlags: { codec: u32, packedAs: "tilePair", bitRange: [12, 4] },
  roofTileId: { codec: u32, packedAs: "tilePair", bitRange: [16, 12] },
  roofFlags: { codec: u32, packedAs: "tilePair", bitRange: [28, 4] },
};
```

Construction-time guards: contiguous declaration order, matching codec across parts, >=2 parts per slot, non-overlapping
ranges, fits within the wire codec's bit width. Gaps are allowed.

### `SpecData<S>`

Type-level projection. `SpecData<typeof spec>` projects per-field-kind: scalars as `number`, arrays as `number[]`, chars
as `string`. Use `type FooData = SpecData<typeof fooSpec>` to keep the data shape and the spec declarations in sync -
adding a field to the spec automatically adds it to the data type.

### External references

A field whose value points outside its file declares `ref: ExternalRef`; an array names its SLOTS with `slotRef`,
and a bitfield names its BITS with `flagsRef`. The union and every variant (`strref`, `ids` with `tables` /
`keyEncoding` / `symbolResource`, `2da`, `resource` with `byFlavour`, `colorGradient`, `deferred`) are documented
in `binary/src/spec/external-ref.ts`, which also says why the library never resolves one: resolution needs an
installed game, and stopping at the declaration keeps a parsed record and its JSON snapshot identical with or
without one. A consumer holding the game resolves it (`Game.ids()`, `Game.tlk()`; the binary editor's host does it
in `client/src/binary-editor/game-rows.ts`).

The declaration never changes storage, editing or the byte round-trip. ITM/SPL strrefs come from the generator
(IESDP's own `type: strref`); resource targets and IDS/2DA tables are hand-declared, in the `*.overrides.ts`
specs or the hand-written CRE spec. Rules for declaring one:

- **Declare on the spec; never key behaviour off description prose.** IESDP writes "(strref)" in some
  descriptions and not others, and documents one resref field differently across formats. The declaration is the
  only reliable signal. `binary/test/external-refs.test.ts` pins the declared set, including a row that carries
  both a value `ref` and a `slotRef` (a CRE sound slot) - a consumer applies both, never one or the other.
- **A field whose documentation names an IDS/2DA table declares it or records why not.** An IDS-backed field is a
  plain number with no shape to spot, so `binary/test/ids-table-declarations.test.ts` sweeps the specs'
  descriptions and requires a declaration or an entry in its exclusion map with a reason.
- **`tables` is an ordered candidate list; a resource `type` is not.** Which table names a value depends on what
  the install ships, so every present candidate contributes and order only decides who wins a key both name. What
  a resref points at follows from the record version and the game, so it is one `type` plus a `byFlavour`
  exception. Check the WIDTH before declaring a resource: a resref is `char[8]`, so a `char[2]` animation code or
  a `char[32]` script variable is not one.
- **A resref whose type another field selects is `deferred`, not bare**, so a completeness sweep can tell a
  decision from an omission (`EFFECT_RESOURCE_REF` in `binary/src/ie-common/types.ts`). Where a SIBLING field
  names the answer, the binary editor's relationship overlay computes the ref per record instead
  (`binary-editor/src/relationship/ie-effects.ts`) and must list that sibling in its `dependents`, or the value
  goes stale when the sibling is edited.
- **A vendored `enum` and an `ids` ref coexist.** The vendored table is the no-game fallback; with a game open
  the install's own table wins per value and the vendored one fills the gaps. Keep such fields `enumOpen`: the
  declaration adds names, never a closed value set.
- **Do not vendor a name table for a value space the install owns.** Vendor only the keys no shipped table can
  reach (`AbilityProjectileNone` in `binary/src/ie-common/types.ts` says which and why), and derive them from the
  declaration's own keying, so two fields naming one concept can need different tables.
- **A vendored table that mirrors an IDS carries the game's identifiers verbatim**, misspellings included, so a
  field reads the same with and without a game and shows what a script author types. Source it from a real
  install or IESDP's IDS listings; where no IDS names a value (an unset `0`), use a plain editor word so it does
  not pose as an identifier.
- **Check a table's key space against real stored values, and use `keyEncoding` where they differ.** Establish
  the encoding from a corpus, not from the vendored table, and prefer one that is a bijection over the field's
  width. The CRE `kit` declaration in `binary/src/cre/specs/header.overrides.ts` is the worked case.
- **A 2DA ref is keyed by row index, and not every 2DA names anything.** Check the file's rows and columns before
  declaring one. Where fields across formats share a table, declare the ref once as a shared constant
  (`SCHOOL_REF` / `SECTYPE_REF`).
- **An opcode number has no engine-neutral meaning.** `OpcodeReadings` holds one entry per engine reading;
  resolve with `opcodeReading(opcode, engine)` (`binary/src/ie-common/opcode-reading.ts`), never by indexing, so
  the editor cannot disagree with itself about which reading a record gets. Anything hand-transcribed per opcode
  records the reading it came from, and the generator refuses a curated entry that omits it for a multi-reading
  opcode.

## Derivation

```
                StructSpec
                    |
        +-----------+-----------+-----------+--------------+
        v           v           v           v              v
toTypedBinarySchema toZodSchema walkStruct  toDomainRanges toPresentationEntries
   (read/write)    (validate)  (display)   (clamp table)  (humanize labels)
```

- **`toTypedBinarySchema(spec): SpecCodec<Doc, Ctx>`** - typed-binary codec. `read(view, ctx?)` and
  `write(view, doc, ctx?)`. Pure-scalar specs without cross-struct deps default `Ctx = void`. Specs with `fromCtx`
  declare their ctx type and require it at call time. `SpecCodec` is a standalone interface (does NOT extend
  typed-binary's `ISchema<Doc>`) because typed-binary folds `ISchema<T>` through a `Parsed<T, Ctx>` simplification on
  `write` that defeats subtype refinement.
- **`toZodSchema(spec): z.ZodType<SpecData<S>>`** - canonical-doc validator. Scalar fields map to
  `z.number().int().min().max()` based on codec signedness, narrowed by `domain` and refined to enum keys when
  `spec.enum` is set (read-permissive / write-strict). Same-struct `fromField` arrays add a save-time refinement
  asserting `array.length === doc[countField]`. Cross-struct `fromCtx` arrays do not refine (the relation crosses struct
  boundaries; orchestrator's responsibility).
- **`walkStruct(spec, presentation, baseOffset, data, groupName, options?)`** - emits a `ParsedGroup` for the editor.
  Field labels come from `presentation.label` ?? `humanize(fieldName)`. `options.labelPrefix` prepends a per-iteration
  prefix (e.g. `"Entry 5"` for a script slot). `options.subGroups` rearranges output into nested groups. Array fields
  render as `"(N values)"` summary rows.
- **`walkGroup(group, spec, presentation): SpecData<S>`** - inverse of `walkStruct`. Used by canonical-readers to
  extract typed data from a display group. Looks up by display label (presentation override or humanized field name);
  prefers `rawValue` over `value` for enum/flags. Throws on array fields - caller iterates the array group structure
  manually.
- **`enforceDerivedFields(spec, doc, ctx?)`** - pre-serialise helper. Walks the spec and writes every field the spec
  derives - a linked `count` from `doc[arrayName].length`, and the offset/size roles the `ctx` supplies - into a copy of
  the doc. Returns a new object only when something changed; does not mutate. Use as the pre-write step in
  canonical-writer flows. `validateDerivedFields(spec, doc, ctx?)` is its read-side counterpart, returning the
  mismatches instead of correcting them.

## Orchestrator vs spec - what stays out of primitives

These are evaluated and intentionally kept in orchestrator code rather than lifted to new spec primitives. Each has
exactly one consumer in the current codebase, and lifting it would carry significant API surface for marginal payoff.
Document the trade-off rather than re-evaluate every time.

| Concern                                                                                            | Where it lives                                                                                          | Why not a primitive                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-element subtype dispatch (script slot variants by `getScriptType(sid)`)                        | `parse-sections.ts`, `canonical-writer.ts`                                                              | One consumer; variants share most layout; discriminator is a single peeked field; the orchestrator-side dispatch is ~10 lines                                                                                                                                        |
| Recursive specs (object inventory: each entry is a full nested object record)                      | `parse-objects.ts`, `canonical-writer.ts`                                                               | Self-referential `SpecData` projection is chicken-and-egg; orchestrator recursion is the cleanest expression                                                                                                                                                         |
| Struct-element arrays (tile elevations as `arraySpec({ element: tilePairSpec, count: 10000 })`)    | `parse-sections.ts` per-tile loop                                                                       | Sole consumer is tiles; scripts have variable-size elements, objects are recursive - neither would benefit                                                                                                                                                           |
| Conditional per-elevation tile presence (`header.flags & SkipElevationN`)                          | `parse-sections.ts`                                                                                     | Avoids a `presentIf` primitive whose audience is also one consumer                                                                                                                                                                                                   |
| Environmental safety (count clamp against remaining buffer for malformed inputs)                   | `clampVarCount` in `parse-sections.ts`                                                                  | Depends on remaining-bytes state the spec layer cannot see                                                                                                                                                                                                           |
| Per-format scaffolding (canonical reader/JSON snapshot/serializer wrappers for ITM, SPL, EFF, CRE) | factored via `ie-common/canonical-reader.ts` + `ie-common/json-snapshot.ts` + `ie-common/serializer.ts` | The bodies are identical across the four formats apart from the schema types and the format id, so each per-format file supplies only those. The format-id literal union (`IeFormatId`) caps drift: a fifth IE format widens the union rather than copying a wrapper |

## Architectural rules

These are non-negotiable across every format:

1. **Schema = data.** Where the wire is flat, canonical zod is flat. Aesthetic nesting is rejected; packed sub-fields
   are peer scalar entries (see Bit-packed fields).
2. **Presentation can nest** even when data is flat. The walker's `subGroups` option handles armor sub-categories,
   scenery layouts, etc., without warping the data shape.
3. **Read permissive, write strict.** Out-of-range enum values display as `Unknown (N)` and parse succeeds; saving
   rejects via the zod refinement when `spec.enum` is set. Real-world exception: MAP object base `rotation`/`elevation`
   carry packed-PID-shaped values in shipped files - the canonical zod stays plain int32 for those even though the wire
   spec documents enum tables.

   **Closed vs open enums.** The strict gate fits enums whose value space is fixed by the engine AND fully vendored (PRO
   `objectType`: Item/Critter/Scenery/Wall/Tile/Misc - adding a 7th would crash the engine). Set `enumOpen: true`
   wherever the vendored table is not the whole story - either the value space is genuinely extensible (ITM type,
   mod-extensible via `itemtype.2da`), the engine tolerates out-of-table values (ITM ability `damageType` /
   `projectileType`, SPL `type` and `castingGraphics`), or the table is narrower than the engines are. IE effect opcodes
   are the last case: the opcode set is FIXED - mods do not add opcodes - but a number's meaning is per-engine and the
   shipped readings do not cover every engine, so a strict gate would refuse to save a file that is legal in its own
   engine. The display lookup still resolves named values; the strict refinement does not enforce membership.
   Closed-default keeps PRO/MAP behaviour unchanged; opt-in keeps mod-friendly fields editable without producing false
   rejections at save time.

4. **No special-case sentinels.** Wire `0xFFFFFFFF` for "no script" reads naturally as `{type: -1, id: -1}` via signed
   `i8`/`i24` codecs. Don't add `if (value === 0xFFFFFFFF)` branches.

   The same pattern covers proto fields the engine seeds to `-1` when it initialises a proto: a vanilla proto that keeps
   the default saves the seed verbatim, so the wire arrives with `0xFFFFFFFF` and the per-object map record (or, rarely,
   a script-spawn caller) supplies the live value. Spec such a field with a signed codec (`i32`) and add `[-1]: "None"`
   (or a more specific sentinel label) to its enum table when one is attached - scenery `materialId` in
   `binary/src/pro/specs/scenery-common.ts` is one.

5. **Linked structures** follow the three count variants: the spec and zod own a same-struct link, the orchestrator owns
   a cross-struct one.
6. **Flat-array projection for flag fields.** A flag-word spec entry (`{codec, flags: Table}`) surfaces in canonical-doc
   as a flat sorted `string[]`, not as the raw int. Each entry is either a named slug (slugified-camelCase from the
   table's display string) or `bit<N>` (zero-based bit position) for set bits the table doesn't name. Canonical sort
   order: named slugs first alphabetically, then `bit<N>` in ascending bit position. Toggling one bit adds or removes
   one entry at its sorted position - same shape for named and unnamed bits, so diffs read uniformly. `compileFlagTable`
   slugifies display strings to camelCase canonical keys (`"NoBlock"` -> `noBlock`); `slugifyCodedName` rejects display
   strings whose slug would collide with the `bit<N>` sentinel namespace. `intToFlagArray` / `flagArrayToInt`
   (`binary/src/spec/coded-projection.ts`) translate at the wire codec boundary, the `FlagArraySchema` wrapper in
   `binary/src/spec/derive-typed-binary.ts`.

   Strict-disjoint invariant: a `bit<N>` entry whose position falls inside the named-mask is rejected at both the schema
   layer and the wire boundary - hand-edits must use the canonical slug for any spec-named bit. `bit<N>` with N >= codec
   width is also rejected at both layers, so synthesized entries cannot reference a bit past the wire word.

   Slugified identifiers (rather than the raw display strings) are the canonical token shape because the construction
   API (`docs/todo.md`) surfaces flags as TS members typed against a literal-name union - identifier-shaped names get
   the canonical dot-trigger autocomplete with per-flag JSDoc visible inline, which a quoted-display-string union does
   not. Schema validation messages and JSON Schema `items.enum` autocomplete also benefit from identifier tokens (no
   spacing/casing ambiguities like "No LOS required" vs "No los required"). The display string remains the parsed-tree
   label; the slug is the toolchain token, with one translation point (label <-> slug) at the projection boundary.

   This is a consistent application of rule #1 - `packedAs`+`bitRange` already exposes byte-packed sub-fields as peer
   scalar entries; the flat-array projection exposes bit-packed sub-fields the same way (the wire packs N independent
   semantic units into one int; canonical separates them into one entry per set bit).

7. **Lossless preservation of unnamed bits.** Adding a name to a flag table is a non-breaking spec evolution: old
   snapshots load via `bit<N>` entries, re-saving promotes the bit to its new slug. `schemaVersion` does NOT bump for
   additive name changes; bumping is reserved for _re-interpretive_ spec changes (a previously-parsed field's meaning
   changes), which require explicit migration code in the snapshot codec. The byte round-trip invariant
   `serialize(parse(b)) === b` is the load-bearing property - every existing `*-roundtrip.test.ts` enforces it.

8. **Enums and PIDs stay numeric in canonical-doc by design.** Where flag fields project to sorted-array name lists
   (rule #6), enum and PID fields stay as raw integers - the diff-friendliness gain doesn't justify the complication.
   Half the enum fields drive dispatch (`objectType`, `subType`, `scriptType`, MAP `version` / `rotation` / `elevation`)
   and would force a conversion at every dispatch site if projected to strings; the rest produce diffs of the same line
   count whether named or numeric (`5 -> 0` vs `"Items" -> "Background"`), unlike flags where the diff is fundamentally
   lossy. The display layer's `enum` table resolves names for editor dropdowns and hover; the snapshot stays close to
   the wire.

## JSON snapshots

Snapshots are canonical `schemaVersion: 1` documents, not raw `ParseResult` dumps:

- `ParseResult.root` - display tree (editor)
- `ParseResult.document` - canonical data (round-trip)
- Snapshots persist `document`; the display tree is reconstructed by re-parsing
- Every format has its own canonical schema (`<format>/canonical-schemas.ts`)
- Dump and load both validate against the schema, then round-trip bytes through the parser as a safety check
- `opaqueRanges` carry hex-chunked bytes for undecoded or intentionally-omitted regions (e.g. MAP tiles when the editor
  skips materialising them)
- Presentation lookups use stable semantic keys (`pro.header.objectType`,
  `map.objects.elevations[].objects[].base.pid`), not display-path strings

Sidecar paths preserve the original extension: `file.pro` -> `file.pro.json`, `file.map` -> `file.map.json`.

## Format adapters

`BinaryFormatAdapter` (in `format-adapter.ts`) is the single per-format extension point - every cross-cutting feature
that needs format-specific data reads it from the adapter, so adding a new format means writing _one_ adapter rather
than registering with N parallel module-level maps. The interface documents each member; in outline:

- **Snapshots**: `buildJsonSnapshot` / `createJsonSnapshot` / `loadJsonSnapshot` - build without serializing (for
  callers that only need to know it does not throw), create, load.
- **Canonical**: `rebuildCanonicalDocument` - reconstruct after tree edits.
- **Cache invalidation** (required): `documentCacheStrategy: "clear" | "none"` - whether the editor clears the cached
  canonical `document` after a display-tree edit. Required so a new format chooses consciously. DLG is the one `"none"`:
  its dialog editor mutates the document directly, so the document is authoritative.
- **Semantic keys**: `toSemanticFieldKey` - display-path -> semantic key for presentation lookup.
- **Editor presentation** (optional):
  - `presentationSchema` - `FormatPresentationSchema` with `exactFields` + `patternFields` (labels, enum/flag dropdowns,
    numeric format, editability, charset). Built in each format's own `<format>/presentation-schema.ts`. Read by
    `getFormatPresentationSchema` and `resolveFieldPresentation` in the top-level `presentation-schema.ts`.
  - `compiledPatternFields` - pre-compiled regex versions of `presentationSchema.patternFields`, computed once at module
    load via `compilePatternFields` (in `presentation-schema-types.ts`).
  - `domainRanges` - per-field numeric domain narrowing keyed by semantic key. Read by `getDomainRange` in
    `binary-format-contract.ts`, consumed by `validateNumericValue` / `clampNumericValue` / `zodFieldNumber`.
  - `layout` - the declarative editor layout (see below).
- **Cross-record references** (optional): `crossRefRelationships` - the index back-references and owner/slice partitions
  a format's records hold (`binary/src/cross-ref-relationship.ts`). The binary editor's cross-record diagnostics read
  them (`binary-editor/src/relationship/`); the byte-builders' relink does not, but binds the same field-name
  constants (`IeEffectRangeFields`), as that module's header explains. Declared by ITM, SPL and CRE.
- **Editor projection** (optional): `shouldHideField`, `shouldHideGroup`, `projectDisplayRoot` - hide tile bulk,
  redundant slots, etc.
- **Structure ops** (optional): `buildAddEntryBytes` / `buildRemoveEntryBytes` / `buildInsertEntryBytes` /
  `buildMoveEntryBytes` / `buildDuplicateEntryBytes` for a section entry, `buildAddChildEntryBytes` /
  `buildRemoveChildEntryBytes` for an entry owned by another entry, and `isRemovableEntry`. Implemented for MAP
  (global/local variables, per-elevation objects and each object's inventory), ITM and SPL (abilities, effects, an
  effect added to a specific ability), and CRE (known spells, spell-memorization entries, memorized spells, effects,
  items). PRO, EFF and DLG have no variable-length list the binary editor edits.
  - **Entries are addressed by section path + structural ordinal `index`, never by display label.** `arrayPath` is the
    section's tree path (e.g. `["Abilities"]`, `["Global Variables"]`, `["Elevation 0 Objects"]`); `index` is the
    entry's 0-based position among its siblings, resolved by the editor (`binary-editor`) from the target node's stable
    identity, so a presentation relabel / i18n / override cannot misaddress a byte op. Section-name routing inside a
    builder is fine - section names are structural identity, not per-entry display strings.
  - Which sections the editor offers to add to or modify is declared on the layout's `list` block (`canAdd` /
    `canModify`), not by the adapter.

### Declarative layout

`layout: FormatLayout` (`layout-schema-types.ts`, zod-validated) describes the editor UI as data - variants ->
optional tabs and subtabs -> rows -> panels -> blocks - referencing fields by semantic key. It is presentation
data attached to the adapter, sibling of `presentationSchema`, so the parser and codec carry no UI knowledge: each
parser emits faithful flat `walkStruct` groups and all grouping and placement lives in the layout. The binary
editor renders the variant whose id matches the parse result's `variantId`; absent a layout or a matching variant,
the webview shows the error banner. Every field-form format (`pro`, `map`, `itm`, `spl`, `eff`, `cre`) authors
one in `<format>/layout-schema.ts`, with a variant for every PRO object and subtype; DLG has none, since it renders
in the dialog editor. The block kinds, their components and the authoring conventions:
[docs/binary-editor-ui.md](../docs/binary-editor-ui.md).

### Structure-op cores (`ie-common/`)

Three shared cores produce the IE byte-builders; each format's `entity-ops.ts` injects its doc accessors, defaults, and
canonical serializer. What the first two assume about entry ordering, and the real-fixture evidence for it, is in the
headers of `ie-common/effect-partition.ts` (ITM/SPL) and `slice-structure-ops.ts` (CRE); `flat-list-ops.ts` makes none:

- **`structure-ops.ts`** - the in-order ability+effects core for ITM/SPL. Its ability ops relink via running-offset
  re-derivation, which is correct only while the effect partition is equipping-first and contiguous in owner order.
- **`slice-structure-ops.ts`** - the order-AGNOSTIC owner+slice core for CRE's spell-memorization partition
  (`spellMemInfo` entries owning `memorizedSpells` slices). Relinks surgically and never assumes owner order equals
  physical order, and validates with the relaxed partition (coverage + overlap + bounds, no ordering).
- **`flat-list-ops.ts`** - single flat array + optional relink hook. CRE binds it for known spells, effects
  (kind-preserving v1/v2), and items, whose hook `relinkItemSlots` remaps the item-slot back-references.

`ie-common/effect-partition.ts` underpins the first two: its header equipping range is optional and
`requireContiguousOrder` is tunable, so one body serves both the in-order ITM/SPL config and the orderless CRE
config. MAP has its own builders - variable sections in `binary/src/map/entity-ops.ts`, per-elevation objects and
their inventories in `binary/src/map/object-ops.ts` - because its writes also re-anchor the opaque ranges MAP
keeps; `flat-list-ops.ts` says why that concern stays out of the shared cores.

### Structure-op design decisions (intentional, by design)

- **Every structural mutation rebuilds bytes, then reparses the whole file.** A structure op builds new bytes via the
  adapter byte-builder, and `binary-editor` reparses them to rebuild the model (`binary-editor/src/structure-ops.ts`).
  This is `O(file)` per op but keeps the wire format the single source of truth - the post-op model is exactly what a
  fresh open of the resulting bytes would produce, so there is no separate "mutate the in-memory tree" path to keep
  consistent with the serializer. MAP's reparse skips materialising the tile bulk. Keep it; do not add an in-place
  tree-mutation fast path without a measured need.
- **The byte-builders live in `binary/` (this package), not in the editor.** Producing the inserted/removed/reordered
  bytes requires the format's codec and canonical writer, which live here. This is a deliberate, narrow widening of the
  parser layer's role ("the format package also knows how to mutate its own structure"), the same layer-spanning choice
  as the canonical readers. The editor stays format-agnostic: it resolves the structural target (section path + ordinal)
  and calls the adapter.
- **`BinaryFormatAdapter` intentionally carries presentation data beside data concerns.** `presentationSchema` and
  `layout` sit on the adapter next to the snapshot, canonical rebuild, domain ranges and byte-builders, so a format's
  whole definition is one object and there is no parallel per-format table in `binary-editor`. The split holds in the
  other direction: structure affordances are layout data, and the adapter keeps only the data-side `isRemovableEntry`
  check the builders validate against.

### Registration

`register-formats.ts` registers every parser on `parserRegistry` and every adapter on `formatAdapterRegistry`, then
installs the registry-backed domain-range lookup with `setDomainRangeLookup`. `index.ts` imports it for that side
effect; the header of `register-formats.ts` says why registration cannot live in `format-adapter.ts` and why the setter
keeps `binary-format-contract.ts` cycle-free. The binary editor consumes the adapter registry; CLI and library users
mostly use the snapshot helpers and the parser registry directly.

## Adding a new format

The format-adapter consolidates per-format data (presentation schema, domain ranges, snapshot helpers, semantic keys)
into one object - most of the wiring is local to the new format's directory. Touch-points outside `binary/src/<format>/`
are listed below as **shared touch-points** so a format addition stays grep-able as a checklist.

**In the new format's directory** (`binary/src/<format>/`):

1. **Wire spec(s).** `specs/*.ts` with `StructSpec` declarations and `SpecData<typeof spec>` types. IESDP-driven
   formats: add the source YAML path to `scripts/ie-binary-update/src/main.ts`'s `TARGETS` and run
   `scripts/ie-binary-update.sh`.
2. **Parser.** `index.ts` implements `BinaryParser` (`id`, `name`, `extensions`, `family`, `parse`, optional
   `serialize`). `family` is load-bearing, not metadata: the two game families collide on `.pro`, so a consumer that
   knows which game its file came from looks the parser up by extension AND family, and the VS Code client's IE resource
   browser derives which formats open in the binary editor from it. Tag a new parser correctly and it routes itself. Use
   `toTypedBinarySchema(spec)` for wire reads, `walkStruct(spec, presentation, ...)` for the display tree, and
   orchestrate any subtype dispatch / recursion in the parser itself.
3. **Canonical model.** `canonical-schemas.ts` (zod), `canonical-reader.ts`, `canonical-writer.ts`. Where the canonical
   shape matches the wire, derive zod via `toZodSchema(spec)`. Where it diverges (computed indices, discriminated
   unions), hand-write and document why. `canonical.ts` re-exports the document type and helpers.
4. **JSON snapshot.** `json-snapshot.ts` exports `createCanonical<Format>JsonSnapshot` /
   `loadCanonical<Format>JsonSnapshot`.
5. **Presentation schema.** `presentation-schema.ts` exports `<format>PresentationSchema`,
   `<format>CompiledPatternFields`, `<format>DomainRanges`. For most fields you can derive entries via
   `toPresentationEntries(spec, presentation, prefix)` over the augmented spec; hand-write `exactFields` /
   `patternFields` only where the spec annotation isn't expressive enough.
6. **Format adapter.** `format-adapter.ts` builds a `BinaryFormatAdapter` and attaches `presentationSchema`,
   `compiledPatternFields`, `domainRanges` from step 5 plus the snapshot helpers from step 4. Layout, editor projection,
   cross-record relationships and structure ops are optional; implement only what the format needs.

**Shared touch-points** (each must be updated together - they are cross-linked here so a search for any one surfaces the
rest):

| Touch-point                                                      | Why                                                                                                                                                                  |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `binary/src/index.ts` parser export                              | Public API exposes the parser.                                                                                                                                       |
| `binary/src/register-formats.ts` parser and adapter registration | Registers the parser and the adapter beside the existing formats. The domain-range lookup reads the adapter property, so domain ranges need no extra wiring.         |
| `binary/src/max-file-sizes.ts` entry                             | The CLI's size cap for the extension, and the snapshot writers' expansion bound. `binary/test/max-file-sizes.test.ts` fails on a registered extension with no entry. |
| `binary/src/types.ts` `BinaryCanonicalDocument` union            | TypeScript needs the literal union for narrowing on `ParseResult.document`. Add the new format's `<Format>CanonicalDocument` to the union.                           |
| `package.json` `customEditors` selector                          | VSCode reads this manifest at install time; extension patterns can't be runtime-driven. Add the new file extension(s).                                               |

**Tests.** Round-trip parse/serialise (real fixtures from `external/` if available), snapshot dump/load, CLI `--save` /
`--check` / `--load` (`binary/test/bin-cli.test.ts`), presentation-tree assertions for headline enum/flag fields, and
structural edits if the format has any. See `binary/test/{itm,spl,eff}-roundtrip.test.ts` and
`binary/test/itm-spl-presentation.test.ts` for templates.

## KEY/BIF archives (`src/archive/`)

Read an installed Infinity Engine game's resource namespace: `chitin.key` (the master index) plus the `.bif`
archives it points into, the override folders, and the lookup resources the editor resolves external references
against. This is groundwork for the TypeScript installer (which needs to see what a resref actually resolves to in
a real install), not an editor format - so it deliberately does NOT go through the `BinaryParser` /
`BinaryFormatAdapter` editor path. Formats: IESDP `key_v1.htm` / `bif_v1.htm`.

- **`byte-source.ts`** - `ByteSource` (`read(offset, length)` positioned reads). `bufferSource` (in-memory) and
  `fileSource` (fd-backed `fs.readSync`). The efficiency seam: a large plain BIF is read a resource at a time,
  never bulk-loaded.
- **`key.ts`** - `parseKey(bytes): KeyIndex`. Reads the BIF table (names normalized to `/`) and the resource
  table, unpacking each 32-bit locator into `bifIndex` (bits 31-20) / `tilesetIndex` (19-14) / `fileIndex`
  (13-0). `KeyIndex.lookup(resref, type?)` resolves case-insensitively.
- **`bif.ts`** - `openBif(source): BifArchive` / `parseBif(bytes)`. Detects the three on-disk shapes by
  signature: plain `BIFF` V1 (streamed - only the header + directory table + the requested resource bytes are
  read), and the two compressed wrappers `BIF ` V1 (whole zlib stream) and `BIFC` V1.0 (zlib blocks), which have
  no random access so they inflate fully once. `readFile(fileIndex)` / `readTileset(tilesetIndex)`.
- **`ids.ts`**, **`two-da.ts`**, **`text-resource.ts`** - the IDS and 2DA lookup tables, read from the install
  rather than vendored, and the shared decoding (including the encrypted form) both go through.
- **`game.ts`** - `openGame(dir, options?): Game` ties it together; the `Game` interface documents every method.
  At open it builds **one in-memory resolution tree** - `Map<resref\0type, {sources: Source[]}>`, each key's
  sources ordered by precedence (override folders high -> low, then the BIF locator at the bottom); the winner is
  `sources[0]`. `read` / `list` / `locate` consume the tree; `write` / `remove` mutate it in place; `rescan()`
  rebuilds its override layer from disk to pick up files another tool wrote or deleted. BIFs open lazily (cached)
  and read a resource at a time; `close()` releases the fds.

  **Resolution matches WeiDU** (the toolchain this emulates), verified against its behavior:
  - Override loose files win over BIFs (override paths are checked before the KEY index).
  - Among BIF duplicates, the **last** KEY entry wins. Near Infinity agrees; GemRB keeps the first, so it
    differs. `KeyIndex.lookupAll` exposes every duplicate in KEY order.
  - **Two override-search modes** via `OpenGameOptions.mode`: `"weidu"` (default) searches `<game>/override`
    alone - WeiDU's actual default (only `<game>/override`, with no extra override paths) - and is what the
    installer uses; `"engine"` searches the fuller engine stack from IESDP
    `appendices/override.htm` (movies, characters, portraits/portrait, sounds, scripts, override, plus
    `lang/<lang>/{movies,sounds}` when `lang` is set) and is what the viewer uses to resolve what the running
    game would. `engineOverrideFolders(lang?)` builds that stack; `overrideFolders` overrides mode entirely.
  - Filenames match case-insensitively (WeiDU matches resrefs and paths case-insensitively too).
  - **A biffed archive is searched across data roots, not just `<game>/`** - a KEY biff name like
    `data/cdcreani.bif` may live under a CD root (`<game>/data/data/cdcreani.bif`). `bifSearchRelRoots` combines
    `baldur.ini`'s `[Alias]` CD/HD0 mappings (reduced to paths relative to HD0, since their absolute Windows
    values don't transfer) with the standard `data`/`cache`/`CD1`..`CD6` roots, game root first; the biff name
    resolves against each, first hit wins (memoized). Some KEYs still list absent developer archives (e.g.
    `PROGTEST.BIF`); `canRead(resref, type)` reports whether the winning source is actually installed, so callers
    can flag or skip an unopenable resource instead of failing on read.

  **Mutation is atomic and rescan-free.** `write(resref, type, bytes, {folder})` writes the loose file via
  temp+rename (a crash never exposes a half-written resource), then splices a file source into the key's stack
  at that folder's precedence rank - a single consistent tree edit, so a later `read` returns the new bytes with
  no directory rescan. `remove` unlinks and drops the source; the winner falls back to what it shadowed (a lower
  folder or the BIF). Writes target `override` by default and must name a folder in the configured stack; BIF
  content is read-only. The tree is the source of truth after open, so files written outside this API are not
  seen until `rescan()` or a re-open. `writeAuxFile` / `readAuxFile` round-trip a non-resource loose file (e.g. a
  `<resref>.<ext>.json` snapshot sidecar) in `override` under an exact name; it is not indexed and the open scan
  skips it (its extension has no resType), so it never appears in `list()`. `looseFile(resref, type, {folder})`
  and `auxFile(fileName)` name the file each write would REPLACE, or `undefined` when it would create one - the
  same lookup `write` uses to pick its target, so a caller confirming a destructive overwrite reads the path
  that will actually be written, on-disk case included, rather than rebuilding the naming rule.

- **`tlk.ts`** - `openTlk(source, {encoding?})` / `parseTlk(bytes, {encoding?}): Tlk`, the `dialog.tlk` string
  table (IESDP `tlk_v1.htm`). Records reference strings by strref; `Tlk.get(strref)` resolves one to text
  (NUL-trimmed). A TLK is uniformly one encoding; the caller passes it (with no encoding, falls back to a
  UTF-8-then-windows-1252 guess). dialog.tlk holds hundreds of thousands of strings, so it reads the header once
  and does a positioned read per strref - never bulk-loaded. `openGame().tlk(variant?)` opens the game's TLK
  lazily - `"male"`/default `dialog.tlk` or `"female"` `dialogF.tlk`, under `lang/<lang>/` for EE games else the
  game root. The EE language folder is resolved WeiDU-style: an explicit `OpenGameOptions.lang` wins, else
  `weidu.conf`'s `lang_dir`, else the sorted-first `lang/<x>` that has a `dialog.tlk` - so the viewer resolves EE
  strings without knowing the language. **Encoding is chosen the way WeiDU distinguishes EE from classic**: EE
  iff the KEY holds a marker resource (`OH1000.ARE`/`OH6000.ARE`/`PSTCHAR.2DA`/`HOWPARTY.2DA`, probed via the KEY
  only) -> UTF-8; else classic -> windows-1252 by default, overridable via `OpenGameOptions.encoding` for
  non-Western installs (windows ANSI is not always cp1252 - Russian cp1251, Polish/Czech cp1250).
- **`game-type.ts`** - `detectGameIdentity(key): GameIdentity` (also `openGame().identity`): the game's
  type/edition, detected the way WeiDU does - probe the KEY for marker resources, last
  match wins, from a classic-BG1 default. `variant` is WeiDU's game_type (the EE edition or `generic`),
  `scriptStyle` its script style, `edition` drives the TLK encoding. `flavour` is the finer type WeiDU's
  `GAME_IS` tests, resolved by area markers - ToB (`AR6111`) vs SoA (`AR0083`), TotSC (`AR2003`) vs
  BG1, HoW/TotLM vs IWD - and drives `label` ("Baldur's Gate II: Throne of Bhaal") and `shortLabel` ("BG2: ToB").
  `refineGameFlavour(base, resExists, fileExists)` then upgrades the flavour for the conversions/expansions that
  only show against the LIVE game (override + loose files), per WeiDU and Near Infinity markers: EET
  (`override/eet.flag` or `data/eetTU00.bif`), SoD (BGEE + `movies/sodcin01.wbm`), BGT (BG2 + `AR7200.ARE` in
  override). `openGame` runs it against the resolution tree (KEY winners + override) and the game dir.
- **`resource-type.ts`** - resType code <-> extension table, transcribed from IESDP `general.htm`.

The library uses the spec-system codecs (`StructSpec` + `toTypedBinarySchema`) for the fixed structs, read at
their pointed-to offsets. Tests (`binary/test/archive.test.ts`) build byte-accurate synthetic fixtures - there
is no real `chitin.key`/BIF in `external/` (those are mod sources, not game installs).

## Testing

Run the package's tests with `pnpm test:project binary-lib [file filter]`; the CLI tests in
`binary/test/bin-cli.test.ts` need the built CLI and run with `pnpm test:cli`. Commands and the full gate:
[docs/development.md](../docs/development.md).

## Known feature gaps

- **MAP boundary ambiguity.** Some shipped maps have script/object section boundaries that aren't recoverable
  structurally. `--graceful-map` falls back to opaque-byte preservation; the editor stays strict by design (ambiguous
  bytes shouldn't propagate through normal workflows).
- **Maps with engine-unloadable object records.** A handful of shipped maps contain object-array records the engine
  itself cannot load - typically an inventory item with `pid=0` (no proto exists), or a parent record with `pid=-1`
  followed by inventory bytes the engine would refuse because no proto resolves. The parser is more lenient than the
  engine here: it bails at the bad record, marks the surrounding group `editingLocked: true`, and captures everything
  from that offset to EOF as the `objects-tail` opaque range so the file still round-trips byte-identically. No fix is
  appropriate - making the parser silently advance past records the engine refuses would lose the signal that the input
  is genuinely malformed. `client/testFixture/maps/newr2.map` is the canonical example fixture;
  `binary/test/map-decode-vanilla.test.ts` pins the behavior so a future change that quietly hides the corruption
  surfaces as a regression.
- **No cross-record consistency check for MAP, by design.** The CRE/ITM/SPL cross-record diagnostics have no MAP
  analogue, because none of MAP's candidate relations is validatable: an object's `scriptIndex` is an engine runtime
  value, not a position in the script table; an object `sid` with no matching script slot is routine, since the engine
  drops the unresolved sid at load and objects can take scripts from their proto; and an orphan script is undecidable,
  since spatial and timer scripts legitimately have no owner. The `sid` / `scriptIndex` field comments in
  `binary/src/map/specs/object.ts` carry the evidence. Do not add a MAP cross-record check.
