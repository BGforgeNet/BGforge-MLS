import {
    type Frame,
    type IndexedAnimation,
    type IndexedSourceFormat,
    type Rgba,
    type RgbaAnimation,
    emptyPalette,
} from "../model/animation.ts";
import { histogramOf, medianCutPalette } from "../quantize/median-cut.ts";
import { LossReport } from "./loss-report.ts";

export interface IndexedConvertOpts {
    /**
     * Map onto this palette instead of building one - FRM's "nearest match" mode, where the file
     * carries no palette of its own and the colours must land on the bundled one.
     */
    palette?: Rgba[];
    /**
     * Alpha at or above this stays; below it becomes transparent. Halfway by default: an indexed
     * format has one all-or-nothing transparent index, so every partial value has to pick a side.
     */
    alphaThreshold?: number;
}

/**
 * Index 0, matching both conventions this has to satisfy at once: FRM treats index 0 as transparent
 * (see normalizeTransparentToZero) and a BAM's header names its own, which is 0 in what the games
 * ship. Keeping it fixed means an FRM export needs no follow-up permutation.
 */
const TRANSPARENT_INDEX = 0;

/** The colour the games park in a BAM's transparent slot. Never displayed; a viewer keys on the index. */
const TRANSPARENT_COLOUR: Rgba = { r: 0, g: 255, b: 0, a: 255 };

const MAX_PALETTE = 256;

function nearestIndex(r: number, g: number, b: number, palette: readonly Rgba[]): number {
    let best = TRANSPARENT_INDEX;
    let bestDist = Infinity;
    palette.forEach((c, i) => {
        // The transparent slot is reserved: a visible colour landing there would vanish in the game.
        if (i === TRANSPARENT_INDEX) return;
        const d = (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2;
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    });
    return best;
}

/**
 * Quantize a true-colour animation down to a palette-indexed one.
 *
 * Two things can be lost and both are reported: per-pixel alpha becomes one transparent index, and
 * colours beyond what the palette holds are merged into their nearest neighbour. Everything else -
 * frame geometry, offsets, cycles, timing - carries across unchanged.
 */
export function convertToIndexed(
    anim: RgbaAnimation,
    target: IndexedSourceFormat,
    opts: IndexedConvertOpts = {},
): { animation: IndexedAnimation; report: LossReport } {
    const report = new LossReport();
    const threshold = opts.alphaThreshold ?? 128;

    // Histogram over the pixels that will still be visible: a colour reachable only through a pixel
    // the threshold turns transparent is not worth a palette slot.
    const histogram = new Map<number, number>();
    let partialAlpha = 0;
    for (const frame of anim.frames) {
        for (const [colour, count] of histogramOf(frame.pixels, threshold)) {
            histogram.set(colour, (histogram.get(colour) ?? 0) + count);
        }
        for (let i = 3; i < frame.pixels.length; i += 4) {
            const a = frame.pixels[i] ?? 0;
            if (a > 0 && a < 255) partialAlpha++;
        }
    }

    let palette: Rgba[];
    if (opts.palette) {
        palette = opts.palette.map((c) => ({ ...c }));
    } else {
        const built = medianCutPalette(histogram, MAX_PALETTE - 1);
        palette = emptyPalette();
        palette[TRANSPARENT_INDEX] = { ...TRANSPARENT_COLOUR };
        built.forEach((c, i) => {
            palette[i + 1] = c;
        });
    }

    // One nearest-colour search per DISTINCT colour rather than per pixel: a sprite repeats a few
    // hundred colours across tens of thousands of pixels, and the search is linear in the palette.
    const lookup = new Map<number, number>();
    // Counted, not a flag: the loss message quotes how many DISTINCT colours actually moved, and the
    // cache-miss branch runs exactly once per distinct colour - the same set the histogram counts.
    let quantizedColours = 0;
    const indexOf = (r: number, g: number, b: number): number => {
        const key = (r << 16) | (g << 8) | b;
        const cached = lookup.get(key);
        if (cached !== undefined) return cached;
        const index = nearestIndex(r, g, b, palette);
        const chosen = palette[index];
        if (chosen === undefined || chosen.r !== r || chosen.g !== g || chosen.b !== b) quantizedColours++;
        lookup.set(key, index);
        return index;
    };

    const frames: Frame[] = anim.frames.map((frame) => {
        const pixels = new Uint8Array(frame.width * frame.height);
        for (let p = 0; p < pixels.length; p++) {
            const at = p * 4;
            const a = frame.pixels[at + 3] ?? 0;
            pixels[p] =
                a < threshold
                    ? TRANSPARENT_INDEX
                    : indexOf(frame.pixels[at] ?? 0, frame.pixels[at + 1] ?? 0, frame.pixels[at + 2] ?? 0);
        }
        return {
            width: frame.width,
            height: frame.height,
            pixels,
            offsetX: frame.offsetX,
            offsetY: frame.offsetY,
        };
    });

    if (partialAlpha > 0) {
        report.add(
            "alpha-flattened",
            `${partialAlpha} partly transparent pixel(s) became fully opaque or fully transparent - ` +
                `${target.toUpperCase()} stores one transparent index, not per-pixel alpha`,
        );
    }
    if (quantizedColours > 0) {
        // Two messages because the two modes lose colour for different reasons: a built palette runs
        // out of slots, a supplied one has no slot for the colour at all. One message would have to
        // quote a capacity, which is meaningless in the supplied case (and was reported wrongly there).
        report.add(
            "colours-quantized",
            opts.palette
                ? `${quantizedColours} of ${histogram.size} colour(s) were shifted to their nearest match in the ${target.toUpperCase()} palette`
                : `${quantizedColours} of ${histogram.size} colour(s) were merged into their nearest neighbour - a ${target.toUpperCase()} palette holds ${MAX_PALETTE - 1} alongside its transparent slot`,
        );
    }

    return {
        animation: {
            palette,
            frames,
            sequences: anim.sequences.map((s) => ({ ...s, frameRefs: [...s.frameRefs] })),
            meta: { ...anim.meta, sourceFormat: target, transparentIndex: TRANSPARENT_INDEX },
        },
        report,
    };
}
