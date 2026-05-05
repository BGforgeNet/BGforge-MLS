# Binary Internals

See also: [README.md](README.md) (npm-facing) | [docs/architecture.md](../docs/architecture.md) (system overview)

`@bgforge/binary` parses and serialises Fallout `.pro` and `.map` files. Round-trips bytes ↔ structured data ↔ canonical JSON snapshots. Bundled `fgbin` CLI uses the same code as the binary editor in the VSCode extension.

## Layered model

```
+----------------------------------------------------+
| Display tree (ParsedGroup) — editor + JSON snapshot|
| Canonical doc  (zod-validated)  — round-trip data  |
| Wire codec     (typed-binary)   — bytes ↔ data     |
| Wire spec      (StructSpec)     — single source    |
+----------------------------------------------------+
```

One `StructSpec` per wire chunk drives every downstream artifact: typed-binary codec, zod canonical validator, display walker, domain-range table. Hand-written downstream artifacts exist only where the canonical shape genuinely diverges from the wire (e.g. MAP header `filename` is u8[16] on wire, `string` in canonical).

Two architectural splits:

- **Data layer vs presentation layer.** `FieldSpec` carries everything the data layer cares about (codec, enum/flags lookups, bit-packing layout, domain bounds). `FieldPresentation` carries only display concerns (label override, unit, format hint). Same `enum`/`flags` table serves validation, codec output, and display.
- **Spec vs orchestrator.** The spec system describes one chunk of bytes. Orchestration — subtype dispatch, recursion, conditional presence, environmental safety (clamping malformed counts) — lives in `parse-sections.ts` / `parse-objects.ts` / `canonical-writer.ts`, not in spec primitives.

## File layout

```
binary/src/
  index.ts                     # Public API surface; pinned by public-api.test.ts
  cli.ts                       # fgbin entry point
  registry.ts                  # parserRegistry (ext → BinaryParser)
  format-adapter.ts            # BinaryFormatAdapter registry (editor metadata)
  json-snapshot.ts             # Schema-versioned snapshot create/load/parse
  json-snapshot-path.ts        # Sidecar path resolution (.pro.json / .map.json)
  presentation-schema.ts       # Format-specific labels/enum tables/editability
  display-lookups.ts           # Resolve enum/flag display ↔ raw values
  binary-format-contract.ts    # zodNumericType, clampNumericValue
  shared-schemas.ts            # opaqueRangeSchema
  schema-validation.ts         # parseWithSchemaValidation wrapper
  opaque-range.ts              # Hex-chunk encoding for undecoded byte spans
  parsed-tree-codec.ts         # Display-tree dump/load helpers
  flags.ts                     # isFlagActive
  types.ts                     # ParsedField, ParsedGroup, ParseResult, ...

  spec/                        # Spec-system primitives (format-agnostic)
    types.ts                   # FieldSpec, StructSpec, SpecData, arraySpec, enforceLinkedCounts
    codec-meta.ts              # codecByteLength, codecNumericTypeName
    derive-typed-binary.ts     # toTypedBinarySchema → SpecCodec<Doc, Ctx>
    derive-zod.ts              # toZodSchema (canonical validator from spec)
    walk-display.ts            # walkStruct (data → ParsedGroup), walkGroup (inverse)
    derive-domain-ranges.ts    # SpecDomainRanges (per-key min/max)
    derive-presentation.ts     # Presentation-table helpers
    presentation.ts            # FieldPresentation, StructPresentation, humanize()

  pro/                         # Fallout PRO format
    schemas.ts                 # Wire helpers (parseHeader, parsers per subtype)
    specs/*.ts                 # Per-subtype StructSpec (header, armor, weapon, ...)
    canonical-schemas.ts       # zod canonical document schema
    canonical-reader.ts        # ParsedGroup → canonical doc
    canonical-writer.ts        # canonical doc → bytes
    canonical.ts               # Barrel re-exports
    format-adapter.ts          # BinaryFormatAdapter for PRO
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
    canonical-reader.ts        # ParsedGroup → canonical doc (walkGroup-driven)
    canonical-writer.ts        # canonical doc → bytes (spec.write-driven)
    format-adapter.ts          # BinaryFormatAdapter for MAP
    json-snapshot.ts           # MAP-specific snapshot adapter
    serializer.ts              # Top-level serialise(parseResult)
    index.ts                   # mapParser
    types.ts                   # MAP enums/flags

binary/test/                   # Vitest unit tests, repo-root cwd for fixture paths
```

## Spec primitives

### `FieldSpec`

```ts
type FieldSpec = ScalarFieldSpec | ArrayFieldSpec;

interface ScalarFieldSpec {
    codec: ISchema<number>; // typed-binary codec (i8/u8/i16/...)
    domain?: { min; max }; // tighter than codec range
    enum?: Record<number, string>; // value → display name
    flags?: Record<number, string>; // bit → display name
    packedAs?: string; // bit-packed slot name
    bitRange?: [bitOffset, bitWidth]; // required when packedAs is set
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

- **Fixed** — N elements always.
- **fromField** — N decoded earlier in the same struct. zod refinement enforces `array.length === doc.n` at save; `enforceLinkedCounts(spec, doc)` is the pre-serialise sync helper that copies `doc.array.length` back into `doc.n`.
- **fromCtx** — N lives in another struct decoded earlier in the file (e.g. a header field driving a variable section's length). The orchestrator owns the binding; zod cannot refine across structs. The clamp/safety check belongs in the orchestrator (e.g. `clampVarCount` in `parse-sections.ts` rejects malformed header counts before invoking the spec).

### Bit-packed fields

Multiple scalar entries share one wire codec read by tagging them with the same `packedAs` slot name and disjoint `bitRange` slices. The canonical-doc shape stays flat — packed parts are peer scalar entries — so a 4-bit floor-flags field reads as `floorFlags: number`, not as `tilePair.floor.flags`.

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

Type-level projection. `SpecData<typeof spec>` is the data shape `{ [K]: number | number[] }`. Use `type FooData = SpecData<typeof fooSpec>` to keep the data shape and the spec declarations in sync — adding a field to the spec automatically adds it to the data type.

## Derivation

```
                StructSpec
                    |
        +-----------+-----------+-----------+--------------+
        v           v           v           v              v
toTypedBinarySchema toZodSchema walkStruct  derive-domain  derive-presentation
   (read/write)    (validate)  (display)   (clamp table)  (humanize labels)
```

- **`toTypedBinarySchema(spec): SpecCodec<Doc, Ctx>`** — typed-binary codec. `read(view, ctx?)` and `write(view, doc, ctx?)`. Pure-scalar specs without cross-struct deps default `Ctx = void`. Specs with `fromCtx` declare their ctx type and require it at call time. `SpecCodec` is a standalone interface (does NOT extend typed-binary's `ISchema<Doc>`) because typed-binary folds `ISchema<T>` through a `Parsed<T, Ctx>` simplification on `write` that defeats subtype refinement.
- **`toZodSchema(spec): z.ZodType<SpecData<S>>`** — canonical-doc validator. Scalar fields map to `z.number().int().min().max()` based on codec signedness, narrowed by `domain` and refined to enum keys when `spec.enum` is set (read-permissive / write-strict). Same-struct `fromField` arrays add a save-time refinement asserting `array.length === doc[countField]`. Cross-struct `fromCtx` arrays do not refine (the relation crosses struct boundaries; orchestrator's responsibility).
- **`walkStruct(spec, presentation, baseOffset, data, groupName, options?)`** — emits a `ParsedGroup` for the editor. Field labels come from `presentation.label` ?? `humanize(fieldName)`. `options.labelPrefix` prepends a per-iteration prefix (e.g. `"Entry 5"` for a script slot). `options.subGroups` rearranges output into nested groups. Array fields render as `"(N values)"` summary rows.
- **`walkGroup(group, spec, presentation): SpecData<S>`** — inverse of `walkStruct`. Used by canonical-readers to extract typed data from a display group. Looks up by display label (presentation override or humanized field name); prefers `rawValue` over `value` for enum/flags. Throws on array fields — caller iterates the array group structure manually.
- **`enforceLinkedCounts(spec, doc)`** — pre-serialise helper. Walks the spec, copies `doc[arrayName].length` into the linked `count` field. Returns a new object; does not mutate. Use as the pre-write step in canonical-writer flows that have linked counts.

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
| `resolveDisplayValue`, `resolveEnumLookup`, `resolveFlagLookup`, `formatEnumDisplayValue`, `resolveRawValueFromDisplay`, `resolveStoredFieldValue` | Display ↔ raw value conversions                                          |
| `validateNumericValue`                                                                                                                             | Type-aware numeric clamp                                                 |
| `isFlagActive`                                                                                                                                     | Bit predicate                                                            |

Internal modules (spec primitives, format-specific specs, parse helpers) are NOT exported — they're only consumed inside the package.

## JSON snapshots

Snapshots are canonical `schemaVersion: 1` documents, not raw `ParseResult` dumps:

- `ParseResult.root` — display tree (editor)
- `ParseResult.document` — canonical data (round-trip)
- Snapshots persist `document`; the display tree is reconstructed by re-parsing
- Both PRO and MAP have format-specific canonical schemas (`canonical-schemas.ts`)
- Dump and load both validate against the schema, then round-trip bytes through the parser as a safety check
- `opaqueRanges` carry hex-chunked bytes for undecoded or intentionally-omitted regions (e.g. MAP tiles when the editor skips materialising them)
- Presentation lookups use stable semantic keys (`pro.header.objectType`, `map.objects.elevations[].objects[].base.pid`), not display-path strings

Sidecar paths preserve the original extension: `file.pro` → `file.pro.json`, `file.map` → `file.map.json`.

## Format adapters

`BinaryFormatAdapter` (in `format-adapter.ts`) encapsulates per-format editor concerns:

- `createJsonSnapshot` / `loadJsonSnapshot` — canonical snapshot create/load
- `rebuildCanonicalDocument` — reconstruct after tree edits
- `toSemanticFieldKey` — display-path → semantic key for presentation lookup
- `shouldHideField`, `shouldHideGroup`, `projectDisplayRoot` — editor projection (hide tile bulk, redundant slots, etc.)
- `isStructuralFieldId`, `buildStructuralTransitionBytes` — structural edits that change layout (e.g. PRO subtype change)

Adapters are registered in `format-adapter.ts` alongside parsers. The binary editor in the VSCode extension consumes the adapter registry; CLI/library users mostly interact with snapshot helpers and the parser registry directly.

## Architectural rules

These are non-negotiable across PRO and MAP:

1. **Schema = data.** Where the wire is flat, canonical zod is flat. Aesthetic nesting is rejected. Bit-packed fields are peer scalar entries via `packedAs`+`bitRange`.
2. **Presentation can nest** even when data is flat. The walker's `subGroups` option handles armor sub-categories, scenery layouts, etc., without warping the data shape.
3. **Read permissive, write strict.** Out-of-range enum values display as `Unknown (N)` and parse succeeds; saving rejects via the zod refinement when `spec.enum` is set. Real-world exception: MAP object base `rotation`/`elevation` carry packed-PID-shaped values in shipped files — the canonical zod stays plain int32 for those even though the wire spec documents enum tables.
4. **No special-case sentinels.** Wire `0xFFFFFFFF` for "no script" reads naturally as `{type: -1, id: -1}` via signed `i8`/`i24` codecs. Don't add `if (value === 0xFFFFFFFF)` branches.

    The same pattern covers proto fields the engine seeds to `-1` in its `proto_*_init` / `proto_scenery_subdata_init` helpers (see fallout2-ce `proto.cc`). Vanilla protos that don't override the default save the seed verbatim, so the wire arrives with `0xFFFFFFFF` and the runtime per-object map record (or, rarely, a script-spawn caller) supplies the live value. Spec these fields with signed codecs (`i32`) and add `[-1]: "None"` (or a more specific sentinel label) to the enum table when one is attached. Known fields following this pattern: scenery `material` (`proto_scenery_init`), elevator `type` / `level`, stairs `destinationBuiltTile` / `destinationMap`, ladder `destinationMap` (`proto_scenery_subdata_init`); on the item side `armor.{perk,maleFid,femaleFid}`, `weapon.{projectilePid,perk,ammoTypePid}`, `misc.powerTypePid`, `key.keyCode` carry the same convention.

5. **Linked structures.** Same-struct: array length drives count via `enforceLinkedCounts(spec, doc)` + zod refinement. Cross-struct (`fromCtx`): orchestrator owns the binding; the count flows in via the read-time ctx.
6. **No work-time artifacts in the repo.** Exception: `tmp/` (in `.gitignore`).

## Orchestrator vs spec — what stays out of primitives

These are evaluated and intentionally kept in orchestrator code rather than lifted to new spec primitives. Each has exactly one consumer in the current codebase, and lifting it would carry significant API surface for marginal payoff. Document the trade-off rather than re-evaluate every time.

| Concern                                                                                         | Where it lives                             | Why not a primitive                                                                                                           |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Per-element subtype dispatch (script slot variants by `getScriptType(sid)`)                     | `parse-sections.ts`, `canonical-writer.ts` | One consumer; variants share most layout; discriminator is a single peeked field; the orchestrator-side dispatch is ~10 lines |
| Recursive specs (object inventory: each entry is a full nested object record)                   | `parse-objects.ts`, `canonical-writer.ts`  | Self-referential `SpecData` projection is chicken-and-egg; orchestrator recursion is the cleanest expression                  |
| Struct-element arrays (tile elevations as `arraySpec({ element: tilePairSpec, count: 10000 })`) | `parse-sections.ts` per-tile loop          | Sole consumer is tiles; scripts have variable-size elements, objects are recursive — neither would benefit                    |
| Conditional per-elevation tile presence (`header.flags & SkipElevationN`)                       | `parse-sections.ts`                        | Avoids a `presentIf` primitive whose audience is also one consumer                                                            |
| Environmental safety (count clamp against remaining buffer for malformed inputs)                | `clampVarCount` in `parse-sections.ts`     | Depends on remaining-bytes state the spec layer cannot see                                                                    |

## Adding a new format

1. **Wire spec(s).** Create `binary/src/<format>/specs/*.ts` with `StructSpec` declarations and `SpecData<typeof spec>` types.
2. **Parser.** Implement `BinaryParser` in `binary/src/<format>/index.ts` (`id`, `name`, `extensions`, `parse`, optional `serialize`). Use `toTypedBinarySchema(spec)` for wire reads, `walkStruct(spec, presentation, ...)` for the display tree, and orchestrate any subtype dispatch / recursion in the parser itself.
3. **Canonical model.** Add `canonical-schemas.ts` (zod), `canonical-reader.ts` (display tree → canonical via `walkGroup`), `canonical-writer.ts` (canonical → bytes via `spec.write` on a `BufferWriter`). Where the canonical shape matches the wire, derive zod via `toZodSchema(spec)`. Where it diverges (string fields, computed indices, discriminated unions), hand-write and document why.
4. **Canonical barrel.** `canonical.ts` re-exports the canonical-document type and helpers.
5. **Format adapter.** Implement `BinaryFormatAdapter` in `format-adapter.ts`; register alongside existing adapters.
6. **JSON snapshot adapter.** Add `<format>/json-snapshot.ts` with `createCanonical<Format>JsonSnapshot` and `loadCanonical<Format>JsonSnapshot`. Wire into `binary/src/json-snapshot.ts`'s top-level routing.
7. **Presentation schema.** Add semantic-key entries in `presentation-schema.ts` (enum/flags lookups, formatting, editability).
8. **Register parser.** Add the side-effect `parserRegistry.register(myParser)` to `binary/src/index.ts`.
9. **VSCode editor.** Add the extension pattern to `package.json`'s `customEditors` selector at the repo root.
10. **Tests.** Round-trip parse/serialise, snapshot dump/load, CLI `--save`/`--check`/`--load`, presentation lookups, structural edits if any.

## CLI

```
fgbin <file.pro|file.map|dir> [--save] [--check] [--load] [--graceful-map] [-r] [-q]
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

Tests run from repo root, not from `binary/` — fixture paths are repo-root-relative.

## Known feature gaps

- **MAP boundary ambiguity.** Some shipped maps have script/object section boundaries that aren't recoverable structurally. `--graceful-map` falls back to opaque-byte preservation; the editor stays strict by design (ambiguous bytes shouldn't propagate through normal workflows).
- **Maps with engine-unloadable object records.** A handful of shipped maps contain object-array records that fallout2-ce itself can't load — typically an inventory item with `pid=0` (no proto exists), or a parent record with `pid=-1` followed by inventory bytes the engine would refuse via `protoGetProto` failing. The parser is more lenient than the engine here: it bails at the bad record, marks the surrounding group `editingLocked: true`, and captures everything from that offset to EOF as the `objects-tail` opaque range so the file still round-trips byte-identically. No fix is appropriate — making the parser silently advance past records the engine refuses would lose the signal that the input is genuinely malformed. `client/testFixture/maps/newr2.map` is the canonical example fixture; `binary/test/map-decode-vanilla.test.ts` pins the behavior so a future change that quietly hides the corruption surfaces as a regression.
