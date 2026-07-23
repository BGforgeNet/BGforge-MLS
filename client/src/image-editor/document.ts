import * as path from "path";
import * as vscode from "vscode";
import { type Animation, combineFrmDirections } from "@bgforge/image";
import { ImageDocumentModel } from "./document-model";
import { frSplitCombinedPath, frSplitSiblingPaths, isFrSplitPath } from "./fr-split";
import { sidecarPalPath } from "./sidecar";
import type { AnimationView, MetaPatch } from "./webview/messages";

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
    private readonly model: ImageDocumentModel;

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
        vscode.CustomDocumentEditEvent<ImageEditorDocument>
    >();
    readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    private readonly _onDidRefresh = new vscode.EventEmitter<void>();
    readonly onDidRefresh = this._onDidRefresh.event;

    private constructor(uri: vscode.Uri, model: ImageDocumentModel, isFrSplit: boolean) {
        this.uri = uri;
        this.isFrSplit = isFrSplit;
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
        const sidecarBytes = await ImageEditorDocument.readSidecar(uri);
        const model = ImageDocumentModel.fromBytes(bytes, path.basename(uri.fsPath), sidecarBytes);
        return new ImageEditorDocument(uri, model, false);
    }

    /** The path an in-place save writes to: the combined `<base>.frm` for a split set, else the source. */
    get savePath(): string {
        return this.isFrSplit ? frSplitCombinedPath(this.uri.fsPath) : this.uri.fsPath;
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

    markSaved(): void {
        this.model.markSaved();
    }

    get dirty(): boolean {
        return this.model.dirty;
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
        const sidecarBytes = await ImageEditorDocument.readSidecar(this.uri);
        this.model.reload(bytes, sidecarBytes);
    }

    dispose(): void {
        this._onDidChangeCustomDocument.dispose();
        this._onDidRefresh.dispose();
    }
}
