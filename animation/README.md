# @bgforge/animation

Library for resolving Infinity Engine animation sets: which animations a game declares, which files each
one draws, how a file's cycles band into directions, and how a character set's facets (race, gender,
class, armour, action) resolve. Backs the animation editor in `client/src/image-editor/` and the image
gallery in `client/src/gallery/`.

Internal workspace package - not currently published to npm.

## Entry points

- `buildAnimationIndex` / `createAnimationIndexResolver` - read a game's own animation declarations into
  an `AnimationIndexResolver`; `armourLevels`, `firstArmour`, `setTitle`, `animationIdHex` read facts off
  a resolved `AnimationSet`.
- `parseAnimationIni` - the per-set `.ini` an Enhanced Edition install declares.
- `readIdsCodes` - the `.IDS` table reader the index and the schemes both use.
- `tableForFlavour` / `animationTable` - the vendored fallback tables an install that declares nothing
  falls back to, picked by game flavour rather than by hand.
- `layoutOf` - how an animation's files are named for a given scheme.
- `schemeMembers`, `characterActions` / `characterMember` - which member (body, weapon overlay, ...) each
  file in a character animation is, and what action it draws.
- `declaredStride` / `schemeForStride` / `stancesOfMembers` - resolve a file's stance layout from its
  declared or measured cycle count.
- `setMembers` / `setStances` / `drawnArmourLevels` - read one set's members and stances out of an open
  install.
- `setPreviewResref` / `setTile` - pick a representative frame for a set and build the gallery's tile
  summary.
- `readNeutralSet` / `writeNeutralSet` - the neutral model: one set read out of a game into an
  engine-independent shape, and written back.
- `planConversion` / `convertSet` / `conversionNotes` / `retargetAction` / `allocateAnimationId` - what a
  conversion target (`FALLOUT_FRM`, `IE_16_POINT_FULL`, `IE_16_POINT_MIRRORED`, `IE_8_POINT_MIRRORED`,
  `IE_8_POINT_PAIRED`) can hold, what converting into it would cost, and how to carry it out.
- `characterFacetsOf` / `characterIdFor` - race, gender, class, armour, and action facets of an animation
  id; `actionLabel` / `armourLabel` give them display labels.
- `@bgforge/animation/group-labels` - a Buffer/zlib-free subpath exporting `ieGroupLabels` (names for the
  direction blocks a packed IE animation file holds). Split from the main entry point because the
  animation editor's webview needs it too, and the barrel reaches `@bgforge/image`'s Node-only codecs
  through the stance reader, which fails to build - or fails at load - in a browser bundle.

## Development

Tests (vitest, coverage-gated): `pnpm test` from this directory.
