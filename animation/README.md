# @bgforge/animation

Library for resolving Infinity Engine animation sets: which animations a game declares, which files each
one draws, how a file's cycles band into directions, and how a character set's facets (race, gender,
class, armour, action) resolve. Backs the animation editor in `client/src/image-editor/` and the image
gallery in `client/src/gallery/`.

Internal workspace package - not currently published to npm.

## Entry points

The barrel exports only what a consumer outside this package reaches; the `.ini` reader, the vendored
fallback tables, the scheme and band inference, the conversion planner and the facet decomposition are
module-local and reached through the entry points below. `test/public-api.test.ts` pins the surface.

- `createAnimationIndexResolver` - read a game's own animation declarations into an
  `AnimationIndexResolver`; `firstArmour`, `setTitle`, `animationIdHex` read facts off a resolved
  `AnimationSet`.
- `readIdsCodes` - the `.IDS` table reader the index and the schemes both use.
- `schemeForStride` - resolve a file's stance layout from its declared or measured cycle count.
- `setMembers` / `drawnArmourLevels` - read one set's members and drawn armour levels out of an open
  install.
- `setTile` - build the gallery's tile summary for a set.
- `readNeutralSet` - the neutral model: one set read out of a game into an engine-independent shape.
- `convertSet` / `allocateAnimationId` - what a conversion target (`FALLOUT_FRM`, `IE_16_POINT_FULL`,
  `IE_16_POINT_MIRRORED`, `IE_8_POINT_MIRRORED`, `IE_8_POINT_PAIRED`) can hold and how to carry a
  conversion out; the files it would write come back as `MemberWrite`s for the caller to apply.
- `armourLabel` - display label for an armour level.
- `@bgforge/animation/group-labels` - a Buffer/zlib-free subpath exporting `ieGroupLabels` (names for the
  direction blocks a packed IE animation file holds). Split from the main entry point because the
  animation editor's webview needs it too, and the barrel reaches `@bgforge/image`'s Node-only codecs
  through the stance reader, which fails to build - or fails at load - in a browser bundle.

## Development

Tests (vitest, coverage-gated): `pnpm test` from this directory.
