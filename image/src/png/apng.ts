import zlib from "zlib";
import { type Rgba, emptyPalette } from "../model/animation.ts";
import { PNG_SIGNATURE, readChunks, writeChunk } from "./chunk.ts";
import { buildIhdr, buildPlte, buildTrns, deflateScanlines } from "./encode.ts";
import { unfilterScanlines } from "./decode.ts";

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

/**
 * Hand-rolled colour-type-3 (indexed) APNG encoder: default image is frame 0
 * (IHDR/IDAT), later frames ride fdAT chunks, all sharing one PLTE/tRNS.
 * Chunk order: signature, IHDR, acTL, PLTE, tRNS, [fcTL, IDAT], [fcTL, fdAT]..., IEND.
 */
export function encodeApng(frames: ApngFrame[], palette: Rgba[], transparentIndex: number, fps: number): Uint8Array {
    const first = frames[0];
    if (!first) {
        throw new Error("encodeApng: at least one frame is required");
    }
    const delayDen = fps || 10;

    const parts: Uint8Array[] = [
        PNG_SIGNATURE,
        writeChunk("IHDR", buildIhdr(first.width, first.height)),
        writeChunk("acTL", buildAcTl(frames.length)),
        writeChunk("PLTE", buildPlte(palette)),
        writeChunk("tRNS", buildTrns(transparentIndex)),
    ];

    let sequenceNumber = 0;
    for (const [index, frame] of frames.entries()) {
        parts.push(writeChunk("fcTL", buildFcTl(sequenceNumber, frame.width, frame.height, delayDen)));
        sequenceNumber++;
        const payload = deflateScanlines(frame.width, frame.height, frame.pixels);
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
 */
export function decodeApng(bytes: Uint8Array): DecodedApng {
    const chunks = readChunks(bytes);

    const ihdr = chunks.find((c) => c.type === "IHDR");
    if (!ihdr) {
        throw new Error("decodeApng: missing IHDR chunk");
    }
    const bitDepth = ihdr.data[8];
    const colourType = ihdr.data[9];
    if (bitDepth === undefined || colourType === undefined) {
        throw new Error("decodeApng: truncated IHDR chunk");
    }
    if (colourType !== 3 || bitDepth !== 8) {
        throw new Error(
            `decodeApng: not an 8-bit indexed APNG (colour type ${colourType}); import requires indexed APNGs`,
        );
    }

    const palette = emptyPalette();
    const plte = chunks.find((c) => c.type === "PLTE");
    if (plte) {
        const entryCount = Math.min(Math.floor(plte.data.length / 3), 256);
        for (let i = 0; i < entryCount; i++) {
            const r = plte.data[i * 3];
            const g = plte.data[i * 3 + 1];
            const b = plte.data[i * 3 + 2];
            const existing = palette[i];
            if (r === undefined || g === undefined || b === undefined || !existing) continue;
            palette[i] = { r, g, b, a: existing.a };
        }
    }

    const trns = chunks.find((c) => c.type === "tRNS");
    if (trns) {
        const entryCount = Math.min(trns.data.length, 256);
        for (let i = 0; i < entryCount; i++) {
            const alpha = trns.data[i];
            const existing = palette[i];
            if (alpha === undefined || !existing) continue;
            palette[i] = { ...existing, a: alpha };
        }
    }
    let transparentIndex = 0;
    for (const [i, entry] of palette.entries()) {
        if (entry.a === 0) {
            transparentIndex = i;
            break;
        }
    }

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
        const raw = new Uint8Array(zlib.inflateSync(Buffer.from(compressed)));
        const pixels = unfilterScanlines(raw, width, height);
        frames.push({ width, height, pixels });
    }

    if (declaredFrameCount !== undefined && declaredFrameCount !== frames.length) {
        throw new Error(`decodeApng: acTL declared ${declaredFrameCount} frames but found ${frames.length}`);
    }

    return { palette, transparentIndex, fps, frames };
}
