import type { AnimationMeta, Facing, Rgba, SourceFormat } from "@bgforge/image";
import { isRecord } from "../../is-record";

/**
 * A single decoded frame, trimmed for the wire: no rawEncoding/rleEncoded (re-encoding is host-side).
 * `pixels` holds palette indices or RGBA quads depending on the view's colorModel.
 */
export interface FrameView {
    width: number;
    height: number;
    // base64-encoded indexed bytes: a raw Uint8Array does not survive VS Code webview postMessage in
    // the web host (arrives as `{}`), so pixels cross the wire as a JSON/structured-clone-safe string.
    pixels: string;
    offsetX: number;
    offsetY: number;
}

export interface SequenceView {
    frameRefs: number[];
    facing: Facing;
    // FRM per-direction header offset (0 for BAM/BAMC); shifts this direction's feet anchor. See
    // render/anchor.ts. Carried per-sequence because a frame can be shared across directions.
    dirOffsetX: number;
    dirOffsetY: number;
}

interface AnimationViewBase {
    frames: FrameView[];
    sequences: SequenceView[];
    meta: AnimationMeta;
    basename: string;
    // Name of the containing directory (from the document's save path). Fallout art derives its
    // category from the art directory (art/critters, art/scenery, ...) - see render/naming.ts.
    dirName?: string;
    sourceFormat: SourceFormat;
}

/** FRM, BAM v1 and BAMC: FrameView.pixels holds palette indices. */
export interface IndexedAnimationView extends AnimationViewBase {
    colorModel: "indexed";
    palette: Rgba[]; // 256, the ACTIVE palette (sidecar/default/embedded already chosen host-side)
    hasSidecarPal: boolean; // FRM: <basename>.pal exists on disk
    externalPaletteActive: boolean; // FRM: sidecar currently in use
}

/**
 * BAM v2: FrameView.pixels holds RGBA quads, and there is no palette at all.
 *
 * Carrying a placeholder palette instead would be worse than absent: the palette controls key off
 * it, so they would render for a format that cannot store their result.
 */
export interface RgbaAnimationView extends AnimationViewBase {
    colorModel: "rgba";
}

export type AnimationView = IndexedAnimationView | RgbaAnimationView;

/** Universal base64 codec for FrameView.pixels: btoa/atob are global in the extension host (including
 *  the web-worker host code-server runs it in, where Node's Buffer is unavailable), the webview, and Node. */
export function encodeFramePixels(bytes: Uint8Array): string {
    let s = "";
    // oxlint-disable-next-line unicorn/prefer-code-point -- btoa needs one char per raw byte, not a code point.
    for (const byte of bytes) s += String.fromCharCode(byte);
    return btoa(s);
}

export function decodeFramePixels(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
        // oxlint-disable-next-line unicorn/prefer-code-point -- atob's output is a byte-string; read raw bytes, not code points.
        out[i] = bin.charCodeAt(i);
    }
    return out;
}

// directionLayout is deliberately NOT patchable: it is resolved at parse (BAM fingerprint detection)
// and has no on-disk BAM field, so a webview edit could not survive save/reopen anyway.
export type MetaPatch = Partial<Pick<AnimationMeta, "fps" | "actionFrame" | "transparentIndex">>;

// "bam" = uncompressed BAM V1, "bamc" = compressed BAMC, "bamv2" = true-colour BAM V2 - three on-disk
// encodings sharing the .bam extension (the host maps the extension; see saveAsTargetPath).
export type SaveAsTarget = "frm" | "bam" | "bamc" | "bamv2" | "apng" | "png-directory";

// Keyed off a Record, not a bare array: `satisfies SaveAsTarget[]` checks each entry is a valid
// target but NOT that every target is listed, so a new member could be added to the union and
// silently rejected by the guard below. A Record demands every key.
const SAVE_AS_TARGETS = new Set<string>(
    Object.keys({
        frm: true,
        bam: true,
        bamc: true,
        bamv2: true,
        apng: true,
        "png-directory": true,
    } satisfies Record<SaveAsTarget, true>),
);
const PALETTE_MODES = new Set<string>(["sidecar", "nearest"]);
const IMPORT_MODES = new Set<string>(["replace", "append"]);

/** Messages the webview posts up to the host. */
export type WebviewToHost =
    | { type: "ready" }
    | { type: "save" } // in-place save, original format (routes to VS Code's native save)
    | { type: "editMeta"; patch: MetaPatch }
    | { type: "setExternalPalette"; enabled: boolean } // FRM only
    | { type: "saveAs"; target: SaveAsTarget; paletteMode?: "sidecar" | "nearest" }
    // Design choice: PNG-directory is the only import path. APNG stays export/preview-only - it round-trips
    // poorly (a single flat sequence, no offsets/facings, palette re-quantized), and ingesting an
    // externally-authored single APNG is out of scope for now. Re-add a `kind` field here to restore it;
    // the library decoder (importApng in @bgforge/image) is still present.
    | { type: "import"; mode: "replace" | "append" }
    | { type: "runtimeError"; message: string; stack?: string };

function isValidMetaPatch(patch: unknown): patch is MetaPatch {
    if (!isRecord(patch)) return false;
    if ("fps" in patch && typeof patch.fps !== "number") return false;
    if ("actionFrame" in patch && typeof patch.actionFrame !== "number") return false;
    if ("transparentIndex" in patch && typeof patch.transparentIndex !== "number") return false;
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
        case "save":
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
            return typeof m.mode === "string" && IMPORT_MODES.has(m.mode);
        case "runtimeError":
            return typeof m.message === "string";
        default:
            return false;
    }
}

/** Messages the host posts down to the webview. */
export type HostToWebview = { type: "init"; view: AnimationView } | { type: "error"; message: string };
