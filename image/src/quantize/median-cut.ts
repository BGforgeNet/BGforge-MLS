import { type Rgba } from "../model/animation.ts";

/** Packed 0xRRGGBB to the number of opaque pixels carrying it. */
export type ColourHistogram = Map<number, number>;

/**
 * Count the distinct colours in an RGBA buffer, ignoring pixels below `alphaThreshold`: their RGB is
 * whatever the encoder happened to leave behind, so letting it in spends palette slots on colours
 * nothing can display. The default skips only fully transparent pixels; a caller that will flatten
 * partial alpha passes its own threshold so the histogram matches what it will actually draw.
 */
export function histogramOf(rgba: Uint8Array, alphaThreshold = 1): ColourHistogram {
    const histogram: ColourHistogram = new Map();
    for (let i = 0; i + 3 < rgba.length; i += 4) {
        if ((rgba[i + 3] ?? 0) < alphaThreshold) continue;
        const key = ((rgba[i] ?? 0) << 16) | ((rgba[i + 1] ?? 0) << 8) | (rgba[i + 2] ?? 0);
        histogram.set(key, (histogram.get(key) ?? 0) + 1);
    }
    return histogram;
}

interface Entry {
    r: number;
    g: number;
    b: number;
    count: number;
}

function entriesOf(histogram: ColourHistogram): Entry[] {
    return [...histogram].map(([key, count]) => ({
        r: (key >> 16) & 0xff,
        g: (key >> 8) & 0xff,
        b: key & 0xff,
        count,
    }));
}

/** Widest-spread channel of a box, which is the one worth cutting on. */
function widestChannel(box: Entry[]): "r" | "g" | "b" {
    let best: "r" | "g" | "b" = "r";
    let bestSpread = -1;
    for (const channel of ["r", "g", "b"] as const) {
        let low = 255;
        let high = 0;
        for (const e of box) {
            low = Math.min(low, e[channel]);
            high = Math.max(high, e[channel]);
        }
        if (high - low > bestSpread) {
            bestSpread = high - low;
            best = channel;
        }
    }
    return best;
}

/**
 * Split at the point that halves the PIXEL count, not the entry count: a thousand background pixels
 * of one colour and two stray highlights are two entries and must not be given equal weight, or the
 * background averages away with the strays.
 */
function split(box: Entry[]): [Entry[], Entry[]] {
    const channel = widestChannel(box);
    const sorted = [...box].sort((a, b) => a[channel] - b[channel]);
    const total = sorted.reduce((sum, e) => sum + e.count, 0);
    let running = 0;
    let cut = 0;
    for (const [i, entry] of sorted.entries()) {
        running += entry.count;
        if (running * 2 >= total) {
            // Keep both halves non-empty: a colour holding the majority of pixels would otherwise
            // take the whole box and leave nothing to the right of the cut.
            cut = Math.min(i + 1, sorted.length - 1);
            break;
        }
    }
    return [sorted.slice(0, cut), sorted.slice(cut)];
}

function averageColour(box: Entry[]): Rgba {
    let total = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (const e of box) {
        total += e.count;
        r += e.r * e.count;
        g += e.g * e.count;
        b += e.b * e.count;
    }
    if (total === 0) return { r: 0, g: 0, b: 0, a: 255 };
    return { r: Math.round(r / total), g: Math.round(g / total), b: Math.round(b / total), a: 255 };
}

/**
 * Median cut: repeatedly split the box with the most pixels along its widest channel until there are
 * `maxColours` boxes, then take each box's pixel-weighted average.
 *
 * Chosen over the alternatives because it needs no tuning and degrades predictably: an image that
 * already fits comes back untouched (the boxes reduce to one entry each), which is the case that
 * matters most - a small sprite must export without any colour drift at all.
 */
export function medianCutPalette(histogram: ColourHistogram, maxColours: number): Rgba[] {
    const entries = entriesOf(histogram);
    if (entries.length === 0) return [];
    if (entries.length <= maxColours) {
        return entries.map((e) => ({ r: e.r, g: e.g, b: e.b, a: 255 }));
    }

    let boxes: Entry[][] = [entries];
    while (boxes.length < maxColours) {
        // Heaviest box holding two or more colours. There is always one while the loop runs - boxes
        // only grow in number, and if every box held a single colour there would already be more
        // boxes than colours - but the sentinel stays rather than defaulting to box 0: splitting a
        // single-colour box yields an empty half, and an empty half averages to a black palette
        // entry that nothing downstream would flag.
        let target = -1;
        let targetWeight = 0;
        boxes.forEach((box, i) => {
            if (box.length < 2) return;
            const weight = box.reduce((sum, e) => sum + e.count, 0);
            if (weight > targetWeight) {
                targetWeight = weight;
                target = i;
            }
        });
        const box = boxes[target];
        /* v8 ignore next -- unreachable per the note above; kept so the impossible case cannot pass silently */
        if (box === undefined) break;
        const [low, high] = split(box);
        boxes = [...boxes.slice(0, target), low, high, ...boxes.slice(target + 1)];
    }
    return boxes.map((box) => averageColour(box));
}
