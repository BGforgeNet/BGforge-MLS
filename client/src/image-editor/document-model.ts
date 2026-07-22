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
    private dirtyValue = false;

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

    private setSidecar(sidecarPalette: Rgba[] | undefined): void {
        this.sidecarPalette = sidecarPalette;
        this.hasSidecar = sidecarPalette !== undefined;
        this.externalEnabled = this.hasSidecar; // FRM auto-on when a sidecar is present
    }

    get animation(): Animation {
        return this.animationValue;
    }

    get dirty(): boolean {
        return this.dirtyValue;
    }

    get canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    get canRedo(): boolean {
        return this.redoStack.length > 0;
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
        const sequences: SequenceView[] = this.animationValue.sequences.map((s) => ({
            frameRefs: s.frameRefs,
            facing: s.facing,
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
            dirty: this.dirtyValue,
        };
    }

    private snapshotForUndo(): void {
        this.undoStack.push({ animation: structuredClone(this.animationValue), externalEnabled: this.externalEnabled });
        this.redoStack = [];
    }

    private markDirty(): void {
        this.dirtyValue = true;
        this.onChange?.();
    }

    applyMetaPatch(patch: MetaPatch): void {
        this.snapshotForUndo();
        this.animationValue = { ...this.animationValue, meta: { ...this.animationValue.meta, ...patch } };
        this.markDirty();
    }

    setExternalPalette(enabled: boolean): void {
        this.snapshotForUndo();
        this.externalEnabled = enabled;
        this.markDirty();
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
        this.markDirty();
    }

    undo(): void {
        const previous = this.undoStack.pop();
        if (previous === undefined) return;
        this.redoStack.push({ animation: structuredClone(this.animationValue), externalEnabled: this.externalEnabled });
        this.animationValue = previous.animation;
        this.externalEnabled = previous.externalEnabled;
        this.dirtyValue = true;
        this.onChange?.();
    }

    redo(): void {
        const next = this.redoStack.pop();
        if (next === undefined) return;
        this.undoStack.push({ animation: structuredClone(this.animationValue), externalEnabled: this.externalEnabled });
        this.animationValue = next.animation;
        this.externalEnabled = next.externalEnabled;
        this.dirtyValue = true;
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

    markSaved(): void {
        this.dirtyValue = false;
    }

    reload(bytes: Uint8Array, sidecarBytes?: Uint8Array): void {
        this.animationValue = loadImage(bytes, this.basename);
        this.setSidecar(sidecarBytes !== undefined ? parsePal(sidecarBytes) : undefined);
        this.undoStack = [];
        this.redoStack = [];
        this.dirtyValue = false;
    }
}
