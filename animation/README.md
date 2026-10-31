# @bgforge/animation

Library for resolving Infinity Engine animation sets: which animations a game declares, which files each
one draws, how a file's cycles band into directions, and how a character set's facets (race, gender,
class, armour, action) resolve. Backs the animation editor in `client/src/image-editor/` and the image
gallery in `client/src/gallery/`.

Internal workspace package - not currently published to npm.

## Entry points

The barrel exports only what a consumer outside this package reaches; the `.ini` reader, the vendored
fallback tables, the scheme and band inference, the conversion planner and the facet decomposition are
module-local. `src/index.ts` is the export list and the source of truth, and `test/public-api.test.ts` pins it.
It covers the game's animation index, reading one set's members, stances and neutral model out of an install, and
converting a set into a target's profile.

`@bgforge/animation/group-labels` is a Buffer/zlib-free subpath holding the naming vocabulary for the direction
blocks a packed IE animation file holds; `src/group-labels.ts` is its export list. It is split from the main entry
point because the animation editor's webview needs it too, and the barrel reaches `@bgforge/image`'s Node-only
codecs through the stance reader, which fails to build - or fails at load - in a browser bundle.

## Development

Tests (vitest, coverage-gated): `pnpm test` from this directory.
