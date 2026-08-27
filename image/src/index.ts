// Curated public surface. The PNG decoder, palette-remap, and direction-order helpers are
// implementation details of the io/convert layers - import them by module path in-package;
// they are deliberately not re-exported here. The PNG ENCODER is public: turning a decoded
// frame into a displayable image is what a consumer holding an Animation wants, and it now has
// a second caller outside the io/ layer (the binary editor's resref thumbnails).

// Shared model.
export {
    type Animation,
    type AnimationMeta,
    type DirectionLayout,
    type Facing,
    type Frame,
    type IndexedAnimation,
    type IndexedAnimationMeta,
    type IndexedSourceFormat,
    type Rgba,
    type RgbaAnimation,
    type RgbaAnimationMeta,
    type RgbaFrame,
    type Sequence,
    type SourceFormat,
    FRM_FACINGS,
    emptyPalette,
    isRgbaAnimation,
    transparentIndexOf,
} from "./model/animation.ts";
export { type Anchor, type AnchorGeom, offsetToAnchor } from "./model/frame-anchor.ts";
export {
    type IeDirectionAnalysis,
    type IeDirectionSlot,
    type SequenceShape,
    interpretIeDirections,
} from "./model/ie-direction.ts";

// Format codecs.
export { parseFrm } from "./frm/parse.ts";
export { serializeFrm } from "./frm/serialize.ts";
export { combineFrmDirections } from "./frm/combine.ts";
export { parseBamV1 } from "./bam/parse.ts";
export { serializeBamV1 } from "./bam/serialize.ts";
export { combineIeBamPair, splitIeBamPair } from "./bam/pair.ts";
export { isBamc, decodeBamc, encodeBamc } from "./bam/bamc.ts";
export { encodeIndexedPng } from "./png/encode.ts";
export { parsePal, serializePal } from "./palette/pal.ts";
export { DEFAULT_FALLOUT_PALETTE } from "./palette/default-palette.ts";
export { loadImage } from "./load.ts";

// Conversion.
export { type LossItem, type LossKind, LossReport } from "./convert/loss-report.ts";
export { type FrmConvertOpts, convert, convertToBam, convertToFrm, frmDirectionMode } from "./convert/index.ts";

// Import/export codecs (PNG directory with manifest, APNG preview). The manifest wire-format
// internals (readManifest/writeManifest and friends) stay io/-internal, like the PNG codec.
export { exportPngDirectory, importPngDirectory } from "./io/png-directory.ts";
export { exportApngPerDirection, importApng } from "./io/apng-io.ts";
