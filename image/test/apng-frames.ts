import { PNG_SIGNATURE, readChunks, writeChunk } from "../src/png/chunk.ts";
import { type DecodedIndexedPng, decodeIndexedPng } from "../src/png/decode.ts";

/**
 * Every frame of an APNG the encoder wrote, each decoded as the plain PNG it would be on its own, plus the fps
 * the first fcTL declares. Assumes the encoder's layout: one IDAT for the default image, one fdAT per later
 * frame, every frame filling the IHDR canvas.
 */
export function readApngFrames(bytes: Uint8Array): { fps: number; frames: DecodedIndexedPng[] } {
    const chunks = readChunks(bytes);
    const ihdr = chunks.find((c) => c.type === "IHDR");
    const fcTl = chunks.find((c) => c.type === "fcTL");
    if (!ihdr || !fcTl) throw new Error("readApngFrames: IHDR or fcTL chunk missing");
    const view = new DataView(fcTl.data.buffer, fcTl.data.byteOffset, fcTl.data.byteLength);
    const fps = view.getUint16(22, false) / view.getUint16(20, false);

    const shared = chunks.filter((c) => c.type === "PLTE" || c.type === "tRNS");
    const frames = chunks
        .filter((c) => c.type === "IDAT" || c.type === "fdAT")
        .map((c) => {
            // An fdAT payload leads with a 4-byte sequence number that an IDAT payload lacks.
            const payload = c.type === "fdAT" ? c.data.subarray(4) : c.data;
            const parts = [
                PNG_SIGNATURE,
                writeChunk("IHDR", ihdr.data),
                ...shared.map((s) => writeChunk(s.type, s.data)),
                writeChunk("IDAT", payload),
                writeChunk("IEND", new Uint8Array(0)),
            ];
            const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
            let offset = 0;
            for (const part of parts) {
                png.set(part, offset);
                offset += part.length;
            }
            return decodeIndexedPng(png);
        });
    return { fps, frames };
}
