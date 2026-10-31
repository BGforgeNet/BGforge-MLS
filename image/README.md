# @bgforge/image

Library for lossless parsing and serialising of Fallout FRM and Infinity Engine BAM animation
files - palette-indexed (FRM, BAM V1, BAMC) and true-colour (BAM V2) - with conversion between
them, PNG import/export and APNG export. Backs the image editor in `client/src/image-editor/`.

An `Animation` is a union of `IndexedAnimation` and `RgbaAnimation`; narrow with `isRgbaAnimation`,
or take `IndexedAnimation` to state that a consumer cannot handle true colour.

Internal workspace package - not currently published to npm.

## Entry points

`src/index.ts` is the export list and the source of truth. It holds the parsers and serialisers per format
(FRM, BAM V1, BAMC, and BAM V2 in two phases: the structure names the PVRZ pages, the caller fetches them, and a
`PvrzResolver` hands them back), the PNG codec, palette handling, the conversions between formats and colour models
(lossy steps are collected in a `LossReport`), and the PNG-directory and APNG exports. `loadImage(bytes, name)` sniffs
BAM/BAMC by signature and FRM by filename; it refuses BAM V2, whose frames it cannot fetch.

Three Buffer-free subpaths are safe for browser bundles: `@bgforge/image/frame-anchor`,
`@bgforge/image/ie-direction` and `@bgforge/image/compose-parts`. The `exports` field of `package.json` names their
files.

## Development

Tests (vitest, coverage-gated): `pnpm test` from this directory.
