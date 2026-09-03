/**
 * Turning a game resource into a small inline picture: which types can be drawn, and the bytes to draw.
 *
 * Its own module for the same reason `editor-routing` is - the "can this be shown" predicate is asked at row
 * build time, long before and far from the decode, and the two must answer about the same set of types or a
 * field reserves a thumbnail slot nothing ever fills.
 */

import { decodeBamV1Frames, encodeIndexedPng, readBamV1Tables } from "@bgforge/image";

/**
 * How each drawable type reaches an `<img>`. A format a browser decodes itself needs only its media type;
 * anything else needs a decoder, so the value carries which.
 *
 * BMP is the whole reason this is not just "formats we decode": IE portraits are BMP, Chromium reads BMP, and
 * re-encoding them would be work to arrive back where we started.
 */
const DRAWABLE = new Map<string, "passthrough:image/bmp" | "bam">([
    ["bmp", "passthrough:image/bmp"],
    ["bam", "bam"],
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
 * The sizes a thumbnail is encoded at, in CSS pixels before device-pixel scaling.
 *
 * A ladder rather than the exact box size so the cache keys on a handful of values instead of every layout
 * width a panel can take; a caller rounds its box UP to the first step that covers it.
 */
export const TILE_SIZES = [32, 64, 96, 128] as const;
export type TileSize = (typeof TILE_SIZES)[number];

/**
 * A `data:` URI for the resource's bytes drawn at `size`, or undefined when it cannot be drawn.
 *
 * Undefined rather than a throw for every failure - a corrupt or unparseable icon is a missing picture, not a
 * reason to fail the field it sits beside, and a mod archive is exactly where a malformed BAM turns up.
 */
export function thumbnailDataUri(bytes: Uint8Array, ext: string, size: number): string | undefined {
    if (bytes.length > MAX_SOURCE_BYTES) return;
    const how = DRAWABLE.get(ext.toLowerCase());
    if (how === undefined) return;
    try {
        if (how === "bam") return dataUri("image/png", bamFramePng(bytes, size));
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
    // Only frame 0 is decoded, not the whole animation: a creature BAM has hundreds of frames and a thumbnail
    // shows one. `decodeBamV1Frames` handles BAMC, which is what most shipped BAMs are.
    const tables = readBamV1Tables(bytes);
    const frame = decodeBamV1Frames(bytes, [0]).get(0);
    if (frame === undefined) throw new Error("BAM has no frames");
    const small = downscaleIndexed(frame.pixels, frame.width, frame.height, size);
    return encodeIndexedPng(small.width, small.height, small.pixels, tables.palette, tables.transparentIndex);
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
