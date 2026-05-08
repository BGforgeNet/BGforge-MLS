# Binary Internals

See also: [README.md](README.md) (npm-facing) | [docs/architecture.md](../docs/architecture.md) (system overview)

`@bgforge/binary` parses and serialises Fallout `.pro` / `.map` and Infinity Engine `.itm` / `.spl` (v1) and `.eff` (v2) files. Round-trips bytes <-> structured data <-> canonical JSON snapshots. Bundled `fgbin` CLI uses the same code as the binary editor in the VSCode extension.

The IE `.itm` / `.spl` / `.eff` wire specs are generated from [IESDP](https://github.com/BGforgeNet/iesdp)'s `_data/file_formats/` YAML by `scripts/ie-binary-update/`; effect-opcode lookups are generated from `_opcodes/op<N>.html` frontmatter (250+ entries). Checked-in `.ts` outputs carry an `Auto-generated from IESDP ...` banner. Run `scripts/ie-binary-update.sh` to refresh.

## Layered model

```
+----------------------------------------------------+
| Display tree (ParsedGroup) - editor + JSON snapshot|
| Canonical doc  (zod-validated)  - round-trip data  |
| Wire codec     (typed-binary)   - bytes <-> data     |
| Wire spec      (StructSpec)     - single source    |
+----------------------------------------------------+
```

One `StructSpec` per wire chunk drives every downstream artifact: typed-binary codec, zod canonical validator, display walker, domain-range table. Hand-written downstream artifacts exist only where the canonical shape genuinely diverges from the wire (e.g. MAP header `filename` is u8[16] on wire, `string` in canonical).

Two architectural splits:

- **Data layer vs presentation layer.** `FieldSpec` carries everything the data layer cares about (codec, enum/flags lookups, bit-packing layout, domain bounds). `FieldPresentation` carries only display concerns (label override, unit, format hint). Same `enum`/`flags` table serves validation, codec output, and display.
- **Spec vs orchestrator.** The spec system describes one chunk of bytes. Orchestration - subtype dispatch, recursion, conditional presence, environmental safety (clamping malformed counts) - lives in `parse-sections.ts` / `parse-objects.ts` / `canonical-writer.ts`, not in spec primitives.

## File layout

```
binary/src/
  index.ts                     # Public API surface; pinned by public-api.test.ts
  cli.ts                       # fgbin entry point
  registry.ts                  # parserRegistry (ext -> BinaryParser)
  format-adapter.ts            # BinaryFormatAdapter interface + registry; eager bottom-imports
                               #   register every per-format adapter and wire setDomainRangeLookup
  json-snapshot.ts             # Schema-versioned snapshot create/load/parse
  json-snapshot-path.ts        # Sidecar path resolution (.pro.json / .map.json)
  presentation-schema.ts       # Lookup functions (resolveFieldPresentation, getFormatPresentationSchema)
                               #   that route through formatAdapterRegistry; per-format schema CONTENT
                               #   lives in <format>/presentation-schema.ts.
  presentation-schema-types.ts # Type definitions + zod parsers + compilePatternFields helper.
                               #   Type-only consumer for format-adapter.ts (cycle-free).
  display-lookups.ts           # Resolve enum/flag display <-> raw values via resolveFieldPresentation
  binary-format-contract.ts    # Codec primitives (zodNumericType) + value helpers
                               #   (validateNumericValue, clampNumericValue, zodFieldNumber,
                               #   getDomainRange) with a setDomainRangeLookup setter installed
                               #   by format-adapter.ts after registrations. Cycle-free.
  shared-schemas.ts            # opaqueRangeSchema
  schema-validation.ts         # parseWithSchemaValidation wrapper
  opaque-range.ts              # Hex-chunk encoding for undecoded byte spans
  parsed-tree-codec.ts         # Display-tree dump/load helpers
  flags.ts                     # isFlagActive
  types.ts                     # ParsedField, ParsedGroup, ParseResult, ...

  spec/                        # Spec-system primitives (format-agnostic)
    types.ts                   # FieldSpec, StructSpec, SpecData, arraySpec, enforceLinkedCounts
    codec-meta.ts              # codecByteLength, codecNumericTypeName
    derive-typed-binary.ts     # toTypedBinarySchema -> SpecCodec<Doc, Ctx>
    derive-zod.ts              # toZodSchema (canonical validator from spec)
    walk-display.ts            # walkStruct (data -> ParsedGroup), walkGroup (inverse)
    derive-domain-ranges.ts    # SpecDomainRanges (per-key min/max)
    derive-presentation.ts     # Presentation-table helpers
    presentation.ts            # FieldPresentation, StructPresentation, humanize()

  pro/                         # Fallout PRO format
    schemas.ts                 # Wire helpers (parseHeader, parsers per subtype)
    specs/*.ts                 # Per-subtype StructSpec (header, armor, weapon, ...)
    canonical-schemas.ts       # zod canonical document schema
    canonical-reader.ts        # ParsedGroup -> canonical doc
    canonical-writer.ts        # canonical doc -> bytes
    canonical.ts               # Barrel re-exports
    format-adapter.ts          # BinaryFormatAdapter for PRO
    presentation-schema.ts     # proPresentationSchema + proCompiledPatternFields + proDomainRanges
    json-snapshot.ts           # PRO-specific snapshot adapter
    serializer.ts              # Top-level serialise(parseResult)
    transition.ts              # Subtype-change structural edit handler
    index.ts                   # proParser
    types.ts                   # PRO enums/flags

  map/                         # Fallout MAP format
    schemas.ts                 # parseHeader, parseTilePair, getScriptType, codec exports
    specs/*.ts                 # Per-section StructSpec (header, tile-pair, variables,
                               #   script-slot variants, object record chunks)
    parse-sections.ts          # Header section, variables, tiles, scripts orchestration
    parse-objects.ts           # Object record orchestration (recursive inventory)
    parse-helpers.ts           # field()/makeGroup()/flagsField()/enumField() builders
    parse-scoring.ts           # Boundary heuristic for graceful-map mode
    canonical-schemas.ts       # zod canonical document schema (some derived, some hand-written)
    canonical-reader.ts        # ParsedGroup -> canonical doc (walkGroup-driven)
    canonical-writer.ts        # canonical doc -> bytes (spec.write-driven)
    format-adapter.ts          # BinaryFormatAdapter for MAP
    presentation-schema.ts     # mapPresentationSchema + mapCompiledPatternFields + mapDomainRanges
    json-snapshot.ts           # MAP-specific snapshot adapter
    serializer.ts              # Top-level serialise(parseResult)
    index.ts                   # mapParser
    types.ts                   # MAP enums/flags

  itm/                         # Infinity Engine ITM v1 (items)
    specs/header.ts            # Generated from IESDP itm_v1/header.yml
    specs/ability.ts           # Generated from IESDP itm_v1/extended_header.yml
    presentation-schema.ts     # itmPresentationSchema (derived via toPresentationEntries from
                               #   *SpecAnnotated) + itmCompiledPatternFields
    schemas.ts, canonical-{schemas,reader,writer}.ts, canonical.ts,
    format-adapter.ts, json-snapshot.ts, serializer.ts, index.ts, types.ts

  spl/                         # Infinity Engine SPL v1 (spells)
    specs/header.ts            # Generated from IESDP spl_v1/header.yml
    specs/ability.ts           # Generated from IESDP spl_v1/extended_header.yml (40 bytes,
                               #   distinct shape from ITM ability)
    presentation-schema.ts     # splPresentationSchema (derived) + compiled patterns + domainRanges
    schemas.ts, canonical-{schemas,reader,writer}.ts, canonical.ts,
    format-adapter.ts, json-snapshot.ts, serializer.ts, index.ts, types.ts

  eff/                         # Infinity Engine EFF v2 (sub-effects)
    specs/header.ts            # Generated from IESDP eff_v2/header.yml (8 bytes: sig + version)
    specs/body.ts              # Generated from IESDP eff_v2/body.yml (264 bytes)
    presentation-schema.ts     # effPresentationSchema (derived) + compiled patterns + domainRanges
    schemas.ts, canonical-{schemas,reader,writer}.ts, canonical.ts,
    format-adapter.ts, json-snapshot.ts, serializer.ts, index.ts, types.ts

  ie-common/                   # Shared IE bits (effect spec + opcodes + lookups)
    types.ts                   # EFFECT_SIZE, bytesEqual, EffectTarget/Timing/Resistance/SaveType,
                               #   AbilityTargetType, AbilityIdRequiredFlags
    opcodes.ts                 # Generated from IESDP _opcodes/opNNN.html (250+ entries)
    specs/effect.ts            # Generated from IESDP itm_v1/feature_block.yml (shared with SPL)
    specs/effect.overrides.ts  # Hand-written: attaches Opcodes / EffectTarget / EffectTiming /
                               #   EffectResistanceFlags / EffectSaveTypeFlags to effectSpec

  <format>/specs/<file>.overrides.ts
                               # Hand-written augmented spec per file. Imports the bare
                               # generated spec + format-specific lookups (ItmFlags / ItmType
                               # / SplFlags / etc.) and exports `<file>SpecAnnotated` with
                               # `enum:` / `flags:` attached. Parser walkStruct + zod
                               # canonical schemas import the annotated form; the bare
                               # generated spec is only re-exported as a stable identifier.

binary/test/                   # Vitest unit tests, repo-root cwd for fixture paths
```

## Spec primitives

### `FieldSpec`

```ts
type FieldSpec = ScalarFieldSpec | ArrayFieldSpec | CharsFieldSpec;

interface ScalarFieldSpec {
    codec: ISchema<number>; // typed-binary codec (i8/u8/i16/...)
    domain?: { min; max }; // tighter than codec range
    enum?: Record<number, string>; // value -> display name
    enumOpen?: boolean; // enum is advisory (display only); strict mode does not enforce membership
    flags?: Record<number, string>; // bit -> display name
    packedAs?: string; // bit-packed slot name
    bitRange?: [bitOffset, bitWidth]; // required when packedAs is set
}

interface CharsFieldSpec {
    kind: "chars";
    count: number; // fixed N raw bytes, surfaced as `string`
}

interface ArrayFieldSpec {
    kind: "array";
    element: ScalarFieldSpec;
    count:
        | number // fixed
        | { fromField: string } // same-struct sibling
        | { fromCtx: (ctx) => number }; // cross-struct, supplied at read
}
```

### Three count variants

```ts
arraySpec({ element: { codec: i32 }, count: 44 }); // fixed
arraySpec({ element: { codec: i32 }, count: { fromField: "n" } }); // same-struct
arraySpec<H>({ element: { codec: i32 }, count: { fromCtx: (h: H) => h.numItems } }); // cross-struct
```

- **Fixed** - N elements always.
- **fromField** - N decoded earlier in the same struct. zod refinement enforces `array.length === doc.n` at save; `enforceLinkedCounts(spec, doc)` is the pre-serialise sync helper that copies `doc.array.length` back into `doc.n`.
- **fromCtx** - N lives in another struct decoded earlier in the file (e.g. a header field driving a variable section's length). The orchestrator owns the binding; zod cannot refine across structs. The clamp/safety check belongs in the orchestrator (e.g. `clampVarCount` in `parse-sections.ts` rejects malformed header counts before invoking the spec).

### Chars fields

Fixed-size ASCII string stored as N raw bytes on the wire. Covers IESDP `resref` (8 bytes) and `char array, length: N` (signature, version, name fields).

```ts
charsSpec(8); // 8-byte resref
charsSpec(4); // 4-byte signature like 'ITM '
```

The spec primitive drives every artifact:

- **typed-binary**: read converts N bytes -> JS string verbatim (every byte = one Latin-1 char, including NULs); write encodes N bytes back, NUL-padding shorter values.
- **zod**: `z.string().max(N)` in canonical schemas; canonical doc has `string` at this field.
- **`SpecData<S>`**: chars fields project as `string`, not `number[]`.
- **walkStruct display**: trims trailing NULs so `"EFF\0\0\0\0\0"` renders as `"EFF"`. Interior NULs (rare; in IESDP-marked unused/garbage slots) are preserved verbatim so the display reflects the actual byte content.

Why all bytes (including NULs) round-trip through the canonical string: real-world IESDP-marked `unused` resref slots ship with non-zero filler bytes past the first NUL; a NUL-trim-on-read approach loses those bytes and breaks byte-exact round-trip. Preserve-all-on-the-wire is byte-perfect; cosmetic trimming happens only at display.

JSON-snapshot diff payoff: a resref change shows as a single line.

```diff
-  "replacement": "EFF_M01",
+  "replacement": "EFF_M02",
```

vs the u8[8]-array shape it replaced, which scattered an 8-byte name change across 8 separate JSON lines.

### Bit-packed fields

Multiple scalar entries share one wire codec read by tagging them with the same `packedAs` slot name and disjoint `bitRange` slices. The canonical-doc shape stays flat - packed parts are peer scalar entries - so a 4-bit floor-flags field reads as `floorFlags: number`, not as `tilePair.floor.flags`.

```ts
const tilePairSpec = {
    floorTileId: { codec: u32, packedAs: "tilePair", bitRange: [0, 12] },
    floorFlags: { codec: u32, packedAs: "tilePair", bitRange: [12, 4] },
    roofTileId: { codec: u32, packedAs: "tilePair", bitRange: [16, 12] },
    roofFlags: { codec: u32, packedAs: "tilePair", bitRange: [28, 4] },
};
```

Construction-time guards: contiguous declaration order, matching codec across parts, ≥2 parts per slot, non-overlapping ranges, fits within the wire codec's bit width. Gaps are allowed.

### `SpecData<S>`

Type-level projection. `SpecData<typeof spec>` projects per-field-kind: scalars as `number`, arrays as `number[]`, chars as `string`. Use `type FooData = SpecData<typeof fooSpec>` to keep the data shape and the spec declarations in sync - adding a field to the spec automatically adds it to the data type.

## Derivation

```
                StructSpec
                    |
        +-----------+-----------+-----------+--------------+
        v           v           v           v              v
toTypedBinarySchema toZodSchema walkStruct  derive-domain  derive-presentation
   (read/write)    (validate)  (display)   (clamp table)  (humanize labels)
```

- **`toTypedBinarySchema(spec): SpecCodec<Doc, Ctx>`** - typed-binary codec. `read(view, ctx?)` and `write(view, doc, ctx?)`. Pure-scalar specs without cross-struct deps default `Ctx = void`. Specs with `fromCtx` declare their ctx type and require it at call time. `SpecCodec` is a standalone interface (does NOT extend typed-binary's `ISchema<Doc>`) because typed-binary folds `ISchema<T>` through a `Parsed<T, Ctx>` simplification on `write` that defeats subtype refinement.
- **`toZodSchema(spec): z.ZodType<SpecData<S>>`** - canonical-doc validator. Scalar fields map to `z.number().int().min().max()` based on codec signedness, narrowed by `domain` and refined to enum keys when `spec.enum` is set (read-permissive / write-strict). Same-struct `fromField` arrays add a save-time refinement asserting `array.length === doc[countField]`. Cross-struct `fromCtx` arrays do not refine (the relation crosses struct boundaries; orchestrator's responsibility).
- **`walkStruct(spec, presentation, baseOffset, data, groupName, options?)`** - emits a `ParsedGroup` for the editor. Field labels come from `presentation.label` ?? `humanize(fieldName)`. `options.labelPrefix` prepends a per-iteration prefix (e.g. `"Entry 5"` for a script slot). `options.subGroups` rearranges output into nested groups. Array fields render as `"(N values)"` summary rows.
- **`walkGroup(group, spec, presentation): SpecData<S>`** - inverse of `walkStruct`. Used by canonical-readers to extract typed data from a display group. Looks up by display label (presentation override or humanized field name); prefers `rawValue` over `value` for enum/flags. Throws on array fields - caller iterates the array group structure manually.
- **`enforceLinkedCounts(spec, doc)`** - pre-serialise helper. Walks the spec, copies `doc[arrayName].length` into the linked `count` field. Returns a new object; does not mutate. Use as the pre-write step in canonical-writer flows that have linked counts.

## Public API

`binary/src/index.ts` is the package's public surface, pinned by `public-api.test.ts`:

| Export                                                                                                                                             | Purpose                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `parserRegistry`, `BinaryParser`, `ParseOptions`, `ParseResult`, `ParsedField`, `ParsedFieldType`, `ParsedGroup`, `ParseOpaqueRange`               | Core registry + types                                                    |
| `proParser`, `mapParser`                                                                                                                           | Concrete parsers (auto-registered as a side effect of importing `index`) |
| `createBinaryJsonSnapshot`, `parseBinaryJsonSnapshot`, `loadBinaryJsonSnapshot`                                                                    | Canonical schemaVersion:1 snapshot create/parse/load                     |
| `getSnapshotPath`, `getOutputPathForJsonSnapshot`                                                                                                  | Sidecar path resolution                                                  |
| `formatAdapterRegistry`, `BinaryFormatAdapter`, `ProjectedEntry`                                                                                   | Editor-facing format metadata                                            |
| `createFieldKey`, `toSemanticFieldKey`, `createSemanticFieldKeyFromId`, `resolveFieldPresentation`                                                 | Stable semantic field-key system                                         |
| `resolveDisplayValue`, `resolveEnumLookup`, `resolveFlagLookup`, `formatEnumDisplayValue`, `resolveRawValueFromDisplay`, `resolveStoredFieldValue` | Display <-> raw value conversions                                        |
| `validateNumericValue`                                                                                                                             | Type-aware numeric clamp                                                 |
| `isFlagActive`                                                                                                                                     | Bit predicate                                                            |

Internal modules (spec primitives, format-specific specs, parse helpers) are NOT exported - they're only consumed inside the package.

## JSON snapshots

Snapshots are canonical `schemaVersion: 1` documents, not raw `ParseResult` dumps:

- `ParseResult.root` - display tree (editor)
- `ParseResult.document` - canonical data (round-trip)
- Snapshots persist `document`; the display tree is reconstructed by re-parsing
- Both PRO and MAP have format-specific canonical schemas (`canonical-schemas.ts`)
- Dump and load both validate against the schema, then round-trip bytes through the parser as a safety check
- `opaqueRanges` carry hex-chunked bytes for undecoded or intentionally-omitted regions (e.g. MAP tiles when the editor skips materialising them)
- Presentation lookups use stable semantic keys (`pro.header.objectType`, `map.objects.elevations[].objects[].base.pid`), not display-path strings

Sidecar paths preserve the original extension: `file.pro` -> `file.pro.json`, `file.map` -> `file.map.json`.

## Format adapters

`BinaryFormatAdapter` (in `format-adapter.ts`) is the single per-format extension point - every cross-cutting feature that needs format-specific data reads it from the adapter, so adding a new format means writing _one_ adapter rather than registering with N parallel module-level maps.

Adapter responsibilities:

- **Snapshots**: `createJsonSnapshot` / `loadJsonSnapshot` - canonical snapshot create/load.
- **Canonical**: `rebuildCanonicalDocument` - reconstruct after tree edits.
- **Semantic keys**: `toSemanticFieldKey` - display-path -> semantic key for presentation lookup.
- **Editor presentation** (consolidated registries):
    - `presentationSchema` - `FormatPresentationSchema` with `exactFields` + `patternFields` (labels, enum/flag dropdowns, numeric format, editability, charset). Built in each format's own `<format>/presentation-schema.ts`. Read by `getFormatPresentationSchema` and `resolveFieldPresentation` in the top-level `presentation-schema.ts`.
    - `compiledPatternFields` - pre-compiled regex versions of `presentationSchema.patternFields`, computed once at module load via `compilePatternFields` (in `presentation-schema-types.ts`).
    - `domainRanges` - per-field numeric domain narrowing keyed by semantic key. Read by `getDomainRange` in `binary-format-contract.ts`, consumed by `validateNumericValue` / `clampNumericValue` / `zodFieldNumber`.
- **Editor projection** (optional): `shouldHideField`, `shouldHideGroup`, `projectDisplayRoot` - hide tile bulk, redundant slots, etc.
- **Structural edits** (optional): `isStructuralFieldId`, `buildStructuralTransitionBytes` - layout-changing edits (PRO subtype change).
- **Variable-length array editing** (optional): `buildAddEntryBytes` / `buildRemoveEntryBytes` / `buildInsertEntryBytes` / `buildMoveEntryBytes` / `isAddableArray` / `isRemovableEntry` - entity ops (MAP global vars, scripts).

Adapters are registered eagerly at the bottom of `format-adapter.ts`. The binary editor consumes the adapter registry; CLI / library users mostly interact with snapshot helpers and the parser registry directly.

**Cycle break for the registry-driven domain-range lookup.** `binary-format-contract.ts` exports `setDomainRangeLookup`, which `format-adapter.ts` calls once after registering every adapter. The setter pattern keeps `binary-format-contract.ts` cycle-free so `derive-zod` and per-format `canonical-schemas.ts` can import codec primitives (`zodNumericType`, `clampNumericValue`, `zodFieldNumber`) without dragging in the format-adapter graph. The split mirrors the type-only `presentation-schema-types.ts`, which exists for the same reason - `format-adapter.ts` types `presentationSchema?` and `compiledPatternFields?` against those types without circular-importing the runtime `presentation-schema.ts`.

Type-only imports recap (load order, top to bottom):

1. `binary-format-contract.ts` - codec primitives, no registry dependency.
2. `presentation-schema-types.ts` - schema + compile helpers, type-only consumers.
3. `format-adapter.ts` - interface + registry; eager bottom-imports register every per-format adapter and wire `setDomainRangeLookup`.
4. `presentation-schema.ts` (runtime lookups) - queries the registry; safe because step 3 finishes before any test or CLI code touches it.

## Architectural rules

These are non-negotiable across PRO and MAP:

1. **Schema = data.** Where the wire is flat, canonical zod is flat. Aesthetic nesting is rejected. Bit-packed fields are peer scalar entries via `packedAs`+`bitRange`.
2. **Presentation can nest** even when data is flat. The walker's `subGroups` option handles armor sub-categories, scenery layouts, etc., without warping the data shape.
3. **Read permissive, write strict.** Out-of-range enum values display as `Unknown (N)` and parse succeeds; saving rejects via the zod refinement when `spec.enum` is set. Real-world exception: MAP object base `rotation`/`elevation` carry packed-PID-shaped values in shipped files - the canonical zod stays plain int32 for those even though the wire spec documents enum tables.

    **Closed vs open enums.** The strict gate fits enums whose value space is fixed by the engine (PRO `objectType`: Item/Critter/Scenery/Wall/Tile/Misc - adding a 7th would crash the engine). For fields whose value space is open by design - IE effect opcodes (mods can introduce new opcode numbers; the engine accepts any 16-bit value), ITM type (mod-extensible via `itemtype.2da`), ITM ability `damageType` / `projectileType` (engine treats out-of-table values as defaults), SPL `type` and `castingGraphics` - set `enumOpen: true` on the spec entry. The display lookup still resolves named values; the strict refinement does not enforce membership. Closed-default keeps PRO/MAP behaviour unchanged; opt-in keeps mod-friendly fields editable without producing false rejections at save time.

4. **No special-case sentinels.** Wire `0xFFFFFFFF` for "no script" reads naturally as `{type: -1, id: -1}` via signed `i8`/`i24` codecs. Don't add `if (value === 0xFFFFFFFF)` branches.

    The same pattern covers proto fields the engine seeds to `-1` in its `proto_*_init` / `proto_scenery_subdata_init` helpers (see fallout2-ce `proto.cc`). Vanilla protos that don't override the default save the seed verbatim, so the wire arrives with `0xFFFFFFFF` and the runtime per-object map record (or, rarely, a script-spawn caller) supplies the live value. Spec these fields with signed codecs (`i32`) and add `[-1]: "None"` (or a more specific sentinel label) to the enum table when one is attached. Known fields following this pattern: scenery `material` (`proto_scenery_init`), elevator `type` / `level`, stairs `destinationBuiltTile` / `destinationMap`, ladder `destinationMap` (`proto_scenery_subdata_init`); on the item side `armor.{perk,maleFid,femaleFid}`, `weapon.{projectilePid,perk,ammoTypePid}`, `misc.powerTypePid`, `key.keyCode` carry the same convention.

5. **Linked structures.** Same-struct: array length drives count via `enforceLinkedCounts(spec, doc)` + zod refinement. Cross-struct (`fromCtx`): orchestrator owns the binding; the count flows in via the read-time ctx.
6. **No work-time artifacts in the repo.** Exception: `tmp/` (in `.gitignore`).

7. **Flat-array projection for flag fields.** A flag-word spec entry (`{codec, flags: Table}`) surfaces in canonical-doc as a flat sorted `string[]`, not as the raw int. Each entry is either a named slug (slugified-camelCase from the table's display string) or `bit<N>` (zero-based bit position) for set bits the table doesn't name. Canonical sort order: named slugs first alphabetically, then `bit<N>` in ascending bit position. Toggling one bit adds or removes one entry at its sorted position - same shape for named and unnamed bits, so diffs read uniformly. `compileFlagTable` slugifies display strings to camelCase canonical keys (`"NoBlock"` -> `noBlock`); `slugifyCodedName` rejects display strings whose slug would collide with the `bit<N>` sentinel namespace. `intToFlagArray` / `flagArrayToInt` translate at the wire codec boundary via the `FlagArraySchema` wrapper.

    Strict-disjoint invariant: a `bit<N>` entry whose position falls inside the named-mask is rejected at both the schema layer and the wire boundary - hand-edits must use the canonical slug for any spec-named bit. `bit<N>` with N >= codec width is also rejected at both layers, so synthesized entries cannot reference a bit past the wire word.

    Slugified identifiers (rather than the raw display strings) are the canonical token shape because the construction API (`docs/todo.md`) surfaces flags as TS members typed against a literal-name union - identifier-shaped names get the canonical dot-trigger autocomplete with per-flag JSDoc visible inline, which a quoted-display-string union does not. Schema validation messages and JSON Schema `items.enum` autocomplete also benefit from identifier tokens (no spacing/casing ambiguities like "No LOS required" vs "No los required"). The display string remains the parsed-tree label; the slug is the toolchain token, with one translation point (label <-> slug) at the projection boundary.

    This is a consistent application of rule #1 - `packedAs`+`bitRange` already exposes byte-packed sub-fields as peer scalar entries; the flat-array projection exposes bit-packed sub-fields the same way (the wire packs N independent semantic units into one int; canonical separates them into one entry per set bit).

8. **Lossless preservation of unnamed bits.** Adding a name to a flag table is a non-breaking spec evolution: old snapshots load via `bit<N>` entries, re-saving promotes the bit to its new slug. `schemaVersion` does NOT bump for additive name changes; bumping is reserved for _re-interpretive_ spec changes (a previously-parsed field's meaning changes), which require explicit migration code in the snapshot codec. The byte round-trip invariant `serialize(parse(b)) === b` is the load-bearing property - every existing `*-roundtrip.test.ts` enforces it.

9. **Enums and PIDs stay numeric in canonical-doc by design.** Where flag fields project to sorted-array name lists (rule #7), enum and PID fields stay as raw integers - the diff-friendliness gain doesn't justify the complication. Half the enum fields drive dispatch (`objectType`, `subType`, `scriptType`, MAP `version` / `rotation` / `elevation`) and would force a conversion at every dispatch site if projected to strings; the rest produce diffs of the same line count whether named or numeric (`5 -> 0` vs `"Items" -> "Background"`), unlike flags where the diff is fundamentally lossy. The display layer's `enum` table resolves names for editor dropdowns and hover; the snapshot stays close to the wire.

## Orchestrator vs spec - what stays out of primitives

These are evaluated and intentionally kept in orchestrator code rather than lifted to new spec primitives. Each has exactly one consumer in the current codebase, and lifting it would carry significant API surface for marginal payoff. Document the trade-off rather than re-evaluate every time.

| Concern                                                                                         | Where it lives                             | Why not a primitive                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-element subtype dispatch (script slot variants by `getScriptType(sid)`)                     | `parse-sections.ts`, `canonical-writer.ts` | One consumer; variants share most layout; discriminator is a single peeked field; the orchestrator-side dispatch is ~10 lines                                                                                                                                       |
| Recursive specs (object inventory: each entry is a full nested object record)                   | `parse-objects.ts`, `canonical-writer.ts`  | Self-referential `SpecData` projection is chicken-and-egg; orchestrator recursion is the cleanest expression                                                                                                                                                        |
| Struct-element arrays (tile elevations as `arraySpec({ element: tilePairSpec, count: 10000 })`) | `parse-sections.ts` per-tile loop          | Sole consumer is tiles; scripts have variable-size elements, objects are recursive - neither would benefit                                                                                                                                                          |
| Conditional per-elevation tile presence (`header.flags & SkipElevationN`)                       | `parse-sections.ts`                        | Avoids a `presentIf` primitive whose audience is also one consumer                                                                                                                                                                                                  |
| Environmental safety (count clamp against remaining buffer for malformed inputs)                | `clampVarCount` in `parse-sections.ts`     | Depends on remaining-bytes state the spec layer cannot see                                                                                                                                                                                                          |
| Per-format scaffolding (canonical reader/writer/snapshot/format-adapter wrappers for ITM, SPL)  | duplicated across `itm/` and `spl/`        | Two consumers with near-identical shapes (~250 LOC duplication). A generic factory in `ie-common/` is plausible but premature with N=2 - re-evaluate when a third IE format (EFF/CRE/STO/ARE) arrives. Until then, copies stay self-contained and obviously correct |

## Adding a new format

The format-adapter consolidates per-format data (presentation schema, domain ranges, snapshot helpers, semantic keys) into one object - most of the wiring is local to the new format's directory. Touch-points outside `binary/src/<format>/` are listed below as **shared touch-points** so a format addition stays grep-able as a checklist.

**In the new format's directory** (`binary/src/<format>/`):

1. **Wire spec(s).** `specs/*.ts` with `StructSpec` declarations and `SpecData<typeof spec>` types. IESDP-driven formats: add the source YAML path to `scripts/ie-binary-update/src/main.ts`'s `TARGETS` and run `scripts/ie-binary-update.sh`.
2. **Parser.** `index.ts` implements `BinaryParser` (`id`, `name`, `extensions`, `parse`, optional `serialize`). Use `toTypedBinarySchema(spec)` for wire reads, `walkStruct(spec, presentation, ...)` for the display tree, and orchestrate any subtype dispatch / recursion in the parser itself.
3. **Canonical model.** `canonical-schemas.ts` (zod), `canonical-reader.ts`, `canonical-writer.ts`. Where the canonical shape matches the wire, derive zod via `toZodSchema(spec)`. Where it diverges (computed indices, discriminated unions), hand-write and document why. `canonical.ts` re-exports the document type and helpers.
4. **JSON snapshot.** `json-snapshot.ts` exports `createCanonical<Format>JsonSnapshot` / `loadCanonical<Format>JsonSnapshot`.
5. **Presentation schema.** `presentation-schema.ts` exports `<format>PresentationSchema`, `<format>CompiledPatternFields`, `<format>DomainRanges`. For most fields you can derive entries via `toPresentationEntries(spec, presentation, prefix)` over the augmented spec; hand-write `exactFields` / `patternFields` only where the spec annotation isn't expressive enough.
6. **Format adapter.** `format-adapter.ts` builds a `BinaryFormatAdapter` and attaches `presentationSchema`, `compiledPatternFields`, `domainRanges` from step 5 plus the snapshot helpers from step 4. Editor projection / structural-edit / entity-op methods are optional; implement only what the format needs.

**Shared touch-points** (each must be updated together - they are cross-linked here so a search for any one surfaces the rest):

| Touch-point                                                                              | Why                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `binary/src/index.ts` parser export + `parserRegistry.register` block                    | Public API exposes the parser; the bottom-of-file side effects register it on the parser registry.                                                                                                                                 |
| `binary/src/format-adapter.ts` bottom-of-file imports + `formatAdapterRegistry.register` | Eager-register the new adapter alongside the existing PRO/MAP/ITM/SPL/EFF entries. After all registrations this same block calls `setDomainRangeLookup`; no extra wiring needed for domain ranges, the adapter property is enough. |
| `binary/src/types.ts` `BinaryCanonicalDocument` union                                    | TypeScript needs the literal union for narrowing on `ParseResult.document`. Add the new format's `<Format>CanonicalDocument` to the union.                                                                                         |
| `package.json` `customEditors` selector                                                  | VSCode reads this manifest at install time; extension patterns can't be runtime-driven. Add the new file extension(s).                                                                                                             |

**Tests.** Round-trip parse/serialise (real fixtures from `external/` if available), snapshot dump/load, CLI `--save` / `--check` / `--load`, presentation-tree assertions for headline enum/flag fields, and structural edits if the format has any. See `binary/test/{itm,spl,eff}-roundtrip.test.ts` and `binary/test/itm-spl-presentation.test.ts` for templates.

## CLI

```
fgbin <file.pro|file.map|file.itm|file.spl|file.eff|dir> [--save] [--check] [--load] [--graceful-map] [-r] [-q]
```

| Flag             | Behaviour                                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `--save`         | Write canonical JSON snapshot beside the binary (`file.pro.json` / `file.map.json`)                                          |
| `--check`        | Compare bytes against existing snapshot; exit 1 on diff. Used in CI                                                          |
| `--load`         | Read a snapshot and write binary bytes back using the parser's native extension                                              |
| `--graceful-map` | Permissive boundary guessing for ambiguous MAP files. Required again on `--load` for snapshots produced from ambiguous bytes |
| `-r`             | Recurse into directories                                                                                                     |
| `-q`             | Quiet mode (errors only, no per-file summary)                                                                                |

CLI tests live in `binary/test/bin-cli.test.ts` and run as `pnpm test:cli`.

## Testing

```bash
pnpm exec vitest run --config binary/vitest.config.ts        # binary unit tests (fast)
pnpm exec tsc --noEmit -p binary                              # typecheck
pnpm test                                                     # project partial target
pnpm test:all                                                 # full target (CI gate)
```

Tests run from repo root, not from `binary/` - fixture paths are repo-root-relative.

## Known feature gaps

- **MAP boundary ambiguity.** Some shipped maps have script/object section boundaries that aren't recoverable structurally. `--graceful-map` falls back to opaque-byte preservation; the editor stays strict by design (ambiguous bytes shouldn't propagate through normal workflows).
- **Maps with engine-unloadable object records.** A handful of shipped maps contain object-array records that fallout2-ce itself can't load - typically an inventory item with `pid=0` (no proto exists), or a parent record with `pid=-1` followed by inventory bytes the engine would refuse via `protoGetProto` failing. The parser is more lenient than the engine here: it bails at the bad record, marks the surrounding group `editingLocked: true`, and captures everything from that offset to EOF as the `objects-tail` opaque range so the file still round-trips byte-identically. No fix is appropriate - making the parser silently advance past records the engine refuses would lose the signal that the input is genuinely malformed. `client/testFixture/maps/newr2.map` is the canonical example fixture; `binary/test/map-decode-vanilla.test.ts` pins the behavior so a future change that quietly hides the corruption surfaces as a regression.
