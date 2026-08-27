import { describe, expect, it } from "vitest";
import { type Rgba } from "../src/model/animation.ts";
import { histogramOf, medianCutPalette } from "../src/quantize/median-cut.ts";

function rgba(r: number, g: number, b: number): Rgba {
    return { r, g, b, a: 255 };
}

/** RGBA bytes for the given opaque colours, in order. */
function pixelsOf(colours: readonly Rgba[]): Uint8Array {
    const out = new Uint8Array(colours.length * 4);
    colours.forEach((c, i) => out.set([c.r, c.g, c.b, c.a], i * 4));
    return out;
}

describe("medianCutPalette", () => {
    it("returns the image's own colours when they already fit", () => {
        // The case that must not degrade: a 3-colour sprite quantized to 256 slots is a rename, not
        // a re-colour, and any drift here would show as a visibly wrong export of a simple icon.
        const colours = [rgba(255, 0, 0), rgba(0, 255, 0), rgba(0, 0, 255)];

        const palette = medianCutPalette(histogramOf(pixelsOf(colours)), 256);

        expect([...palette].sort((a, b) => a.r - b.r || a.g - b.g)).toEqual(
            [...colours].sort((a, b) => a.r - b.r || a.g - b.g),
        );
    });

    it("never returns more colours than it was allowed", () => {
        const colours = Array.from({ length: 300 }, (_, i) => rgba(i % 256, (i * 7) % 256, (i * 13) % 256));

        const palette = medianCutPalette(histogramOf(pixelsOf(colours)), 16);

        expect(palette.length).toBeLessThanOrEqual(16);
        expect(palette.length).toBeGreaterThan(0);
    });

    it("splits along the channel that actually varies", () => {
        // A ramp that varies only in red must come back as distinct reds; a splitter that cut on a
        // constant channel would collapse the whole ramp onto one entry and flatten the gradient.
        const colours = Array.from({ length: 64 }, (_, i) => rgba(i * 4, 128, 128));

        const palette = medianCutPalette(histogramOf(pixelsOf(colours)), 4);

        expect(palette).toHaveLength(4);
        const reds = palette.map((c) => c.r).sort((a, b) => a - b);
        expect(new Set(reds).size).toBe(4);
        expect(palette.every((c) => c.g === 128 && c.b === 128)).toBe(true);
    });

    it("weights by pixel count, so a dominant colour keeps its own entry", () => {
        // 1000 identical background pixels plus two stray ones: an unweighted cut would give the
        // strays half the palette and average the background away with them.
        const many = Array.from({ length: 1000 }, () => rgba(10, 20, 30));
        const colours = [...many, rgba(200, 0, 0), rgba(210, 0, 0)];

        const palette = medianCutPalette(histogramOf(pixelsOf(colours)), 2);

        expect(palette).toContainEqual(rgba(10, 20, 30));
    });

    it("ignores fully transparent pixels, which carry no colour to preserve", () => {
        // Their RGB is whatever the encoder left behind; letting it into the histogram spends
        // palette slots on colours no one can see.
        const pixels = new Uint8Array(3 * 4);
        pixels.set([255, 0, 0, 255], 0);
        pixels.set([9, 9, 9, 0], 4);
        pixels.set([255, 0, 0, 255], 8);

        expect([...histogramOf(pixels).values()]).toEqual([2]);
    });
});
