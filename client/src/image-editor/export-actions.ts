import * as path from "path";
import {
    convert,
    DEFAULT_FALLOUT_PALETTE,
    exportApngPerDirection,
    exportPngDirectory,
    serializeBamV1,
    serializeFrm,
    serializePal,
    type Animation,
    type Facing,
    type LossReport,
    type Rgba,
} from "@bgforge/image";
import { sidecarPalPath } from "./sidecar";
import { type SaveWrite } from "./save";

/** Maps the relative-path Map exported by @bgforge/image onto absolute writes under destDir. */
export function buildExport(anim: Animation, target: "apng" | "png-directory", destDir: string): SaveWrite[] {
    const files = target === "apng" ? exportApngPerDirection(anim) : exportPngDirectory(anim);
    return Array.from(files, ([relativePath, bytes]) => ({ path: path.join(destDir, relativePath), bytes }));
}

function palettesEqual(a: Rgba[], b: Rgba[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((c, i) => {
        const other = b[i];
        return other !== undefined && c.r === other.r && c.g === other.g && c.b === other.b && c.a === other.a;
    });
}

/** Converts anim to the target format and serializes it, adding a `.pal` sidecar when the
 * converted FRM palette could not be losslessly remapped onto the default Fallout palette. */
export function buildCrossFormatSave(
    anim: Animation,
    target: "frm" | "bam",
    targetPath: string,
    opts?: { layout?: Facing[]; paletteMode?: "sidecar" | "nearest"; singleCycle?: number },
): { writes: SaveWrite[]; report: LossReport } {
    const { animation, report } = convert(anim, target, opts);
    const bytes = target === "frm" ? serializeFrm(animation) : serializeBamV1(animation);
    const writes: SaveWrite[] = [{ path: targetPath, bytes }];
    if (target === "frm" && !palettesEqual(animation.palette, DEFAULT_FALLOUT_PALETTE)) {
        writes.push({ path: sidecarPalPath(targetPath), bytes: serializePal(animation.palette) });
    }
    return { writes, report };
}
