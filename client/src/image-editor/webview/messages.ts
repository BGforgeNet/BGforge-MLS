import type { AnimationMeta, DirectionLayout, Facing, Rgba, SourceFormat } from "@bgforge/image";

/** A single decoded frame, trimmed for the wire: no rawEncoding/rleEncoded (re-encoding is host-side). */
export interface FrameView {
    width: number;
    height: number;
    pixels: Uint8Array;
    offsetX: number;
    offsetY: number;
}

export interface SequenceView {
    frameRefs: number[];
    facing: Facing;
}

export interface AnimationView {
    palette: Rgba[]; // 256, the ACTIVE palette (sidecar/default/embedded already chosen host-side)
    frames: FrameView[];
    sequences: SequenceView[];
    meta: AnimationMeta;
    basename: string;
    sourceFormat: SourceFormat;
    hasSidecarPal: boolean; // FRM: <basename>.pal exists on disk
    externalPaletteActive: boolean; // FRM: sidecar currently in use
    dirty: boolean;
}

export type MetaPatch = Partial<Pick<AnimationMeta, "fps" | "actionFrame" | "transparentIndex" | "directionLayout">>;

export type SaveAsTarget = "frm" | "bam" | "apng" | "png-directory";
export type ImportKind = "png-directory" | "apng";

const SAVE_AS_TARGETS = new Set<string>(["frm", "bam", "apng", "png-directory"] satisfies SaveAsTarget[]);
const IMPORT_KINDS = new Set<string>(["png-directory", "apng"] satisfies ImportKind[]);
const PALETTE_MODES = new Set<string>(["sidecar", "nearest"]);
const IMPORT_MODES = new Set<string>(["replace", "append"]);
const DIRECTION_LAYOUTS = new Set<string>(["frm6", "ie8", "non-directional"] satisfies DirectionLayout[]);

/** Messages the webview posts up to the host. */
export type WebviewToHost =
    | { type: "ready" }
    | { type: "editMeta"; patch: MetaPatch }
    | { type: "setExternalPalette"; enabled: boolean } // FRM only
    | { type: "saveAs"; target: SaveAsTarget; paletteMode?: "sidecar" | "nearest" }
    | { type: "import"; kind: ImportKind; mode: "replace" | "append" }
    | { type: "runtimeError"; message: string; stack?: string };

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null;
}

function isValidMetaPatch(patch: unknown): patch is MetaPatch {
    if (!isRecord(patch)) return false;
    if ("fps" in patch && typeof patch.fps !== "number") return false;
    if ("actionFrame" in patch && typeof patch.actionFrame !== "number") return false;
    if ("transparentIndex" in patch && typeof patch.transparentIndex !== "number") return false;
    if (
        "directionLayout" in patch &&
        (typeof patch.directionLayout !== "string" || !DIRECTION_LAYOUTS.has(patch.directionLayout))
    ) {
        return false;
    }
    return true;
}

/**
 * Runtime narrow of an incoming webview message before the host acts on it. A same-origin webview
 * channel is not an external trust boundary, so this is defense-in-depth, matching the binary
 * editor's per-field narrowing posture instead of a blanket cast.
 */
export function isWebviewToHost(m: unknown): m is WebviewToHost {
    if (!isRecord(m) || typeof m.type !== "string") return false;
    switch (m.type) {
        case "ready":
            return true;
        case "editMeta":
            return isValidMetaPatch(m.patch);
        case "setExternalPalette":
            return typeof m.enabled === "boolean";
        case "saveAs":
            return (
                typeof m.target === "string" &&
                SAVE_AS_TARGETS.has(m.target) &&
                (m.paletteMode === undefined || (typeof m.paletteMode === "string" && PALETTE_MODES.has(m.paletteMode)))
            );
        case "import":
            return (
                typeof m.kind === "string" &&
                IMPORT_KINDS.has(m.kind) &&
                typeof m.mode === "string" &&
                IMPORT_MODES.has(m.mode)
            );
        case "runtimeError":
            return typeof m.message === "string";
        default:
            return false;
    }
}

/** Messages the host posts down to the webview. */
export type HostToWebview = { type: "init"; view: AnimationView } | { type: "error"; message: string };
