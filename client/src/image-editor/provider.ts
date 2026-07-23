import * as path from "path";
import * as vscode from "vscode";
import { type Animation, importPngDirectory } from "@bgforge/image";
import { generateNonce, getCachedHtmlAsset, getCachedJsAsset, inlineWebviewScript } from "../webview-assets";
import { surfaceWebviewRuntimeError } from "../webview-error";
import { ImageEditorDocument } from "./document";
import { buildCrossFormatSave, buildExport } from "./export-actions";
import { type SaveWrite, planImageSave } from "./save";
import { needsCyclePick, reshapeImportToFrm, saveAsTargetPath, summarizeLoss } from "./save-as";
import { sidecarPalPath } from "./sidecar";
import { type HostToWebview, type SaveAsTarget, type WebviewToHost, isWebviewToHost } from "./webview/messages";

const WEBVIEW_DIR = path.join("client", "src", "image-editor", "webview");
const WEBVIEW_HTML = path.join(WEBVIEW_DIR, "index.html");
const WEBVIEW_CSS = path.join(WEBVIEW_DIR, "styles.css");
const WEBVIEW_JS = path.join("client", "out", "image-editor", "webview", "main.js");
const CODICONS_DIR = path.join("client", "out", "codicons");

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
            case "save":
                // Route through VS Code's own save so its dirty tracking clears; the webview panel is
                // active (the user just clicked in it), so this saves THIS custom document in place.
                await vscode.commands.executeCommand("workbench.action.files.save");
                break;
            case "editMeta":
                document.applyMetaPatch(message.patch);
                break;
            case "setExternalPalette":
                document.setExternalPalette(message.enabled);
                break;
            case "saveAs":
                await this.handleSaveAs(document, message.target, message.paletteMode);
                break;
            case "import":
                await this.handleImport(document, message.mode);
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
        target: SaveAsTarget,
        paletteMode: "sidecar" | "nearest" | undefined,
    ): Promise<void> {
        try {
            // resolvedAnimation, not animation: an FRM's own palette is an all-black placeholder, so a
            // raw-animation export would write black-silhouette PNGs / a black BAM (see document-model).
            const anim = document.resolvedAnimation();
            const targetPath = saveAsTargetPath(document.uri.fsPath, target);

            if (target === "apng" || target === "png-directory") {
                await this.writeAll(buildExport(anim, target, targetPath));
                vscode.window.setStatusBarMessage(`Exported ${path.basename(targetPath)}${path.sep}`, 3000);
                return;
            }

            // A non-directional animation (a native non-directional BAM, or one imported from a PNG
            // directory - frmDirectionMode reads the animation, not the source format) becomes a
            // single-orientation FRM from ONE cycle. Auto for a single cycle; ask which for several.
            let singleCycle: number | undefined;
            if (target === "frm" && needsCyclePick(anim)) {
                singleCycle = await this.pickCycle(anim.sequences.length);
                if (singleCycle === undefined) return; // user dismissed the picker
            }
            const { writes, report } = buildCrossFormatSave(anim, target, targetPath, { paletteMode, singleCycle });
            if (!report.lossless) {
                const confirmed = await vscode.window.showWarningMessage(
                    summarizeLoss(report),
                    { modal: true },
                    "Save anyway",
                );
                if (confirmed !== "Save anyway") return;
            }
            await this.writeAll(writes);
            vscode.window.setStatusBarMessage(`Saved ${path.basename(targetPath)}`, 3000);
        } catch (error) {
            // A save-as failure is a transient action error - surface it as a notification, NOT the
            // webview's fatal "Could not open file" state, which would wrongly blow away a working editor.
            void vscode.window.showErrorMessage(
                `Save failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    /** Ask which cycle a single-orientation FRM should use; undefined if the user dismisses the picker. */
    private async pickCycle(cycleCount: number): Promise<number | undefined> {
        const items = Array.from({ length: cycleCount }, (_, i) => `Cycle ${i}`);
        const picked = await vscode.window.showQuickPick(items, {
            title: "This animation has no directions - which cycle should the single-orientation FRM use?",
        });
        return picked === undefined ? undefined : items.indexOf(picked);
    }

    private async handleImport(document: ImageEditorDocument, mode: "replace" | "append"): Promise<void> {
        try {
            // Design choice: PNG-directory is the only import path. APNG is export/preview-only - see
            // the "import" message note in webview/messages.ts for why.
            const next = await this.importPngDirectory();
            if (!next) return;

            // An FRM is a fixed 6-rotation format, so an import INTO one is reshaped to a valid FRM
            // (single-orientation for a non-directional import, with a cycle pick when several cycles
            // were imported) and always REPLACES - otherwise an in-place Save would serialize the
            // non-FRM shape into a malformed .frm (rotations 1-5 empty while the header claims frames).
            // A BAM accepts arbitrary cycles, so its import applies unchanged.
            if (document.animation.meta.sourceFormat === "frm") {
                let singleCycle: number | undefined;
                if (needsCyclePick(next)) {
                    singleCycle = await this.pickCycle(next.sequences.length);
                    if (singleCycle === undefined) return; // user dismissed the cycle picker
                }
                document.replaceSequences(reshapeImportToFrm(next, singleCycle), "replace");
                return;
            }
            document.replaceSequences(next, mode);
        } catch (error) {
            void vscode.window.showErrorMessage(
                `Import failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    private async importPngDirectory(): Promise<Animation | undefined> {
        // Accept EITHER the export folder or its manifest.json - both resolve to the same directory,
        // whose frames are read relative to manifest.json.
        const selection = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: true,
            canSelectMany: false,
            filters: { "PNG-directory manifest": ["json"] },
            openLabel: "Import",
            title: "Import PNG directory - pick its folder or its manifest.json",
        });
        const picked = selection?.[0];
        if (!picked) return undefined;

        const stat = await vscode.workspace.fs.stat(picked);
        const dir = stat.type === vscode.FileType.Directory ? picked : vscode.Uri.file(path.dirname(picked.fsPath));

        // Sanity check the selection BEFORE reading the tree: a PNG-directory export is defined by its
        // manifest.json. Guide the user to the right pick instead of leaking the codec's internal throw,
        // and avoid recursively slurping an unrelated folder they picked by mistake.
        const manifestUri = vscode.Uri.joinPath(dir, "manifest.json");
        if (!(await this.fileExists(manifestUri))) {
            void vscode.window.showWarningMessage(
                `"${path.basename(dir.fsPath)}" is not a PNG-directory export (no manifest.json inside). ` +
                    `Pick the folder written by "Save as > PNG directory", or its manifest.json.`,
            );
            return undefined;
        }

        try {
            return importPngDirectory(await this.readDirectoryTree(dir));
        } catch (error) {
            // Malformed/incompatible manifest or a missing frame PNG - surface the cause, not a stack.
            const detail =
                error instanceof Error ? error.message.replace(/^importPngDirectory:\s*/, "") : String(error);
            void vscode.window.showWarningMessage(`Can't import "${path.basename(dir.fsPath)}": ${detail}`);
            return undefined;
        }
    }

    private async fileExists(uri: vscode.Uri): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(uri);
            return true;
        } catch {
            return false;
        }
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
        // A Fallout .fr0-.fr5 split set saves to the combined <base>.frm (document.savePath), never
        // back to the opened .frN member; the six split files are left untouched.
        const targetPath = document.savePath;
        const primary = targetPath === document.uri.fsPath ? document.uri : vscode.Uri.file(targetPath);
        await this.writeSave(document, targetPath, primary);
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
        // Create each unique parent directory once (createDirectory is mkdirp + idempotent), then write
        // every file in parallel. A per-file sequential create+write made a 60-file PNG-directory export
        // visibly slow over the remote filesystem (directories appearing one by one); this is two fan-outs.
        const dirs = [...new Set(writes.map((write) => path.dirname(write.path)))];
        await Promise.all(dirs.map((dir) => vscode.workspace.fs.createDirectory(vscode.Uri.file(dir))));
        await Promise.all(
            writes.map((write) => vscode.workspace.fs.writeFile(vscode.Uri.file(write.path), write.bytes)),
        );
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
