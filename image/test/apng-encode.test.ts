import { describe, expect, it } from "vitest";
import { emptyPalette } from "@bgforge/image";
import { decodeApng, encodeApng } from "../src/png/apng.ts";
import { readChunks } from "../src/png/chunk.ts";

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

    it("pads differently-sized frames to the IHDR canvas so the PNG is spec-valid (loadable by real decoders)", () => {
        // The bug this guards: with frames of DIFFERING size, IHDR was the max but the IDAT default
        // image kept frame 0's smaller size - a PNG whose IDAT decodes to fewer pixels than IHDR
        // declares, which spec-compliant decoders (Chromium / VS Code image viewer) reject. Real FRM
        // directions have varying frame sizes; the uniform-size fixtures above never exercised this.
        const pal = emptyPalette();
        pal[1] = { r: 200, g: 100, b: 50, a: 255 };
        const frames = [
            { width: 2, height: 2, pixels: new Uint8Array([1, 1, 1, 1]) }, // frame 0 is the SMALLER one
            { width: 4, height: 3, pixels: new Uint8Array(12).fill(1) },
        ];
        const png = encodeApng(frames, pal, 0, 10);
        const chunks = readChunks(png);

        const ihdr = chunks.find((c) => c.type === "IHDR");
        if (!ihdr) throw new Error("no IHDR");
        const ihdrView = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
        const canvasW = ihdrView.getUint32(0, false);
        const canvasH = ihdrView.getUint32(4, false);
        expect([canvasW, canvasH]).toEqual([4, 3]); // the max across frames

        // Every fcTL (the default image's included) must declare the full IHDR canvas, not the source
        // frame's own size - that equality is exactly what makes the IDAT/fdAT payloads spec-valid.
        for (const fcTl of chunks.filter((c) => c.type === "fcTL")) {
            const v = new DataView(fcTl.data.buffer, fcTl.data.byteOffset, fcTl.data.byteLength);
            expect([v.getUint32(4, false), v.getUint32(8, false)]).toEqual([canvasW, canvasH]);
        }

        // Round-trip: decoded frames come back at the canvas size, with the small frame centred.
        const decoded = decodeApng(png);
        expect(decoded.frames.map((f) => [f.width, f.height])).toEqual([
            [4, 3],
            [4, 3],
        ]);
    });
});
