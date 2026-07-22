import { describe, expect, it } from "vitest";
import { encodeApng, decodeApng, readChunks, emptyPalette } from "@bgforge/image";

describe("encodeApng", () => {
    it("throws when given no frames", () => {
        expect(() => encodeApng([], emptyPalette(), 0, 10)).toThrow(/at least one frame is required/);
    });

    it("falls back to a delay denominator of 10 when fps is 0", () => {
        const frames = [{ width: 1, height: 1, pixels: new Uint8Array([0]) }];
        const png = encodeApng(frames, emptyPalette(), 0, 0);
        expect(decodeApng(png).fps).toBe(10);
    });

    it("writes acTL/fcTL/IDAT/fdAT chunks with sequential sequence numbers", () => {
        const pal = emptyPalette();
        pal[1] = { r: 10, g: 20, b: 30, a: 255 };
        const frames = [
            { width: 2, height: 2, pixels: new Uint8Array([0, 1, 1, 0]) },
            { width: 2, height: 2, pixels: new Uint8Array([1, 0, 0, 1]) },
            { width: 2, height: 2, pixels: new Uint8Array([0, 0, 1, 1]) },
        ];
        const png = encodeApng(frames, pal, 0, 10);
        const chunks = readChunks(png);

        const acTl = chunks.find((c) => c.type === "acTL");
        if (!acTl) throw new Error("no acTL");
        expect(chunks.filter((c) => c.type === "acTL")).toHaveLength(1);
        const acTlView = new DataView(acTl.data.buffer, acTl.data.byteOffset, acTl.data.byteLength);
        expect(acTlView.getUint32(0, false)).toBe(3); // num_frames
        expect(acTlView.getUint32(4, false)).toBe(0); // num_plays: loop forever

        expect(chunks.filter((c) => c.type === "fcTL")).toHaveLength(3);
        expect(chunks.filter((c) => c.type === "IDAT")).toHaveLength(1);
        expect(chunks.filter((c) => c.type === "fdAT")).toHaveLength(2);

        const sequenceNumbers = chunks
            .filter((c) => c.type === "fcTL" || c.type === "fdAT")
            .map((c) => new DataView(c.data.buffer, c.data.byteOffset, c.data.byteLength).getUint32(0, false));
        expect(sequenceNumbers).toEqual([0, 1, 2, 3, 4]);
    });
});
