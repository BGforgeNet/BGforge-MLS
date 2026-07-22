// Lossless Animation -> per-sequence APNG codec: one "<id>.png" per sequence, all
// sharing the animation's palette. Pure byte-in/byte-out - no filesystem access.
import type { Animation } from "../model/animation.ts";
import { type ApngFrame, decodeApng, encodeApng } from "../png/apng.ts";
import { sequenceDirId } from "./manifest.ts";

export function exportApngPerDirection(anim: Animation): Map<string, Uint8Array> {
    const files = new Map<string, Uint8Array>();
    const transparentIndex = anim.meta.transparentIndex ?? 0;
    const fps = anim.meta.fps ?? 10;

    for (const [s, seq] of anim.sequences.entries()) {
        const frames: ApngFrame[] = seq.frameRefs.map((ref) => {
            const frame = anim.frames[ref];
            if (!frame)
                throw new Error(`exportApngPerDirection: sequence ${s} references out-of-range frame index ${ref}`);
            return { width: frame.width, height: frame.height, pixels: frame.pixels };
        });
        const dirId = sequenceDirId(seq, s);
        files.set(`${dirId}.png`, encodeApng(frames, anim.palette, transparentIndex, fps));
    }
    return files;
}

export function importApng(bytes: Uint8Array): {
    fps: number;
    frames: { width: number; height: number; pixels: Uint8Array }[];
} {
    const decoded = decodeApng(bytes);
    return { fps: decoded.fps, frames: decoded.frames };
}
