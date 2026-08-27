import zlib from "zlib";
import { type Rgba } from "../model/animation.ts";
import { MAX_FRAME_PIXELS } from "../limits.ts";
import { PNG_SIGNATURE, readChunks, writeChunk } from "./chunk.ts";
import { buildIhdr, buildPlte, buildTrns, deflateScanlines } from "./encode.ts";
import { parseHeaderAndPalette, unfilterScanlines } from "./decode.ts";

export interface ApngFrame {
    width: number;
    height: number;
    pixels: Uint8Array;
}

export interface DecodedApng {
    palette: Rgba[];
    transparentIndex: number;
    fps: number;
    frames: ApngFrame[];
}

function buildAcTl(numFrames: number): Uint8Array {
    const data = new Uint8Array(8);
    const view = new DataView(data.buffer);
    view.setUint32(0, numFrames, false);
    view.setUint32(4, 0, false); // num_plays: 0 = loop forever
    return data;
}

function buildFcTl(sequenceNumber: number, width: number, height: number, delayDen: number): Uint8Array {
    const data = new Uint8Array(26);
    const view = new DataView(data.buffer);
    view.setUint32(0, sequenceNumber, false);
    view.setUint32(4, width, false);
    view.setUint32(8, height, false);
    view.setUint32(12, 0, false); // x_offset
    view.setUint32(16, 0, false); // y_offset
    view.setUint16(20, 1, false); // delay_num
    view.setUint16(22, delayDen, false);
    data[24] = 1; // dispose_op: APNG_DISPOSE_OP_BACKGROUND
    data[25] = 0; // blend_op: APNG_BLEND_OP_SOURCE
    return data;
}

function buildFdAt(sequenceNumber: number, payload: Uint8Array): Uint8Array {
    const data = new Uint8Array(4 + payload.length);
    const view = new DataView(data.buffer);
    view.setUint32(0, sequenceNumber, false);
    data.set(payload, 4);
    return data;
}

/** How one colour model fills in the parts of the encoder that differ between them. */
interface ApngColourModel {
    /** IHDR colour type: 3 for indexed, 6 for true colour with alpha. */
    colourType: number;
    bytesPerPixel: number;
    /** Chunks written between acTL and the first fcTL - PLTE/tRNS for indexed, none for true colour. */
    colourChunks: Uint8Array[];
    /** One pixel's worth of bytes, used to fill the canvas around a smaller frame. */
    padPixel: readonly number[];
}

/** Centre `frame` on a canvasWidth x canvasHeight canvas of `padPixel`s. Returns the pixels
 *  unchanged when the frame already fills the canvas. */
function padFrameToCanvas(
    frame: ApngFrame,
    canvasWidth: number,
    canvasHeight: number,
    model: ApngColourModel,
): Uint8Array {
    if (frame.width === canvasWidth && frame.height === canvasHeight) return frame.pixels;
    const bpp = model.bytesPerPixel;
    const out = new Uint8Array(canvasWidth * canvasHeight * bpp);
    // Skipped for an all-zero pad pixel, which the allocation already gives - the true-colour case,
    // where transparent IS zero. Same skip as blitBytes in model/anchor-align.ts.
    if (model.padPixel.some((byte) => byte !== 0)) {
        for (let p = 0; p < canvasWidth * canvasHeight; p++) out.set(model.padPixel, p * bpp);
    }
    const dx = Math.floor((canvasWidth - frame.width) / 2);
    const dy = Math.floor((canvasHeight - frame.height) / 2);
    for (let y = 0; y < frame.height; y++) {
        const src = y * frame.width * bpp;
        out.set(frame.pixels.subarray(src, src + frame.width * bpp), ((y + dy) * canvasWidth + dx) * bpp);
    }
    return out;
}

/**
 * The APNG container, in whichever colour model `model` describes: default image is frame 0
 * (IHDR/IDAT), later frames ride fdAT chunks. Chunk order: signature, IHDR, acTL, [colour chunks],
 * [fcTL, IDAT], [fcTL, fdAT]..., IEND.
 */
function encodeApngWith(frames: ApngFrame[], fps: number, model: ApngColourModel): Uint8Array {
    if (frames.length === 0) {
        // Names the operation, not this function: both encodeApng and encodeTruecolourApng land here.
        throw new Error("APNG encode: at least one frame is required");
    }
    const delayDen = fps || 10;

    // The IHDR canvas is the max frame size, and EVERY frame - the IDAT default image included - is
    // padded to it (centred, transparent). A default image (or any frame) smaller than IHDR is a
    // malformed PNG that spec-compliant decoders (Chromium / the VS Code image viewer) reject outright;
    // FRM frames within a direction differ in size, so this padding is what keeps the export loadable.
    const canvasWidth = Math.max(...frames.map((f) => f.width));
    const canvasHeight = Math.max(...frames.map((f) => f.height));

    const parts: Uint8Array[] = [
        PNG_SIGNATURE,
        writeChunk("IHDR", buildIhdr(canvasWidth, canvasHeight, model.colourType)),
        writeChunk("acTL", buildAcTl(frames.length)),
        ...model.colourChunks,
    ];

    let sequenceNumber = 0;
    for (const [index, frame] of frames.entries()) {
        const pixels = padFrameToCanvas(frame, canvasWidth, canvasHeight, model);
        parts.push(writeChunk("fcTL", buildFcTl(sequenceNumber, canvasWidth, canvasHeight, delayDen)));
        sequenceNumber++;
        const payload = deflateScanlines(canvasWidth, canvasHeight, pixels, model.bytesPerPixel);
        if (index === 0) {
            parts.push(writeChunk("IDAT", payload));
        } else {
            parts.push(writeChunk("fdAT", buildFdAt(sequenceNumber, payload)));
            sequenceNumber++;
        }
    }
    parts.push(writeChunk("IEND", new Uint8Array(0)));

    const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

/** Colour-type-3 (indexed) APNG: every frame shares one PLTE/tRNS, and padding is the transparent index. */
export function encodeApng(frames: ApngFrame[], palette: Rgba[], transparentIndex: number, fps: number): Uint8Array {
    return encodeApngWith(frames, fps, {
        colourType: 3,
        bytesPerPixel: 1,
        colourChunks: [writeChunk("PLTE", buildPlte(palette)), writeChunk("tRNS", buildTrns(transparentIndex))],
        padPixel: [transparentIndex],
    });
}

/**
 * Colour-type-6 (true colour with alpha) APNG: no palette chunks at all, and padding is a fully
 * transparent pixel rather than an index into a palette that does not exist.
 */
export function encodeTruecolourApng(frames: ApngFrame[], fps: number): Uint8Array {
    return encodeApngWith(frames, fps, {
        colourType: 6,
        bytesPerPixel: 4,
        colourChunks: [],
        padPixel: [0, 0, 0, 0],
    });
}

// fdAT payloads are prefixed with a 4-byte big-endian sequence number (APNG
// spec) that IDAT payloads lack; strip it so both feed the same inflate path.
function stripFdatSequenceNumber(data: Uint8Array): Uint8Array {
    return data.subarray(4);
}

/**
 * Hand-rolled colour-type-3 (indexed) APNG decoder: inverse of `encodeApng`.
 * Each fcTL starts a frame and carries that frame's width/height, plus - on
 * the first fcTL only - the delay used for fps; the frame's pixel data is the
 * next IDAT (frame 0) or fdAT (later frames) chunk that follows it.
 * Assumes one IDAT/fdAT per frame and that the first fcTL's data chunk is the
 * default image - both guaranteed by our own `encodeApng`; a foreign APNG that
 * splits a frame's data across multiple fdAT chunks is unsupported.
 */
export function decodeApng(bytes: Uint8Array): DecodedApng {
    const chunks = readChunks(bytes);
    const { palette, transparentIndex } = parseHeaderAndPalette(chunks, "decodeApng");

    const acTl = chunks.find((c) => c.type === "acTL");
    const declaredFrameCount = acTl
        ? new DataView(acTl.data.buffer, acTl.data.byteOffset, acTl.data.byteLength).getUint32(0, false)
        : undefined;

    let fps = 10;
    let sawFirstFcTl = false;
    const frames: ApngFrame[] = [];

    for (const [i, chunk] of chunks.entries()) {
        if (chunk.type !== "fcTL") continue;
        const view = new DataView(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength);
        const width = view.getUint32(4, false);
        const height = view.getUint32(8, false);
        if (width === 0 || height === 0 || width * height > MAX_FRAME_PIXELS) {
            throw new Error(`decodeApng: implausible frame dimensions ${width}x${height}`);
        }
        if (!sawFirstFcTl) {
            sawFirstFcTl = true;
            const delayNum = view.getUint16(20, false);
            const delayDen = view.getUint16(22, false);
            fps = delayNum > 0 ? delayDen / delayNum : 10;
        }

        const isFirstFrame = frames.length === 0;
        const dataChunk = chunks.slice(i + 1).find((c) => c.type === "IDAT" || c.type === "fdAT");
        if (!dataChunk) {
            throw new Error("decodeApng: fcTL chunk has no following IDAT/fdAT data");
        }
        const compressed = isFirstFrame ? dataChunk.data : stripFdatSequenceNumber(dataChunk.data);
        // Same inflate cap as decodeIndexedPng: exact raw size for 8-bit indexed, stops zlib bombs.
        let raw: Uint8Array;
        try {
            raw = new Uint8Array(zlib.inflateSync(Buffer.from(compressed), { maxOutputLength: height * (width + 1) }));
        } catch (error) {
            throw new Error(
                `decodeApng: frame decompression failed: ${error instanceof Error ? error.message : String(error)}`,
                {
                    cause: error,
                },
            );
        }
        const pixels = unfilterScanlines(raw, width, height);
        frames.push({ width, height, pixels });
    }

    if (declaredFrameCount !== undefined && declaredFrameCount !== frames.length) {
        throw new Error(`decodeApng: acTL declared ${declaredFrameCount} frames but found ${frames.length}`);
    }

    return { palette, transparentIndex, fps, frames };
}
