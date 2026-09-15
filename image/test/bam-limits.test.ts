import { describe, expect, it } from "vitest";
import { parseBamV1 } from "../src/bam/parse.ts";
import { MAX_ANIMATION_PIXELS } from "../src/limits.ts";

/** A BAM V1 whose frame table declares `count` frames of `w`x`h`, all pointing at one RLE run. */
function bamDeclaring(count: number, w: number, h: number): Uint8Array {
    const frameEntry = 0x18;
    const palette = frameEntry + count * 12 + 4; // one cycle entry after the frame table
    const lut = palette + 256 * 4;
    const data = lut + 2;
    const bytes = new Uint8Array(data + 4);
    const view = new DataView(bytes.buffer);
    bytes.set(new TextEncoder().encode("BAM V1  "), 0);
    view.setUint16(0x08, count, true);
    bytes[0x0a] = 1; // one cycle
    bytes[0x0b] = 0; // transparent index
    view.setUint32(0x0c, frameEntry, true);
    view.setUint32(0x10, palette, true);
    view.setUint32(0x14, lut, true);
    for (let i = 0; i < count; i++) {
        const e = frameEntry + i * 12;
        view.setUint16(e, w, true);
        view.setUint16(e + 2, h, true);
        view.setUint32(e + 8, data, true); // every frame shares one data offset
    }
    bytes[data] = 0; // transparent run byte
    bytes[data + 1] = 255;
    return bytes;
    // No cycle entry is written: the cycle table sits at frameEntryOffset + frameCount*12 (parse.ts:108)
    // and reads as zero-filled, which parses. Nothing here needs a cycle.
}

describe("parseBamV1 aggregate bound", () => {
    it("refuses an animation whose DECLARED frames total more than MAX_ANIMATION_PIXELS", () => {
        // 64 frames of 4096x4096 = 1.07e9 declared pixels in a tiny file. The guard must fire on the
        // table alone: these frames have no decodable pixel data, and if the check ran per frame during
        // decoding the RLE reader would throw "frame data truncated" first - a different error, from a
        // path that has already allocated.
        expect(() => parseBamV1(bamDeclaring(64, 4096, 4096))).toThrow(/whole animation may hold/);
    });

    it("does not fire on a real-sized animation", () => {
        // Declares little; still fails later on absent pixel data, which is the point - the aggregate
        // guard must not be what rejects it.
        expect(() => parseBamV1(bamDeclaring(4, 64, 64))).not.toThrow(/whole animation may hold/);
        expect(4 * 64 * 64).toBeLessThan(MAX_ANIMATION_PIXELS);
    });
});
