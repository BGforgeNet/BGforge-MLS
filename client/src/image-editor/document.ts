import * as path from "path";
import * as vscode from "vscode";
import {
    type Animation,
    combineFrmDirections,
    combineIeBamPair,
    encodeBamc,
    loadImage,
    serializeBamV1,
    splitIeBamPair,
} from "@bgforge/image";
import { ImageDocumentModel } from "./document-model";
import { frSplitCombinedPath, frSplitSiblingPaths, isFrSplitPath } from "./fr-split";
import { baseCandidatePath, eastCompanionCandidates, isBamPath } from "./ie-pair";
import { type SaveWrite } from "./save";
import { sidecarPalPath } from "./sidecar";
import type { AnimationView, MetaPatch } from "./webview/messages";

type BamFormat = "bam" | "bamc";

/** The on-disk identity of an IE base/east pair: both paths and each member's own encoding. */
interface IePairInfo {
    basePath: string;
    eastPath: string;
    baseFormat: BamFormat;
    eastFormat: BamFormat;
}

function serializeBamAs(animation: Animation, format: BamFormat): Uint8Array {
    const bytes = serializeBamV1(animation);
    return format === "bamc" ? encodeBamc(bytes) : bytes;
}

/**
 * Thin `vscode.CustomDocument` shell over `ImageDocumentModel`: owns the file identity, the
 * sidecar `.pal` read, and the two VS Code event emitters (edit stack + panel refresh). All
 * animation state and undo logic lives in the model.
 */
export class ImageEditorDocument implements vscode.CustomDocument {
    readonly uri: vscode.Uri;
    // True when the document was opened from a Fallout `.fr0`-`.fr5` split set: it is combined on
    // load and saved back to a single `<base>.frm` (see fr-split.ts and the provider's save path).
    readonly isFrSplit: boolean;
    // Set when the document was opened from an IE base/east BAM pair (see ie-pair.ts): the pair is
    // combined on load into one full-rose animation and split back into both files on save.
    readonly iePair: IePairInfo | undefined;
    private readonly model: ImageDocumentModel;

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
        vscode.CustomDocumentEditEvent<ImageEditorDocument>
    >();
    readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    private readonly _onDidRefresh = new vscode.EventEmitter<void>();
    readonly onDidRefresh = this._onDidRefresh.event;

    private constructor(uri: vscode.Uri, model: ImageDocumentModel, isFrSplit: boolean, iePair?: IePairInfo) {
        this.uri = uri;
        this.isFrSplit = isFrSplit;
        this.iePair = iePair;
        this.model = model;
        this.model.onChange = () => this._onDidRefresh.fire();
    }

    static async open(uri: vscode.Uri): Promise<ImageEditorDocument> {
        if (isFrSplitPath(uri.fsPath)) {
            const { animation, sidecarBytes } = await ImageEditorDocument.readFrSplit(uri.fsPath);
            // Present and save under the combined <base>.frm identity, not the opened .frN member.
            const basename = path.basename(frSplitCombinedPath(uri.fsPath));
            const model = ImageDocumentModel.fromAnimation(animation, basename, sidecarBytes);
            return new ImageEditorDocument(uri, model, true);
        }
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (isBamPath(uri.fsPath)) {
            const pair = await ImageEditorDocument.tryReadIePair(uri.fsPath, bytes);
            if (pair) {
                // Present under the base file's identity, whichever member was opened.
                const model = ImageDocumentModel.fromAnimation(pair.animation, path.basename(pair.info.basePath));
                return new ImageEditorDocument(uri, model, false, pair.info);
            }
        }
        const sidecarBytes = await ImageEditorDocument.readSidecar(uri);
        const model = ImageDocumentModel.fromBytes(bytes, path.basename(uri.fsPath), sidecarBytes);
        return new ImageEditorDocument(uri, model, false);
    }

    /**
     * The path an in-place save writes to: the combined `<base>.frm` for a split set, the base member
     * for an IE pair (the provider splits a pair save across both members), else the source. A
     * split-set save deliberately overwrites any pre-existing `<base>.frm` without prompting - the
     * split members are the source of truth for that basename.
     */
    get savePath(): string {
        if (this.isFrSplit) return frSplitCombinedPath(this.uri.fsPath);
        return this.iePair?.basePath ?? this.uri.fsPath;
    }

    /**
     * In-place save writes for an IE pair: the combined animation split back into its two files, each
     * serialized with its member's own encoding. Undefined for non-pair documents; throws when edits
     * broke the 8-slot block structure a split needs.
     */
    pairSaveWrites(): SaveWrite[] | undefined {
        if (!this.iePair) return undefined;
        const split = splitIeBamPair(this.model.animation);
        if (!split) {
            throw new Error(
                "This base/east BAM pair no longer fits the 8-cycle direction blocks - use Save As instead.",
            );
        }
        return [
            { path: this.iePair.basePath, bytes: serializeBamAs(split.base, this.iePair.baseFormat) },
            { path: this.iePair.eastPath, bytes: serializeBamAs(split.east, this.iePair.eastFormat) },
        ];
    }

    // Probe the opened .bam's siblings for the other pair member: first as the base (companion =
    // stem + "e"/"E"), then as the companion (base = stem minus its trailing "e"). combineIeBamPair
    // does the actual shape validation, so an unrelated same-named sibling never pairs.
    private static async tryReadIePair(
        fsPath: string,
        bytes: Uint8Array,
    ): Promise<{ animation: Animation; info: IePairInfo } | undefined> {
        const opened = ImageEditorDocument.tryParseBam(bytes, fsPath);
        if (!opened) return undefined;

        const candidates = eastCompanionCandidates(fsPath);
        const eastReads = await Promise.all(candidates.map((p) => ImageEditorDocument.tryReadFile(p)));
        const hit = eastReads.findIndex((b) => b !== undefined);
        const eastPath = candidates[hit];
        const eastBytes = eastReads[hit];
        if (eastPath !== undefined && eastBytes !== undefined) {
            const east = ImageEditorDocument.tryParseBam(eastBytes, eastPath);
            const combined = east && combineIeBamPair(opened.animation, east.animation);
            if (east && combined) {
                return {
                    animation: combined,
                    info: { basePath: fsPath, eastPath, baseFormat: opened.format, eastFormat: east.format },
                };
            }
        }

        const basePath = baseCandidatePath(fsPath);
        if (basePath !== undefined) {
            const baseBytes = await ImageEditorDocument.tryReadFile(basePath);
            const base = baseBytes && ImageEditorDocument.tryParseBam(baseBytes, basePath);
            const combined = base && combineIeBamPair(base.animation, opened.animation);
            if (base && combined) {
                return {
                    animation: combined,
                    info: { basePath, eastPath: fsPath, baseFormat: base.format, eastFormat: opened.format },
                };
            }
        }
        return undefined;
    }

    private static tryParseBam(
        bytes: Uint8Array,
        fsPath: string,
    ): { animation: Animation; format: BamFormat } | undefined {
        try {
            const animation = loadImage(bytes, path.basename(fsPath));
            const format = animation.meta.sourceFormat;
            // A .bam-named file whose bytes are something else never joins a pair.
            if (format !== "bam" && format !== "bamc") return undefined;
            return { animation, format };
        } catch {
            return undefined;
        }
    }

    // Read the six `.fr0`-`.fr5` siblings (missing ones become undefined -> an empty facing) and
    // merge them into one 6-direction FRM. The sidecar palette is the combined file's `<base>.pal`.
    private static async readFrSplit(
        fsPath: string,
    ): Promise<{ animation: Animation; sidecarBytes: Uint8Array | undefined }> {
        const files = await Promise.all(frSplitSiblingPaths(fsPath).map((p) => ImageEditorDocument.tryReadFile(p)));
        const animation = combineFrmDirections(files);
        const sidecarBytes = await ImageEditorDocument.tryReadFile(sidecarPalPath(frSplitCombinedPath(fsPath)));
        return { animation, sidecarBytes };
    }

    private static async tryReadFile(fsPath: string): Promise<Uint8Array | undefined> {
        try {
            return await vscode.workspace.fs.readFile(vscode.Uri.file(fsPath));
        } catch {
            return undefined;
        }
    }

    // FRM carries no embedded palette and may have a sidecar .pal; BAM/BAMC always embed their
    // own, so probing for one there would only spend a read on a file that is never consulted.
    private static async readSidecar(uri: vscode.Uri): Promise<Uint8Array | undefined> {
        if (!uri.fsPath.toLowerCase().endsWith(".frm")) return undefined;
        try {
            return await vscode.workspace.fs.readFile(vscode.Uri.file(sidecarPalPath(uri.fsPath)));
        } catch {
            return undefined;
        }
    }

    private fireEdit(label: string): void {
        this._onDidChangeCustomDocument.fire({
            document: this,
            label,
            undo: () => this.model.undo(),
            redo: () => this.model.redo(),
        });
    }

    applyMetaPatch(patch: MetaPatch): void {
        this.model.applyMetaPatch(patch);
        this.fireEdit("Edit animation properties");
    }

    setExternalPalette(enabled: boolean): void {
        this.model.setExternalPalette(enabled);
        this.fireEdit(enabled ? "Enable external palette" : "Disable external palette");
    }

    replaceSequences(next: Animation, mode: "replace" | "append"): void {
        this.model.replaceSequences(next, mode);
        this.fireEdit(mode === "append" ? "Import cycles" : "Replace cycles");
    }

    toView(): AnimationView {
        return this.model.toView();
    }

    getBytes(): Uint8Array {
        return this.model.getBytes();
    }

    sidecarBytes(): Uint8Array | undefined {
        return this.model.sidecarBytes();
    }

    get animation(): Animation {
        return this.model.animation;
    }

    /** Animation with the active palette resolved in - use for exports/conversions (see model). */
    resolvedAnimation(): Animation {
        return this.model.resolvedAnimation();
    }

    async reload(): Promise<void> {
        if (this.isFrSplit) {
            const { animation, sidecarBytes } = await ImageEditorDocument.readFrSplit(this.uri.fsPath);
            this.model.reloadAnimation(animation, sidecarBytes);
            return;
        }
        const bytes = await vscode.workspace.fs.readFile(this.uri);
        if (this.iePair) {
            // Re-pair from disk; if the companion vanished, fall back to the opened file alone (the
            // document keeps its pair identity - the next save recreates the companion).
            const pair = await ImageEditorDocument.tryReadIePair(this.uri.fsPath, bytes);
            if (pair) {
                this.model.reloadAnimation(pair.animation);
                return;
            }
        }
        const sidecarBytes = await ImageEditorDocument.readSidecar(this.uri);
        this.model.reload(bytes, sidecarBytes);
    }

    dispose(): void {
        this._onDidChangeCustomDocument.dispose();
        this._onDidRefresh.dispose();
    }
}
