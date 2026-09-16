import type { AnimationMeta, Facing, Rgba, SourceFormat } from "@bgforge/image";
import type { IeScheme } from "@bgforge/image/ie-direction";
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
 * What the Save As dialog may offer for the open set, decided host-side.
 *
 * All of it is a property of the SET rather than an answer to opening the dialog, so it travels with the
 * view: the dialog has to be able to draw itself, including saying that a geometry is unreachable, before
 * anything is picked. Host-side for the same reason the labels above are - the schemes and the naming
 * table are the animation package's, and a webview copy would drift on the first edit.
 */
export interface SetSaveOptionsView {
    /** The naming families an Infinity Engine set can be written under, with their labels. */
    namings: { id: string; label: string }[];
    /**
     * The families a declaration can name, spelled for a reader, each saying whether this set can be
     * written under it.
     *
     * A list rather than a box to type in: a declaration names one of these, and a header no engine reads
     * declares nothing. The set's own header leads the list where this project has no spelling for it,
     * since an INI section is an install's vocabulary and a closed picker would refuse to write such a set
     * back as it was read.
     *
     * The section is also the SHAPE control: its type fixes how many facings are stored and whether the
     * east sits in a companion, so `reachable` is false where this set's own facings cannot fill that
     * shape, or where nothing here can say what the shape is. Shown disabled rather than hidden, so a
     * reader asking why is answered by a greyed row rather than by a row that was never drawn.
     */
    sections: { id: string; label: string; reachable: boolean }[];
    /**
     * The set's own shape, which the dialog opens on.
     *
     * Leaving these alone is what "write it as it stands" means, and changing any of them is what makes a
     * save a retarget - which is how the dialog decides whether to ask for a stem and an id at all. A
     * field is absent where the set has no such shape: a directionless ambient has no geometry, and a
     * layout the naming table does not cover has no family.
     */
    source: { directions?: 8 | 16; storeEast: boolean; naming?: string; section?: string };
    /**
     * The game's own override folder, which is where a save can land instead of a folder of the reader's.
     *
     * Named rather than merely offered: "the game's override folder" is not a destination a reader can
     * check, and the whole point of showing it is that they can.
     */
    overridePath: string;
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
    /**
     * Every stance this armour level draws, across all its files - one flat list, in the order to show it.
     *
     * Flat because the file boundary is a convention of the naming family rather than anything the reader
     * chose: the same creature ships as ten single-band files under one family and three packed ones under
     * another, so a picker for the file would be asking about packaging. `key` is what a pick posts back
     * and is opaque here; `title` names the files the stance draws, which is what a save writes.
     */
    stances: { key: string; label: string; title: string }[];
    stance: string;
    /** Which direction band of the open file the stance is - what the stage draws, in place of its own pick. */
    band: number;
    /**
     * Set where the open stance is its band drawn back to front.
     *
     * Getting up shares the dying band and the engine plays it in reverse, so the two rows differ only in
     * playback direction: without this the stage would draw the same clip for both.
     */
    reversed?: true;
    /**
     * The animation type the install declares for this set, where it declares one.
     *
     * Carried because several types pack different stances into the same sequence token, block scheme and
     * block count - so the block-name table needs the declaration to tell them apart, and a file opened on
     * its own (no set, no declaration) is exactly the case that falls back to numbered blocks.
     */
    section?: string;
    /**
     * The same section spelled for a reader, for the header band.
     *
     * Labelled host-side like the armour levels and stances above, so the webview holds no naming table
     * of its own. Absent exactly when `section` is: a set whose install declared no family has nothing to
     * say here rather than a default worth showing.
     */
    familyLabel?: string;
    /**
     * The whole sentence behind that label: which engine declares this, under what token, and what its
     * files look like. Composed host-side for the same reason the label is.
     */
    familyTitle?: string;
    /**
     * How this set's files divide into direction bands, where its declared type settles that.
     *
     * Resolved host-side for the same reason the labels above are: the answer is a property of the
     * install's own declaration, and a webview reading it from a table of its own would be a second
     * statement of it. Absent where the type settles nothing, which leaves the reading to block structure.
     * `scheme` is absent for a band width no block scheme covers - a sixteen-wide one, whose stances the
     * block table therefore cannot name.
     */
    bands?: { stride: number; scheme?: IeScheme; coarse?: true };
    /** What the Save As dialog may offer for this set - see `SetSaveOptionsView`. */
    saveOptions: SetSaveOptionsView;
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
    /**
     * How many files on disk this one picture was combined from.
     *
     * One for an ordinary file. Two for an IE base and its eastern twin, six for a Fallout `.fr0`-`.fr5`
     * split set, and whatever a set member's own composition names. Carried because it is not readable
     * from the animation: a combined base/east pair looks exactly like a file that stored all eight
     * facings itself, and the difference is what the header tells the reader.
     */
    composedFiles: number;
    /** Present only for a document opened on a whole animation set. */
    set?: SetView;
    /**
     * The sets drawing this file, where it was opened out of a game and at least one does. Absent for a file
     * on disk: a set draws the install's copy, which is not the file being edited.
     */
    drawnBy?: { id: number; title: string }[];
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
 * The fields only the DOCUMENT can answer: where the file sits, how many files were combined into it,
 * which set it is, and which sets draw it. The model is deliberately path-free and knows none of them.
 */
type DocumentOwned = "dirName" | "composedFiles" | "set" | "drawnBy";

/**
 * The view as the model builds it - everything but the three above, which `ImageEditorDocument.toView`
 * adds. Stated as a type rather than defaulted in the model, so the model cannot state a composition it
 * has no way of knowing.
 */
export type ModelAnimationView = Omit<IndexedAnimationView, DocumentOwned> | Omit<RgbaAnimationView, DocumentOwned>;

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
    // On a SET document this writes every member of every armour level into a folder the reader chooses,
    // not the stance on screen - a set's scope is the set. `frm` is refused there and belongs to the
    // conversion mode instead, which is what asks for the name and id a Fallout critter set needs.
    | { type: "saveAs"; target: SaveAsTarget; paletteMode?: "sidecar" | "nearest" }
    // Design choice: PNG-directory is the only import path. APNG stays export/preview-only - it round-trips
    // poorly (a single flat sequence, no offsets/facings, palette re-quantized), and ingesting an
    // externally-authored single APNG is out of scope for now. Re-add a `kind` field here to restore it;
    // the library decoder (importApng in image/src/io/apng-io.ts, not on the package barrel) is still present.
    // A folder carrying a set manifest imports across every member it names; one of that folder's own
    // member directories is an ordinary PNG directory and imports as the single animation it is.
    | { type: "import"; mode: "replace" | "append" }
    // The install's creatures, for choosing whose colours to draw an IE creature animation in.
    | { type: "requestCreatures" }
    | { type: "setCreature"; resref: string | null }
    // A webview cannot run a command, so the note that asks for a game asks the host to open one instead.
    | { type: "openGame" }
    // Frames whose pixels the open did not carry, asked for as the view comes to need them.
    | { type: "requestFrames"; indices: number[] }
    // Set documents only: which stance and which armour level of the open set to show. The key is the
    // host's own (see `stanceKey`) - the webview holds it opaquely and sends back the one it was given.
    | { type: "selectSetStance"; key: string }
    | { type: "selectSetArmour"; level: number }
    // Set documents only: offer the install's sets and open the one chosen. The list is the host's to
    // show - an install declares hundreds, and the host's own quick pick is already a search over them.
    | { type: "pickSet" }
    // Game files only: open the set drawing this file, asking which where several do (see `drawnBy`).
    | { type: "openDrawnBy" }
    /**
     * Set documents only: the Save As dialog.
     *
     * `beginSaveAs` asks the host for the defaults its name and id boxes open on; `planSave` asks what
     * the chosen settings would cost, which is the whole point of showing a dialog rather than writing -
     * a set is many files, so the reader has to see the outcome before committing to it; `chooseSaveFolder`
     * opens the host's folder picker WHILE the dialog is up, so where it lands is one of the things the
     * dialog shows rather than a question sprung after Save; `runSave` writes, once.
     *
     * What the dialog can OFFER is not asked for here: it travels with the view, because the offer is a
     * property of the open set and the dialog has to be able to say when there is nothing to offer.
     */
    | { type: "beginSaveAs" }
    | { type: "chooseSaveFolder" }
    | { type: "planSave"; request: SaveRequestView }
    | { type: "runSave"; request: SaveRequestView }
    | { type: "runtimeError"; message: string; stack?: string };

/**
 * Everything the Save As dialog holds, as one request.
 *
 * ONE shape for both the planning and the running of a save, so what the dialog previewed and what it
 * writes cannot come apart. Whether this is a straight write or a retarget is DERIVED from it rather than
 * chosen: a request whose geometry and naming match the set's own writes it as it stands under its own
 * resrefs, and any other is a conversion that mints new names.
 */
export interface SaveRequestView {
    /** What is written. `bam` and `frm` carry the engine's own shape; the other two are image exports. */
    format: "bam" | "frm" | "apng" | "png-directory";
    /** BAM only: v2 keeps true colour in PVRZ pages, v1 is the palette-indexed container. */
    bamVersion: 1 | 2;
    /** BAM v1 only: whether the container is compressed (BAMC). */
    compressed: boolean;
    /** What the written files are called. Ignored where the save is not a retarget. */
    naming: string;
    /**
     * BAM v2 only: the first `MOS<nnnn>.PVRZ` page the frames are written into.
     *
     * Absent until the reader states one, and never defaulted - a number the game's own archives already
     * use surfaces as corrupted graphics at runtime, and only the person doing the install knows which
     * range their mod owns. The plan says when it is needed; Save waits for it.
     */
    basePage?: number;
    /**
     * Fallout only: what to do where the source's six rotations are not the same length.
     *
     * An FRM header carries one frames-per-direction for all six, so the difference has to be resolved in
     * the data. Asked only where there IS one - the plan says so - because for a source whose rotations
     * already agree the question has no answer that changes a file.
     */
    unevenRotations?: "hold" | "clip" | "wrap";
    /** The stem a retarget names its files from. Empty asks for the source's own. */
    prefix: string;
    /** The id a retarget is to be declared under. */
    targetId: number;
    /** The section a retarget is to be declared as, which the notes state. */
    section: string;
    notes: boolean;
    /** The game's own override folder, or a folder the reader picked in the dialog. */
    destination: "override" | "folder";
    /**
     * The folder chosen for the `folder` destination, absent until one is.
     *
     * Chosen from inside the dialog rather than by a picker sprung after Save: where a dozen to eighty
     * files land is one of the things the reader is deciding, so it belongs beside the file names that
     * show what will be in it.
     */
    folder?: string;
}

/**
 * A request's identity, for matching a plan to the settings it answers.
 *
 * Stated once and read by both ends: the host echoes it and the dialog compares it, so "is this the answer
 * to what is on screen" has one definition rather than a host key and a webview key that agree until one of
 * them gains a field.
 */
export function saveRequestKey(request: SaveRequestView): string {
    return [
        request.format,
        request.bamVersion,
        request.compressed,
        request.basePage ?? "",
        request.folder ?? "",
        request.unevenRotations ?? "",
        request.naming,
        request.prefix,
        request.targetId,
        request.section,
        request.notes,
        request.destination,
        // Escaped rather than typed: a raw NUL in the source makes ripgrep and git grep treat this whole
        // file as binary and skip it silently. The separator itself is deliberate - no field can contain
        // one, so no combination of fields can collide with another.
    ].join("\0");
}

/**
 * Whether a PVRZ page number is one the writer can use: a whole number inside the four digits the
 * `MOS<nnnn>.PVRZ` name holds. Stated once, so the dialog gates Save on the same rule the host validates.
 */
export function isValidBasePage(page: number): boolean {
    return Number.isInteger(page) && page >= 0 && page <= 9999;
}

const SAVE_FORMATS = new Set(["bam", "frm", "apng", "png-directory"]);
const UNEVEN_ROTATIONS = new Set(["hold", "clip", "wrap"]);

function isValidSaveRequest(request: unknown): request is SaveRequestView {
    return (
        isRecord(request) &&
        typeof request.format === "string" &&
        SAVE_FORMATS.has(request.format) &&
        (request.bamVersion === 1 || request.bamVersion === 2) &&
        typeof request.compressed === "boolean" &&
        (request.basePage === undefined ||
            (typeof request.basePage === "number" && isValidBasePage(request.basePage))) &&
        (request.folder === undefined || typeof request.folder === "string") &&
        (request.unevenRotations === undefined ||
            (typeof request.unevenRotations === "string" && UNEVEN_ROTATIONS.has(request.unevenRotations))) &&
        typeof request.naming === "string" &&
        typeof request.prefix === "string" &&
        typeof request.targetId === "number" &&
        typeof request.section === "string" &&
        typeof request.notes === "boolean" &&
        (request.destination === "override" || request.destination === "folder")
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
        case "openGame":
        case "pickSet":
        case "openDrawnBy":
        case "beginSaveAs":
        case "chooseSaveFolder":
            return true;
        case "planSave":
        case "runSave":
            return isValidSaveRequest(m.request);
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
        case "selectSetStance":
            return typeof m.key === "string";
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
    /**
     * The install's creatures, and whether an install answered.
     *
     * `gameOpen` is stated rather than read off `entries.length`: no game and an install that lists no
     * creatures both arrive as an empty list, and only the first of them is fixed by opening a game.
     */
    | { type: "creatures"; entries: CreatureOption[]; gameOpen: boolean }
    /** The palette the view should draw with: a creature's resolved colours, or the animation's own when
     *  `creature` is absent. A view state - the document's own palette is never changed by it. */
    | { type: "palette"; palette: Rgba[]; creature?: string }
    /** The defaults the Save As dialog opens its name and id boxes on, sent when the reader opens it. */
    | { type: "saveAsSetup"; setup: SaveAsSetupView }
    /** What the chosen settings would write, where, and what they would cost. */
    | { type: "savePlan"; plan: SavePlanView }
    /** The folder the reader picked, or absent where they dismissed the picker without choosing one. */
    | { type: "saveFolder"; path?: string }
    | { type: "error"; message: string };

/**
 * What the Save As dialog opens on. The destinations are NOT here - they travel with the view, because
 * what a set can be written into is a property of the set rather than an answer to opening a dialog.
 */
export interface SaveAsSetupView {
    /**
     * Which set these defaults belong to.
     *
     * Self-describing because the answer is asynchronous and the reader can move between sets while it is
     * in flight: without it the dialog seeded on the id CHANGING and took whatever answer was on hand,
     * which was the previous creature's stem and id.
     */
    id: number;
    /** The stem to offer, which is the source's own. */
    prefix: string;
    /** An id free among those the source's install declares. */
    targetId: number;
    /** The section to offer, which is the source's own where the install declared one. */
    section: string;
}

/**
 * A planned save, as the dialog draws it: what would be written, where, and what it would cost.
 *
 * The file NAMES rather than a count, because a count answers none of the questions a reader asks of a
 * save - whether the stem took, whether the names are the ones the target expects, whether an existing
 * file is about to be replaced. Capped at `shown`, with `files` carrying the whole total, since a
 * character set is ninety-six names and a tiled one far more.
 */
export interface SavePlanView {
    /**
     * Which request this answers - `saveRequestKey` of it.
     *
     * A plan is a round trip and the reader keeps moving controls, so the answer on screen can be one
     * request behind. Without this the dialog could only take whatever arrived last as the answer to what
     * it is showing, which left Save enabled against a preview of different settings.
     */
    for: string;
    outcome: "refused" | "lossless" | "lossy";
    /** Present only on a refusal, and then it is the whole answer. */
    reason?: string;
    losses: string[];
    notes: string[];
    /** Every file the save would write, in write order, truncated to what the dialog can show. */
    shown: string[];
    /** How many it would write in total, which `shown` may be shorter than. */
    files: number;
    /** Where they would land, named so the reader can check it rather than trust a word. */
    destination: string;
    /**
     * Whether this save rewrites the set for another shape rather than writing it as it stands.
     *
     * Derived host-side from the request against the set's own geometry and naming, so the dialog and the
     * writer cannot disagree about which one is happening - and it is what decides whether the stem, the
     * id and the section are asked for at all.
     */
    retarget: boolean;
    /**
     * Whether this save takes a first PVRZ page number at all.
     *
     * A property of the save, not of what has been filled in yet: keyed on whether one is still MISSING,
     * the field vanished the moment the reader typed into it. Answered host-side because only the host
     * knows whether the members bring pages of their own, and asked in the dialog rather than after the
     * folder picker - every question a save has belongs to the decision, not to the moment the reader
     * thought they had already made it.
     */
    needsBasePage: boolean;
    /**
     * Whether this save has rotations of differing length to resolve.
     *
     * Answered host-side because only a run of the conversion knows: the source's facings are what differ,
     * and by how much. The control is drawn only when this is true, since for a source whose rotations
     * already agree every answer writes the same six files.
     */
    unevenRotations: boolean;
}

/** One creature the picker offers. `matches` marks the ones that actually use the open animation. */
export interface CreatureOption {
    resref: string;
    name: string;
    matches: boolean;
}
