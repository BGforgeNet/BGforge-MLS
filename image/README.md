# @bgforge/image

Library for lossless parsing and serialising of Fallout FRM and Infinity Engine BAM animation
files - palette-indexed (FRM, BAM V1, BAMC) and true-colour (BAM V2) - with conversion between
them and PNG/APNG import/export. Backs the image editor in `client/src/image-editor/`.

An `Animation` is a union of `IndexedAnimation` and `RgbaAnimation`; narrow with `isRgbaAnimation`,
or take `IndexedAnimation` to state that a consumer cannot handle true colour.

Internal workspace package - not currently published to npm.

## Entry points

- `loadImage(bytes, name)` - sniffs BAM/BAMC by signature, FRM by filename. Refuses BAM V2, whose
  frames it cannot fetch; use the two-phase read below.
- `parseFrm` / `serializeFrm`, `combineFrmDirections` - Fallout FRM, including `.fr0`-`.fr5`
  split critter sets.
- `parseBamV1` / `serializeBamV1`, `isBamc` / `decodeBamc` / `encodeBamc` - Infinity Engine
  BAM v1 and BAMC.
- `isBamV2`, `readBamV2Structure` -> resolve pages -> `decodeBamV2(structure, resolver)` /
  `serializeBamV2` - Infinity Engine BAM V2. Read in two phases because the frames live in separate
  PVRZ pages and this package has no filesystem access: the structure names the pages it needs
  (`pvrzResourceName`), the caller fetches them, and a `PvrzResolver` hands them back.
- `convertToFrm` / `convertToBam` - conversion between the indexed formats; lossy steps are collected
  in a `LossReport`.
- `convertToRgba` / `convertToIndexed` / `convertToBamV2` - conversion across the colour models.
  Indexed to true colour is exact; the reverse quantizes and reports what it cost. `needsFreshPages`
  answers whether saving must write new PVRZ pages.
- `exportPngDirectory` / `importPngDirectory` - lossless per-frame PNG round-trip with a
  `manifest.json`.
- `exportApngPerDirection` - APNG preview export (drops per-frame offsets).
- `parsePal` / `serializePal`, `DEFAULT_FALLOUT_PALETTE` - palette handling.
- `@bgforge/image/frame-anchor` - Buffer/zlib-free subpath with the anchor math, safe for
  browser bundles (used by the editor webview).
- `@bgforge/image/ie-direction` - Buffer/zlib-free subpath with the IE direction-block
  analysis (used by the editor webview's compass layout).

## Development

Tests (vitest, coverage-gated): `pnpm test` from this directory.
