import * as path from "path";
import * as vscode from "vscode";
import type { Animation } from "@bgforge/image";
import { ImageDocumentModel } from "./document-model";
import { sidecarPalPath } from "./sidecar";
import type { AnimationView, MetaPatch } from "./webview/messages";

/**
 * Thin `vscode.CustomDocument` shell over `ImageDocumentModel`: owns the file identity, the
 * sidecar `.pal` read, and the two VS Code event emitters (edit stack + panel refresh). All
 * animation state and undo logic lives in the model.
 */
export class ImageEditorDocument implements vscode.CustomDocument {
    readonly uri: vscode.Uri;
    private readonly model: ImageDocumentModel;

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
        vscode.CustomDocumentEditEvent<ImageEditorDocument>
    >();
    readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    private readonly _onDidRefresh = new vscode.EventEmitter<void>();
    readonly onDidRefresh = this._onDidRefresh.event;

    private constructor(uri: vscode.Uri, model: ImageDocumentModel) {
        this.uri = uri;
        this.model = model;
        this.model.onChange = () => this._onDidRefresh.fire();
    }

    static async open(uri: vscode.Uri): Promise<ImageEditorDocument> {
        const bytes = await vscode.workspace.fs.readFile(uri);
        const sidecarBytes = await ImageEditorDocument.readSidecar(uri);
        const model = ImageDocumentModel.fromBytes(bytes, path.basename(uri.fsPath), sidecarBytes);
        return new ImageEditorDocument(uri, model);
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
        this.fireEdit(mode === "append" ? "Import frames" : "Replace frames");
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

    async reload(): Promise<void> {
        const bytes = await vscode.workspace.fs.readFile(this.uri);
        const sidecarBytes = await ImageEditorDocument.readSidecar(this.uri);
        this.model.reload(bytes, sidecarBytes);
    }

    dispose(): void {
        this._onDidChangeCustomDocument.dispose();
        this._onDidRefresh.dispose();
    }
}
