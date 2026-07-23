// Curated public surface. The PNG codec, palette-remap, and direction-order helpers are
// implementation details of the io/convert layers - import them by module path in-package;
// they are deliberately not re-exported here.
export const IMAGE_LIB_VERSION = "0.1.0";

// Shared model.
export {
    type Animation,
    type AnimationMeta,
    type DirectionLayout,
    type Facing,
    type Frame,
    type Rgba,
    type Sequence,
    type SourceFormat,
    FRM_FACINGS,
    emptyPalette,
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
export { parsePal, serializePal } from "./palette/pal.ts";
export { DEFAULT_FALLOUT_PALETTE } from "./palette/default-palette.ts";
export { loadImage } from "./load.ts";

// Conversion.
export { type LossItem, type LossKind, LossReport } from "./convert/loss-report.ts";
export { type FrmConvertOpts, convert, convertToBam, convertToFrm, frmDirectionMode } from "./convert/index.ts";

// Import/export codecs (PNG directory with manifest, APNG preview).
export { exportPngDirectory, importPngDirectory } from "./io/png-directory.ts";
export { exportApngPerDirection, importApng } from "./io/apng-io.ts";
export {
    type ManifestMetaV1,
    type ManifestV1,
    frameFileName,
    readManifest,
    sequenceDirId,
    writeManifest,
} from "./io/manifest.ts";
