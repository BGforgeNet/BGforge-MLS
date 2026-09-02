import type { AnimationMeta, Facing, Rgba, SourceFormat } from "@bgforge/image";
import { isRecord } from "../../is-record";

/**
 * A single decoded frame, trimmed for the wire: no rawEncoding/rleEncoded (re-encoding is host-side).
 * The pixels themselves live in the view's shared `pixels` buffer; `start`/`length` is this frame's
 * span within it, holding palette indices or RGBA quads depending on the view's colorModel.
 */
export interface FrameView {
    width: number;
    height: number;
    /**
     * This frame's span within the view's shared buffer (`length` is w*h indexed, w*h*4 rgba),
     * ABSENT while its pixels have not been delivered yet.
     *
     * One optional field rather than two: an offset without a length is not a state this can be in,
     * and two co-varying optionals would let it be written.
     */
    span?: FrameSpan;
    offsetX: number;
    offsetY: number;
}

/** Where one frame's pixels sit inside a view's shared buffer. */
export interface FrameSpan {
    start: number;
    length: number;
}

/** What `packFramePixels` accepts: a decoded frame still holding its own bytes. */
export interface SourceFrame {
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
    pixels: Uint8Array;
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
    /** Every frame's pixels concatenated; each frame's own bytes are its `start`/`length` span. */
    pixels: ArrayBuffer;
    sequences: SequenceView[];
    meta: AnimationMeta;
    basename: string;
    // Name of the containing directory (from the document's save path). Fallout art derives its
    // category from the art directory (art/critters, art/scenery, ...) - see render/naming.ts.
    dirName?: string;
    sourceFormat: SourceFormat;
}

/** FRM, BAM v1 and BAMC: each frame's span of the shared buffer holds palette indices. */
export interface IndexedAnimationView extends AnimationViewBase {
    colorModel: "indexed";
    palette: Rgba[]; // 256, the ACTIVE palette (sidecar/default/embedded already chosen host-side)
    hasSidecarPal: boolean; // FRM: <basename>.pal exists on disk
    externalPaletteActive: boolean; // FRM: sidecar currently in use
}

/**
 * BAM v2: each frame's span of the shared buffer holds RGBA quads, and there is no palette at all.
 *
 * Carrying a placeholder palette instead would be worse than absent: the palette controls key off
 * it, so they would render for a format that cannot store their result.
 */
export interface RgbaAnimationView extends AnimationViewBase {
    colorModel: "rgba";
}

export type AnimationView = IndexedAnimationView | RgbaAnimationView;

/**
 * Lay every frame's pixels end to end in ONE ArrayBuffer and record each frame's span.
 *
 * One buffer, not one per frame: VS Code recreates a single `ArrayBuffer` natively on the webview
 * side (its `postMessage` doc, 1.57+), but an array of thousands of them arrives as empty objects -
 * measured at 5888 frames, where every buffer came through with zero bytes. Base64, the format this
 * replaces, cost 4/3 the payload plus an encode and a decode pass over every byte.
 */
export function packFramePixels(
    sources: readonly SourceFrame[],
    include?: ReadonlySet<number>,
): { frames: FrameView[]; pixels: ArrayBuffer } {
    const wanted = (i: number): boolean => include === undefined || include.has(i);

    let total = 0;
    for (const [i, source] of sources.entries()) if (wanted(i)) total += source.pixels.length;

    const packed = new Uint8Array(total);
    const frames: FrameView[] = [];
    let at = 0;
    for (const [i, source] of sources.entries()) {
        // Geometry always crosses, even for an excluded frame: the layout sizes every tile from it
        // (tileSizePx walks all frames), and it is a handful of numbers against megabytes of pixels.
        const geometry = {
            width: source.width,
            height: source.height,
            offsetX: source.offsetX,
            offsetY: source.offsetY,
        };
        if (!wanted(i)) {
            frames.push(geometry);
            continue;
        }
        packed.set(source.pixels, at);
        frames.push({ ...geometry, span: { start: at, length: source.pixels.length } });
        at += source.pixels.length;
    }
    return { frames, pixels: packed.buffer };
}

/**
 * This frame's pixels as a VIEW into the shared buffer - never a copy, at 5888 frames - or undefined
 * while the frame has not been delivered.
 */
export function framePixels(pixels: ArrayBuffer, frame: FrameView): Uint8Array | undefined {
    return frame.span && new Uint8Array(pixels, frame.span.start, frame.span.length);
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
    // Frames whose pixels the open did not carry, asked for as the view comes to need them.
    | { type: "requestFrames"; indices: number[] }
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
        case "requestFrames":
            return Array.isArray(m.indices) && m.indices.every((i) => typeof i === "number");
        case "runtimeError":
            return typeof m.message === "string";
        default:
            return false;
    }
}

/**
 * Messages the host posts down to the webview.
 *
 * `loading` is a liveness signal and carries nothing: the webview's init deadline bounds SILENCE, so
 * the message only has to arrive. Progress is counted webview-side from the tiles that have pixels.
 */
export type HostToWebview =
    | { type: "loading" }
    | { type: "init"; view: AnimationView }
    // Answer to `requestFrames`: `frames[i]` is the frame at `indices[i]`, spanning `pixels`.
    | { type: "frames"; indices: number[]; frames: FrameView[]; pixels: ArrayBuffer }
    | { type: "error"; message: string };
