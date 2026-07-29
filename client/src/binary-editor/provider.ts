import * as path from "node:path";
import * as vscode from "vscode";
import { getSnapshotPath } from "@bgforge/binary";
import type { ChangeSet, StructureOpRequest } from "@bgforge/binary-editor";
import { generateNonce, getCachedHtmlAsset, getCachedJsAsset, inlineWebviewScript } from "../webview-assets";
import {
    isGameDocument,
    type NamingTableResolver,
    type ResourceListResolver,
    type ResourceTypeResolver,
    type SlotLabelResolver,
    type StrrefResolver,
} from "../ie-resources/game-lookups";
import { surfaceWebviewRuntimeError } from "../webview-error";
import { BinaryEditorDocument } from "./document";
import { planSave } from "./save";
import { withGameContext } from "./game-rows";
import { type HostToWebview, type WebviewToHost, isWebviewToHost } from "./webview/messages";

/** The game-backed lookups the editor is handed; it never reaches for a `Game` itself. */
export interface GameResolvers {
    strref: StrrefResolver;
    slotLabel: SlotLabelResolver;
    namingTable: NamingTableResolver;
    resourceType: ResourceTypeResolver;
    resourceList: ResourceListResolver;
}

const WORKER_SCRIPT = path.join("client", "out", "binary-editor", "worker.js");
const WEBVIEW_DIR = path.join("client", "src", "binary-editor", "webview");
const WEBVIEW_HTML = path.join(WEBVIEW_DIR, "index.html");
const WEBVIEW_CSS = path.join(WEBVIEW_DIR, "styles.css");
const WEBVIEW_JS = path.join("client", "out", "binary-editor", "webview", "main.js");
const CODICONS_DIR = path.join("client", "out", "codicons");

/**
 * The `<name>.json` snapshot sidecar URI for a destination.
 *
 * A real file gets a `file:` path next to it; a virtual document keeps its OWN scheme (and query) so the write
 * dispatches back through that provider - for a game resource the FS provider lands it in `override/`, not on
 * the real filesystem (whose root a `file:` fsPath would hit). Takes the destination rather than the document
 * because a Save As targets somewhere else, and both it and the dump/load commands must derive the sidecar the
 * same way.
 */
function snapshotSidecarUri(destination: vscode.Uri): vscode.Uri {
    return destination.scheme === "file"
        ? vscode.Uri.file(getSnapshotPath(destination.fsPath))
        : destination.with({ path: getSnapshotPath(destination.path) });
}

/** Human-readable undo-history label for a structure op. The worker keeps its own detailed label; this is the
 *  coarse-grained entry shown in the host editor's undo stack. */
function structureOpLabel(op: StructureOpRequest["op"]): string {
    switch (op) {
        case "add":
            return "Add entry";
        case "insert":
            return "Insert entry";
        case "remove":
            return "Remove entry";
        case "reorder":
            return "Reorder entry";
        case "duplicate":
            return "Duplicate entry";
        case "addChild":
            return "Add entry";
        case "removeChild":
            return "Remove entry";
    }
}

/**
 * Custom editor backed by a per-document worker session. The host stays thin: it owns
 * the webview shell and message routing, and forwards all parse/edit/serialize work to
 * the worker via the document's bridge.
 */
export class BinaryEditorProvider implements vscode.CustomEditorProvider<BinaryEditorDocument> {
    static readonly viewType = "bgforge.binaryEditor";

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
        vscode.CustomDocumentEditEvent<BinaryEditorDocument>
    >();
    readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    /** Open panel-to-document map. */
    private readonly active = new Map<vscode.WebviewPanel, BinaryEditorDocument>();

    /** Debounce window for the advisory validate round-trip, so a burst of rapid edits collapses to one pass. */
    private static readonly DIAGNOSTICS_DEBOUNCE_MS = 120;
    /** Pending debounced-validate timer per document (cancelled on the next edit and on document close). */
    private readonly diagnosticsTimers = new WeakMap<BinaryEditorDocument, ReturnType<typeof setTimeout>>();

    private readonly extensionUri: vscode.Uri;
    private readonly gameLookups: GameResolvers;

    constructor(context: vscode.ExtensionContext, gameLookups: GameResolvers) {
        this.extensionUri = context.extensionUri;
        this.gameLookups = gameLookups;
    }

    async openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken,
    ): Promise<BinaryEditorDocument> {
        const workerScript = path.join(this.extensionUri.fsPath, WORKER_SCRIPT);
        // A hot-exit restore hands back the backup written by backupCustomDocument, whose bytes carry the unsaved
        // edits; reading the file instead would silently discard them while the editor still shows as dirty.
        const backup = openContext.backupId ? vscode.Uri.parse(openContext.backupId) : undefined;
        const document = await BinaryEditorDocument.open(uri, workerScript, backup);
        document.onDidChange((event) => this._onDidChangeCustomDocument.fire(event));
        document.onDidRefresh((changeSet) => this.refreshDocumentPanels(document, changeSet));
        return document;
    }

    async resolveCustomEditor(
        document: BinaryEditorDocument,
        panel: vscode.WebviewPanel,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        const codiconsDir = vscode.Uri.joinPath(this.extensionUri, CODICONS_DIR);
        const webviewDir = vscode.Uri.joinPath(this.extensionUri, WEBVIEW_DIR);
        // Both roots must be readable for the <link> stylesheets: codicon.css/.ttf live under CODICONS_DIR,
        // styles.css under WEBVIEW_DIR. asWebviewUri only resolves resources beneath a declared root.
        panel.webview.options = { enableScripts: true, localResourceRoots: [codiconsDir, webviewDir] };
        panel.webview.html = this.getHtml(panel.webview);

        this.active.set(panel, document);
        panel.onDidDispose(() => {
            this.active.delete(panel);
            // Last panel for this document gone -> cancel any pending debounced validate so it never fires
            // against a disposed bridge.
            if (!this.documentIsActive(document)) {
                const timer = this.diagnosticsTimers.get(document);
                if (timer) {
                    clearTimeout(timer);
                    this.diagnosticsTimers.delete(document);
                }
            }
        });

        panel.webview.onDidReceiveMessage(async (message: unknown) => {
            if (!isWebviewToHost(message)) {
                // Malformed or unknown-shape message: ignore rather than act on partial data.
                return;
            }
            try {
                await this.handleWebviewMessage(document, panel, message);
            } catch (error) {
                // A rejected bridge send (worker crash/hang timeout) lands here instead of becoming an
                // unhandled promise rejection. Surface it in the webview's error banner so the failure is
                // visible rather than a silently dead editor.
                this.post(panel, { type: "error", message: error instanceof Error ? error.message : String(error) });
            }
        });
    }

    private async handleWebviewMessage(
        document: BinaryEditorDocument,
        panel: vscode.WebviewPanel,
        message: WebviewToHost,
    ): Promise<void> {
        switch (message.type) {
            case "ready":
                this.post(panel, { type: "init", open: document.openResult });
                await this.pushDiagnosticsToDocument(document);
                break;
            case "requestChildren": {
                const r = await document.bridge.send({
                    type: "getChildren",
                    sessionId: document.sessionId,
                    nodeId: message.nodeId,
                    start: message.start,
                    end: message.end,
                });
                if (r.type === "children") {
                    this.post(panel, {
                        type: "children",
                        requestId: message.requestId,
                        parentId: r.parentId,
                        rows: r.rows,
                        total: r.total,
                    });
                } else if (r.type === "error") {
                    this.post(panel, { type: "error", requestId: message.requestId, message: r.message });
                }
                break;
            }
            case "requestSpellbook": {
                const r = await document.bridge.send({
                    type: "getSpellbook",
                    sessionId: document.sessionId,
                });
                if (r.type === "spellbook") {
                    this.post(panel, { type: "spellbook", requestId: message.requestId, view: r.view });
                } else if (r.type === "error") {
                    this.post(panel, { type: "error", requestId: message.requestId, message: r.message });
                }
                break;
            }
            case "requestEffectTree": {
                const r = await document.bridge.send({
                    type: "getEffectTree",
                    sessionId: document.sessionId,
                });
                if (r.type === "effectTree") {
                    this.post(panel, { type: "effectTree", requestId: message.requestId, view: r.view });
                } else if (r.type === "error") {
                    this.post(panel, { type: "error", requestId: message.requestId, message: r.message });
                }
                break;
            }
            case "requestResourceList": {
                // Answered from the game session, not the worker: the record's own bytes say nothing about what
                // else the install holds. An empty list is the honest answer outside a game - the picker then
                // offers nothing and the field stays the free-text box it is without one.
                const resrefs = this.gameLookups.resourceList(document.uri, message.ext) ?? [];
                this.post(panel, { type: "resourceList", requestId: message.requestId, resrefs });
                break;
            }
            case "editField": {
                const r = await document.bridge.send({
                    type: "editField",
                    sessionId: document.sessionId,
                    nodeId: message.nodeId,
                    value: message.value,
                });
                if (r.type === "error") {
                    this.post(panel, { type: "error", message: r.message });
                    break;
                }
                if (r.type === "edited") {
                    document.pushEdit("Edit field");
                    // Keep the edited entry selected so an inline list does not collapse the row on commit.
                    this.postToDocumentPanels(document, {
                        type: "changeSet",
                        changeSet: r.result.changeSet,
                        selection: message.nodeId,
                    });
                    this.scheduleDiagnostics(document);
                }
                break;
            }
            case "structureOp": {
                const r = await document.bridge.send({
                    type: "structureOp",
                    sessionId: document.sessionId,
                    op: message.op,
                });
                if (r.type === "error") {
                    this.post(panel, { type: "error", message: r.message });
                    break;
                }
                if (r.type === "structure") {
                    document.pushEdit(structureOpLabel(message.op.op));
                    // Forward the post-op selection so the webview re-activates the new/moved/neighbor entry.
                    this.postToDocumentPanels(document, {
                        type: "changeSet",
                        changeSet: r.result.changeSet,
                        selection: r.result.selection,
                    });
                    this.scheduleDiagnostics(document);
                }
                break;
            }
            case "spellbookEdit": {
                const r = await document.bridge.send({
                    type: "spellbookEdit",
                    sessionId: document.sessionId,
                    op: message.op,
                });
                if (r.type === "error") {
                    this.post(panel, { type: "error", message: r.message });
                    break;
                }
                if (r.type === "structure") {
                    document.pushEdit("Spellbook edit");
                    this.postToDocumentPanels(document, {
                        type: "changeSet",
                        changeSet: r.result.changeSet,
                        selection: r.result.selection,
                    });
                    this.scheduleDiagnostics(document);
                }
                break;
            }
            case "openResource":
                // The ie-resources subsystem owns opening a game resource (it decides binary editor vs default
                // editor and holds the session), so this forwards rather than re-implementing that choice.
                await vscode.commands.executeCommand("bgforge.ieResources.openRef", {
                    documentUri: document.uri,
                    resref: message.resref,
                    ext: message.ext,
                });
                break;
            case "dumpJson":
                await this.dumpJson(document);
                break;
            case "loadJson":
                await this.loadJson(document, panel);
                break;
            case "runtimeError": {
                const file = path.basename(document.uri.fsPath);
                surfaceWebviewRuntimeError({
                    label: `Binary editor for ${file}`,
                    userFacingFile: file,
                    message: message.message,
                    stack: message.stack,
                });
                break;
            }
        }
    }

    async saveCustomDocument(document: BinaryEditorDocument, _token: vscode.CancellationToken): Promise<void> {
        await this.writeSave(document, document.uri.fsPath, document.uri);
    }

    async saveCustomDocumentAs(
        document: BinaryEditorDocument,
        destination: vscode.Uri,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        await this.writeSave(document, destination.fsPath, destination);
    }

    async revertCustomDocument(document: BinaryEditorDocument, _token: vscode.CancellationToken): Promise<void> {
        await document.reloadFromDisk();
        this.postToDocumentPanels(document, { type: "init", open: document.openResult });
        await this.pushDiagnosticsToDocument(document);
    }

    async backupCustomDocument(
        document: BinaryEditorDocument,
        context: vscode.CustomDocumentBackupContext,
        _token: vscode.CancellationToken,
    ): Promise<vscode.CustomDocumentBackup> {
        const bytes = await document.getBytes();
        await vscode.workspace.fs.writeFile(context.destination, bytes);
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
        document: BinaryEditorDocument,
        targetPath: string,
        primaryDestination: vscode.Uri,
    ): Promise<void> {
        const bytes = await document.getBytes();
        const snapshotJson = await document.getSnapshotJson();
        const autoDumpJson = vscode.workspace
            .getConfiguration("bgforge.binaryEditor")
            .get<boolean>("autoDumpJson", false);
        for (const write of planSave({ targetPath, bytes, snapshotJson, autoDumpJson })) {
            // The primary artifact reuses the caller's URI (preserving its scheme); the sidecar derives from
            // that same destination, through the one helper that owns the scheme rule.
            const target = write.path === targetPath ? primaryDestination : snapshotSidecarUri(primaryDestination);
            // Sequential by design: the main artifact must land before the JSON sidecar so a
            // crash never leaves a snapshot newer than the file it describes. The list is at
            // most two entries, so serial writes cost nothing.
            // eslint-disable-next-line no-await-in-loop
            await vscode.workspace.fs.writeFile(target, write.bytes);
        }
    }

    private post(panel: vscode.WebviewPanel, message: HostToWebview): void {
        // Every host-to-webview message funnels through here, so strref resolution lands once instead of at
        // each of the six sites that can carry rows. The document comes from the panel map rather than the
        // call sites: only the document's URI says which game (if any) the record was opened from.
        //
        // Gated on the document actually being game-backed, not just on having a URI: every resolver answers
        // undefined for a record opened off disk, so without this the common case - editing a mod's own file -
        // pays a full recursive walk of every message to find nothing.
        const uri = this.active.get(panel)?.uri;
        const resolved =
            uri === undefined || !isGameDocument(uri)
                ? message
                : withGameContext(message, {
                      strref: (strref) => this.gameLookups.strref(uri, strref),
                      slotLabel: (tables, index) => this.gameLookups.slotLabel(uri, tables, index),
                      namingTable: (kind, tables) => this.gameLookups.namingTable(uri, kind, tables),
                      resourceType: (decl, resref) => this.gameLookups.resourceType(uri, decl, resref),
                  });
        void panel.webview.postMessage(resolved);
    }

    /** Post a message to every webview panel currently showing the given document. */
    private postToDocumentPanels(document: BinaryEditorDocument, message: HostToWebview): void {
        for (const [panel, doc] of this.active) {
            if (doc === document) this.post(panel, message);
        }
    }

    /** Run the worker validate pass and push the advisory diagnostics to all of the document's panels. */
    private async pushDiagnosticsToDocument(document: BinaryEditorDocument): Promise<void> {
        const v = await document.bridge.send({ type: "validate", sessionId: document.sessionId });
        if (v.type === "diagnostics") {
            this.postToDocumentPanels(document, { type: "diagnostics", diagnostics: v.diagnostics });
        }
    }

    /** Debounce the advisory validate round-trip: a burst of rapid edits collapses to a single validate once
     *  edits settle, instead of one worker round-trip per edit. One-shot paths (open / revert / loadJson) call
     *  pushDiagnosticsToDocument directly - they are not bursty and want immediate diagnostics. */
    private scheduleDiagnostics(document: BinaryEditorDocument): void {
        const existing = this.diagnosticsTimers.get(document);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
            this.diagnosticsTimers.delete(document);
            // The document may have closed while the debounce was pending; skip if no panel still shows it (its
            // bridge may be disposed). The catch covers a dispose that races the fire.
            if (!this.documentIsActive(document)) return;
            void this.pushDiagnosticsToDocument(document).catch(() => {
                /* worker gone (document closed mid-flight); advisory diagnostics, drop silently */
            });
        }, BinaryEditorProvider.DIAGNOSTICS_DEBOUNCE_MS);
        this.diagnosticsTimers.set(document, timer);
    }

    private documentIsActive(document: BinaryEditorDocument): boolean {
        for (const doc of this.active.values()) {
            if (doc === document) return true;
        }
        return false;
    }

    /** After an undo/redo: tell every panel to clear its cache and re-fetch (layout is unchanged, so
     *  selection/tab state in the webview is preserved - no re-init). */
    private refreshDocumentPanels(document: BinaryEditorDocument, changeSet?: ChangeSet): void {
        // A full changeSet refreshes everything an edit would (fields, tab count badges, cross-record dropdowns,
        // diagnostics, and the tree) while preserving selection/tab state - so undo/redo no longer leaves field
        // values or tab counts stale. The dataless fallback (no changeSet) keeps the old invalidate behavior.
        if (changeSet) {
            this.postToDocumentPanels(document, { type: "changeSet", changeSet });
            return;
        }
        this.postToDocumentPanels(document, { type: "invalidated" });
        this.scheduleDiagnostics(document);
    }

    private async dumpJson(document: BinaryEditorDocument): Promise<void> {
        // Write the canonical snapshot to the automatic sidecar path (<name>.json) - the same target the
        // autoDumpJson save-time sidecar uses - with no dialog.
        const json = await document.getSnapshotJson();
        await vscode.workspace.fs.writeFile(snapshotSidecarUri(document.uri), Buffer.from(json, "utf8"));
    }

    private async loadJson(document: BinaryEditorDocument, panel: vscode.WebviewPanel): Promise<void> {
        // Read from the automatic sidecar path (<name>.json), no dialog. Missing file -> advisory error.
        const source = snapshotSidecarUri(document.uri);
        let json: string;
        try {
            const bytes = await vscode.workspace.fs.readFile(source);
            json = Buffer.from(bytes).toString("utf8");
        } catch {
            this.post(panel, {
                type: "error",
                message: `No JSON sidecar to load for ${path.basename(document.uri.path)}.`,
            });
            return;
        }
        const r = await document.bridge.send({ type: "loadJson", sessionId: document.sessionId, json });
        if (r.type === "error") {
            this.post(panel, { type: "error", message: r.message });
            return;
        }
        if (r.type === "opened") {
            document.applyOpenResult(r.result);
            document.pushEdit("Load JSON");
            // A load can change the layout, so re-init all panels (rebuilds their view from the new model).
            this.postToDocumentPanels(document, { type: "init", open: r.result });
            await this.pushDiagnosticsToDocument(document);
        }
    }

    private getHtml(webview: vscode.Webview): string {
        const extensionPath = this.extensionUri.fsPath;
        let html = getCachedHtmlAsset("binary-editor-v2", extensionPath, WEBVIEW_HTML);
        // Styles load as <link> stylesheets resolved through asWebviewUri and authorised by
        // `style-src {{cspSource}}` - not inlined as <style nonce>. The VS Code webview layer only honours
        // style-src sources it attributes to the webview origin (cspSource); a bare `style-src 'nonce-...'`
        // is honoured by raw Chromium but silently ignored here, leaving the panel unstyled. See
        // docs/architecture.md (Webview CSP).
        // codicon.css links directly too: its @font-face `url("./codicon.ttf")` resolves relative to the
        // stylesheet's webview URI (same dir, both under localResourceRoots), so no font-URL rewrite is needed.
        const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, WEBVIEW_CSS));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, CODICONS_DIR, "codicon.css"));
        // Function replacers: the URIs contain `$`-adjacent characters that String.replace would otherwise
        // interpret as `$&`/`$'` patterns.
        html = html.replace("{{stylesUri}}", () => stylesUri.toString());
        html = html.replace("{{codiconsUri}}", () => codiconsUri.toString());
        const script = getCachedJsAsset("binary-editor-v2", extensionPath, WEBVIEW_JS);
        const nonce = generateNonce();
        html = inlineWebviewScript(html, script, nonce);
        return html.replaceAll("{{cspSource}}", webview.cspSource);
    }
}
