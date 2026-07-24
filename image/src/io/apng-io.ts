// Animation -> per-sequence APNG codec: one "<id>.png" per sequence, all sharing the animation's
// palette. Pure byte-in/byte-out - no filesystem access.
//
// This is a viewable PREVIEW, not a lossless export: each sequence's frames are re-composed onto one
// shared anchor-aligned canvas (the same steadiness treatment as the FRM conversion's uniform
// rotation canvas), so the played APNG holds still, but the individual frame boxes and
// offsetX/offsetY are NOT preserved. The PNG-directory codec (png-directory.ts) is the lossless one.
import { type Animation, transparentIndexOf } from "../model/animation.ts";
import { type PlacedFrame, blitToBox, unionAnchorBox } from "../model/anchor-align.ts";
import { offsetToAnchor } from "../model/frame-anchor.ts";
import { type ApngFrame, decodeApng, encodeApng } from "../png/apng.ts";
import { sequenceDirId } from "./manifest.ts";

export function exportApngPerDirection(anim: Animation): Map<string, Uint8Array> {
    const files = new Map<string, Uint8Array>();
    const transparentIndex = transparentIndexOf(anim.meta);
    const fps = anim.meta.fps ?? 10;

    for (const [s, seq] of anim.sequences.entries()) {
        const placed: PlacedFrame[] = seq.frameRefs.map((ref) => {
            const frame = anim.frames[ref];
            if (!frame)
                throw new Error(`exportApngPerDirection: sequence ${s} references out-of-range frame index ${ref}`);
            const anchor = offsetToAnchor(anim.meta.sourceFormat, {
                width: frame.width,
                height: frame.height,
                offsetX: frame.offsetX,
                offsetY: frame.offsetY,
                dirOffsetX: anim.meta.dirOffsetsX?.[s] ?? 0,
                dirOffsetY: anim.meta.dirOffsetsY?.[s] ?? 0,
            });
            return { frame, ax: anchor.ax, ay: anchor.ay };
        });
        const box = unionAnchorBox(placed);
        // An empty sequence (a base-file dummy cycle) has nothing to encode - and a zero-frame APNG
        // is not a valid PNG - so it simply emits no file.
        if (!box) continue;
        const frames: ApngFrame[] = placed.map((p) => {
            const composed = blitToBox(p, box, transparentIndex);
            return { width: composed.width, height: composed.height, pixels: composed.pixels };
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
