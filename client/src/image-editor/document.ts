import * as path from "path";
import * as vscode from "vscode";
import {
    type IndexedAnimation,
    combineFrmDirections,
    combineIeBamPair,
    encodeBamc,
    loadImage,
    serializeBamV1,
    splitIeBamPair,
} from "@bgforge/image";
import type { DocumentBackup } from "./backup";
import { ImageDocumentModel } from "./document-model";
import { frSplitCombinedPath, frSplitSiblingPaths, isFrSplitPath } from "./fr-split";
import { baseCandidatePath, eastCompanionCandidates, isBamPath } from "./ie-pair";
import { sidecarPalPath } from "./sidecar";
import type { AnimationView, MetaPatch } from "./webview/messages";

type BamFormat = "bam" | "bamc";

/** One write of an in-place pair save, addressed by URI so it lands back where the member was read. */
export interface PairWrite {
    uri: vscode.Uri;
    bytes: Uint8Array;
}

/**
 * The stored identity of an IE base/east pair: both members and each one's own encoding. URIs, not
 * filesystem paths, so a pair opened out of a game's archives keeps the scheme and query that route
 * a read or a write back to that game.
 */
interface IePairInfo {
    baseUri: vscode.Uri;
    eastUri: vscode.Uri;
    baseFormat: BamFormat;
    eastFormat: BamFormat;
}

function serializeBamAs(animation: IndexedAnimation, format: BamFormat): Uint8Array {
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

    /**
     * Opens `uri`, or restores it from `backup` when VS Code re-opens a document that was dirty at
     * shutdown. A restore takes only the animation from the backup: the split-set / pair identity and
     * the sidecar palette still come from disk, which the unsaved edits never touched.
     */
    static async open(uri: vscode.Uri, backup?: DocumentBackup): Promise<ImageEditorDocument> {
        if (isFrSplitPath(uri.fsPath)) {
            const { animation, sidecarBytes } = await ImageEditorDocument.readFrSplit(uri.fsPath);
            // Present and save under the combined <base>.frm identity, not the opened .frN member.
            const basename = path.basename(frSplitCombinedPath(uri.fsPath));
            const model = backup
                ? ImageDocumentModel.fromBackup(backup, basename, sidecarBytes)
                : ImageDocumentModel.fromAnimation(animation, basename, sidecarBytes);
            return new ImageEditorDocument(uri, model, true);
        }
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (isBamPath(uri.path)) {
            const pair = await ImageEditorDocument.tryReadIePair(uri, bytes);
            if (pair) {
                // Present under the base file's identity, whichever member was opened.
                const basename = path.posix.basename(pair.info.baseUri.path);
                const model = backup
                    ? ImageDocumentModel.fromBackup(backup, basename)
                    : ImageDocumentModel.fromAnimation(pair.animation, basename);
                return new ImageEditorDocument(uri, model, false, pair.info);
            }
        }
        const sidecarBytes = await ImageEditorDocument.readSidecar(uri);
        const basename = path.basename(uri.fsPath);
        const model = backup
            ? ImageDocumentModel.fromBackup(backup, basename, sidecarBytes)
            : ImageDocumentModel.fromBytes(bytes, basename, sidecarBytes);
        return new ImageEditorDocument(uri, model, false);
    }

    /**
     * What an in-place save writes to: the combined `<base>.frm` for a split set, the base member for
     * an IE pair (the provider splits a pair save across both members), else the source. A split-set
     * save deliberately overwrites any pre-existing `<base>.frm` without prompting - the split members
     * are the source of truth for that basename.
     *
     * A URI rather than a path so the write lands back where the document was read from; only the
     * Fallout split set, which exists on a real filesystem by definition, names a `file:` path itself.
     */
    get saveUri(): vscode.Uri {
        if (this.isFrSplit) return vscode.Uri.file(frSplitCombinedPath(this.uri.fsPath));
        return this.iePair?.baseUri ?? this.uri;
    }

    /**
     * In-place save writes for an IE pair: the combined animation split back into its two files, each
     * serialized with its member's own encoding. Undefined for non-pair documents; throws when edits
     * broke the 8-slot block structure a split needs.
     */
    pairSaveWrites(): PairWrite[] | undefined {
        if (!this.iePair) return undefined;
        const split = splitIeBamPair(this.model.animation);
        if (!split) {
            throw new Error(
                "This base/east BAM pair no longer fits the 8-cycle direction blocks - use Save As instead.",
            );
        }
        return [
            { uri: this.iePair.baseUri, bytes: serializeBamAs(split.base, this.iePair.baseFormat) },
            { uri: this.iePair.eastUri, bytes: serializeBamAs(split.east, this.iePair.eastFormat) },
        ];
    }

    // Probe the opened .bam's siblings for the other pair member: first as the base (companion =
    // stem + "e"/"E"), then as the companion (base = stem minus its trailing "e"). combineIeBamPair
    // does the actual shape validation, so an unrelated same-named sibling never pairs.
    //
    // Siblings are derived from the opened URI rather than a filesystem path, so the probe stays in
    // whatever served it: a game resource looks for its companion in the same game, where the pair
    // actually lives, instead of at the root of the local filesystem.
    private static async tryReadIePair(
        uri: vscode.Uri,
        bytes: Uint8Array,
    ): Promise<{ animation: IndexedAnimation; info: IePairInfo } | undefined> {
        const opened = ImageEditorDocument.tryParseBam(bytes, uri);
        if (!opened) return undefined;

        const candidates = eastCompanionCandidates(uri.path).map((p) => uri.with({ path: p }));
        const eastReads = await Promise.all(candidates.map((c) => ImageEditorDocument.tryReadUri(c)));
        const hit = eastReads.findIndex((b) => b !== undefined);
        const eastUri = candidates[hit];
        const eastBytes = eastReads[hit];
        if (eastUri !== undefined && eastBytes !== undefined) {
            const east = ImageEditorDocument.tryParseBam(eastBytes, eastUri);
            const combined = east && combineIeBamPair(opened.animation, east.animation);
            if (east && combined) {
                return {
                    animation: combined,
                    info: { baseUri: uri, eastUri, baseFormat: opened.format, eastFormat: east.format },
                };
            }
        }

        const basePath = baseCandidatePath(uri.path);
        if (basePath !== undefined) {
            const baseUri = uri.with({ path: basePath });
            const baseBytes = await ImageEditorDocument.tryReadUri(baseUri);
            const base = baseBytes && ImageEditorDocument.tryParseBam(baseBytes, baseUri);
            const combined = base && combineIeBamPair(base.animation, opened.animation);
            if (base && combined) {
                return {
                    animation: combined,
                    info: { baseUri, eastUri: uri, baseFormat: base.format, eastFormat: opened.format },
                };
            }
        }
        return undefined;
    }

    private static tryParseBam(
        bytes: Uint8Array,
        uri: vscode.Uri,
    ): { animation: IndexedAnimation; format: BamFormat } | undefined {
        try {
            const animation = loadImage(bytes, path.posix.basename(uri.path));
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
    ): Promise<{ animation: IndexedAnimation; sidecarBytes: Uint8Array | undefined }> {
        const files = await Promise.all(frSplitSiblingPaths(fsPath).map((p) => ImageEditorDocument.tryReadFile(p)));
        const animation = combineFrmDirections(files);
        const sidecarBytes = await ImageEditorDocument.tryReadFile(sidecarPalPath(frSplitCombinedPath(fsPath)));
        return { animation, sidecarBytes };
    }

    private static async tryReadFile(fsPath: string): Promise<Uint8Array | undefined> {
        return ImageEditorDocument.tryReadUri(vscode.Uri.file(fsPath));
    }

    private static async tryReadUri(uri: vscode.Uri): Promise<Uint8Array | undefined> {
        try {
            return await vscode.workspace.fs.readFile(uri);
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

    replaceSequences(next: IndexedAnimation, mode: "replace" | "append"): void {
        this.model.replaceSequences(next, mode);
        this.fireEdit(mode === "append" ? "Import cycles" : "Replace cycles");
    }

    toView(): AnimationView {
        // dirName lives here, not in the model: the model is deliberately path-free, and the
        // document owns the file identity (see saveUri). Only FRM naming reads it, and an FRM is
        // always a real file, so the filesystem path is the right form to take the folder from.
        return { ...this.model.toView(), dirName: path.basename(path.dirname(this.saveUri.fsPath)) };
    }

    getBytes(): Uint8Array {
        return this.model.getBytes();
    }

    backup(): DocumentBackup {
        return this.model.backup();
    }

    sidecarBytes(): Uint8Array | undefined {
        return this.model.sidecarBytes();
    }

    get animation(): IndexedAnimation {
        return this.model.animation;
    }

    /** IndexedAnimation with the active palette resolved in - use for exports/conversions (see model). */
    resolvedAnimation(): IndexedAnimation {
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
            const pair = await ImageEditorDocument.tryReadIePair(this.uri, bytes);
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
