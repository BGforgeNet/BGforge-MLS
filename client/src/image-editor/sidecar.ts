import * as path from "path";
import { DEFAULT_FALLOUT_PALETTE, type Rgba, type SourceFormat } from "@bgforge/image";

/** The `<basename>.pal` sibling path for an FRM/BAM/BAMC source file. */
export function sidecarPalPath(fsPath: string): string {
    const parsed = path.parse(fsPath);
    return path.format({ dir: parsed.dir, name: parsed.name, ext: ".pal" });
}

/**
 * Resolves which palette an animation should render with: FRM has no embedded
 * palette of its own, so it falls back to the shared default when the sidecar
 * .pal is missing or the user has external palettes disabled. BAM/BAMC always
 * carry their own embedded palette.
 */
export function chooseActivePalette(args: {
    sourceFormat: SourceFormat;
    embedded: Rgba[];
    sidecar?: Rgba[];
    externalEnabled: boolean;
}): Rgba[] {
    if (args.sourceFormat === "frm") {
        return args.externalEnabled && args.sidecar ? args.sidecar : DEFAULT_FALLOUT_PALETTE;
    }
    return args.embedded;
}
