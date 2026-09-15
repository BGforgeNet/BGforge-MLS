/**
 * Where a document can be saved, for the two surfaces that ask.
 *
 * A single FILE keeps a menu: every entry is a one-click write with nothing further to ask, so a dialog
 * would be a dialog to press one button in. A SET gets a dialog instead - every set-scoped write goes into
 * a folder the reader chooses, and several need a naming family, a container and an id besides - so the
 * menu would have been a list of things that all open the same panel.
 *
 * Decided here rather than in markup so both vocabularies are testable, and so the surfaces render a list
 * rather than making a choice of their own.
 */
import type { SourceFormat } from "@bgforge/image";
import type { SaveAsTarget } from "./messages";

export interface SaveAsOption {
    /** Stable across relabelling: the menu sends this back, so nothing keys off the display text. */
    value: string;
    label: string;
    title?: string;
    target: SaveAsTarget;
    paletteMode?: "sidecar" | "nearest";
}

/**
 * THREE different formats share the `.bam` extension - v1, compressed v1 (BAMC) and v2 - so every label
 * carries its version, and each is its own target.
 */
const DIRECT_TARGETS = [
    { value: "bam", label: "BAM v1", target: "bam" },
    { value: "bamc", label: "BAMC v1 (compressed)", target: "bamc" },
    // BAM v2 keeps true colour and per-pixel alpha, but writes its frames into separate MOSxxxx.PVRZ
    // files - the host asks which page number to start at when it needs new ones.
    { value: "bamv2", label: "BAM v2", target: "bamv2" },
    { value: "apng", label: "APNG", target: "apng" },
    { value: "png-directory", label: "PNG directory", target: "png-directory" },
] as const satisfies readonly { value: string; label: string; target: SaveAsTarget }[];

/** FRM is split by palette mode: sidecar writes a `.pal`, nearest remaps to the default Fallout palette. */
const FRM_TARGETS: SaveAsOption[] = [
    { value: "frm-sidecar", label: "FRM (sidecar palette)", target: "frm", paletteMode: "sidecar" },
    { value: "frm-nearest", label: "FRM (nearest match)", target: "frm", paletteMode: "nearest" },
];

/**
 * The single FILE editor's menu: every format EXCEPT the source's own exact one, which plain Save already
 * writes in place. `null` is "nothing loaded", so there is no source format to leave out.
 */
export function buildSaveAsOptions(source: SourceFormat | null): SaveAsOption[] {
    return [
        ...(source === "frm" ? [] : FRM_TARGETS),
        ...DIRECT_TARGETS.filter((entry) => entry.target !== source).map((entry) => ({
            value: entry.value,
            label: entry.label,
            target: entry.target as SaveAsTarget,
        })),
    ];
}
