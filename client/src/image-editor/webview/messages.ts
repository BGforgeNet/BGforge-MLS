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

/**
 * The animation set a document is showing, when it was opened on one rather than on a single file.
 *
 * Absent for a file, which is what the two extra controls key off: everything else in the view is the
 * same, so the set surface is the file surface plus these pickers rather than a second editor.
 */
export interface SetView {
    id: number;
    title: string;
    /**
     * Every armour level the set declares, lowest first, each with the name the install's own vocabulary
     * gives it. Labelled host-side like the actions below, so the webview holds no naming table of its own.
     */
    armours: { level: number; label: string }[];
    armour: number;
    /** The actions this armour level draws; `resref` is what a pick posts back. */
    actions: { label: string; resref: string }[];
    action: string;
    /**
     * The animation type the install declares for this set, where it declares one.
     *
     * Carried because several types pack different stances into the same sequence token, block scheme and
     * block count - so the block-name table needs the declaration to tell them apart, and a file opened on
     * its own (no set, no declaration) is exactly the case that falls back to numbered blocks.
     */
    section?: string;
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
    /** Present only for a document opened on a whole animation set. */
    set?: SetView;
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
    // The install's creatures, for choosing whose colours to draw an IE creature animation in.
    | { type: "requestCreatures" }
    | { type: "setCreature"; resref: string | null }
    // Frames whose pixels the open did not carry, asked for as the view comes to need them.
    | { type: "requestFrames"; indices: number[] }
    // Set documents only: which action and which armour level of the open set to show.
    | { type: "selectSetAction"; resref: string }
    | { type: "selectSetArmour"; level: number }
    // Set documents only: offer the install's sets and open the one chosen. The list is the host's to
    // show - an install declares hundreds, and the host's own quick pick is already a search over them.
    | { type: "pickSet" }
    /**
     * Set documents only: the conversion mode.
     *
     * `beginConversion` asks the host what it can convert into and what to offer as the name and id;
     * `planConversion` asks what a target would cost, which is the whole point of the mode - a set is
     * many files, so the reader has to see the outcome before committing to it; `runConversion` writes,
     * once, after the host has asked where.
     */
    | { type: "beginConversion" }
    | { type: "planConversion"; profileId: string }
    | { type: "runConversion"; request: ConversionRequestView }
    | { type: "runtimeError"; message: string; stack?: string };

/** The reader's choices for a conversion, as the webview holds them. */
export interface ConversionRequestView {
    profileId: string;
    prefix: string;
    targetId: number;
    notes: boolean;
}

function isValidConversionRequest(request: unknown): request is ConversionRequestView {
    return (
        isRecord(request) &&
        typeof request.profileId === "string" &&
        typeof request.prefix === "string" &&
        typeof request.targetId === "number" &&
        typeof request.notes === "boolean"
    );
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
        case "requestCreatures":
        case "pickSet":
        case "beginConversion":
            return true;
        case "planConversion":
            return typeof m.profileId === "string";
        case "runConversion":
            return isValidConversionRequest(m.request);
        case "setCreature":
            return m.resref === null || typeof m.resref === "string";
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
        case "selectSetAction":
            return typeof m.resref === "string";
        case "selectSetArmour":
            return typeof m.level === "number";
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
    /** Creatures the open game holds, the ones using this animation first. Empty outside a game. */
    | { type: "creatures"; entries: CreatureOption[] }
    /** The palette the view should draw with: a creature's resolved colours, or the animation's own when
     *  `creature` is absent. A view state - the document's own palette is never changed by it. */
    | { type: "palette"; palette: Rgba[]; creature?: string }
    /** What the conversion mode can offer, sent once when the reader opens it. */
    | { type: "conversionSetup"; setup: ConversionSetupView }
    /** What converting into the chosen target would cost, and how many files it would write. */
    | { type: "conversionPlan"; plan: ConversionPlanView }
    | { type: "error"; message: string };

/** The targets on offer, and what to fill the name and id boxes with before the reader touches them. */
export interface ConversionSetupView {
    profiles: { id: string; label: string }[];
    prefix: string;
    targetId: number;
}

/**
 * A planned conversion, as the panel draws it.
 *
 * `files` is a count rather than the names: the names follow the reader's chosen stem, which would mean
 * re-reading and re-converting the whole set on every keystroke to keep a list honest.
 */
export interface ConversionPlanView {
    profileId: string;
    outcome: "refused" | "lossless" | "lossy";
    /** Present only on a refusal, and then it is the whole answer. */
    reason?: string;
    losses: string[];
    notes: string[];
    files: number;
}

/** One creature the picker offers. `matches` marks the ones that actually use the open animation. */
export interface CreatureOption {
    resref: string;
    name: string;
    matches: boolean;
}
