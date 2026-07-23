import type { AnimationMeta, Facing, Rgba, SourceFormat } from "@bgforge/image";

/** A single decoded frame, trimmed for the wire: no rawEncoding/rleEncoded (re-encoding is host-side). */
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

// "bam" = uncompressed BAM V1, "bamc" = compressed BAMC - two on-disk encodings of the same animation,
// both using the .bam extension (the host maps the extension; see provider.handleSaveAs).
export type SaveAsTarget = "frm" | "bam" | "bamc" | "apng" | "png-directory";

const SAVE_AS_TARGETS = new Set<string>(["frm", "bam", "bamc", "apng", "png-directory"] satisfies SaveAsTarget[]);
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

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === "object" && v !== null;
}

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
