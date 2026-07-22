import { type Rgba } from "../model/animation.ts";
import { PNG_SIGNATURE, writeChunk } from "./chunk.ts";
import { buildIhdr, buildPlte, buildTrns, deflateScanlines } from "./encode.ts";

export interface ApngFrame {
    width: number;
    height: number;
    pixels: Uint8Array;
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
