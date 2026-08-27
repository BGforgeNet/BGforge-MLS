# @bgforge/image

Library for lossless parsing and serialising of Fallout FRM and Infinity Engine BAM animation
files, with FRM <-> BAM conversion and PNG/APNG import/export. Backs the image editor in
`client/src/image-editor/`.

Internal workspace package - not currently published to npm.

## Entry points

- `loadImage(bytes, name)` - sniffs BAM/BAMC by signature, FRM by filename.
- `parseFrm` / `serializeFrm`, `combineFrmDirections` - Fallout FRM, including `.fr0`-`.fr5`
  split critter sets.
- `parseBamV1` / `serializeBamV1`, `isBamc` / `decodeBamc` / `encodeBamc` - Infinity Engine
  BAM v1 and BAMC.
- `convertToFrm` / `convertToBam` - cross-format conversion; lossy steps are collected in a
  `LossReport`.
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
