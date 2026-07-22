import { describe, expect, it } from "vitest";
import { decodeApng, encodeApng, emptyPalette } from "@bgforge/image";

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
});
