/**
 * Turning a game resource into a small inline picture: which types can be drawn, and the bytes to draw.
 *
 * Its own module for the same reason `editor-routing` is - the "can this be shown" predicate is asked at row
 * build time, long before and far from the decode, and the two must answer about the same set of types or a
 * field reserves a thumbnail slot nothing ever fills.
 */

import {
    type PvrzResolver,
    decodeBamV1Frames,
    decodeBamV2,
    encodeIndexedPng,
    encodeTruecolourPng,
    isBamV2,
    parseFrm,
    pvrzResourceName,
    readBamV1Tables,
    readBamV2Structure,
    transparentIndexOf,
} from "@bgforge/image";
import { chooseActivePalette } from "../image-editor/sidecar";

/**
 * How each drawable type reaches an `<img>`. A format a browser decodes itself needs only its media type;
 * anything else needs a decoder, so the value carries which.
 *
 * BMP is the whole reason this is not just "formats we decode": IE portraits are BMP, Chromium reads BMP, and
 * re-encoding them would be work to arrive back where we started.
 */
const DRAWABLE = new Map<string, "passthrough:image/bmp" | "bam" | "frm">([
    ["bmp", "passthrough:image/bmp"],
    ["bam", "bam"],
    ["frm", "frm"],
]);

/**
 * Whether a resource of this type can be rendered as a thumbnail. Asked per ROW so the view can reserve the
 * slot before any bytes are fetched - a picture that appeared once it loaded would reflow the field grid,
 * which the editor's layout rules forbid.
 */
export function canThumbnail(ext: string): boolean {
    return DRAWABLE.has(ext.toLowerCase());
}

/**
 * A cap on what will be turned into a thumbnail, applied to the SOURCE bytes.
 *
 * Every drawable resource crosses a `postMessage` boundary base64-encoded, so its bytes cost ~4/3 their size in
 * a string the webview then holds. Real icons and portraits are tens of KB; the bound is loose enough that no
 * real asset trips it and tight enough that a mod's full-screen BMP does not put a megabyte on the wire for an
 * 18px box.
 */
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

/**
 * A `data:` URI for the resource's bytes drawn at `size`, or undefined when it cannot be drawn.
 *
 * Undefined rather than a throw for every failure - a corrupt or unparseable icon is a missing picture, not a
 * reason to fail the field it sits beside, and a mod archive is exactly where a malformed BAM turns up.
 */
export function thumbnailDataUri(
    bytes: Uint8Array,
    ext: string,
    size: number,
    pvrz?: PvrzResolver,
): string | undefined {
    if (bytes.length > MAX_SOURCE_BYTES) return;
    const how = DRAWABLE.get(ext.toLowerCase());
    if (how === undefined) return;
    try {
        if (how === "frm") return dataUri("image/png", frmFramePng(bytes, size));
        if (how === "bam") {
            // v1 and v2 share the "BAM " tag and are entirely different formats behind it; dispatch on the
            // signature rather than the caller's extension, which cannot tell them apart.
            if (isBamV2(bytes)) return dataUri("image/png", bamV2FramePng(bytes, size, pvrz));
            return dataUri("image/png", bamFramePng(bytes, size));
        }
        // BMP crosses unchanged and so is not downscaled: there is no BMP decoder here to downscale WITH, and
        // re-encoding it would undo the passthrough this branch exists for.
        return dataUri(how.slice("passthrough:".length), bytes);
    } catch {
        // Deliberately swallowed, per the contract above: a malformed icon leaves the field with no picture,
        // which is the same state as a field whose type has none.
        return undefined;
    }
}

/**
 * The first frame of a BAM, as an indexed PNG.
 *
 * First frame, not the first frame of the first SEQUENCE: an icon BAM's sequences are its states (enabled,
 * pressed, disabled) over the same artwork, so frame 0 is the representative image either way - and a BAM whose
 * sequence table is empty still has frames to show.
 */
function bamFramePng(bytes: Uint8Array, size: number): Uint8Array {
    // Only the sampled frames are decoded, not the whole animation: a creature BAM has hundreds of frames and
    // a tile shows at most four. `decodeBamV1Frames` handles BAMC, which is what most shipped BAMs are.
    const tables = readBamV1Tables(bytes);
    const cells = composeCells(firstFrameOfEachCycle(tables));
    const frames = decodeBamV1Frames(
        bytes,
        cells.map((c) => c.index),
    );

    const drawn = cells.flatMap((cell) => {
        const frame = frames.get(cell.index);
        if (frame === undefined) return [];
        // One cell is the whole tile; four cells are half of it each.
        const box = cells.length === 1 ? size : Math.max(1, Math.floor(size / 2));
        return [{ cell: cell.cell, ...downscaleIndexed(frame.pixels, frame.width, frame.height, box) }];
    });
    const first = drawn[0];
    if (first === undefined) throw new Error("BAM has no frames");
    if (drawn.length === 1) {
        return encodeIndexedPng(first.width, first.height, first.pixels, tables.palette, tables.transparentIndex);
    }

    // The cell edge comes from the largest picture actually drawn, not from `size`: small art must not be
    // stranded in the corner of a mostly-empty canvas just because the tile box is large.
    const edge = Math.max(...drawn.map((d) => Math.max(d.width, d.height)));
    const canvas = new Uint8Array(edge * 2 * edge * 2).fill(tables.transparentIndex);
    for (const d of drawn) {
        // Centred in its cell, so cells of unequal art still read as a 2x2 grid.
        const originX = (d.cell % 2) * edge + Math.floor((edge - d.width) / 2);
        const originY = Math.floor(d.cell / 2) * edge + Math.floor((edge - d.height) / 2);
        for (let y = 0; y < d.height; y++) {
            canvas.set(d.pixels.subarray(y * d.width, (y + 1) * d.width), (originY + y) * edge * 2 + originX);
        }
    }
    return encodeIndexedPng(edge * 2, edge * 2, canvas, tables.palette, tables.transparentIndex);
}

/**
 * The frame each cycle opens on, in cycle order. A cycle with no frames contributes nothing, and a BAM with no
 * usable cycle table falls back to frame 0 - such a file still has frames to show, and refusing to draw it
 * would be a blank tile for a picture that exists.
 */
function firstFrameOfEachCycle(tables: { sequences: readonly { frameRefs: readonly number[] }[] }): number[] {
    const opens = tables.sequences.flatMap((s) => (s.frameRefs[0] === undefined ? [] : [s.frameRefs[0]]));
    return opens.length > 0 ? opens : [0];
}

/**
 * Which frames a tile shows and where, from the frame each cycle opens on.
 *
 * Counted by DISTINCT frame: an icon BAM's cycles are its states (enabled, pressed, disabled) over the same
 * artwork, so four cycles of one frame is one picture, not a grid of four identical ones. Two go on the
 * diagonal, which reads as two things rather than as a half-empty grid.
 */
export function composeCells(firstFrames: readonly number[]): { index: number; cell: 0 | 1 | 2 | 3 }[] {
    const CELLS = { 1: [0], 2: [0, 3], 3: [0, 1, 2], 4: [0, 1, 2, 3] } as const;
    const distinct = [...new Set(firstFrames)].slice(0, 4);
    const layout = CELLS[Math.max(1, distinct.length) as 1 | 2 | 3 | 4];
    return distinct.map((index, at) => ({ index, cell: layout[at]! }));
}

/**
 * Every PVRZ page a BAM v2 needs, by RESOURCE name, so a caller can resolve them before any decode.
 *
 * Empty for anything that is not a v2, so a caller need not sniff the format first. The names come from
 * `pvrzResourceName` rather than being rebuilt here - one derivation of what a page is called.
 */
export function requiredPvrzPages(bytes: Uint8Array): string[] {
    if (!isBamV2(bytes)) return [];
    try {
        return readBamV2Structure(bytes).requiredPages.map((page) => pvrzResourceName(page));
    } catch {
        return [];
    }
}

/**
 * The first frame of a BAM v2, whose pixels live in sibling PVRZ pages rather than in the file.
 *
 * True colour, so this is the one path that cannot produce an indexed PNG.
 */
function bamV2FramePng(bytes: Uint8Array, size: number, pvrz: PvrzResolver | undefined): Uint8Array {
    // No resolver means the caller cannot supply pages, so there is no picture to draw - not an error.
    if (pvrz === undefined) throw new Error("BAM v2 needs a PVRZ resolver");
    const animation = decodeBamV2(readBamV2Structure(bytes), pvrz, bytes);
    const frame = animation.frames[0];
    if (frame === undefined) throw new Error("BAM has no frames");
    const small = downscaleRgba(frame.pixels, frame.width, frame.height, size);
    return encodeTruecolourPng(small.width, small.height, small.pixels);
}

/**
 * The first frame of an FRM.
 *
 * An FRM carries no palette: `parseFrm` returns 256 opaque blacks, so drawing it as-is renders every tile
 * solid black. `chooseActivePalette` is the repo's one resolution of which palette an FRM renders with, and
 * with no sidecar available here it yields the shared Fallout default.
 */
function frmFramePng(bytes: Uint8Array, size: number): Uint8Array {
    const animation = parseFrm(bytes);
    const frame = animation.frames[0];
    if (frame === undefined) throw new Error("FRM has no frames");
    const palette = chooseActivePalette({
        sourceFormat: animation.meta.sourceFormat,
        embedded: animation.palette,
        externalEnabled: false,
    });
    const small = downscaleIndexed(frame.pixels, frame.width, frame.height, size);
    return encodeIndexedPng(small.width, small.height, small.pixels, palette, transparentIndexOf(animation.meta));
}

/** The RGBA twin of `downscaleIndexed` - same nearest-neighbour rule over 4 bytes per pixel. */
function downscaleRgba(
    src: Uint8Array,
    w: number,
    h: number,
    max: number,
): { pixels: Uint8Array; width: number; height: number } {
    const scale = Math.min(1, max / Math.max(w, h));
    if (scale >= 1) return { pixels: src, width: w, height: h };
    const width = Math.max(1, Math.round(w * scale));
    const height = Math.max(1, Math.round(h * scale));
    const out = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        const sy = Math.min(h - 1, Math.floor((y * h) / height));
        for (let x = 0; x < width; x++) {
            const sx = Math.min(w - 1, Math.floor((x * w) / width));
            out.set(src.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * width + x) * 4);
        }
    }
    return { pixels: out, width, height };
}

/**
 * Nearest-neighbour, not averaging: the result stays palette-indexed (averaging blends across palette entries
 * and would force a truecolour re-encode) and it is the right filter for pixel art. Downscale only - a small
 * icon in a large tile draws at its own size rather than being smeared up to fill it.
 */
function downscaleIndexed(
    src: Uint8Array,
    w: number,
    h: number,
    max: number,
): { pixels: Uint8Array; width: number; height: number } {
    const scale = Math.min(1, max / Math.max(w, h));
    if (scale >= 1) return { pixels: src, width: w, height: h };
    const width = Math.max(1, Math.round(w * scale));
    const height = Math.max(1, Math.round(h * scale));
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        const sy = Math.min(h - 1, Math.floor((y * h) / height));
        for (let x = 0; x < width; x++) {
            out[y * width + x] = src[sy * w + Math.min(w - 1, Math.floor((x * w) / width))]!;
        }
    }
    return { pixels: out, width, height };
}

/** base64 without `Buffer`: the extension host is a web worker under some hosts, where only `btoa` exists. */
function dataUri(mediaType: string, bytes: Uint8Array): string {
    let binary = "";
    // oxlint-disable-next-line unicorn/prefer-code-point -- btoa needs one char per raw byte, not a code point.
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `data:${mediaType};base64,${btoa(binary)}`;
}
