export type Rgba = { r: number; g: number; b: number; a: number };
export type Facing = "NE" | "E" | "SE" | "SW" | "W" | "NW" | "N" | "S" | "none";
export type DirectionLayout = "frm6" | "ie8" | "non-directional";
export type SourceFormat = "frm" | "bam" | "bamc";

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
    fps?: number; // FRM only
    actionFrame?: number; // FRM only
    transparentIndex?: number; // BAM only
    directionLayout?: DirectionLayout;
    frmVersion?: number; // FRM header version, preserved for byte-identical round-trip
    dirOffsetsX?: number[]; // FRM only: header x_offset[6], one per direction (0x0A)
    dirOffsetsY?: number[]; // FRM only: header y_offset[6], one per direction (0x16)
}

export interface Animation {
    palette: Rgba[]; // 256 entries
    sequences: Sequence[];
    frames: Frame[];
    meta: AnimationMeta;
}

// Fallout's 6 hexagonal rotations, in header index order 0..5. No due-N or due-S.
export const FRM_FACINGS: Facing[] = ["NE", "E", "SE", "SW", "W", "NW"];

export function emptyPalette(): Rgba[] {
    return Array.from({ length: 256 }, () => ({ r: 0, g: 0, b: 0, a: 255 }));
}
