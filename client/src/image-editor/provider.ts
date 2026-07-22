import * as path from "path";
import * as vscode from "vscode";
import { type Animation, type LossReport, importApng, importPngDirectory } from "@bgforge/image";
import { generateNonce, getCachedHtmlAsset, getCachedJsAsset, inlineWebviewScript } from "../webview-assets";
import { surfaceWebviewRuntimeError } from "../webview-error";
import { ImageEditorDocument } from "./document";
import { buildCrossFormatSave, buildExport } from "./export-actions";
import { type SaveWrite, planImageSave } from "./save";
import { sidecarPalPath } from "./sidecar";
import {
    type HostToWebview,
    type ImportKind,
    type SaveAsTarget,
    type WebviewToHost,
    isWebviewToHost,
} from "./webview/messages";

const WEBVIEW_DIR = path.join("client", "src", "image-editor", "webview");
const WEBVIEW_HTML = path.join(WEBVIEW_DIR, "index.html");
const WEBVIEW_CSS = path.join(WEBVIEW_DIR, "styles.css");
const WEBVIEW_JS = path.join("client", "out", "image-editor", "webview", "main.js");
const CODICONS_DIR = path.join("client", "out", "codicons");

const SAVE_DIALOG_FILTERS: Record<"frm" | "bam", Record<string, string[]>> = {
    frm: { "Fallout FRM": ["frm"] },
    bam: { "Infinity Engine BAM": ["bam"] },
};

function summarizeLoss(report: LossReport): string {
    return `Converting will lose: ${report.items.map((item) => item.detail).join("; ")}`;
}

/**
 * Custom editor for Fallout FRM / Infinity Engine BAM animations. Unlike the binary editor,
 * `@bgforge/image` is a pure, fast in-process library - no worker thread is needed, and the
 * provider calls it directly from the extension host.
 */
export class ImageEditorProvider implements vscode.CustomEditorProvider<ImageEditorDocument> {
    static readonly viewType = "bgforge.animationEditor";

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
        vscode.CustomDocumentEditEvent<ImageEditorDocument>
    >();
    readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    /** Open panel-to-document map, for broadcasting a refresh to every panel showing a document. */
    private readonly active = new Map<vscode.WebviewPanel, ImageEditorDocument>();

    private readonly extensionUri: vscode.Uri;

    constructor(context: vscode.ExtensionContext) {
        this.extensionUri = context.extensionUri;
    }

    async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken,
    ): Promise<ImageEditorDocument> {
        const document = await ImageEditorDocument.open(uri);
        document.onDidChangeCustomDocument((event) => this._onDidChangeCustomDocument.fire(event));
        document.onDidRefresh(() => this.postToDocumentPanels(document, { type: "init", view: document.toView() }));
        return document;
    }

    async resolveCustomEditor(
        document: ImageEditorDocument,
        panel: vscode.WebviewPanel,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        const codiconsDir = vscode.Uri.joinPath(this.extensionUri, CODICONS_DIR);
        const webviewDir = vscode.Uri.joinPath(this.extensionUri, WEBVIEW_DIR);
        panel.webview.options = { enableScripts: true, localResourceRoots: [codiconsDir, webviewDir] };
        panel.webview.html = this.getHtml(panel.webview);

        this.active.set(panel, document);
        panel.onDidDispose(() => this.active.delete(panel));

        panel.webview.onDidReceiveMessage(async (message: unknown) => {
            if (!isWebviewToHost(message)) {
                // Malformed or unknown-shape message: ignore rather than act on partial data.
                return;
            }
            try {
                await this.handleWebviewMessage(document, panel, message);
            } catch (error) {
                this.post(panel, { type: "error", message: error instanceof Error ? error.message : String(error) });
            }
        });
    }

    private async handleWebviewMessage(
        document: ImageEditorDocument,
        panel: vscode.WebviewPanel,
        message: WebviewToHost,
    ): Promise<void> {
        switch (message.type) {
            case "ready":
                this.post(panel, { type: "init", view: document.toView() });
                break;
            case "editMeta":
                document.applyMetaPatch(message.patch);
                break;
            case "setExternalPalette":
                document.setExternalPalette(message.enabled);
                break;
            case "saveAs":
                await this.handleSaveAs(document, panel, message.target, message.paletteMode);
                break;
            case "import":
                await this.handleImport(document, panel, message.kind, message.mode);
                break;
            case "runtimeError": {
                const file = path.basename(document.uri.fsPath);
                surfaceWebviewRuntimeError({
                    label: `Animation editor for ${file}`,
                    userFacingFile: file,
                    message: message.message,
                    stack: message.stack,
                });
                break;
            }
        }
    }

    private async handleSaveAs(
        document: ImageEditorDocument,
        panel: vscode.WebviewPanel,
        target: SaveAsTarget,
        paletteMode: "sidecar" | "nearest" | undefined,
    ): Promise<void> {
        try {
            if (target === "apng" || target === "png-directory") {
                const selection = await vscode.window.showOpenDialog({
                    canSelectFolders: true,
                    canSelectFiles: false,
                    canSelectMany: false,
                    openLabel: "Export Here",
                });
                const destDir = selection?.[0];
                if (!destDir) return;
                await this.writeAll(buildExport(document.animation, target, destDir.fsPath));
                return;
            }

            const destination = await vscode.window.showSaveDialog({ filters: SAVE_DIALOG_FILTERS[target] });
            if (!destination) return;
            const { writes, report } = buildCrossFormatSave(document.animation, target, destination.fsPath, {
                paletteMode,
            });
            if (!report.lossless) {
                const confirmed = await vscode.window.showWarningMessage(
                    summarizeLoss(report),
                    { modal: true },
                    "Save anyway",
                );
                if (confirmed !== "Save anyway") return;
            }
            await this.writeAll(writes);
        } catch (error) {
            this.post(panel, { type: "error", message: error instanceof Error ? error.message : String(error) });
        }
    }

    private async handleImport(
        document: ImageEditorDocument,
        panel: vscode.WebviewPanel,
        kind: ImportKind,
        mode: "replace" | "append",
    ): Promise<void> {
        try {
            const next = kind === "png-directory" ? await this.importPngDirectory() : await this.importApng(document);
            if (!next) return;
            document.replaceSequences(next, mode);
        } catch (error) {
            this.post(panel, { type: "error", message: error instanceof Error ? error.message : String(error) });
        }
    }

    private async importPngDirectory(): Promise<Animation | undefined> {
        const selection = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: "Import Folder",
        });
        const dir = selection?.[0];
        if (!dir) return undefined;
        return importPngDirectory(await this.readDirectoryTree(dir));
    }

    private async importApng(document: ImageEditorDocument): Promise<Animation | undefined> {
        const selection = await vscode.window.showOpenDialog({
            canSelectFolders: false,
            canSelectFiles: true,
            canSelectMany: false,
            filters: { APNG: ["png"] },
        });
        const source = selection?.[0];
        if (!source) return undefined;
        const { fps, frames } = importApng(await vscode.workspace.fs.readFile(source));
        // importApng drops its source PLTE: it re-decodes this editor's own single-sequence
        // preview export, whose pixel indices are only meaningful against the open document's
        // own palette. replaceSequences only reads next.frames/next.sequences (see
        // document-model.ts), so palette/meta here are never observed - they exist only to
        // satisfy the Animation shape.
        return {
            palette: document.animation.palette,
            meta: { ...document.animation.meta, fps },
            sequences: [{ frameRefs: frames.map((_, i) => i), facing: "none" }],
            frames: frames.map((frame) => ({ ...frame, offsetX: 0, offsetY: 0 })),
        };
    }

    /** Recursively reads a directory into a relative-path Map, the shape `importPngDirectory` expects. */
    private async readDirectoryTree(root: vscode.Uri, prefix = ""): Promise<Map<string, Uint8Array>> {
        const files = new Map<string, Uint8Array>();
        const entries = await vscode.workspace.fs.readDirectory(root);
        for (const [name, type] of entries) {
            const childUri = vscode.Uri.joinPath(root, name);
            const relativePath = prefix ? `${prefix}/${name}` : name;
            if (type === vscode.FileType.Directory) {
                // eslint-disable-next-line no-await-in-loop
                const nested = await this.readDirectoryTree(childUri, relativePath);
                for (const [nestedPath, bytes] of nested) files.set(nestedPath, bytes);
            } else {
                // eslint-disable-next-line no-await-in-loop
                files.set(relativePath, await vscode.workspace.fs.readFile(childUri));
            }
        }
        return files;
    }

    async saveCustomDocument(document: ImageEditorDocument, _token: vscode.CancellationToken): Promise<void> {
        await this.writeSave(document, document.uri.fsPath, document.uri);
    }

    async saveCustomDocumentAs(
        document: ImageEditorDocument,
        destination: vscode.Uri,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        await this.writeSave(document, destination.fsPath, destination);
    }

    async revertCustomDocument(document: ImageEditorDocument, _token: vscode.CancellationToken): Promise<void> {
        await document.reload();
        this.postToDocumentPanels(document, { type: "init", view: document.toView() });
    }

    async backupCustomDocument(
        document: ImageEditorDocument,
        context: vscode.CustomDocumentBackupContext,
        _token: vscode.CancellationToken,
    ): Promise<vscode.CustomDocumentBackup> {
        await vscode.workspace.fs.writeFile(context.destination, document.getBytes());
        return {
            id: context.destination.toString(),
            delete: () =>
                vscode.workspace.fs.delete(context.destination).then(
                    () => {},
                    () => {},
                ),
        };
    }

    private async writeSave(
        document: ImageEditorDocument,
        targetPath: string,
        primaryDestination: vscode.Uri,
    ): Promise<void> {
        const bytes = document.getBytes();
        const sidecarBytes = document.sidecarBytes();
        const sidecar = sidecarBytes ? { path: sidecarPalPath(targetPath), bytes: sidecarBytes } : undefined;
        for (const write of planImageSave({ targetPath, bytes, sidecar })) {
            // The primary artifact reuses the caller's URI (preserving its scheme); the sidecar
            // is always a plain filesystem path, same as the binary editor's writeSave.
            const target = write.path === targetPath ? primaryDestination : vscode.Uri.file(write.path);
            // Sequential by design: the main artifact lands before the .pal sidecar so a crash
            // never leaves a sidecar describing a palette for a file that was never written.
            // eslint-disable-next-line no-await-in-loop
            await vscode.workspace.fs.writeFile(target, write.bytes);
        }
        document.markSaved();
    }

    /** Writes an arbitrary set of paths, creating each write's parent directory first - needed for
     *  multi-file exports (png-directory nests a subdirectory per sequence) where the selected
     *  destination folder does not yet contain the sequence subdirectories. createDirectory has
     *  mkdirp semantics and is a no-op when the directory already exists. */
    private async writeAll(writes: SaveWrite[]): Promise<void> {
        for (const write of writes) {
            const target = vscode.Uri.file(write.path);
            // eslint-disable-next-line no-await-in-loop
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(write.path)));
            // eslint-disable-next-line no-await-in-loop
            await vscode.workspace.fs.writeFile(target, write.bytes);
        }
    }

    private post(panel: vscode.WebviewPanel, message: HostToWebview): void {
        void panel.webview.postMessage(message);
    }

    /** Post a message to every webview panel currently showing the given document. */
    private postToDocumentPanels(document: ImageEditorDocument, message: HostToWebview): void {
        for (const [panel, doc] of this.active) {
            if (doc === document) this.post(panel, message);
        }
    }

    private getHtml(webview: vscode.Webview): string {
        const extensionPath = this.extensionUri.fsPath;
        let html = getCachedHtmlAsset("animation-editor", extensionPath, WEBVIEW_HTML);
        // See docs/architecture.md (Webview CSP): styles load as <link> stylesheets resolved
        // through asWebviewUri and authorised by `style-src {{cspSource}}`, not inlined with a
        // nonce - the wrapped webview silently drops a nonce-only style-src.
        const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, WEBVIEW_CSS));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, CODICONS_DIR, "codicon.css"));
        // Function replacers: the URIs contain `$`-adjacent characters that String.replace would
        // otherwise interpret as `$&`/`$'` patterns.
        html = html.replace("{{stylesUri}}", () => stylesUri.toString());
        html = html.replace("{{codiconsUri}}", () => codiconsUri.toString());
        const script = getCachedJsAsset("animation-editor", extensionPath, WEBVIEW_JS);
        const nonce = generateNonce();
        html = inlineWebviewScript(html, script, nonce);
        return html.replaceAll("{{cspSource}}", webview.cspSource);
    }
}
