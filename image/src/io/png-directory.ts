// Lossless Animation <-> PNG-directory codec: "manifest.json" + "<id>/NNN.png" per frame.
// Pure byte-in/byte-out (Map<string, Uint8Array>) - no filesystem access; the caller
// decides where those bytes land.
//
// The PNGs follow the animation's colour model: indexed (colour type 3, one shared palette) for
// FRM/BAM, true colour with alpha (colour type 6) for BAM v2. Routing a true-colour animation
// through the indexed writer would flatten every soft edge, which is the opposite of what this
// export is for.
import {
    type Animation,
    type Frame,
    type Rgba,
    type RgbaFrame,
    type Sequence,
    emptyPalette,
    isRgbaAnimation,
    transparentIndexOf,
} from "../model/animation.ts";
import { encodeIndexedPng, encodeTruecolourPng } from "../png/encode.ts";
import { decodeIndexedPng, decodeTruecolourPng, pngColourType } from "../png/decode.ts";
import { frameFileName, readManifest, sequenceDirId, writeManifest } from "./manifest.ts";

export function exportPngDirectory(anim: Animation): Map<string, Uint8Array> {
    const files = new Map<string, Uint8Array>();
    const manifest = writeManifest(anim);
    files.set("manifest.json", new TextEncoder().encode(JSON.stringify(manifest)));

    let encodeFrame: (frame: Frame | RgbaFrame) => Uint8Array;
    if (isRgbaAnimation(anim)) {
        encodeFrame = (frame) => encodeTruecolourPng(frame.width, frame.height, frame.pixels);
    } else {
        // Both resolved once, not per frame: they are whole-animation properties, and
        // transparentIndexOf is the single resolution site the optional field is read through.
        const { palette } = anim;
        const transparentIndex = transparentIndexOf(anim.meta);
        encodeFrame = (frame) => encodeIndexedPng(frame.width, frame.height, frame.pixels, palette, transparentIndex);
    }

    for (const [s, seq] of anim.sequences.entries()) {
        const dirId = sequenceDirId(seq, s);
        for (const [f, ref] of seq.frameRefs.entries()) {
            const frame: Frame | RgbaFrame | undefined = anim.frames[ref];
            // Unreachable in practice: writeManifest above already walks every frameRef against
            // this same anim and throws first. Kept for noUncheckedIndexedAccess narrowing.
            if (!frame) throw new Error(`exportPngDirectory: sequence ${s} references out-of-range frame index ${ref}`);
            files.set(`${dirId}/${frameFileName(f)}`, encodeFrame(frame));
        }
    }
    return files;
}

function samePalette(a: Rgba[], b: Rgba[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((c, i) => {
        const o = b[i];
        return o !== undefined && c.r === o.r && c.g === o.g && c.b === o.b;
    });
}

/**
 * The frame files a manifest names, in sequence order, paired with the sequence they belong to.
 * Walking this once means the two colour-model importers below share the file-resolution rules
 * (missing file, ordering, offsets) rather than each restating them.
 */
function* manifestFrames(
    files: Map<string, Uint8Array>,
    manifestSequences: ReturnType<typeof readManifest>["sequences"],
): Generator<{ seqIndex: number; path: string; bytes: Uint8Array; offset: [number, number] }> {
    for (const [seqIndex, manifestSeq] of manifestSequences.entries()) {
        for (const [f, offset] of manifestSeq.offsets.entries()) {
            const path = `${manifestSeq.id}/${frameFileName(f)}`;
            const bytes = files.get(path);
            if (!bytes) throw new Error(`importPngDirectory: missing referenced PNG at ${path}`);
            yield { seqIndex, path, bytes, offset };
        }
    }
}

/**
 * Reads a directory back into an animation, in whichever colour model its PNGs are written in - so
 * a true-colour directory returns a true-colour animation rather than being flattened on the way in.
 * The first frame's colour type decides; a directory mixing the two is rejected.
 */
export function importPngDirectory(files: Map<string, Uint8Array>): Animation {
    const manifestBytes = files.get("manifest.json");
    if (!manifestBytes) throw new Error("importPngDirectory: missing manifest.json");
    const manifestJson: unknown = JSON.parse(new TextDecoder().decode(manifestBytes));
    const { meta, sequences: manifestSequences } = readManifest(manifestJson);

    const walked = [...manifestFrames(files, manifestSequences)];
    const sequences: Sequence[] = manifestSequences.map((seq) => ({ frameRefs: [], facing: seq.facing }));
    const first = walked[0];

    if (first !== undefined && pngColourType(first.bytes) === 6) {
        const frames: RgbaFrame[] = [];
        for (const { seqIndex, bytes, offset } of walked) {
            const decoded = decodeTruecolourPng(bytes);
            const [offsetX, offsetY] = offset;
            frames.push({ width: decoded.width, height: decoded.height, pixels: decoded.pixels, offsetX, offsetY });
            sequences[seqIndex]?.frameRefs.push(frames.length - 1);
        }
        return { colorModel: "rgba", frames, sequences, meta: { ...meta, sourceFormat: "bamv2" } };
    }

    const frames: Frame[] = [];
    let palette: Rgba[] | undefined;
    for (const { seqIndex, path, bytes, offset } of walked) {
        const decoded = decodeIndexedPng(bytes);
        if (!palette) palette = decoded.palette;
        else if (!samePalette(palette, decoded.palette)) {
            // Each PNG is independently hand-editable; a frame re-saved with a different or
            // reordered palette would silently attach its indices to the first frame's colors.
            throw new Error(
                `importPngDirectory: ${path} uses a different palette than the first frame - all frames of one animation must share a palette`,
            );
        }
        const [offsetX, offsetY] = offset;
        frames.push({ width: decoded.width, height: decoded.height, pixels: decoded.pixels, offsetX, offsetY });
        sequences[seqIndex]?.frameRefs.push(frames.length - 1);
    }

    // An empty or true-colour-less directory keeps whatever the manifest said, minus the true-colour
    // format it cannot be: the PNGs are indexed, so the animation is.
    const sourceFormat = meta.sourceFormat === "bamv2" ? "bam" : meta.sourceFormat;
    return { palette: palette ?? emptyPalette(), sequences, frames, meta: { ...meta, sourceFormat } };
}
