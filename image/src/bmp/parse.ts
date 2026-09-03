/**
 * A reader for the BMP variants an Infinity Engine install ships.
 *
 * Deliberately not a general BMP library: 4-, 8-, 24- and 32-bit uncompressed plus 32-bit BI_BITFIELDS cover
 * every bitmap in a shipped game, and RLE4/RLE8 appear in none. Anything else is refused, because a wrong
 * guess at a pixel layout draws a plausible-looking picture rather than failing.
 *
 * Output is RGBA rather than the indexed pair the BAM and FRM readers return: the palette is per file and
 * carries no meaning past this decode, so keeping it would only oblige every consumer to resolve it.
 */
import { MAX_FRAME_PIXELS } from "../limits.ts";

export interface BmpImage {
    width: number;
    height: number;
    /** Row-major, top-down, four bytes per pixel. */
    rgba: Uint8Array;
}

const FILE_HEADER_BYTES = 14;
const CORE_DIB_BYTES = 40;
/** BI_RGB and BI_BITFIELDS - the only two an install uses. */
const COMPRESSION_RGB = 0;
const COMPRESSION_BITFIELDS = 3;

export function readBmpRgba(bytes: Uint8Array): BmpImage {
    if (bytes.length < FILE_HEADER_BYTES + CORE_DIB_BYTES || bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
        throw new Error("readBmpRgba: not a BMP file");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const pixelOffset = view.getUint32(10, true);
    const headerSize = view.getUint32(14, true);
    const width = view.getInt32(18, true);
    const signedHeight = view.getInt32(22, true);
    const height = Math.abs(signedHeight);
    const bpp = view.getUint16(28, true);
    const compression = view.getUint32(30, true);

    if (width <= 0 || height <= 0) throw new Error(`readBmpRgba: bad dimensions ${width}x${signedHeight}`);
    if (width * height > MAX_FRAME_PIXELS) {
        throw new Error(`readBmpRgba: ${width}x${height} pixels - implausibly large for a bitmap`);
    }
    if (compression !== COMPRESSION_RGB && compression !== COMPRESSION_BITFIELDS) {
        throw new Error(`readBmpRgba: unsupported compression ${compression}`);
    }
    // 4, 8, 24 and 32 are the depths an install ships. 1 and 2 are named here rather than left to the
    // palette branch, which unpacks two pixels per byte and would read them as nonsense.
    if (bpp !== 4 && bpp !== 8 && bpp !== 24 && bpp !== 32) {
        throw new Error(`readBmpRgba: unsupported bit depth ${bpp}`);
    }
    if (compression === COMPRESSION_BITFIELDS && bpp !== 32) {
        throw new Error(`readBmpRgba: unsupported compression ${compression} at ${bpp}bpp`);
    }

    const palette = bpp <= 8 ? readPalette(view, bytes, headerSize, bpp) : undefined;
    const stride = Math.ceil((width * bpp) / 32) * 4;
    if (pixelOffset + stride * height > bytes.length) throw new Error("readBmpRgba: pixel data runs past EOF");

    const rgba = new Uint8Array(width * height * 4);
    const readPixel = pixelReader(view, bpp, compression, headerSize, palette);
    for (let y = 0; y < height; y++) {
        // A positive height means the rows are stored bottom-up, which is the default and what every shipped
        // bitmap uses; a negative one means they are already in top-down order.
        const row = signedHeight > 0 ? height - 1 - y : y;
        const rowStart = pixelOffset + row * stride;
        for (let x = 0; x < width; x++) readPixel(rowStart, x, rgba, (y * width + x) * 4);
    }
    return { width, height, rgba };
}

function readPalette(view: DataView, bytes: Uint8Array, headerSize: number, bpp: number): Uint8Array {
    const declared = view.getUint32(46, true);
    const count = declared === 0 ? 1 << bpp : declared;
    const at = FILE_HEADER_BYTES + headerSize;
    const palette = new Uint8Array((1 << bpp) * 4);
    for (let i = 0; i < count && at + i * 4 + 2 < bytes.length; i++) {
        // Stored BGR plus a reserved byte; the reserved byte is not alpha, so entries are opaque.
        palette[i * 4] = bytes[at + i * 4 + 2]!;
        palette[i * 4 + 1] = bytes[at + i * 4 + 1]!;
        palette[i * 4 + 2] = bytes[at + i * 4]!;
        palette[i * 4 + 3] = 0xff;
    }
    return palette;
}

type PixelReader = (rowStart: number, x: number, out: Uint8Array, at: number) => void;

function pixelReader(
    view: DataView,
    bpp: number,
    compression: number,
    headerSize: number,
    palette: Uint8Array | undefined,
): PixelReader {
    // Read through the DataView rather than indexing the array: the caller has already bounded every offset
    // against the file length, so a `?? 0` fallback here would be an unreachable branch pretending to be a
    // guard - and `getUint8` throws rather than silently reading a zero if that bound is ever wrong.
    if (palette) {
        // 4bpp packs two pixels per byte, high nibble first.
        const perByte = 8 / bpp;
        return (rowStart, x, out, at) => {
            const byte = view.getUint8(rowStart + Math.floor(x / perByte));
            const index = bpp === 8 ? byte : (byte >> (4 * (1 - (x % 2)))) & 0x0f;
            out.set(palette.subarray(index * 4, index * 4 + 4), at);
        };
    }
    if (bpp === 24 || compression === COMPRESSION_RGB) {
        // BI_RGB's fourth byte at 32bpp is undefined rather than alpha, so both depths read three channels
        // and an opaque alpha: a file whose padding bytes happen to be zero would otherwise decode to a
        // fully transparent image.
        const step = bpp === 24 ? 3 : 4;
        return (rowStart, x, out, at) => {
            const p = rowStart + x * step;
            out[at] = view.getUint8(p + 2);
            out[at + 1] = view.getUint8(p + 1);
            out[at + 2] = view.getUint8(p);
            out[at + 3] = 0xff;
        };
    }

    // BI_BITFIELDS. The masks sit at the same file offset either way - immediately after a 40-byte header, or
    // in the corresponding fields of a V4/V5 one - so only the alpha mask depends on the header being longer.
    const masksAt = FILE_HEADER_BYTES + CORE_DIB_BYTES;
    const channels = [0, 4, 8].map((delta) => channelOf(view.getUint32(masksAt + delta, true)));
    const alpha = headerSize >= CORE_DIB_BYTES + 16 ? channelOf(view.getUint32(masksAt + 12, true)) : undefined;
    return (rowStart, x, out, at) => {
        const raw = view.getUint32(rowStart + x * 4, true);
        out[at] = channels[0]!(raw);
        out[at + 1] = channels[1]!(raw);
        out[at + 2] = channels[2]!(raw);
        out[at + 3] = alpha === undefined ? 0xff : alpha(raw);
    };
}

/** Extracts one masked channel and scales it to a full byte, so a 5-bit channel still reaches 255. */
function channelOf(mask: number): (raw: number) => number {
    if (mask === 0) return () => 0xff;
    let shift = 0;
    while (((mask >>> shift) & 1) === 0) shift++;
    const span = (mask >>> shift) + 1; // masks are contiguous, so this is 2^bits
    return (raw) => Math.round((((raw & mask) >>> shift) * 255) / (span - 1));
}
