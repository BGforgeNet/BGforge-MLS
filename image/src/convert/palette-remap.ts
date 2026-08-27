import { type IndexedAnimation, type Frame, type Rgba, transparentIndexOf } from "../model/animation.ts";
import { DEFAULT_FALLOUT_PALETTE } from "../palette/default-palette.ts";

// FRM's transparency convention is index 0. When a source marks another slot transparent, swap
// indices 0 <-> transparentIndex in pixels and palette - a lossless permutation that lets an FRM
// output (and its .pal sidecar) keep the source's transparency without a color remap.
export function normalizeTransparentToZero(
    frames: Frame[],
    palette: Rgba[],
    transparentIndex: number,
): { frames: Frame[]; palette: Rgba[] } {
    if (transparentIndex === 0) return { frames, palette };
    const swappedPalette = palette.map((c) => ({ ...c }));
    const zeroColor = swappedPalette[0];
    const transparentColor = swappedPalette[transparentIndex];
    if (!zeroColor || !transparentColor) {
        throw new Error(`normalizeTransparentToZero: transparent index ${transparentIndex} out of palette range`);
    }
    swappedPalette[0] = transparentColor;
    swappedPalette[transparentIndex] = zeroColor;
    const swappedFrames = frames.map((f) => {
        const pixels = new Uint8Array(f.pixels.length);
        f.pixels.forEach((idx, i) => {
            pixels[i] = idx === 0 ? transparentIndex : idx === transparentIndex ? 0 : idx;
        });
        // Pixels were re-indexed; rawEncoding described the old indices and must not carry over.
        return { width: f.width, height: f.height, pixels, offsetX: f.offsetX, offsetY: f.offsetY };
    });
    return { frames: swappedFrames, palette: swappedPalette };
}

function colorKey(c: Rgba): string {
    return `${c.r},${c.g},${c.b}`;
}

// First default-palette index per color, skipping index 0 (the transparent sentinel) for
// non-transparent matches so a real color never collapses onto the transparent slot.
function buildDefaultIndex(): Map<string, number> {
    const index = new Map<string, number>();
    DEFAULT_FALLOUT_PALETTE.forEach((c, i) => {
        if (i === 0) return;
        const key = colorKey(c);
        if (!index.has(key)) index.set(key, i);
    });
    return index;
}

// Attempt a lossless re-index of `frames` onto DEFAULT_FALLOUT_PALETTE. Only the palette indices
// actually used by the pixels need to resolve; unused source-palette entries are irrelevant.
export function remapToDefault(
    frames: Frame[],
    sourcePalette: Rgba[],
    transparentIndex: number,
): { remapped: boolean; frames: Frame[]; palette: Rgba[] } {
    const used = new Set<number>();
    for (const f of frames) {
        for (const idx of f.pixels) used.add(idx);
    }

    const defaultIndex = buildDefaultIndex();
    const indexMap = new Map<number, number>();
    for (const idx of used) {
        if (idx === transparentIndex) {
            indexMap.set(idx, 0);
            continue;
        }
        const color = sourcePalette[idx];
        if (!color) return { remapped: false, frames, palette: sourcePalette };
        const mapped = defaultIndex.get(colorKey(color));
        if (mapped === undefined) return { remapped: false, frames, palette: sourcePalette };
        indexMap.set(idx, mapped);
    }

    const remappedFrames = frames.map((f) => {
        const pixels = new Uint8Array(f.pixels.length);
        f.pixels.forEach((idx, i) => {
            pixels[i] = indexMap.get(idx) ?? 0;
        });
        // Pixels were re-indexed; rawEncoding described the OLD indices, so it must not carry over
        // (a serializer reading rawEncoding ?? pixels would otherwise silently undo the remap).
        return { width: f.width, height: f.height, pixels, offsetX: f.offsetX, offsetY: f.offsetY, rleEncoded: false };
    });

    return { remapped: true, frames: remappedFrames, palette: DEFAULT_FALLOUT_PALETTE };
}

function nearestIndex(color: Rgba, target: Rgba[]): number {
    let best = 0;
    let bestDist = Infinity;
    target.forEach((t, i) => {
        const d = (t.r - color.r) ** 2 + (t.g - color.g) ** 2 + (t.b - color.b) ** 2;
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    });
    return best;
}

// Lossy: re-index every pixel to the nearest color in `target` (the bundled default palette).
// The transparent source index maps to 0 (the default palette's transparency slot) so
// transparency survives. Output frames drop rawEncoding/rleEncoded (they described the old bytes).
export function remapToNearest(
    anim: IndexedAnimation,
    target: Rgba[],
): { animation: IndexedAnimation; remapped: true } {
    const transparent = transparentIndexOf(anim.meta);
    // src index -> target index, one entry per palette slot, computed once.
    const table = anim.palette.map((color, idx) => (idx === transparent ? 0 : nearestIndex(color, target)));
    const frames = anim.frames.map((f) => {
        const pixels = new Uint8Array(f.pixels.length);
        f.pixels.forEach((idx, i) => {
            pixels[i] = table[idx] ?? 0;
        });
        return { width: f.width, height: f.height, pixels, offsetX: f.offsetX, offsetY: f.offsetY };
    });
    return {
        animation: {
            palette: target.map((c) => ({ ...c })),
            frames,
            sequences: anim.sequences.map((s) => ({ ...s })),
            meta: { ...anim.meta },
        },
        remapped: true,
    };
}
