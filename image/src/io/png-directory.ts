// Lossless Animation <-> PNG-directory codec: "manifest.json" + "<id>/NNN.png" per frame.
// Pure byte-in/byte-out (Map<string, Uint8Array>) - no filesystem access; the caller
// decides where those bytes land.
import {
    type Animation,
    type Frame,
    type Rgba,
    type Sequence,
    emptyPalette,
    transparentIndexOf,
} from "../model/animation.ts";
import { encodeIndexedPng } from "../png/encode.ts";
import { decodeIndexedPng } from "../png/decode.ts";
import { frameFileName, readManifest, sequenceDirId, writeManifest } from "./manifest.ts";

export function exportPngDirectory(anim: Animation): Map<string, Uint8Array> {
    const files = new Map<string, Uint8Array>();
    const manifest = writeManifest(anim);
    files.set("manifest.json", new TextEncoder().encode(JSON.stringify(manifest)));

    const transparentIndex = transparentIndexOf(anim.meta);
    for (const [s, seq] of anim.sequences.entries()) {
        const dirId = sequenceDirId(seq, s);
        for (const [f, ref] of seq.frameRefs.entries()) {
            const frame = anim.frames[ref];
            // Unreachable in practice: writeManifest above already walks every frameRef against
            // this same anim and throws first. Kept for noUncheckedIndexedAccess narrowing.
            if (!frame) throw new Error(`exportPngDirectory: sequence ${s} references out-of-range frame index ${ref}`);
            const png = encodeIndexedPng(frame.width, frame.height, frame.pixels, anim.palette, transparentIndex);
            files.set(`${dirId}/${frameFileName(f)}`, png);
        }
    }
    return files;
}

export function importPngDirectory(files: Map<string, Uint8Array>): Animation {
    const manifestBytes = files.get("manifest.json");
    if (!manifestBytes) throw new Error("importPngDirectory: missing manifest.json");
    const manifestJson: unknown = JSON.parse(new TextDecoder().decode(manifestBytes));
    const { meta, sequences: manifestSequences } = readManifest(manifestJson);

    const frames: Frame[] = [];
    const sequences: Sequence[] = [];
    let palette: Rgba[] | undefined;

    for (const manifestSeq of manifestSequences) {
        const frameRefs: number[] = [];
        for (const [f, offset] of manifestSeq.offsets.entries()) {
            const path = `${manifestSeq.id}/${frameFileName(f)}`;
            const bytes = files.get(path);
            if (!bytes) throw new Error(`importPngDirectory: missing referenced PNG at ${path}`);
            const decoded = decodeIndexedPng(bytes);
            if (!palette) palette = decoded.palette;
            const [offsetX, offsetY] = offset;
            frames.push({ width: decoded.width, height: decoded.height, pixels: decoded.pixels, offsetX, offsetY });
            frameRefs.push(frames.length - 1);
        }
        sequences.push({ frameRefs, facing: manifestSeq.facing });
    }

    return { palette: palette ?? emptyPalette(), sequences, frames, meta };
}
