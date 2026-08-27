export type Rgba = { r: number; g: number; b: number; a: number };
export type Facing = "NE" | "E" | "SE" | "SW" | "W" | "NW" | "N" | "S" | "none";
export type DirectionLayout = "frm6" | "ie8" | "non-directional";
/** The palette-indexed formats. Split out so an indexed-only consumer's exhaustiveness proofs hold. */
export type IndexedSourceFormat = "frm" | "bam" | "bamc";
export type SourceFormat = IndexedSourceFormat | "bamv2";

export interface Frame {
    width: number;
    height: number;
    pixels: Uint8Array; // indexed, row-major, length width*height
    offsetX: number;
    offsetY: number;
    // Original on-disk bytes for this frame's pixel payload; present when parsed,
    // dropped when a frame is synthesized/edited. Lets an unmodified frame
    // re-serialize verbatim (byte-identical round-trips, preserved RLE-vs-raw choice).
    rawEncoding?: Uint8Array;
    // BAM only: frame stored RLE-compressed on disk.
    rleEncoded?: boolean;
}

export interface Sequence {
    frameRefs: number[]; // indices into Animation.frames
    facing: Facing;
}

export interface AnimationMeta {
    sourceFormat: SourceFormat;
    fps?: number; // FRM: stored header field; BAM: the engine's fixed 15, resolved at parse
    actionFrame?: number; // FRM only
    transparentIndex?: number; // BAM only
    directionLayout?: DirectionLayout;
    frmVersion?: number; // FRM header version, preserved for byte-identical round-trip
    dirOffsetsX?: number[]; // FRM only: header x_offset[6], one per direction (0x0A)
    dirOffsetsY?: number[]; // FRM only: header y_offset[6], one per direction (0x16)
}

/**
 * A true-colour frame. `pixels` is `width * height * 4` RGBA bytes rather than palette indices.
 *
 * No `rawEncoding`/`rleEncoded`: those describe BAM v1's per-frame RLE. A BAM v2 frame's
 * verbatim-preservation state is its source data blocks and pages, which live on the animation.
 */
export interface RgbaFrame {
    width: number;
    height: number;
    pixels: Uint8Array; // RGBA, row-major, length width*height*4
    offsetX: number;
    offsetY: number;
}

/** An indexed animation's metadata, with `sourceFormat` narrowed to the palette-indexed formats. */
export interface IndexedAnimationMeta extends AnimationMeta {
    sourceFormat: IndexedSourceFormat;
}

/** A true-colour animation's metadata. BAM v2 is the only format that reaches it. */
export interface RgbaAnimationMeta extends AnimationMeta {
    sourceFormat: "bamv2";
}

/** FRM, BAM v1 and BAMC: 8-bit indices into a 256-entry palette. */
export interface IndexedAnimation {
    palette: Rgba[]; // 256 entries
    sequences: Sequence[];
    frames: Frame[];
    meta: IndexedAnimationMeta;
    /**
     * Absent, and only ever absent - the marker that discriminates this member of the union.
     *
     * Declaring it here rather than requiring a `colorModel: "indexed"` on every indexed animation
     * keeps the ~83 existing construction sites compiling untouched, while still giving the
     * checker a discriminant it narrows in both directions. A colour model is a whole-file
     * property in both formats, so it belongs on the animation rather than on each frame.
     */
    colorModel?: undefined;
}

/** BAM v2: true colour with real per-pixel alpha, so no palette at all. */
export interface RgbaAnimation {
    colorModel: "rgba";
    sequences: Sequence[];
    frames: RgbaFrame[];
    meta: RgbaAnimationMeta;
}

export type Animation = IndexedAnimation | RgbaAnimation;

/**
 * The one narrowing every consumer of a possibly-true-colour animation shares. Consumers that
 * cannot handle true colour should say so by taking `IndexedAnimation`, not by calling this and
 * throwing.
 */
export function isRgbaAnimation(animation: Animation): animation is RgbaAnimation {
    return animation.colorModel === "rgba";
}

// Fallout's 6 hexagonal rotations, in header index order 0..5. No due-N or due-S.
export const FRM_FACINGS: Facing[] = ["NE", "E", "SE", "SW", "W", "NW"];

export function emptyPalette(): Rgba[] {
    return Array.from({ length: 256 }, () => ({ r: 0, g: 0, b: 0, a: 255 }));
}

// The one resolution of the optional field: absent means the format's convention (FRM: index 0).
// Consumers must resolve through this rather than re-deriving the fallback per call site.
export function transparentIndexOf(meta: AnimationMeta): number {
    return meta.transparentIndex ?? 0;
}
