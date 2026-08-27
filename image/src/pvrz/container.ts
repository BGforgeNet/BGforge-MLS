import zlib from "zlib";
import { MAX_INFLATED_BYTES } from "../limits.ts";
import { decodeBc1, decodeBc3, encodeBc1, encodeBc3 } from "./bc.ts";
import { type PvrFormat, type PvrTexture } from "./texture.ts";

// PVR v3 container: 52-byte header, magic 'PVR\x03' as a little-endian dword, then the texture
// data. Only the fields below are load-bearing here - the games ship single-surface, single-face,
// mip-level-1 textures, and the remaining header fields describe variation none of them use.
const PVR_MAGIC = 0x03525650;
const PVR_HEADER_BYTES = 52;

// PVR pixel-format codes. The desktop games are limited to these two; the mobile builds use
// formats (PVRTC, ETC) that no desktop asset carries.
const PIXEL_FORMAT: Record<number, PvrFormat> = { 7: "bc1", 11: "bc3" };

/** Bytes per 4x4 block, which is the whole size difference between the two formats. */
const BLOCK_BYTES: Record<PvrFormat, number> = { bc1: 8, bc3: 16 };

/** Encode an RGBA texture as a PVRZ, in the block format the texture declares. */
export function encodePvrz(texture: PvrTexture): Uint8Array {
    const { width, height, format, rgba } = texture;
    const blocks = (format === "bc1" ? encodeBc1 : encodeBc3)(rgba, width, height);

    const payload = new Uint8Array(PVR_HEADER_BYTES + blocks.byteLength);
    const view = new DataView(payload.buffer);
    view.setUint32(0x00, PVR_MAGIC, true);
    view.setUint32(0x08, format === "bc1" ? 7 : 11, true);
    view.setUint32(0x18, height, true);
    view.setUint32(0x1c, width, true);
    // Single-surface, single-face, one mip level and no metadata: the shape every shipped game
    // texture uses, and the only shape decodePvrz reads back.
    view.setUint32(0x20, 1, true);
    view.setUint32(0x24, 1, true);
    view.setUint32(0x28, 1, true);
    view.setUint32(0x2c, 1, true);
    payload.set(blocks, PVR_HEADER_BYTES);

    const compressed = zlib.deflateSync(Buffer.from(payload));
    const out = new Uint8Array(4 + compressed.length);
    new DataView(out.buffer).setUint32(0, payload.byteLength, true);
    out.set(compressed, 4);
    return out;
}

/** Decode a PVRZ (zlib-wrapped PVR v3) into a decompressed RGBA texture. */
export function decodePvrz(bytes: Uint8Array): PvrTexture {
    if (bytes.byteLength < 4) throw new Error("decodePvrz: PVRZ truncated before its length prefix");
    const declared = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
    if (declared > MAX_INFLATED_BYTES) {
        throw new Error(
            `decodePvrz: declared uncompressed size ${declared} exceeds the ${MAX_INFLATED_BYTES}-byte cap`,
        );
    }

    let inflated: Uint8Array;
    try {
        // The declared size doubles as the inflate cap, so a crafted stream cannot out-inflate its
        // own header claim - the same guard decodeBamc applies to the BAMC container.
        inflated = new Uint8Array(
            zlib.inflateSync(Buffer.from(bytes.subarray(4)), { maxOutputLength: Math.max(declared, 1) }),
        );
    } catch (error) {
        throw new Error(`decodePvrz: decompression failed: ${error instanceof Error ? error.message : String(error)}`, {
            cause: error,
        });
    }

    if (inflated.byteLength < PVR_HEADER_BYTES) throw new Error("decodePvrz: PVR header truncated");
    const view = new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength);
    if (view.getUint32(0x00, true) !== PVR_MAGIC) {
        throw new Error("decodePvrz: not a PVR v3 texture (bad magic)");
    }

    const pixelFormat = view.getUint32(0x08, true);
    const format = PIXEL_FORMAT[pixelFormat];
    if (format === undefined) {
        throw new Error(`decodePvrz: unsupported PVR pixel format ${pixelFormat} - only BC1 (7) and BC3 (11) ship`);
    }

    // Height precedes width in the PVR v3 header. Verified against a known 1024x512 game texture
    // rather than read off a field list, because transposing them yields a plausible-looking image.
    const height = view.getUint32(0x18, true);
    const width = view.getUint32(0x1c, true);

    const blocks = inflated.subarray(PVR_HEADER_BYTES + view.getUint32(0x30, true));
    const needed = Math.ceil(width / 4) * Math.ceil(height / 4) * BLOCK_BYTES[format];
    if (blocks.byteLength < needed) {
        throw new Error(
            `decodePvrz: texture data truncated - ${width}x${height} ${format} needs ${needed} bytes, has ${blocks.byteLength}`,
        );
    }

    return { width, height, format, rgba: (format === "bc1" ? decodeBc1 : decodeBc3)(blocks, width, height) };
}
