import * as path from "path";
import {
    type Animation,
    convert,
    convertToIndexed,
    convertToRgba,
    DEFAULT_FALLOUT_PALETTE,
    encodeBamc,
    exportApngPerDirection,
    exportPngDirectory,
    serializeBamV1,
    serializeFrm,
    serializePal,
    type IndexedAnimation,
    isRgbaAnimation,
    LossReport,
    type Rgba,
} from "@bgforge/image";
import { sidecarPalPath } from "./sidecar";
import { type SaveWrite } from "./save";

/**
 * Maps the relative-path Map exported by @bgforge/image onto absolute writes under destDir. Both
 * targets take the animation in its own colour model - a true-colour document exports true-colour
 * PNGs rather than being quantized on the way out, since PNG holds everything BAM v2 does.
 */
export function buildExport(anim: Animation, target: "apng" | "png-directory", destDir: string): SaveWrite[] {
    const files = target === "apng" ? exportApngPerDirection(anim) : exportPngDirectory(anim);
    return Array.from(files, ([relativePath, bytes]) => ({ path: path.join(destDir, relativePath), bytes }));
}

/**
 * An imported animation brought into the colour model of the document receiving it.
 *
 * Indexed into true-colour is exact, so it reports nothing. True-colour into indexed has to quantize
 * - the one lossy direction, and the reason this returns a report at all rather than just converting.
 */
export function adaptImportedColourModel(
    imported: Animation,
    document: Animation,
): { animation: Animation; report: LossReport } {
    const wantRgba = isRgbaAnimation(document);
    if (isRgbaAnimation(imported) === wantRgba) return { animation: imported, report: new LossReport() };
    if (isRgbaAnimation(imported)) {
        // The document is indexed, so its own source format decides what the frames become.
        const target = document.meta.sourceFormat;
        if (target === "bamv2") throw new Error("adaptImportedColourModel: an indexed document cannot be BAM v2");
        return convertToIndexed(imported, target);
    }
    return { animation: convertToRgba(imported), report: new LossReport() };
}

function palettesEqual(a: Rgba[], b: Rgba[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((c, i) => {
        const other = b[i];
        return other !== undefined && c.r === other.r && c.g === other.g && c.b === other.b && c.a === other.a;
    });
}

/** Converts anim to the target format and serializes it, adding a `.pal` sidecar when the
 * converted FRM palette could not be losslessly remapped onto the default Fallout palette.
 * `bamc` is the compressed on-disk encoding of `bam`: the animation converts identically, then the
 * serialized BAM V1 is wrapped by encodeBamc. */
export function buildCrossFormatSave(
    anim: IndexedAnimation,
    target: "frm" | "bam" | "bamc",
    targetPath: string,
    opts?: { paletteMode?: "sidecar" | "nearest"; singleCycle?: number; ieGroup?: number },
): { writes: SaveWrite[]; report: LossReport } {
    const { animation, report } = convert(anim, target === "frm" ? "frm" : "bam", opts);
    let bytes: Uint8Array;
    if (target === "frm") bytes = serializeFrm(animation);
    else if (target === "bam") bytes = serializeBamV1(animation);
    else bytes = encodeBamc(serializeBamV1(animation));
    const writes: SaveWrite[] = [{ path: targetPath, bytes }];
    if (target === "frm" && !palettesEqual(animation.palette, DEFAULT_FALLOUT_PALETTE)) {
        writes.push({ path: sidecarPalPath(targetPath), bytes: serializePal(animation.palette) });
    }
    return { writes, report };
}
