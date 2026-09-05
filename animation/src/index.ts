/**
 * Curated public surface for Infinity Engine animation sets: which animations a game declares, which files
 * each one draws, how a file's cycles band into directions, and how a character set's facets resolve.
 *
 * The vendored per-game tables (`animation-tables/bg2.ts`, `animation-tables/effects.ts`) are consulted
 * through `tableForFlavour` and are deliberately not re-exported - a caller picking a table by hand would
 * bypass the rule that an install's own declaration always wins.
 *
 * `ieGroupLabels` is not here either: it has its own `@bgforge/animation/group-labels` entry point, because
 * the animation editor's webview needs it and this barrel reaches the image library's Node-only codecs.
 */

// The index: what a game declares.
export {
    type AnimationIndexResolver,
    type AnimationScheme,
    type AnimationSet,
    buildAnimationIndex,
    createAnimationIndexResolver,
    firstArmour,
} from "./animation-index";
export { type GameHandle, type GameSource } from "./game-handle";
export { type AnimationIni, parseAnimationIni } from "./animation-ini";
export { readIdsCodes } from "./ids-tables";

// The fallback tables, for installs that declare nothing.
export { tableForFlavour } from "./animation-tables";
export { type AnimationTable, type TableAnimation, type TableRows, animationTable } from "./animation-tables/table";

// Schemes: how an animation's files are named, and how their cycles band.
export { type Layout, layoutOf } from "./animation-schemes/layout";
export { type SchemeMember, schemeMembers } from "./animation-schemes/members";
export { type Action, characterActions, characterDrawsBody, characterMember } from "./animation-schemes/character";
export {
    type BandConfidence,
    type FileBands,
    type SetStance,
    declaredStride,
    stancesOfMembers,
} from "./animation-schemes/bands";

// Reading one set out of an install.
export { type StanceIo, setStances } from "./set-stances";
export { type SetTile, setPreviewResref, setTile } from "./set-tiles";

// The neutral model: one set, read out of a game and writable back to it.
export {
    type NeutralAction,
    type NeutralCycles,
    type NeutralDirection,
    type NeutralIdentity,
    type NeutralSet,
    type NeutralVariant,
} from "./neutral/model";
export { readNeutralSet } from "./neutral/read";
export { type MemberWrite, writeNeutralSet } from "./neutral/write";

// Conversion: what a target can hold, and what converting into it would cost.
export {
    type ConversionTarget,
    FALLOUT_FRM,
    IE_16_POINT_FULL,
    IE_16_POINT_MIRRORED,
    IE_8_POINT_MIRRORED,
    IE_8_POINT_PAIRED,
} from "./convert/target";
export { type ConversionPlan, planConversion } from "./convert/plan";

// Character facets: race, gender, class, armour, action.
export {
    type CharClass,
    type CharacterFacets,
    type Gender,
    type Race,
    characterFacetsOf,
    characterIdFor,
} from "./animation-facets";
export {
    type FacetChoice,
    type FacetResolution,
    ARMOUR_LABELS,
    CLASSES,
    GENDERS,
    RACES,
    actionLabel,
    armourLabel,
    armourLevels,
    facetChoices,
    facetIndex,
    facetKey,
    facetLabel,
    resolveFacets,
    setForFacets,
} from "./facet-browser";
