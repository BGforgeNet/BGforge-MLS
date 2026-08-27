import {
    type Animation,
    type BamV2PageWrite,
    type IndexedSourceFormat,
    type RgbaAnimation,
    type Sequence,
    type SourceFormat,
    DEFAULT_FALLOUT_PALETTE,
    LossReport,
    convertToIndexed,
    decodeBamV2,
    encodeBamc,
    loadImage,
    isBamV2,
    isRgbaAnimation,
    needsFreshPages,
    parsePal,
    readBamV2Structure,
    serializeBamV1,
    serializeBamV2,
    serializeFrm,
    serializePal,
    type IndexedAnimation,
    type Rgba,
} from "@bgforge/image";
import type { DocumentBackup } from "./backup";
import { chooseActivePalette } from "./sidecar";
import {
    encodeFramePixels,
    type AnimationView,
    type FrameView,
    type MetaPatch,
    type SequenceView,
} from "./webview/messages";

function paletteEquals(a: Rgba[], b: Rgba[]): boolean {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    return a.every((c, i) => {
        const other = b[i];
        return other !== undefined && c.r === other.r && c.g === other.g && c.b === other.b && c.a === other.a;
    });
}

// A switch + never default keeps this exhaustive: a new IndexedSourceFormat member without a
// dispatch arm becomes a compile error instead of silently mis-serializing.
function serializeIndexed(indexed: IndexedAnimation): Uint8Array {
    switch (indexed.meta.sourceFormat) {
        case "frm":
            return serializeFrm(indexed);
        case "bam":
            return serializeBamV1(indexed);
        case "bamc":
            return encodeBamc(serializeBamV1(indexed));
        /* v8 ignore start -- unreachable: the never narrowing makes a new IndexedSourceFormat a compile error here */
        default: {
            const unhandled: never = indexed.meta.sourceFormat;
            throw new Error(`serializeIndexed: unhandled sourceFormat ${String(unhandled)}`);
        }
        /* v8 ignore stop */
    }
}

const COLOUR_MODEL_MISMATCH = "replaceSequences: the incoming animation's colour model does not match the document's";

/**
 * Which MetaPatch fields this format actually writes to disk.
 *
 * A patch touching none of them is a VIEW setting, not a document edit: the frame rate is the case
 * that matters, since a BAM of any version stores none and the parser resolves the engine's fixed 15
 * (see AnimationMeta.fps). Applying such an edit is right - playback should follow it - but marking
 * the file dirty and pushing an undo step for it is not: the save would write nothing, and reopening
 * would snap the value back. That is exactly why `directionLayout` is not patchable at all; the
 * difference here is that the frame rate is worth retuning for playback, so it is offered and scoped
 * rather than withheld.
 */
function persistedMetaFields(format: SourceFormat): readonly (keyof MetaPatch)[] {
    switch (format) {
        case "frm":
            return ["fps", "actionFrame"];
        case "bam":
        case "bamc":
            return ["transparentIndex"];
        case "bamv2":
            return [];
        /* v8 ignore start -- unreachable: the never narrowing makes a new SourceFormat a compile error here */
        default: {
            const unhandled: never = format;
            throw new Error(`persistedMetaFields: unhandled sourceFormat ${String(unhandled)}`);
        }
        /* v8 ignore stop */
    }
}

/**
 * Frames and cycles from `next` spliced into `current`, either replacing its own or appended after
 * them (with every incoming frame reference shifted past the frames already there).
 *
 * Generic over the animation so both colour models share one splice: the frame arrays never mix,
 * which is exactly the property the mismatch guard above exists to hold.
 */
function spliceInto<A extends { frames: F[]; sequences: Sequence[] }, F>(
    current: A,
    next: { frames: F[]; sequences: Sequence[] },
    mode: "replace" | "append",
): A {
    if (mode === "replace") return { ...current, frames: next.frames, sequences: next.sequences };
    const offset = current.frames.length;
    return {
        ...current,
        frames: [...current.frames, ...next.frames],
        sequences: [
            ...current.sequences,
            ...next.sequences.map((s) => ({ ...s, frameRefs: s.frameRefs.map((r) => r + offset) })),
        ],
    };
}

// A single undo/redo step captures ALL mutable document state a mutation can change - the
// animation AND externalEnabled (which is not part of the Animation IR but is a saveable,
// undoable choice); snapshotting only the animation would leave a palette toggle unrevertible.
// basePage rides along for the same reason: undoing the import that forced a page allocation must
// also forget the number chosen for it.
interface DocumentSnapshot {
    animation: Animation;
    externalEnabled: boolean;
    basePage: number | undefined;
}

/**
 * Rebuild a true-colour animation from a backup, resolving its pages out of the backup itself.
 *
 * A v2 cannot go through `loadImage` - that path deliberately refuses a v2, since it cannot fetch
 * pages - and it must not read them from disk either: the whole point of a backup is that the edited
 * pages were never written there.
 */
function rgbaFromBackup(backup: DocumentBackup): RgbaAnimation {
    const pages = new Map((backup.pages ?? []).map((p) => [p.page, p.bytes]));
    return decodeBamV2(readBamV2Structure(backup.bytes), (page) => pages.get(page), backup.bytes);
}

/**
 * Pure byte-in/byte-out animation document state: no vscode, no fs. The host-side
 * vscode.CustomDocument shell wraps this and wires onChange to its own refresh event.
 */
export class ImageDocumentModel {
    private animationValue: Animation;
    private readonly basename: string;
    private sidecarPalette: Rgba[] | undefined;
    private hasSidecar = false;
    private externalEnabled = false;
    /**
     * First PVRZ page number a save may allocate, once the user has chosen one. Undefined until then
     * - never defaulted, because a number already taken by a page inside the game's own archives
     * surfaces only as corrupted graphics at runtime.
     */
    private basePage: number | undefined;
    private undoStack: DocumentSnapshot[] = [];
    private redoStack: DocumentSnapshot[] = [];

    onChange?: () => void;

    private constructor(animation: Animation, basename: string, sidecarPalette?: Rgba[]) {
        this.animationValue = animation;
        this.basename = basename;
        this.setSidecar(sidecarPalette);
    }

    static fromBytes(bytes: Uint8Array, basename: string, sidecarBytes?: Uint8Array): ImageDocumentModel {
        const animation = loadImage(bytes, basename);
        const sidecarPalette = sidecarBytes !== undefined ? parsePal(sidecarBytes) : undefined;
        return new ImageDocumentModel(animation, basename, sidecarPalette);
    }

    // Restore an unsaved document from its hot-exit backup. The sidecar still comes from disk (a dirty
    // document wrote nothing), but the toggle must be replayed over setSidecar's auto-on default, which
    // otherwise silently re-enables a palette the pending edit had turned off.
    static fromBackup(backup: DocumentBackup, basename: string, sidecarBytes?: Uint8Array): ImageDocumentModel {
        // A v2 is rebuilt from the backup's own pages rather than sniffed by loadImage, which refuses
        // one; every other format still routes through the byte-sniffing path.
        const model = isBamV2(backup.bytes)
            ? ImageDocumentModel.fromRgbaAnimation(rgbaFromBackup(backup), basename)
            : ImageDocumentModel.fromBytes(backup.bytes, basename, sidecarBytes);
        model.externalEnabled = backup.externalPalette;
        return model;
    }

    /**
     * A true-colour animation the document layer already composed (BAM v2, whose PVRZ pages it
     * resolved). No sidecar: a `.pal` cannot apply to a format with no palette.
     */
    static fromRgbaAnimation(animation: RgbaAnimation, basename: string): ImageDocumentModel {
        return new ImageDocumentModel(animation, basename, undefined);
    }

    // An already-combined animation (a Fallout `.fr0`-`.fr5` split set the document layer merged
    // via combineFrmDirections), so the byte-sniffing loadImage path is bypassed. basename is the
    // combined `<base>.frm` identity the editor should present and save to.
    static fromAnimation(animation: IndexedAnimation, basename: string, sidecarBytes?: Uint8Array): ImageDocumentModel {
        const sidecarPalette = sidecarBytes !== undefined ? parsePal(sidecarBytes) : undefined;
        return new ImageDocumentModel(animation, basename, sidecarPalette);
    }

    private setSidecar(sidecarPalette: Rgba[] | undefined): void {
        this.sidecarPalette = sidecarPalette;
        this.hasSidecar = sidecarPalette !== undefined;
        // A sidecar on disk is authoritative: every (re)open enables it, even after a session that
        // disabled it and saved - the toggle is a per-session choice, and a save with the external
        // palette off leaves the .pal file in place rather than deleting a user file.
        this.externalEnabled = this.hasSidecar;
    }

    /**
     * The document's animation. Indexed-only callers (every save, export and convert path today)
     * should take `indexedAnimation()` instead, which states the requirement rather than casting.
     */
    get animation(): Animation {
        return this.animationValue;
    }

    /**
     * The animation as an indexed one, or undefined when the document is true-colour. Callers that
     * cannot represent true colour ask here and say what they will do about `undefined`, rather
     * than reading `.palette` off a union member that has none.
     */
    indexedAnimation(): IndexedAnimation | undefined {
        return isRgbaAnimation(this.animationValue) ? undefined : this.animationValue;
    }

    /**
     * The animation with its ACTIVE palette resolved in. An FRM carries no palette of its own -
     * `animationValue.palette` is an all-black placeholder - so the real colours come from the
     * default Fallout / sidecar palette (the same one toView uses). Every export/convert path MUST
     * use this, not the raw `animation`, or an FRM exports as a black silhouette.
     */
    resolvedAnimation(): IndexedAnimation | undefined {
        const indexed = this.indexedAnimation();
        return indexed && { ...indexed, palette: this.activePalette(indexed) };
    }

    /**
     * The document as an indexed animation, for an export to a format that cannot hold true colour.
     * An indexed document comes back with its ACTIVE palette resolved in (see resolvedAnimation); a
     * true-colour one is quantized, and the report says what that cost - per-pixel alpha becoming
     * one transparent index, colours merging into their nearest neighbour, or neither.
     *
     * `palette` pins the result to a given palette instead of building one, for FRM's "nearest
     * match" mode. Passing it here rather than remapping afterwards keeps it to ONE quantization:
     * quantizing to a fresh palette and then remapping that onto the bundled one compounds the
     * error twice over the same pixels.
     */
    indexedForExport(opts: { target: IndexedSourceFormat; palette?: Rgba[] }): {
        animation: IndexedAnimation;
        report: LossReport;
    } {
        const resolved = this.resolvedAnimation();
        if (resolved !== undefined) return { animation: resolved, report: new LossReport() };
        const animation = this.animationValue;
        if (!isRgbaAnimation(animation)) throw new Error("indexedForExport: document is neither indexed nor rgba");
        return convertToIndexed(animation, opts.target, opts.palette ? { palette: opts.palette } : {});
    }

    private activePalette(indexed: IndexedAnimation): Rgba[] {
        return chooseActivePalette({
            sourceFormat: indexed.meta.sourceFormat,
            embedded: indexed.palette,
            sidecar: this.sidecarPalette,
            externalEnabled: this.externalEnabled,
        });
    }

    toView(): AnimationView {
        const frames: FrameView[] = this.animationValue.frames.map((f) => ({
            width: f.width,
            height: f.height,
            pixels: encodeFramePixels(f.pixels),
            offsetX: f.offsetX,
            offsetY: f.offsetY,
        }));
        // FRM sequences are built in header-direction order, so the sequence index selects its
        // dirOffsets entry; BAM/BAMC have none, so the anchor's direction shift is 0.
        const { dirOffsetsX, dirOffsetsY } = this.animationValue.meta;
        const sequences: SequenceView[] = this.animationValue.sequences.map((s, i) => ({
            frameRefs: s.frameRefs,
            facing: s.facing,
            dirOffsetX: dirOffsetsX?.[i] ?? 0,
            dirOffsetY: dirOffsetsY?.[i] ?? 0,
        }));
        const shared = {
            frames,
            sequences,
            meta: this.animationValue.meta,
            basename: this.basename,
            sourceFormat: this.animationValue.meta.sourceFormat,
        };
        const indexed = this.indexedAnimation();
        if (indexed === undefined) return { ...shared, colorModel: "rgba" };
        return {
            ...shared,
            colorModel: "indexed",
            palette: this.activePalette(indexed),
            hasSidecarPal: this.hasSidecar,
            externalPaletteActive:
                indexed.meta.sourceFormat === "frm" && this.externalEnabled && this.sidecarPalette !== undefined,
        };
    }

    /**
     * Whether a save must write fresh PVRZ pages, i.e. whether this document's frames still carry
     * the data blocks they were read from. False for every palette-indexed format, which has none.
     */
    needsFreshPages(): boolean {
        const animation = this.animationValue;
        return isRgbaAnimation(animation) && needsFreshPages(animation);
    }

    /** The page number already chosen, or undefined while none has been - so a caller knows both
     *  whether to ask and what to pass on. */
    chosenBasePage(): number | undefined {
        return this.basePage;
    }

    /**
     * Record the first PVRZ page number a save may allocate. Set at the EDIT that forces a repack,
     * not at the save: a save path that could still be missing it has no way to ask (a hot-exit
     * backup least of all), and would have to fail instead.
     */
    setBasePage(page: number): void {
        this.basePage = page;
    }

    private snapshot(): DocumentSnapshot {
        return {
            animation: structuredClone(this.animationValue),
            externalEnabled: this.externalEnabled,
            basePage: this.basePage,
        };
    }

    private restore(snapshot: DocumentSnapshot): void {
        this.animationValue = snapshot.animation;
        this.externalEnabled = snapshot.externalEnabled;
        this.basePage = snapshot.basePage;
    }

    private snapshotForUndo(): void {
        this.undoStack.push(this.snapshot());
        this.redoStack = [];
    }

    /**
     * Apply a metadata edit. Returns whether it changed anything the file will actually carry, so
     * the caller knows whether to mark the document dirty and push an undo step - see
     * persistedMetaFields.
     */
    applyMetaPatch(patch: MetaPatch): boolean {
        const persists = persistedMetaFields(this.animationValue.meta.sourceFormat).some(
            (field) => patch[field] !== undefined,
        );
        // Only a persisting edit is undoable: an orphaned snapshot would be popped by a later undo
        // of some other edit and silently revert the view setting along with it.
        if (persists) this.snapshotForUndo();
        const indexed = this.indexedAnimation();
        // A BAM v1 frame's cached rawEncoding is RLE-encoded against the transparent index it was
        // parsed with; serializing it verbatim under an edited header index yields an unreadable
        // stream. Drop the caches so the serializer writes those frames uncompressed instead. A
        // true-colour frame holds no such cache, so this applies only to the indexed member.
        const dropsRawEncoding =
            indexed !== undefined &&
            patch.transparentIndex !== undefined &&
            patch.transparentIndex !== indexed.meta.transparentIndex;
        if (indexed !== undefined && dropsRawEncoding) {
            this.animationValue = {
                ...indexed,
                frames: indexed.frames.map((f) => ({
                    width: f.width,
                    height: f.height,
                    pixels: f.pixels,
                    offsetX: f.offsetX,
                    offsetY: f.offsetY,
                })),
                meta: { ...indexed.meta, ...patch },
            };
        } else if (indexed !== undefined) {
            this.animationValue = { ...indexed, meta: { ...indexed.meta, ...patch } };
        } else if (isRgbaAnimation(this.animationValue)) {
            this.animationValue = { ...this.animationValue, meta: { ...this.animationValue.meta, ...patch } };
        }
        this.onChange?.();
        return persists;
    }

    setExternalPalette(enabled: boolean): void {
        this.snapshotForUndo();
        this.externalEnabled = enabled;
        this.onChange?.();
    }

    replaceSequences(next: Animation, mode: "replace" | "append"): void {
        // Indexed frames carry one byte per pixel; a true-colour animation's carry four. `Frame` is
        // structurally assignable to `RgbaFrame`, so a mismatched splice typechecks and then renders
        // garbage - this is the only thing standing between an import and a corrupted document.
        // Callers convert first (see adaptImportedColourModel), so a mismatch here is a bug, not a
        // user-reachable state.
        // Branching on the DOCUMENT and re-checking the import inside keeps each arm's frame type
        // concrete, which is what makes the splice type-safe rather than merely type-checked.
        const current = this.animationValue;
        if (isRgbaAnimation(current)) {
            if (!isRgbaAnimation(next)) throw new Error(COLOUR_MODEL_MISMATCH);
            this.commitSplice(spliceInto(current, next, mode));
            return;
        }
        if (isRgbaAnimation(next)) throw new Error(COLOUR_MODEL_MISMATCH);
        this.commitSplice(spliceInto(current, next, mode));
    }

    /** Undo point plus the swap. Separate so the two colour-model arms above share it verbatim. */
    private commitSplice(animation: Animation): void {
        this.snapshotForUndo();
        this.animationValue = animation;
        this.onChange?.();
    }

    undo(): void {
        const previous = this.undoStack.pop();
        if (previous === undefined) return;
        this.redoStack.push(this.snapshot());
        this.restore(previous);
        this.onChange?.();
    }

    redo(): void {
        const next = this.redoStack.pop();
        if (next === undefined) return;
        this.undoStack.push(this.snapshot());
        this.restore(next);
        this.onChange?.();
    }

    /**
     * Everything a save must write: the artifact itself, plus the PVRZ pages a BAM v2 re-encoded.
     * `pages` is empty for every other format, and for a v2 whose frames still carry the blocks they
     * were composed from - that file writes back byte-for-byte rather than through a lossy re-encode.
     *
     * `standalone` says the write must stand on its own, i.e. it is going somewhere the file's
     * existing pages are not (a Save As). A v2 then carries its untouched pages along verbatim,
     * because its data blocks address them by number and the destination folder has none.
     */
    saveArtifacts(options: { standalone?: boolean } = {}): { bytes: Uint8Array; pages: readonly BamV2PageWrite[] } {
        const animation = this.animationValue;
        if (isRgbaAnimation(animation)) {
            const saved = serializeBamV2(animation, {
                emitUnchangedPages: options.standalone,
                ...(this.basePage === undefined ? {} : { basePage: this.basePage }),
            });
            return { bytes: saved.bam, pages: saved.pages };
        }
        return { bytes: serializeIndexed(animation), pages: [] };
    }

    /** The artifact bytes alone. A BAM v2 save also writes PVRZ pages - see saveArtifacts. */
    getBytes(): Uint8Array {
        return this.saveArtifacts().bytes;
    }

    /**
     * Snapshot for a hot-exit backup: the serialized animation plus the state its bytes cannot carry.
     *
     * `standalone` because a backup must stand on its own. A v2's frames live in PVRZ pages the
     * document may have repacked and never written, so a restore that re-read them from the folder
     * would rebuild the pre-edit picture - or find nothing at all.
     */
    backup(): DocumentBackup {
        const { bytes, pages } = this.saveArtifacts({ standalone: true });
        return { bytes, externalPalette: this.externalEnabled, pages: [...pages] };
    }

    sidecarBytes(): Uint8Array | undefined {
        const indexed = this.indexedAnimation();
        if (indexed === undefined || indexed.meta.sourceFormat !== "frm") return undefined;
        const active = this.activePalette(indexed);
        if (paletteEquals(active, DEFAULT_FALLOUT_PALETTE)) return undefined;
        return serializePal(active);
    }

    reload(bytes: Uint8Array, sidecarBytes?: Uint8Array): void {
        this.reloadAnimation(loadImage(bytes, this.basename), sidecarBytes);
    }

    // Reload from an already-combined animation (the FR-split path), skipping byte sniffing.
    reloadAnimation(animation: IndexedAnimation, sidecarBytes?: Uint8Array): void {
        this.animationValue = animation;
        this.setSidecar(sidecarBytes !== undefined ? parsePal(sidecarBytes) : undefined);
        this.undoStack = [];
        this.redoStack = [];
    }
}
