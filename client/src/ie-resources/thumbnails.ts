/**
 * Turning a game resource into a small inline picture: which types can be drawn, and the bytes to draw.
 *
 * Its own module for the same reason `editor-routing` is - the "can this be shown" predicate is asked at row
 * build time, long before and far from the decode, and the two must answer about the same set of types or a
 * field reserves a thumbnail slot nothing ever fills.
 */

import { encodeIndexedPng, loadImage, transparentIndexOf } from "@bgforge/image";

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
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

/** Longest edge of a decoded BAM frame worth re-encoding; see `bamFramePng`. */
const MAX_FRAME_EDGE = 1024;

/**
 * A `data:` URI for the resource's bytes, or undefined when it cannot be drawn.
 *
 * Undefined rather than a throw for every failure - a corrupt or unparseable icon is a missing picture, not a
 * reason to fail the field it sits beside, and a mod archive is exactly where a malformed BAM turns up.
 */
export function thumbnailDataUri(bytes: Uint8Array, ext: string, resref: string): string | undefined {
    if (bytes.length > MAX_SOURCE_BYTES) return;
    const how = DRAWABLE.get(ext.toLowerCase());
    if (how === undefined) return;
    try {
        if (how === "bam") return dataUri("image/png", bamFramePng(bytes, resref));
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
function bamFramePng(bytes: Uint8Array, resref: string): Uint8Array {
    const animation = loadImage(bytes, `${resref}.bam`);
    const frame = animation.frames[0];
    if (frame === undefined) throw new Error("BAM has no frames");
    // The source cap above bounds the file, not the picture: BAM frames are RLE-compressed, and a resref field
    // is free text, so an icon field pointed at a creature animation would re-encode a huge frame for an 18px
    // box. No icon or portrait approaches this.
    if (frame.width > MAX_FRAME_EDGE || frame.height > MAX_FRAME_EDGE) throw new Error("frame too large to preview");
    return encodeIndexedPng(
        frame.width,
        frame.height,
        frame.pixels,
        animation.palette,
        transparentIndexOf(animation.meta),
    );
}

/** base64 without `Buffer`: the extension host is a web worker under some hosts, where only `btoa` exists. */
function dataUri(mediaType: string, bytes: Uint8Array): string {
    let binary = "";
    // oxlint-disable-next-line unicorn/prefer-code-point -- btoa needs one char per raw byte, not a code point.
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `data:${mediaType};base64,${btoa(binary)}`;
}
