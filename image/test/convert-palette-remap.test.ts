import { describe, expect, it } from "vitest";
import { remapToDefault, DEFAULT_FALLOUT_PALETTE, emptyPalette, type Frame, type Rgba } from "@bgforge/image";

function frame(pixels: number[]): Frame {
    return { width: pixels.length, height: 1, pixels: new Uint8Array(pixels), offsetX: 0, offsetY: 0 };
}

describe("remapToDefault", () => {
    it("remaps losslessly when used colors exist in the default palette", () => {
        // Source palette where index 5 = the default's color at index 10, index 0 = transparent.
        const src: Rgba[] = emptyPalette();
        const d10 = DEFAULT_FALLOUT_PALETTE[10];
        if (!d10) throw new Error("default palette too small");
        src[5] = { ...d10 };
        const r = remapToDefault([frame([0, 5, 5, 0])], src, 0);
        expect(r.remapped).toBe(true);
        expect(r.palette).toEqual(DEFAULT_FALLOUT_PALETTE);
        // index 0 (transparent) -> 0; index 5 -> 10
        expect([...(r.frames[0]?.pixels ?? [])]).toEqual([0, 10, 10, 0]);
    });
    it("clears stale rawEncoding/rleEncoded on remapped frames", () => {
        const src: Rgba[] = emptyPalette();
        const d10 = DEFAULT_FALLOUT_PALETTE[10];
        if (!d10) throw new Error("default palette too small");
        src[5] = { ...d10 };
        const withRaw: Frame = {
            width: 2,
            height: 1,
            pixels: new Uint8Array([0, 5]),
            offsetX: 0,
            offsetY: 0,
            rawEncoding: new Uint8Array([0, 5]),
            rleEncoded: true,
        };
        const r = remapToDefault([withRaw], src, 0);
        expect(r.remapped).toBe(true);
        const out = r.frames[0];
        if (!out) throw new Error("expected a remapped frame");
        expect(out.rawEncoding).toBeUndefined();
        expect(out.rleEncoded).toBe(false);
        expect([...out.pixels]).toEqual([0, 10]);
    });
    it("declines (sidecar) when a used color is absent from the default", () => {
        const src: Rgba[] = emptyPalette();
        src[5] = { r: 1, g: 2, b: 3, a: 255 }; // verified absent from DEFAULT_FALLOUT_PALETTE
        const r = remapToDefault([frame([5])], src, 0);
        expect(r.remapped).toBe(false);
        expect(r.palette).toBe(src); // unchanged
    });
});
