import { type IndexedAnimation, type RgbaAnimation, type RgbaFrame, transparentIndexOf } from "../model/animation.ts";

/**
 * Resolve a palette-indexed animation into a true-colour one. Lossless in both directions that
 * matter - every index has exactly one colour, and the transparent index becomes a fully transparent
 * pixel - so unlike its counterpart (convertToIndexed) this returns no loss report.
 *
 * The result carries no BAM v2 provenance: these frames were never composed from a PVRZ page, so a
 * save must repack them rather than reuse pages that do not describe them.
 */
export function convertToRgba(anim: IndexedAnimation): RgbaAnimation {
    const transparent = transparentIndexOf(anim.meta);
    // One RGBA quadruple per palette slot, resolved once rather than per pixel. The transparent slot
    // holds a real colour on disk (the games park green there), which must never be painted.
    const table = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
        const colour = anim.palette[i];
        if (i === transparent || colour === undefined) continue;
        table.set([colour.r, colour.g, colour.b, 255], i * 4);
    }

    const frames: RgbaFrame[] = anim.frames.map((frame) => {
        const pixels = new Uint8Array(frame.width * frame.height * 4);
        for (const [p, index] of frame.pixels.entries()) {
            pixels.set(table.subarray(index * 4, index * 4 + 4), p * 4);
        }
        return {
            width: frame.width,
            height: frame.height,
            pixels,
            offsetX: frame.offsetX,
            offsetY: frame.offsetY,
        };
    });

    return {
        colorModel: "rgba",
        frames,
        sequences: anim.sequences.map((s) => ({ ...s, frameRefs: [...s.frameRefs] })),
        meta: { ...anim.meta, sourceFormat: "bamv2" },
    };
}
