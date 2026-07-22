import { describe, expect, it } from "vitest";
import {
    decodeApng,
    encodeApng,
    emptyPalette,
    writeChunk,
    PNG_SIGNATURE,
    buildIhdr,
    deflateScanlines,
} from "@bgforge/image";

function concatParts(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

// Mirrors apng.ts's private buildAcTl/buildFcTl, needed here to hand-assemble
// malformed or non-standard APNG fixtures the encoder itself never produces.
function buildAcTl(numFrames: number): Uint8Array {
    const data = new Uint8Array(8);
    new DataView(data.buffer).setUint32(0, numFrames, false);
    return data;
}

function buildFcTl(
    sequenceNumber: number,
    width: number,
    height: number,
    delayNum: number,
    delayDen: number,
): Uint8Array {
    const data = new Uint8Array(26);
    const view = new DataView(data.buffer);
    view.setUint32(0, sequenceNumber, false);
    view.setUint32(4, width, false);
    view.setUint32(8, height, false);
    view.setUint16(20, delayNum, false);
    view.setUint16(22, delayDen, false);
    data[24] = 1; // dispose_op: background
    data[25] = 0; // blend_op: source
    return data;
}

describe("decodeApng", () => {
    it("round-trips frames of distinct content and per-frame dimensions, with fps and palette intact", () => {
        const pal = emptyPalette();
        pal[1] = { r: 10, g: 20, b: 30, a: 255 };
        const frames = [
            { width: 2, height: 2, pixels: new Uint8Array([0, 1, 1, 0]) },
            { width: 2, height: 3, pixels: new Uint8Array([1, 0, 0, 1, 1, 0]) }, // multi-row, distinct dims
            { width: 2, height: 2, pixels: new Uint8Array([0, 0, 1, 1]) },
        ];
        const png = encodeApng(frames, pal, 0, 12);
        const out = decodeApng(png);

        expect(out.fps).toBe(12);
        expect(out.transparentIndex).toBe(0);
        expect(out.palette[1]).toEqual({ r: 10, g: 20, b: 30, a: 255 });
        expect(out.frames).toHaveLength(3);
        for (const [i, frame] of out.frames.entries()) {
            const expected = frames[i];
            if (!expected) throw new Error("test setup: missing expected frame");
            expect(frame.width).toBe(expected.width);
            expect(frame.height).toBe(expected.height);
            expect([...frame.pixels]).toEqual([...expected.pixels]);
        }
    });

    it("locates a transparentIndex greater than 0 by scanning the palette", () => {
        const pal = emptyPalette();
        const png = encodeApng([{ width: 1, height: 1, pixels: new Uint8Array([5]) }], pal, 5, 10);
        expect(decodeApng(png).transparentIndex).toBe(5);
    });

    it("throws when the IHDR chunk is missing", () => {
        const bytes = concatParts([PNG_SIGNATURE, writeChunk("IEND", new Uint8Array(0))]);
        expect(() => decodeApng(bytes)).toThrow(/missing IHDR chunk/);
    });

    it("throws on a truncated IHDR chunk", () => {
        const bytes = concatParts([PNG_SIGNATURE, writeChunk("IHDR", new Uint8Array(8))]);
        expect(() => decodeApng(bytes)).toThrow(/truncated IHDR chunk/);
    });

    it("rejects a non-indexed colour type", () => {
        const ihdrData = buildIhdr(1, 1);
        ihdrData[9] = 2; // truecolour, not indexed
        const bytes = concatParts([PNG_SIGNATURE, writeChunk("IHDR", ihdrData)]);
        expect(() => decodeApng(bytes)).toThrow(/indexed/);
    });

    it("falls back to fps 10 when the first fcTL's delay_num is 0", () => {
        const bytes = concatParts([
            PNG_SIGNATURE,
            writeChunk("IHDR", buildIhdr(1, 1)),
            writeChunk("acTL", buildAcTl(1)),
            writeChunk("fcTL", buildFcTl(0, 1, 1, 0, 10)), // delay_num 0: a real APNG would never use this delay
            writeChunk("IDAT", deflateScanlines(1, 1, new Uint8Array([5]))),
            writeChunk("IEND", new Uint8Array(0)),
        ]);
        expect(decodeApng(bytes).fps).toBe(10);
    });

    it("tolerates a missing acTL chunk (skips the frame-count cross-check)", () => {
        const bytes = concatParts([
            PNG_SIGNATURE,
            writeChunk("IHDR", buildIhdr(1, 1)),
            writeChunk("fcTL", buildFcTl(0, 1, 1, 1, 10)),
            writeChunk("IDAT", deflateScanlines(1, 1, new Uint8Array([5]))),
            writeChunk("IEND", new Uint8Array(0)),
        ]);
        const out = decodeApng(bytes);
        expect(out.frames).toHaveLength(1);
        expect([...(out.frames[0]?.pixels ?? [])]).toEqual([5]);
        expect(out.fps).toBe(10);
    });

    it("throws when acTL declares a frame count that does not match the decoded frames", () => {
        const bytes = concatParts([
            PNG_SIGNATURE,
            writeChunk("IHDR", buildIhdr(1, 1)),
            writeChunk("acTL", buildAcTl(2)), // declares 2, but only 1 fcTL/IDAT pair follows
            writeChunk("fcTL", buildFcTl(0, 1, 1, 1, 10)),
            writeChunk("IDAT", deflateScanlines(1, 1, new Uint8Array([5]))),
            writeChunk("IEND", new Uint8Array(0)),
        ]);
        expect(() => decodeApng(bytes)).toThrow(/acTL declared 2 frames but found 1/);
    });

    it("throws when an fcTL chunk has no following IDAT/fdAT data", () => {
        const bytes = concatParts([
            PNG_SIGNATURE,
            writeChunk("IHDR", buildIhdr(1, 1)),
            writeChunk("acTL", buildAcTl(1)),
            writeChunk("fcTL", buildFcTl(0, 1, 1, 1, 10)),
            writeChunk("IEND", new Uint8Array(0)),
        ]);
        expect(() => decodeApng(bytes)).toThrow(/fcTL chunk has no following IDAT\/fdAT data/);
    });

    it("tolerates missing PLTE/tRNS chunks (defaults to opaque black, transparentIndex 0)", () => {
        const bytes = concatParts([
            PNG_SIGNATURE,
            writeChunk("IHDR", buildIhdr(1, 1)),
            writeChunk("acTL", buildAcTl(1)),
            writeChunk("fcTL", buildFcTl(0, 1, 1, 1, 10)),
            writeChunk("IDAT", deflateScanlines(1, 1, new Uint8Array([9]))),
            writeChunk("IEND", new Uint8Array(0)),
        ]);
        const out = decodeApng(bytes);
        expect(out.palette[0]).toEqual({ r: 0, g: 0, b: 0, a: 255 });
        expect(out.transparentIndex).toBe(0);
        expect([...(out.frames[0]?.pixels ?? [])]).toEqual([9]);
    });
});
