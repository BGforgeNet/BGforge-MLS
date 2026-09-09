// Curated public surface: only what a consumer outside this package reaches, pinned by
// test/public-api.test.ts. The palette-remap step, the manifest wire format and the byte-level
// structure and options types are implementation details of the io/convert layers - import them by
// module path in-package. The PNG codec is public: turning a decoded frame into a displayable image
// is what a consumer holding an Animation wants, and the encoder has a second caller outside the
// io/ layer (the binary editor's resref thumbnails).

// Shared model.
export {
    type Animation,
    type AnimationMeta,
    type DirectionLayout,
    type Facing,
    type Frame,
    type IndexedAnimation,
    type IndexedSourceFormat,
    type Rgba,
    type RgbaAnimation,
    type Sequence,
    type SourceFormat,
    FRM_FACINGS,
    emptyPalette,
    isRgbaAnimation,
    mirrorFacing,
    mirrorFrame,
    transparentIndexOf,
} from "./model/animation.ts";
export { ieFacingsForStride, interpretIeDirections } from "./model/ie-direction.ts";
export { composeParts, cycleDrawsArt, drawsCycle } from "./model/compose-parts.ts";

// Format codecs.
export { readBmpPalette, readBmpRgba } from "./bmp/parse.ts";
export { parseFrm } from "./frm/parse.ts";
export { serializeFrm } from "./frm/serialize.ts";
export { combineFrmDirections } from "./frm/combine.ts";
export { splitFrmDirections } from "./frm/split.ts";
export { parseBamV1 } from "./bam/parse.ts";
// Thumbnail-shaped read: the tables without the pixels, then only the frames the caller names.
export { decodeBamV1Frames, readBamV1Tables } from "./bam/selective.ts";
// BAM v2 reads in two phases: the structure names the PVRZ pages, the caller resolves them, then
// decodeBamV2 composes the frames. See v2-parse.ts for why the resolver is injected.
export { isBamV2, readBamV2Structure } from "./bam/v2-structure.ts";
export { type PvrzResolver, decodeBamV2, pvrzResourceName } from "./bam/v2-parse.ts";
export { type BamV2PageWrite, serializeBamV2 } from "./bam/v2-serialize.ts";
export { serializeBamV1 } from "./bam/serialize.ts";
export { combineIeBamPair, splitIeBamBlocks, splitIeBamPair } from "./bam/pair.ts";
export { isBamc, decodeBamc, encodeBamc } from "./bam/bamc.ts";
export { encodeIndexedPng, encodeTruecolourPng } from "./png/encode.ts";
export { decodeIndexedPng, decodeTruecolourPng } from "./png/decode.ts";
export { parsePal, serializePal } from "./palette/pal.ts";
export {
    type CreatureColors,
    CREATURE_RANGES,
    applyCreatureColors,
    creatureColorsAt,
    parseGradientTable,
} from "./palette/creature-colors.ts";
export { DEFAULT_FALLOUT_PALETTE } from "./palette/default-palette.ts";
export { loadImage } from "./load.ts";

// Conversion.
export { type LossKind, LossReport } from "./convert/loss-report.ts";
export {
    type FrmConvertOpts,
    type UnevenRotations,
    convertToBam,
    convertToBamV2,
    convertToFrm,
    convertToIndexed,
    convertToRgba,
    frmDirectionMode,
    needsFreshPages,
} from "./convert/index.ts";

// Import/export codecs (PNG directory with manifest, APNG preview). The manifest wire-format
// internals (readManifest/writeManifest and friends) stay io/-internal, like the PNG codec.
export { exportPngDirectory, importPngDirectory } from "./io/png-directory.ts";
// `importApng` stays io/-internal: no consumer outside this package decodes an APNG, and its round-trip
// test reaches it by module path.
export { exportApngPerDirection } from "./io/apng-io.ts";
