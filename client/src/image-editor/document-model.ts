import {
    DEFAULT_FALLOUT_PALETTE,
    encodeBamc,
    loadImage,
    parsePal,
    serializeBamV1,
    serializeFrm,
    serializePal,
    type Animation,
    type Rgba,
} from "@bgforge/image";
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
// animation AND externalEnabled (which is not part of the Animation IR but is a saveable,
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

    // An already-combined animation (a Fallout `.fr0`-`.fr5` split set the document layer merged
    // via combineFrmDirections), so the byte-sniffing loadImage path is bypassed. basename is the
    // combined `<base>.frm` identity the editor should present and save to.
    static fromAnimation(animation: Animation, basename: string, sidecarBytes?: Uint8Array): ImageDocumentModel {
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

    get animation(): Animation {
        return this.animationValue;
    }

    /**
     * The animation with its ACTIVE palette resolved in. An FRM carries no palette of its own -
     * `animationValue.palette` is an all-black placeholder - so the real colours come from the
     * default Fallout / sidecar palette (the same one toView uses). Every export/convert path MUST
     * use this, not the raw `animation`, or an FRM exports as a black silhouette.
     */
    resolvedAnimation(): Animation {
        return { ...this.animationValue, palette: this.activePalette() };
    }

    private activePalette(): Rgba[] {
        return chooseActivePalette({
            sourceFormat: this.animationValue.meta.sourceFormat,
            embedded: this.animationValue.palette,
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
        return {
            palette: this.activePalette(),
            frames,
            sequences,
            meta: this.animationValue.meta,
            basename: this.basename,
            sourceFormat: this.animationValue.meta.sourceFormat,
            hasSidecarPal: this.hasSidecar,
            externalPaletteActive:
                this.animationValue.meta.sourceFormat === "frm" &&
                this.externalEnabled &&
                this.sidecarPalette !== undefined,
        };
    }

    private snapshotForUndo(): void {
        this.undoStack.push({ animation: structuredClone(this.animationValue), externalEnabled: this.externalEnabled });
        this.redoStack = [];
    }

    applyMetaPatch(patch: MetaPatch): void {
        this.snapshotForUndo();
        let frames = this.animationValue.frames;
        // A BAM frame's cached rawEncoding is RLE-encoded against the transparent index it was parsed
        // with; serializing it verbatim under an edited header index yields an unreadable stream. Drop
        // the caches so the serializer writes those frames uncompressed instead.
        if (
            patch.transparentIndex !== undefined &&
            patch.transparentIndex !== this.animationValue.meta.transparentIndex
        ) {
            frames = frames.map((f) => ({
                width: f.width,
                height: f.height,
                pixels: f.pixels,
                offsetX: f.offsetX,
                offsetY: f.offsetY,
            }));
        }
        this.animationValue = { ...this.animationValue, frames, meta: { ...this.animationValue.meta, ...patch } };
        this.onChange?.();
    }

    setExternalPalette(enabled: boolean): void {
        this.snapshotForUndo();
        this.externalEnabled = enabled;
        this.onChange?.();
    }

    replaceSequences(next: Animation, mode: "replace" | "append"): void {
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
        switch (this.animationValue.meta.sourceFormat) {
            case "frm":
                return serializeFrm(this.animationValue);
            case "bam":
                return serializeBamV1(this.animationValue);
            case "bamc":
                return encodeBamc(serializeBamV1(this.animationValue));
            default: {
                const unhandled: never = this.animationValue.meta.sourceFormat;
                throw new Error(`getBytes: unhandled sourceFormat ${String(unhandled)}`);
            }
        }
    }

    sidecarBytes(): Uint8Array | undefined {
        if (this.animationValue.meta.sourceFormat !== "frm") return undefined;
        const active = this.activePalette();
        if (paletteEquals(active, DEFAULT_FALLOUT_PALETTE)) return undefined;
        return serializePal(active);
    }

    reload(bytes: Uint8Array, sidecarBytes?: Uint8Array): void {
        this.reloadAnimation(loadImage(bytes, this.basename), sidecarBytes);
    }

    // Reload from an already-combined animation (the FR-split path), skipping byte sniffing.
    reloadAnimation(animation: Animation, sidecarBytes?: Uint8Array): void {
        this.animationValue = animation;
        this.setSidecar(sidecarBytes !== undefined ? parsePal(sidecarBytes) : undefined);
        this.undoStack = [];
        this.redoStack = [];
    }
}
