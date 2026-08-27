import * as path from "path";
import * as vscode from "vscode";
import {
    type Animation,
    type IndexedAnimation,
    DEFAULT_FALLOUT_PALETTE,
    convertToBamV2,
    importPngDirectory,
    isRgbaAnimation,
    needsFreshPages,
    serializeBamV2,
} from "@bgforge/image";
import { backupHandle, warnBackupUnreadable } from "../hot-exit-backup";
import { generateNonce, getCachedHtmlAsset, getCachedJsAsset, inlineWebviewScript } from "../webview-assets";
import { surfaceWebviewRuntimeError } from "../webview-error";
import { type DocumentBackup, decodeBackup, encodeBackup } from "./backup";
import { type GameResourceBytes, ImageEditorDocument } from "./document";
import { adaptImportedColourModel, buildCrossFormatSave, buildExport } from "./export-actions";
import { type SaveWrite, planImageSave, pvrzPageWrites } from "./save";
import {
    type FrmShapePick,
    ieGroupCount,
    needsCyclePick,
    reshapeImportToFrm,
    saveAsTargetPath,
    summarizeLoss,
} from "./save-as";
import { sidecarPalPath } from "./sidecar";
import { ieGroupLabels, ieGroupOptionText } from "./webview/render/cycle-grouping";
import { type HostToWebview, type SaveAsTarget, type WebviewToHost, isWebviewToHost } from "./webview/messages";

/**
 * The hot-exit backup for `backupId`, or undefined when there is none or it cannot be used.
 *
 * A decode failure is an EXPECTED condition here, not just a read failure: the container is versioned
 * precisely because a backup can outlive the extension version that wrote it. `decodeBackup` still refuses a
 * header it cannot read - only the caller's handling is forgiving, per the shared policy in
 * `warnBackupUnreadable`.
 */
async function readBackup(uri: vscode.Uri, backupId: string | undefined): Promise<DocumentBackup | undefined> {
    if (backupId === undefined) return undefined;
    try {
        return decodeBackup(await vscode.workspace.fs.readFile(vscode.Uri.parse(backupId)));
    } catch {
        warnBackupUnreadable(uri);
        return undefined;
    }
}

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

    /**
     * `resourceBytes` reads the open game's resources, used to resolve a BAM v2's PVRZ pages when
     * they are not siblings of the opened file. Absent when the resource viewer is not registered.
     */
    private readonly resourceBytes: GameResourceBytes | undefined;

    constructor(context: vscode.ExtensionContext, resourceBytes?: GameResourceBytes) {
        this.resourceBytes = resourceBytes;
        this.extensionUri = context.extensionUri;
    }

    async openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken,
    ): Promise<ImageEditorDocument> {
        // A hot-exit restore hands back the backup written by backupCustomDocument, whose payload carries
        // the unsaved edits; reading the files instead would silently discard them while the editor still
        // shows as dirty.
        const backup = await readBackup(uri, openContext.backupId);
        const document = await ImageEditorDocument.open(uri, backup, this.resourceBytes);
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
                // Route through VS Code's own save so its dirty tracking clears - scoped to this
                // document's URI, so it saves the right one even if focus moved since the click.
                await vscode.workspace.save(document.uri);
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
                    editor: "Animation editor",
                    file,
                    message: message.message,
                    stack: message.stack,
                });
                break;
            }
        }
    }

    /**
     * The path Save As names its destination against, and the one gate on writing an export of a
     * document that is not a file. A resource read out of a game's archives has no containing folder
     * - its URI path is just `<resref>.<ext>` - so the usual "next to the source" name would put the
     * export at the root of the filesystem; ask for a folder instead. Undefined when the user
     * dismisses the picker, which cancels the save.
     */
    private async saveAsSourcePath(document: ImageEditorDocument): Promise<string | undefined> {
        if (document.uri.scheme === "file") return document.uri.fsPath;
        const basename = path.posix.basename(document.uri.path);
        const picked = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: "Save here",
            title: `Choose a folder for ${basename}`,
        });
        const dir = picked?.[0]?.fsPath;
        return dir === undefined ? undefined : path.join(dir, basename);
    }

    private async handleSaveAs(
        document: ImageEditorDocument,
        target: SaveAsTarget,
        paletteMode: "sidecar" | "nearest" | undefined,
    ): Promise<void> {
        try {
            const sourcePath = await this.saveAsSourcePath(document);
            if (sourcePath === undefined) return; // user dismissed the destination picker
            const targetPath = saveAsTargetPath(sourcePath, target);

            // Save As auto-names its destination instead of showing a dialog, so overwrite consent
            // needs its own gate. In-place targets are exempt: BAMC's .bam collision is a deliberate
            // re-encode of the source (see saveAsTargetPath), and a split set's combined <base>.frm
            // is overwrite-by-design (see document.saveUri).
            const inPlace = targetPath === document.uri.fsPath || targetPath === document.saveUri.fsPath;
            if (!inPlace && (await this.fileExists(vscode.Uri.file(targetPath)))) {
                const overwrite = await vscode.window.showWarningMessage(
                    `${path.basename(targetPath)} already exists - overwrite?`,
                    { modal: true },
                    "Overwrite",
                );
                if (overwrite !== "Overwrite") return;
            }

            if (target === "apng" || target === "png-directory") {
                // Both PNG targets hold everything either colour model does, so the animation goes
                // out as it is - no quantization, nothing to warn about. For an INDEXED document
                // that means resolvedAnimation, not animation: an FRM's own palette is an all-black
                // placeholder, and exporting the raw one writes black silhouettes (see document-model).
                await this.writeAll(
                    buildExport(document.resolvedAnimation() ?? document.animation, target, targetPath),
                );
                vscode.window.setStatusBarMessage(`Exported ${path.basename(targetPath)}${path.sep}`, 3000);
                return;
            }

            if (target === "bamv2") {
                await this.saveAsBamV2(document, targetPath);
                return;
            }

            // A true-colour document is quantized here; an indexed one comes back with its active
            // palette resolved. FRM's "nearest match" mode pins the palette so the colours make ONE
            // hop rather than being quantized and then remapped (see indexedForExport).
            const { animation: anim, report: conversion } = document.indexedForExport({
                target,
                ...(target === "frm" && paletteMode === "nearest" ? { palette: DEFAULT_FALLOUT_PALETTE } : {}),
            });

            // How the animation fills FRM's 6 rotations: an IE base file contributes one direction
            // block (asked by name when there are several), a non-directional animation one cycle for
            // all rotations. Undefined only when the user dismisses a picker.
            let pick: FrmShapePick | undefined = {};
            if (target === "frm") {
                pick = await this.resolveFrmShape(anim, path.basename(document.uri.fsPath));
                if (pick === undefined) return; // user dismissed the picker
            }
            const { writes, report } = buildCrossFormatSave(anim, target, targetPath, { paletteMode, ...pick });
            // One warning for the whole journey: quantizing to indexed and then reshaping to the
            // target are two steps of one save, and the user is deciding about the result.
            report.absorb(conversion);
            if (!report.lossless) {
                const { message, detail } = summarizeLoss(report);
                const confirmed = await vscode.window.showWarningMessage(
                    message,
                    { modal: true, detail },
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

    /**
     * Save As a BAM v2: convert the animation into v2's shape, then write the `.bam` plus the PVRZ
     * pages its frames need. Unlike every other target this can require input - a page number - so it
     * lives in its own method rather than another branch of handleSaveAs.
     */
    private async saveAsBamV2(document: ImageEditorDocument, targetPath: string): Promise<void> {
        // resolvedAnimation for an indexed document: its active palette is what becomes the pixels,
        // and an FRM's own palette is an all-black placeholder (see document-model).
        const { animation, report } = convertToBamV2(document.resolvedAnimation() ?? document.animation);
        if (!report.lossless) {
            const { message, detail } = summarizeLoss(report);
            const confirmed = await vscode.window.showWarningMessage(message, { modal: true, detail }, "Save anyway");
            if (confirmed !== "Save anyway") return;
        }

        // Frames that came from a page can be written back against it; anything else needs pages of
        // its own, and which page numbers are free is a fact about the installation, not the file.
        let basePage: number | undefined;
        if (needsFreshPages(animation)) {
            basePage = await this.pickBasePage(path.basename(targetPath));
            if (basePage === undefined) return; // user dismissed the prompt
        }
        // No fresh pages needed means the frames are still the source file's, so its own pages come
        // along verbatim - the destination folder has none of them.
        const saved = serializeBamV2(animation, basePage === undefined ? { emitUnchangedPages: true } : { basePage });
        await this.writeAll(
            planImageSave({
                targetPath,
                bytes: saved.bam,
                pages: pvrzPageWrites(targetPath, saved.pages),
            }),
        );
        const pageCount = saved.pages.length;
        vscode.window.setStatusBarMessage(
            `Saved ${path.basename(targetPath)}${pageCount > 0 ? ` and ${pageCount} PVRZ page(s)` : ""}`,
            3000,
        );
    }

    /**
     * Ask which PVRZ page number to start at. Never defaulted: a number already taken by a page
     * inside the game's own BIF archives surfaces only as corrupted graphics at runtime, and only
     * the person doing the install knows which range their mod owns.
     */
    private async pickBasePage(fileName: string): Promise<number | undefined> {
        const answer = await vscode.window.showInputBox({
            title: `PVRZ page number for ${fileName}`,
            prompt: "The frames are written into MOS<nnnn>.PVRZ files starting at this number. Pick a range your mod owns - reusing a number the game already ships corrupts its graphics.",
            validateInput: (value) =>
                /^\d{1,4}$/.test(value.trim()) ? undefined : "Enter a page number between 0 and 9999.",
        });
        return answer === undefined ? undefined : Number(answer.trim());
    }

    /**
     * Resolve how a non-FRM shape fills FRM's 6 rotations. An IE base file (ie8 layout) converts one
     * direction block - its whole rose, minus the north/south cycles FRM has no slot for; a
     * non-directional multi-cycle animation converts one chosen cycle into all six rotations. Returns
     * an empty pick when no choice is needed, undefined when the user dismisses a picker.
     */
    private async resolveFrmShape(anim: IndexedAnimation, sourceName: string): Promise<FrmShapePick | undefined> {
        const groupCount = ieGroupCount(anim);
        if (groupCount !== undefined) {
            if (groupCount === 1) return { ieGroup: 0 };
            const ieGroup = await this.pickDirectionGroup(sourceName, groupCount);
            return ieGroup === undefined ? undefined : { ieGroup };
        }
        if (needsCyclePick(anim)) {
            const singleCycle = await this.pickCycle(anim.sequences.length);
            return singleCycle === undefined ? undefined : { singleCycle };
        }
        return {};
    }

    /** Ask which direction block a directional FRM should use; undefined if the user dismisses the
     *  picker. Options carry the same scheme names as the webview's group select. */
    private async pickDirectionGroup(sourceName: string, groupCount: number): Promise<number | undefined> {
        const labels = ieGroupLabels(sourceName, groupCount);
        const items = Array.from({ length: groupCount }, (_, i) => ieGroupOptionText(labels, i));
        const picked = await vscode.window.showQuickPick(items, {
            title: "Which direction group should the FRM use? (its north/south cycles have no FRM rotation)",
        });
        return picked === undefined ? undefined : items.indexOf(picked);
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

            // A directory carries its own colour model, which need not be the document's. Matching
            // them up front keeps replaceSequences a pure splice, and puts the one lossy direction
            // (true-colour PNGs into an indexed document) behind the same confirmation as a save.
            const adapted = adaptImportedColourModel(next.animation, document.animation);
            if (!adapted.report.lossless) {
                const { detail } = summarizeLoss(adapted.report);
                const confirmed = await vscode.window.showWarningMessage(
                    "Importing will lose data.",
                    { modal: true, detail },
                    "Import anyway",
                );
                if (confirmed !== "Import anyway") return;
            }

            // An FRM is a fixed 6-rotation format, so an import INTO one is reshaped to a valid FRM
            // (a direction block or a single chosen cycle, per resolveFrmShape) and always REPLACES -
            // otherwise an in-place Save would serialize the non-FRM shape into a malformed .frm
            // (rotations 1-5 empty while the header claims frames). A BAM accepts arbitrary cycles, so
            // its import applies unchanged.
            if (document.animation.meta.sourceFormat === "frm") {
                const indexed = adapted.animation;
                if (isRgbaAnimation(indexed)) throw new Error("handleImport: an FRM document adapted to true colour");
                const pick = await this.resolveFrmShape(indexed, next.name);
                if (pick === undefined) return; // user dismissed the picker
                document.replaceSequences(reshapeImportToFrm(indexed, pick), "replace");
                return;
            }
            document.replaceSequences(adapted.animation, mode);
        } catch (error) {
            void vscode.window.showErrorMessage(
                `Import failed: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    private async importPngDirectory(): Promise<{ animation: Animation; name: string } | undefined> {
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
            // The directory name feeds the group-pick labels (the export keeps the source's basename).
            return {
                animation: importPngDirectory(await this.readDirectoryTree(dir)),
                name: path.basename(dir.fsPath),
            };
        } catch (error) {
            // Malformed/incompatible manifest or a missing frame PNG - surface the cause, not a stack.
            const detail =
                error instanceof Error ? error.message.replace(/^importPngDirectory:\s*/, "") : String(error);
            void vscode.window.showWarningMessage(`Can't import "${path.basename(dir.fsPath)}": ${detail}`);
            return undefined;
        }
    }

    /** True when the path already exists (file or directory) - the Save As overwrite check and the
     *  sidecar-manifest probe both ask this. */
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
        // A Fallout .fr0-.fr5 split set saves to the combined <base>.frm (document.saveUri), never
        // back to the opened .frN member; the six split files are left untouched.
        await this.writeSave(document, document.saveUri);
    }

    async saveCustomDocumentAs(
        document: ImageEditorDocument,
        destination: vscode.Uri,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        await this.writeSave(document, destination);
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
        await vscode.workspace.fs.writeFile(context.destination, encodeBackup(document.backup()));
        return backupHandle(context.destination);
    }

    private async writeSave(document: ImageEditorDocument, destination: vscode.Uri): Promise<void> {
        // An IE base/east pair saves in place by splitting back into its two member files; a Save As
        // to another destination falls through and writes the single combined form instead.
        if (destination.toString() === document.saveUri.toString()) {
            const pairWrites = document.pairSaveWrites();
            if (pairWrites) {
                // Sequential by design: the base lands before the companion so a crash never leaves a
                // fresh east file next to a stale base.
                for (const write of pairWrites) {
                    // eslint-disable-next-line no-await-in-loop
                    await vscode.workspace.fs.writeFile(write.uri, write.bytes);
                }
                return;
            }
        }
        const targetPath = destination.fsPath;
        // A save that lands anywhere but the document's own file cannot rely on the PVRZ pages a
        // BAM v2 addresses being there, so it takes them along; an in-place save leaves them alone.
        const standalone = destination.toString() !== document.saveUri.toString();
        const { bytes, pages } = document.saveArtifacts({ standalone });
        const sidecarBytes = document.sidecarBytes();
        const sidecar = sidecarBytes ? { path: sidecarPalPath(targetPath), bytes: sidecarBytes } : undefined;
        for (const write of planImageSave({ targetPath, bytes, sidecar, pages: pvrzPageWrites(targetPath, pages) })) {
            // The primary artifact reuses the caller's URI (preserving its scheme); the sidecar and
            // any PVRZ pages are plain filesystem paths, same as the binary editor's writeSave. Only
            // an FRM has a sidecar, and an FRM is always a real file, so that stays a `file:` write.
            const target = write.path === targetPath ? destination : vscode.Uri.file(write.path);
            // Sequential by design: the main artifact lands before the .pal sidecar so a crash
            // never leaves a sidecar describing a palette for a file that was never written.
            // eslint-disable-next-line no-await-in-loop
            await vscode.workspace.fs.writeFile(target, write.bytes);
        }
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
