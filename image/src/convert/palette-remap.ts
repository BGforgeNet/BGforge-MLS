import { type Frame, type Rgba } from "../model/animation.ts";
import { DEFAULT_FALLOUT_PALETTE } from "../palette/default-palette.ts";

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
