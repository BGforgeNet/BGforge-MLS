import {
    type Animation,
    type RgbaAnimation,
    DEFAULT_FALLOUT_PALETTE,
    encodeBamc,
    loadImage,
    isRgbaAnimation,
    parsePal,
    serializeBamV1,
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

// A single undo/redo step captures ALL mutable document state a mutation can change - the
// animation AND externalEnabled (which is not part of the IndexedAnimation IR but is a saveable,
// undoable choice); snapshotting only the animation would leave a palette toggle unrevertible.
interface DocumentSnapshot {
    animation: Animation;
    externalEnabled: boolean;
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
        const model = ImageDocumentModel.fromBytes(backup.bytes, basename, sidecarBytes);
        model.externalEnabled = backup.externalPalette;
        return model;
    }

    // An already-combined animation (a Fallout `.fr0`-`.fr5` split set the document layer merged
    // via combineFrmDirections), so the byte-sniffing loadImage path is bypassed. basename is the
    // combined `<base>.frm` identity the editor should present and save to.
    /**
     * A true-colour animation the document layer already composed (BAM v2, whose PVRZ pages it
     * resolved). No sidecar: a `.pal` cannot apply to a format with no palette.
     */
    static fromRgbaAnimation(animation: RgbaAnimation, basename: string): ImageDocumentModel {
        return new ImageDocumentModel(animation, basename, undefined);
    }

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

    private snapshotForUndo(): void {
        this.undoStack.push({ animation: structuredClone(this.animationValue), externalEnabled: this.externalEnabled });
        this.redoStack = [];
    }

    applyMetaPatch(patch: MetaPatch): void {
        this.snapshotForUndo();
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
    }

    setExternalPalette(enabled: boolean): void {
        this.snapshotForUndo();
        this.externalEnabled = enabled;
        this.onChange?.();
    }

    replaceSequences(next: IndexedAnimation, mode: "replace" | "append"): void {
        // Indexed frames carry one byte per pixel; a true-colour animation's carry four. `Frame` is
        // structurally assignable to `RgbaFrame`, so splicing them in typechecks and then renders
        // garbage - this is the only thing standing between an import and a corrupted document.
        if (isRgbaAnimation(this.animationValue)) {
            throw new Error("Importing indexed frames into a true-colour BAM v2 is not supported.");
        }
        this.snapshotForUndo();
        if (mode === "replace") {
            this.animationValue = { ...this.animationValue, frames: next.frames, sequences: next.sequences };
        } else {
            const offset = this.animationValue.frames.length;
            const frames = [...this.animationValue.frames, ...next.frames];
            const sequences = [
                ...this.animationValue.sequences,
                ...next.sequences.map((s) => ({ ...s, frameRefs: s.frameRefs.map((r) => r + offset) })),
            ];
            this.animationValue = { ...this.animationValue, frames, sequences };
        }
        this.onChange?.();
    }

    undo(): void {
        const previous = this.undoStack.pop();
        if (previous === undefined) return;
        this.redoStack.push({ animation: structuredClone(this.animationValue), externalEnabled: this.externalEnabled });
        this.animationValue = previous.animation;
        this.externalEnabled = previous.externalEnabled;
        this.onChange?.();
    }

    redo(): void {
        const next = this.redoStack.pop();
        if (next === undefined) return;
        this.undoStack.push({ animation: structuredClone(this.animationValue), externalEnabled: this.externalEnabled });
        this.animationValue = next.animation;
        this.externalEnabled = next.externalEnabled;
        this.onChange?.();
    }

    getBytes(): Uint8Array {
        // A switch + never default keeps this exhaustive: a new SourceFormat member without a
        // dispatch arm becomes a compile error instead of silently mis-serializing.
        const indexed = this.indexedAnimation();
        if (indexed === undefined) {
            throw new Error(
                "Saving BAM v2 is not supported yet - its frames live in separate PVRZ pages that this build only reads.",
            );
        }
        switch (indexed.meta.sourceFormat) {
            case "frm":
                return serializeFrm(indexed);
            case "bam":
                return serializeBamV1(indexed);
            case "bamc":
                return encodeBamc(serializeBamV1(indexed));
            default: {
                const unhandled: never = indexed.meta.sourceFormat;
                throw new Error(`getBytes: unhandled sourceFormat ${String(unhandled)}`);
            }
        }
    }

    /** Snapshot for a hot-exit backup: the serialized animation plus the state its bytes cannot carry. */
    backup(): DocumentBackup {
        return { bytes: this.getBytes(), externalPalette: this.externalEnabled };
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
