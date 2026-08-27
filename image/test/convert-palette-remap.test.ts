import { describe, expect, it } from "vitest";
import { DEFAULT_FALLOUT_PALETTE, emptyPalette, type IndexedAnimation, type Frame, type Rgba } from "@bgforge/image";
import { normalizeTransparentToZero, remapToDefault, remapToNearest } from "../src/convert/palette-remap.ts";

function frame(pixels: number[]): Frame {
    return { width: pixels.length, height: 1, pixels: new Uint8Array(pixels), offsetX: 0, offsetY: 0 };
}

describe("normalizeTransparentToZero", () => {
    it("throws when the transparent index is outside the palette", () => {
        expect(() => normalizeTransparentToZero([], [{ r: 0, g: 0, b: 0, a: 255 }], 5)).toThrow(/out of palette range/);
    });
});

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

describe("remapToNearest", () => {
    it("maps each used color to the nearest default-palette index", () => {
        // A 1-color source palette whose color is closest to some default index.
        const src: Rgba[] = emptyPalette();
        src[5] = { r: 255, g: 254, b: 253, a: 255 }; // near-white -> default's white-ish slot
        const anim: IndexedAnimation = {
            palette: src,
            frames: [
                {
                    width: 1,
                    height: 1,
                    pixels: Uint8Array.from([5]),
                    offsetX: 0,
                    offsetY: 0,
                    rawEncoding: Uint8Array.from([5]),
                },
            ],
            sequences: [{ frameRefs: [0], facing: "none" }],
            meta: { sourceFormat: "bam", transparentIndex: 0 },
        };
        const { animation, remapped } = remapToNearest(anim, DEFAULT_FALLOUT_PALETTE);
        expect(remapped).toBe(true);
        const outFrame = animation.frames[0];
        if (!outFrame) throw new Error("expected a remapped frame");
        const outIdx = outFrame.pixels[0] ?? 0;
        const near = DEFAULT_FALLOUT_PALETTE[outIdx];
        if (!near) throw new Error("expected a default-palette entry");
        // The remapped index must point at the nearest default color to (255,254,253).
        for (const c of DEFAULT_FALLOUT_PALETTE) {
            const d = (c.r - 255) ** 2 + (c.g - 254) ** 2 + (c.b - 253) ** 2;
            const dn = (near.r - 255) ** 2 + (near.g - 254) ** 2 + (near.b - 253) ** 2;
            expect(dn).toBeLessThanOrEqual(d);
        }
        expect(outFrame.rawEncoding).toBeUndefined();
        expect(animation.palette).toEqual(DEFAULT_FALLOUT_PALETTE);
        expect(animation.palette).not.toBe(DEFAULT_FALLOUT_PALETTE); // cloned
    });

    it("sends the transparent index to 0", () => {
        const src: Rgba[] = Array.from({ length: 256 }, () => ({ r: 10, g: 20, b: 30, a: 255 }));
        const anim: IndexedAnimation = {
            palette: src,
            frames: [{ width: 2, height: 1, pixels: Uint8Array.from([7, 3]), offsetX: 0, offsetY: 0 }],
            sequences: [{ frameRefs: [0], facing: "none" }],
            meta: { sourceFormat: "bam", transparentIndex: 7 },
        };
        const { animation } = remapToNearest(anim, DEFAULT_FALLOUT_PALETTE);
        const outFrame = animation.frames[0];
        if (!outFrame) throw new Error("expected a remapped frame");
        expect(outFrame.pixels[0]).toBe(0); // index 7 was transparent -> 0
    });

    it("defaults the transparent index to 0 when meta omits transparentIndex", () => {
        const src: Rgba[] = emptyPalette(); // index 0 is black; the default palette's nearest to black is not 0
        const anim: IndexedAnimation = {
            palette: src,
            frames: [{ width: 1, height: 1, pixels: Uint8Array.from([0]), offsetX: 0, offsetY: 0 }],
            sequences: [{ frameRefs: [0], facing: "none" }],
            meta: { sourceFormat: "bam" },
        };
        const { animation: out } = remapToNearest(anim, DEFAULT_FALLOUT_PALETTE);
        const outFrame = out.frames[0];
        if (!outFrame) throw new Error("expected a remapped frame");
        expect(outFrame.pixels[0]).toBe(0); // omitted transparentIndex still forces index 0 -> 0
    });

    it("maps a pixel index beyond a short source palette to 0", () => {
        const src: Rgba[] = [
            { r: 0, g: 0, b: 0, a: 255 },
            { r: 10, g: 10, b: 10, a: 255 },
        ];
        const anim: IndexedAnimation = {
            palette: src,
            frames: [{ width: 1, height: 1, pixels: Uint8Array.from([9]), offsetX: 0, offsetY: 0 }],
            sequences: [{ frameRefs: [0], facing: "none" }],
            meta: { sourceFormat: "bam", transparentIndex: 0 },
        };
        const { animation } = remapToNearest(anim, DEFAULT_FALLOUT_PALETTE);
        const outFrame = animation.frames[0];
        if (!outFrame) throw new Error("expected a remapped frame");
        expect(outFrame.pixels[0]).toBe(0); // no table entry for this out-of-range byte -> falls back to 0
    });
});
