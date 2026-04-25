# Binary Parsers

Extensible system for parsing binary file formats.

## Architecture

- `types.ts` - Interfaces: `BinaryParser`, `ParseResult`, `ParsedGroup`, `ParsedField`
- `registry.ts` - `ParserRegistry` maps file extensions to parsers
- `index.ts` - Exports and registers all parsers
- `pro-canonical-schemas.ts` / `map-canonical-schemas.ts` - Zod schemas and types for canonical data models
- `pro-canonical-reader.ts` / `map-canonical-reader.ts` - Display-tree readers that rebuild canonical documents
- `pro-canonical-writer.ts` / `map-canonical-writer.ts` - Binary serializers from canonical documents
- `pro-canonical.ts` / `map-canonical.ts` - Barrel re-exports preserving the public surface
- `pro-json-snapshot.ts` / `map-json-snapshot.ts` - Format-specific snapshot adapters
- `presentation-schema.ts` - Format-specific presentation metadata for labels, enum/flag options, numeric formatting, and editability

## Adding a new format

1. Create `<format>.ts` implementing `BinaryParser`
2. Register in `index.ts`: `parserRegistry.register(myParser)`
3. Create `<format>-format-adapter.ts` implementing `BinaryFormatAdapter` and register it in `format-adapter.ts`
4. Add extension pattern to `package.json` customEditors selector

## New Binary Format Checklist

Use this end-to-end checklist when adding a new binary format to avoid missing one of the hard-linked layers.

1. Parser and registry

- Add `binary/src/<format>.ts` implementing `BinaryParser` (`id`, `name`, `extensions`, `parse`, optional `serialize`).
- Register the parser in `binary/src/index.ts` (the side-effect block at the bottom of the public-API barrel).
- Ensure extension mapping is reachable from the binary editor (`parserRegistry.getByExtension(...)`).

2. Canonical model and serializer

- Add `binary/src/<format>-canonical-schemas.ts` (zod schema + types), `<format>-canonical-reader.ts` (rebuild helpers), and `<format>-canonical-writer.ts` (serializer); expose via a `<format>-canonical.ts` barrel.
- Ensure parser output populates `ParseResult.document` with the canonical document.
- Ensure serializer prefers canonical document data over display tree data.

3. Snapshot adapter

- Add `binary/src/<format>-json-snapshot.ts` with:
    - `createCanonical<Format>JsonSnapshot(parseResult)`
    - `loadCanonical<Format>JsonSnapshot(jsonText, parseOptions?)`
- Enforce round-trip checks: `snapshot -> bytes -> parse -> snapshot` semantic equality.

4. Shared snapshot routing

- Wire `createBinaryJsonSnapshot(...)` / `loadBinaryJsonSnapshot(...)` in `json-snapshot.ts` for the new format.
- Keep fallback generic snapshot handling only for non-canonical formats.

5. Presentation schema (editor-facing metadata)

- Add format schema entry in `presentation-schema.ts`:
    - enum/flags lookup tables
    - numeric formatting
    - editability rules
    - semantic key mapping behavior
- Ensure field identity does not depend on display names alone.

6. Binary editor integration

- Validate tree projection behavior in `binaryEditor-tree.ts` (hide/projection rules if needed).
- Verify edit pipeline supports field validation and display/raw conversions for the new format.
- Verify structural edits (if any) trigger full refresh correctly.

7. CLI and docs

- Confirm `bin-cli` dump/check/load works for the new format and sidecar path behavior.
- Update `docs/architecture.md` binary editor snapshot contract notes if behavior differs.

8. Tests

- Add/extend:
    - parser round-trip tests
    - snapshot dump/load tests
    - editor document edit/undo tests
    - lookup/presentation tests
    - CLI tests (`--save`, `--check`, `--load`)

## JSON snapshots

- Snapshots are canonical `schemaVersion: 1` documents, not raw `ParseResult` dumps.
- `ParseResult.root` remains the editor/display tree.
- `ParseResult.document` is the canonical data model when a format has one.
- `pro` and `map` snapshots are semantic documents. Normal decoded fields do not persist parser layout metadata such as `offset`, `size`, `valueType`, or `nodeType`.
- `opaqueRanges` remain the explicit place where byte offsets and sizes are preserved for undecoded or intentionally omitted regions.
- Presentation metadata is separate from canonical data and is resolved from `presentation-schema.ts`.
- Presentation lookups use stable semantic field IDs such as `pro.header.objectType` and `map.objects.elevations[].objects[].base.pid`, not escaped display-path keys.
- Binary serialization should prefer the canonical document over the display tree.
- Dump and load must validate against the format schema and re-parse bytes as a round-trip check.
- When rebuilding canonical data from a parsed editor tree, serializer-facing code must clamp legacy out-of-range numeric values to supported domain bounds instead of emitting invalid bytes.

## CLI

```bash
node binary/out/cli.js <file>           # dump to stdout (requires pnpm build:binary first)
node binary/out/cli.js <file> --save    # save to <file>.<ext>.json
node binary/out/cli.js <file> --check   # verify against saved canonical json
node binary/out/cli.js <file>.json --load
```

Notes:

- Sidecars preserve the original extension: `file.pro -> file.pro.json`, `file.map -> file.map.json`.
- `--load` does not support legacy snapshots without `schemaVersion`.
- Ambiguous MAP snapshots still require `--graceful-map` again on load.

## Format Adapter

Format-specific behavior is encapsulated in `BinaryFormatAdapter` implementations registered in `format-adapter.ts`. Each adapter provides:

- **Snapshots**: `createJsonSnapshot` / `loadJsonSnapshot` — canonical snapshot create and load.
- **Canonical rebuild**: `rebuildCanonicalDocument` — reconstruct canonical data after tree edits.
- **Semantic keys**: `toSemanticFieldKey` — map display-path segments to semantic field keys for presentation lookup.
- **Editor projection** (optional): `shouldHideField`, `shouldHideGroup`, `projectDisplayRoot` — control what the editor tree shows.
- **Structural edits** (optional): `isStructuralFieldId`, `buildStructuralTransitionBytes` — handle edits that change the file's field layout.

### Adding adapter support for a new format

1. Create `<format>-format-adapter.ts` implementing `BinaryFormatAdapter`.
2. Import and register it in `format-adapter.ts` alongside the existing adapters.

## Testing

```bash
pnpm test:cli              # CLI mode tests (check/save/stdout exit codes, diff output)
```
