/**
 * Curated public surface for Infinity Engine animation sets: which animations a game declares, which files
 * each one draws, how a file's cycles band into directions, and how a character set's facets resolve.
 *
 * Scope rule: only what a consumer outside this package reaches, pinned by `test/public-api.test.ts`. The
 * layer the entry points below are built on - the per-set `.ini` reader, the vendored per-game tables, the
 * scheme and band inference, the conversion planner and the facet decomposition - stays module-local. A
 * caller picking a table by hand would bypass the rule that an install's own declaration always wins.
 *
 * `ieGroups` is not here either: it has its own `@bgforge/animation/group-labels` entry point, because
 * the animation editor's webview needs it and this barrel reaches the image library's Node-only codecs.
 */

// The index: what a game declares.
export {
    type AnimationIndexResolver,
    type AnimationSet,
    animationIdHex,
    createAnimationIndexResolver,
    firstArmour,
    setTitle,
} from "./animation-index";
export { type GameHandle, type GameSource } from "./game-handle";
export { readIdsCodes } from "./ids-tables";

// Schemes: how an animation's files are named, and how their cycles band.
export { type ActionScheme } from "./animation-schemes/actions";
export { namingForLayout } from "./animation-schemes/layout";
export { type SchemeMember } from "./animation-schemes/members";
export { type SetStance, schemeForStride } from "./animation-schemes/bands";

// Reading one set out of an install.
export { type StanceIo, drawnArmourLevels, overlaidStride, setMembers, setStances, stanceIo } from "./set-stances";
export { replacementPaletteNames } from "./set-palette";
export { type SetTile, setTile } from "./set-tiles";

// The neutral model: one set, read out of a game and written back to it.
export { readNeutralSet } from "./neutral/read";
export { type BamContainer, type MemberWrite } from "./neutral/write";

// Conversion: what a target can hold, and what converting into it would cost.
export {
    type ConversionTarget,
    FALLOUT_FRM,
    IE_16_POINT_FULL,
    IE_16_POINT_MIRRORED,
    IE_8_POINT_MIRRORED,
    IE_8_POINT_PAIRED,
    IE_16_POINT_WIDE_PAIRED,
    targetForSection,
    unfillableSlots,
} from "./convert/target";
export { convertSet } from "./convert/convert";
export { type DeclarationFile, type DeclarationInput, declarationFiles } from "./convert/declaration-files";
export { type AnimationIniDeclaration, writeAnimationIni } from "./animation-ini-write";
export { allocateAnimationId } from "./convert/allocate";

// What an exported set directory declares about itself: which files it holds and where they came from.
export {
    type SetManifestMember,
    type SetManifestSource,
    type SetManifestV1,
    readSetManifest,
    writeSetManifest,
} from "./io/set-manifest";

// Display labels for a set's armour levels and for the family the install declares it under.
export { armourLabel, familyDescription, sectionLabel, sectionOptions } from "./facet-labels";
