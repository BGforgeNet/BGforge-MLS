import { describe, expect, it } from "vitest";
import { type RgbaAnimation } from "../src/model/animation.ts";
import { exportApngPerDirection } from "../src/io/apng-io.ts";
import { encodeTruecolourApng } from "../src/png/apng.ts";
import { decodeTruecolourPng } from "../src/png/decode.ts";
import { readChunks } from "../src/png/chunk.ts";

/** RGBA bytes for `quads`, in order. */
function pixelsOf(quads: readonly (readonly number[])[]): Uint8Array {
    const out = new Uint8Array(quads.length * 4);
    quads.forEach((q, i) => out.set(q, i * 4));
    return out;
}

describe("encodeTruecolourApng", () => {
    it("writes a default image any PNG reader can open, per-pixel alpha intact", () => {
        // An APNG's default image is a plain PNG: what a viewer with no APNG support shows, and the
        // cheapest real check that the frame data is not smeared or flattened.
        const frame = {
            width: 2,
            height: 1,
            pixels: pixelsOf([
                [255, 0, 0, 255],
                [0, 128, 255, 64],
            ]),
        };

        const decoded = decodeTruecolourPng(encodeTruecolourApng([frame], 15));

        expect([decoded.width, decoded.height]).toEqual([2, 1]);
        expect([...decoded.pixels]).toEqual([...frame.pixels]);
    });

    it("pads a smaller frame onto the shared canvas with fully transparent pixels", () => {
        // Every frame, the default image included, must fill IHDR or spec-compliant decoders reject
        // the file outright. The padding has to be transparent, not black, or the sprite gets a box.
        const small = { width: 1, height: 1, pixels: pixelsOf([[255, 0, 0, 255]]) };
        const large = {
            width: 3,
            height: 1,
            pixels: pixelsOf([
                [1, 1, 1, 255],
                [2, 2, 2, 255],
                [3, 3, 3, 255],
            ]),
        };

        const decoded = decodeTruecolourPng(encodeTruecolourApng([small, large], 15));

        expect([decoded.width, decoded.height]).toEqual([3, 1]);
        expect([...decoded.pixels]).toEqual([0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0]);
    });

    it("carries no palette chunks, which a true-colour image must not have", () => {
        const frame = { width: 1, height: 1, pixels: pixelsOf([[1, 2, 3, 4]]) };

        const types = readChunks(encodeTruecolourApng([frame], 15)).map((c) => c.type);

        expect(types).not.toContain("PLTE");
        expect(types).not.toContain("tRNS");
        expect(types).toContain("acTL");
    });

    it("refuses to write an animation with no frames", () => {
        // A zero-frame APNG is not a valid PNG at all, so this has to fail here rather than produce
        // a file that every reader rejects.
        expect(() => encodeTruecolourApng([], 15)).toThrow(/frame/);
    });
});

describe("exportApngPerDirection on a true-colour animation", () => {
    function animation(): RgbaAnimation {
        const pixels = new Uint8Array(2 * 2 * 4);
        pixels.set([255, 0, 0, 255], 0);
        pixels.set([0, 128, 255, 64], 4);
        return {
            colorModel: "rgba",
            frames: [{ width: 2, height: 2, pixels, offsetX: 1, offsetY: 1 }],
            sequences: [{ frameRefs: [0], facing: "NE" }],
            meta: { sourceFormat: "bamv2", fps: 15 },
        };
    }

    it("writes one true-colour APNG per sequence, keeping the alpha", () => {
        // The export the user picks from the menu - and the reason it takes this path rather than
        // the quantizer: APNG holds per-pixel alpha, so nothing needs to be given up here.
        const files = exportApngPerDirection(animation());

        const png = files.get("NE.png");
        if (png === undefined) throw new Error("expected NE.png");
        const decoded = decodeTruecolourPng(png);
        expect([...decoded.pixels.subarray(4, 8)]).toEqual([0, 128, 255, 64]);
        expect(readChunks(png).map((c) => c.type)).not.toContain("PLTE");
    });
});
