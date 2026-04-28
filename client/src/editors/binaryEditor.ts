/**
 * Custom editor provider for binary PRO and MAP files.
 * Displays parsed structure in an editable tree view with undo/redo and save.
 */

import * as vscode from "vscode";
import * as path from "path";
import { randomBytes } from "crypto";
import {
    type BinaryParser,
    type ParseResult,
    parserRegistry,
    formatAdapterRegistry,
    createSemanticFieldKeyFromId,
    getSnapshotPath,
    loadBinaryJsonSnapshot,
} from "@bgforge/binary";
import { escapeHtml } from "../utils";
import { getCachedCssAsset, getCachedHtmlAsset, getCachedJsAsset } from "../webview-assets";
import { BinaryDocument } from "./binaryEditor-document";
import { BinaryEditorSelectionTracker, type BinaryEditorSelection } from "./binaryEditor-selectionTracker";
import { type BinaryEditorTreeState, buildBinaryEditorTreeState } from "./binaryEditor-tree";
import { validateFieldEdit } from "./binaryEditor-validation";
import type { BinaryEditorNode, WebviewToExtension, ExtensionToWebview, InitMessage } from "./binaryEditor-messages";
import {
    resolveDisplayValue,
    resolveEnumLookup,
    resolveFlagLookup,
    resolveStringCharset,
} from "./binaryEditor-lookups";
import { saveBinaryDocumentArtifacts, writeBinaryJsonSnapshot } from "./binaryEditor-save";
import { BinaryEditorRefreshGate } from "./binaryEditor-refreshGate";
import { BinaryEditorLocalEditTracker } from "./binaryEditor-localEditTracker";
import { surfaceWebviewRuntimeError } from "../webview-error";
import { conlog } from "../logging";

type EditableBinaryParser = BinaryParser & {
    serialize: NonNullable<BinaryParser["serialize"]>;
};

/**
 * Decide whether a group's children list needs to be replaced wholesale on
 * the webview side. `updateField` only refreshes value/rawValue, so any
 * change in display metadata (offset, size, type, name, kind) — e.g. local
 * vars whose offsets shift after a global var is added — has to go through
 * the children-replacement path.
 */
function groupChildrenStructureChanged(
    oldChildren: readonly BinaryEditorNode[],
    newChildren: readonly BinaryEditorNode[],
): boolean {
    if (oldChildren.length !== newChildren.length) return true;
    for (let i = 0; i < oldChildren.length; i++) {
        const o = oldChildren[i]!;
        const n = newChildren[i]!;
        if (
            o.id !== n.id ||
            o.kind !== n.kind ||
            o.name !== n.name ||
            o.offset !== n.offset ||
            o.size !== n.size ||
            o.valueType !== n.valueType
        ) {
            return true;
        }
    }
    return false;
}

class BinaryEditorProvider implements vscode.CustomEditorProvider<BinaryDocument> {
    public static readonly viewType = "bgforge.binaryEditor";

    private readonly extensionUri: vscode.Uri;

    /** Per-document disposables, cleaned up when document is disposed */
    private readonly documentSubscriptions = new Map<BinaryDocument, vscode.Disposable[]>();
    /**
     * Per-panel tree state. Keyed by `WebviewPanel` rather than by `BinaryDocument`
     * because `supportsMultipleEditorsPerDocument: true` permits two panels to view
     * the same document — keying by document would cause the second panel's
     * lazy-expand state to overwrite the first's.
     */
    private readonly treeStates = new Map<vscode.WebviewPanel, BinaryEditorTreeState>();

    private readonly panelDocuments = new Map<vscode.WebviewPanel, BinaryDocument>();
    private readonly selectionTracker = new BinaryEditorSelectionTracker();

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
        vscode.CustomDocumentEditEvent<BinaryDocument>
    >();
    readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    constructor(context: vscode.ExtensionContext) {
        this.extensionUri = context.extensionUri;
    }

    /**
     * Currently selected node + its source document, or undefined if no
     * binary editor is the focused view. Commands consult this to know
     * what to operate on.
     */
    getActiveContext(): { document: BinaryDocument; selection: BinaryEditorSelection } | undefined {
        const selection = this.selectionTracker.getActiveSelection();
        if (!selection) return undefined;
        for (const [panel, doc] of this.panelDocuments) {
            if (panel.active) return { document: doc, selection };
        }
        return undefined;
    }

    private panelKey(panel: vscode.WebviewPanel): string {
        // Stable per-panel key. Panels are reference-typed and we only need
        // identity equality, so a Map<panel, key> would be redundant — we
        // synthesize a key from a WeakMap-backed counter.
        let key = this.panelKeys.get(panel);
        if (key === undefined) {
            key = `panel-${this.nextPanelKey++}`;
            this.panelKeys.set(panel, key);
        }
        return key;
    }
    private readonly panelKeys = new WeakMap<vscode.WebviewPanel, string>();
    private nextPanelKey = 0;

    // -- CustomEditorProvider lifecycle -------------------------------------

    async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken,
    ): Promise<BinaryDocument> {
        const { parseResult, parser } = await this.parseFile(uri);
        const doc = new BinaryDocument(uri, parseResult, {
            parse: parser.parse.bind(parser),
            serialize: parser.serialize.bind(parser),
            parseOptions: this.getParseOptions(path.extname(uri.fsPath)),
        });

        const subscriptions: vscode.Disposable[] = [];

        // Forward document edit events to VSCode for dirty tracking and undo/redo
        subscriptions.push(doc.onDidChange((e) => this._onDidChangeCustomDocument.fire(e)));

        // Clean up subscriptions when document is disposed.
        // Per-panel treeStates entries are removed by each panel's onDidDispose;
        // by the time the document disposes, all its panels are already gone.
        subscriptions.push(
            doc.onDidDispose(() => {
                const subs = this.documentSubscriptions.get(doc);
                if (subs) {
                    for (const sub of subs) sub.dispose();
                    this.documentSubscriptions.delete(doc);
                }
            }),
        );

        this.documentSubscriptions.set(doc, subscriptions);

        return doc;
    }

    async resolveCustomEditor(
        document: BinaryDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        const refreshGate = new BinaryEditorRefreshGate();
        const localEditTracker = new BinaryEditorLocalEditTracker();

        webviewPanel.webview.options = {
            enableScripts: true,
            // The HTML shell inlines its CSS (via <style>) and JS (via <script>) and
            // never references local assets through asWebviewUri(); no roots need to
            // be reachable. CSP locks the document to nonced inline content.
            localResourceRoots: [],
        };

        // Set the initial HTML shell
        webviewPanel.webview.html = this.getHtmlShell(document);

        // Per-panel disposables. Pushed onto onDidDispose so that closing one
        // panel for a document does not leak the document.onDidChangeContent
        // listener that the closed panel registered.
        const panelSubscriptions: vscode.Disposable[] = [];

        // Register panel↔document binding + view-state tracking for the
        // selection model. Commands consult `getActiveContext` to learn which
        // document the focused webview belongs to.
        this.panelDocuments.set(webviewPanel, document);
        this.selectionTracker.recordActive(this.panelKey(webviewPanel), webviewPanel.active);
        panelSubscriptions.push(
            webviewPanel.onDidChangeViewState((event) => {
                this.selectionTracker.recordActive(this.panelKey(event.webviewPanel), event.webviewPanel.active);
            }),
        );

        // Handle messages from webview.
        //
        // The `msg` is type-asserted, not runtime-discriminated. VSCode's
        // webview postMessage channel is same-origin: the only producer is the
        // extension's own webview JS (loaded under the nonce-gated CSP set in
        // binaryEditor.html), so external injection is not possible. A runtime
        // discriminated-union guard would only catch bugs in our own webview
        // code — not a trust-boundary concern — and is intentionally omitted to
        // keep the dispatcher legible.
        panelSubscriptions.push(
            webviewPanel.webview.onDidReceiveMessage((msg: WebviewToExtension) => {
                switch (msg.type) {
                    case "ready":
                        this.sendInit(webviewPanel, document);
                        break;
                    case "getChildren":
                        this.sendChildren(webviewPanel, document, msg.nodeId);
                        break;
                    case "edit":
                        void this.handleEdit(
                            webviewPanel.webview,
                            document,
                            msg.fieldId,
                            msg.fieldPath,
                            msg.value,
                            refreshGate,
                            localEditTracker,
                        );
                        break;
                    case "dumpJson":
                        void this.handleDumpJson(document);
                        break;
                    case "loadJson":
                        void this.handleLoadJson(document);
                        break;
                    case "runtimeError":
                        surfaceWebviewRuntimeError({
                            label: "Binary editor",
                            userFacingFile: path.basename(document.uri.fsPath),
                            message: msg.message,
                            stack: msg.stack,
                        });
                        break;
                    case "addEntry":
                        this.applyEntityChange(webviewPanel, document, refreshGate, () =>
                            document.addEntity(msg.arrayPath),
                        );
                        break;
                    case "removeEntry":
                        this.applyEntityChange(webviewPanel, document, refreshGate, () =>
                            document.removeEntity(msg.entryPath),
                        );
                        break;
                    case "selectionChanged":
                        this.selectionTracker.recordSelection(this.panelKey(webviewPanel), msg.selection);
                        break;
                }
            }),
        );

        // Re-send data when content changes (undo/redo)
        panelSubscriptions.push(
            document.onDidChangeContent(() => {
                if (refreshGate.consumeShouldSkipFullRefresh()) {
                    return;
                }
                localEditTracker.clear();
                this.sendInit(webviewPanel, document);
            }),
        );

        webviewPanel.onDidDispose(() => {
            for (const sub of panelSubscriptions) sub.dispose();
            this.treeStates.delete(webviewPanel);
            this.selectionTracker.forgetPanel(this.panelKey(webviewPanel));
            this.panelDocuments.delete(webviewPanel);
        });
    }

    async saveCustomDocument(document: BinaryDocument, _cancellation: vscode.CancellationToken): Promise<void> {
        const bytes = document.getContent();
        await saveBinaryDocumentArtifacts(document.uri, document.uri, bytes, document.parseResult);
    }

    async saveCustomDocumentAs(
        document: BinaryDocument,
        destination: vscode.Uri,
        _cancellation: vscode.CancellationToken,
    ): Promise<void> {
        const bytes = document.getContent();
        await saveBinaryDocumentArtifacts(document.uri, destination, bytes, document.parseResult);
    }

    async revertCustomDocument(document: BinaryDocument, _cancellation: vscode.CancellationToken): Promise<void> {
        const { parseResult } = await this.parseFile(document.uri);
        document.reset(parseResult);
    }

    async backupCustomDocument(
        document: BinaryDocument,
        context: vscode.CustomDocumentBackupContext,
        _cancellation: vscode.CancellationToken,
    ): Promise<vscode.CustomDocumentBackup> {
        const bytes = document.getContent();
        await vscode.workspace.fs.writeFile(context.destination, bytes);
        return { id: context.destination.toString(), delete: () => vscode.workspace.fs.delete(context.destination) };
    }

    // -- Message handling ---------------------------------------------------

    private async handleDumpJson(document: BinaryDocument): Promise<void> {
        const jsonUri = await writeBinaryJsonSnapshot(document.uri, document.parseResult);
        void vscode.window.showInformationMessage(`Saved JSON snapshot: ${path.basename(jsonUri.fsPath)}`);
    }

    private async handleLoadJson(document: BinaryDocument): Promise<void> {
        const jsonUri = vscode.Uri.file(getSnapshotPath(document.uri.fsPath));

        try {
            const jsonText = Buffer.from(await vscode.workspace.fs.readFile(jsonUri)).toString("utf8");
            const extension = path.extname(document.uri.fsPath);
            const parseOptions = this.getParseOptions(extension);
            const loaded = loadBinaryJsonSnapshot(jsonText, {
                proParseOptions: parseOptions,
                mapParseOptions:
                    extension === ".map" ? { ...parseOptions, gracefulMapBoundaries: false } : parseOptions,
            });
            const snapshot = loaded.parseResult;
            const parser = this.getEditableParser(extension);

            if (!parser) {
                void vscode.window.showErrorMessage(
                    `No editable parser registered for ${path.basename(document.uri.fsPath)}`,
                );
                return;
            }

            if (snapshot.format !== document.parseResult.format) {
                void vscode.window.showErrorMessage(
                    `JSON snapshot format ${snapshot.format} does not match ${document.parseResult.format}`,
                );
                return;
            }

            const reparsed = loaded.parseResult;
            document.replaceParseResult(reparsed, `Load ${path.basename(jsonUri.fsPath)}`);
            void vscode.window.showInformationMessage(`Loaded JSON snapshot: ${path.basename(jsonUri.fsPath)}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`Failed to load JSON snapshot: ${message}`);
        }
    }

    private sendInit(panel: vscode.WebviewPanel, document: BinaryDocument): void {
        const treeState = buildBinaryEditorTreeState(document.parseResult);
        this.treeStates.set(panel, treeState);
        const payload = treeState.getInitMessagePayload();
        const msg: InitMessage = {
            type: "init",
            format: payload.format,
            formatName: payload.formatName,
            rootChildren: payload.rootChildren,
            warnings: payload.warnings,
            errors: payload.errors,
        };
        panel.webview.postMessage(msg);
    }

    private sendChildren(panel: vscode.WebviewPanel, document: BinaryDocument, nodeId: string): void {
        const treeState = this.treeStates.get(panel) ?? buildBinaryEditorTreeState(document.parseResult);
        this.treeStates.set(panel, treeState);
        const msg: ExtensionToWebview = {
            type: "children",
            nodeId,
            children: treeState.getChildren(nodeId),
        };
        panel.webview.postMessage(msg);
    }

    /**
     * Run an add/remove/insert/move operation and post a targeted delta to the
     * webview instead of triggering a full re-init. The refresh gate is set
     * before the document mutation so the synchronous `onDidChangeContent`
     * fire from `applyByteRebuild` skips the wholesale rebuild — the delta
     * messages here put the new state on screen without tearing down the DOM.
     *
     * Falls back to `sendInit` when the operation didn't apply, when there's
     * no prior tree state to diff against, or when the top-level group set
     * shifted (a var section appearing/disappearing as it crosses 0 entries).
     */
    private applyEntityChange(
        panel: vscode.WebviewPanel,
        document: BinaryDocument,
        refreshGate: BinaryEditorRefreshGate,
        op: () => unknown,
    ): void {
        const oldTreeState = this.treeStates.get(panel);
        refreshGate.beginIncrementalEdit();
        const result = op();
        conlog(`[entity] op result=${JSON.stringify(result)}, hadOldTreeState=${oldTreeState !== undefined}`, "debug");
        if (!result) {
            // Op didn't apply (unknown path or reparse failed). The
            // synchronous onDidChangeContent fire is the only thing that
            // would have consumed the gate; if applyByteRebuild bailed out
            // before firing, the gate stays armed and would suppress the next
            // unrelated change. Clear it here.
            refreshGate.cancelIncrementalEdit();
            return;
        }
        if (!oldTreeState) {
            conlog(`[entity] no oldTreeState, falling back to sendInit`, "debug");
            this.sendInit(panel, document);
            return;
        }
        const ok = this.tryEmitEntityDelta(panel, document, oldTreeState);
        conlog(`[entity] tryEmitEntityDelta returned ${ok}`, "debug");
        if (!ok) {
            this.sendInit(panel, document);
        }
    }

    /**
     * Compare the old and new tree state at root + one level deep and post
     * `children` / `updateField` messages for what differs. One level is
     * enough for the variable add/remove flow (Global/Local Variables groups
     * are at the root; the only other affected node is the
     * `Num Global Vars` / `Num Local Vars` field inside the Header group).
     * Returns false when the top-level structure changed so the caller can
     * fall back to a full re-init.
     */
    private tryEmitEntityDelta(
        panel: vscode.WebviewPanel,
        document: BinaryDocument,
        oldTreeState: BinaryEditorTreeState,
    ): boolean {
        const newTreeState = buildBinaryEditorTreeState(document.parseResult);
        const oldRoot = oldTreeState.getInitMessagePayload().rootChildren;
        const newRoot = newTreeState.getInitMessagePayload().rootChildren;

        if (oldRoot.length !== newRoot.length) {
            conlog(`[entity] root length differs ${oldRoot.length}->${newRoot.length}`, "debug");
            return false;
        }
        for (let i = 0; i < oldRoot.length; i++) {
            if (oldRoot[i]!.id !== newRoot[i]!.id) {
                conlog(`[entity] root id differs at ${i}: ${oldRoot[i]!.id}!=${newRoot[i]!.id}`, "debug");
                return false;
            }
        }

        this.treeStates.set(panel, newTreeState);

        for (let i = 0; i < newRoot.length; i++) {
            const oldNode = oldRoot[i]!;
            const newNode = newRoot[i]!;
            if (oldNode.kind !== "group" || newNode.kind !== "group") continue;

            const oldChildren = oldTreeState.getChildren(oldNode.id);
            const newChildren = newTreeState.getChildren(newNode.id);

            if (groupChildrenStructureChanged(oldChildren, newChildren)) {
                conlog(
                    `[entity] post children for ${newNode.name} (${newNode.id}): ${newChildren.length} entries`,
                    "debug",
                );
                panel.webview.postMessage({
                    type: "children",
                    nodeId: newNode.id,
                    children: newChildren,
                } satisfies ExtensionToWebview);
                continue;
            }

            // Same structure and metadata at this group's children — only
            // values may have changed. Post `updateField` for each leaf field
            // whose value/rawValue differs. Nested groups (e.g. Header has no
            // nested groups, but Tiles/Scripts/Objects do) are not recursed
            // into — entity ops today only mutate variable arrays + their
            // header-counter scalars, all reachable at this depth.
            for (let j = 0; j < newChildren.length; j++) {
                const oldChild = oldChildren[j]!;
                const newChild = newChildren[j]!;
                if (
                    oldChild.kind !== "field" ||
                    newChild.kind !== "field" ||
                    !newChild.fieldId ||
                    !newChild.fieldPath
                ) {
                    continue;
                }
                if (oldChild.value === newChild.value && oldChild.rawValue === newChild.rawValue) {
                    continue;
                }
                conlog(
                    `[entity] post updateField ${newChild.fieldId}: ${oldChild.value} -> ${newChild.value}`,
                    "debug",
                );
                panel.webview.postMessage({
                    type: "updateField",
                    fieldId: newChild.fieldId,
                    fieldPath: newChild.fieldPath,
                    displayValue: typeof newChild.value === "string" ? newChild.value : String(newChild.value ?? ""),
                    rawValue: newChild.rawValue ?? 0,
                } satisfies ExtensionToWebview);
            }
        }

        return true;
    }

    private async handleEdit(
        webview: vscode.Webview,
        document: BinaryDocument,
        fieldId: string,
        fieldPath: string,
        rawValue: number | string,
        refreshGate: BinaryEditorRefreshGate,
        localEditTracker: BinaryEditorLocalEditTracker,
    ): Promise<void> {
        const format = document.parseResult.format;
        const field = document.getFieldById(fieldId);

        if (!field) {
            const msg: ExtensionToWebview = {
                type: "validationError",
                fieldId,
                fieldPath,
                message: `Field not found: ${fieldPath}`,
            };
            webview.postMessage(msg);
            return;
        }

        // Reject value/type mismatches at the dispatcher boundary so downstream
        // code can rely on the invariant that string fields receive string values.
        const isStringField = field.type === "string";
        if (isStringField && typeof rawValue !== "string") {
            webview.postMessage({
                type: "validationError",
                fieldId,
                fieldPath,
                message: `Field ${fieldPath} expects a string value`,
            } satisfies ExtensionToWebview);
            return;
        }
        if (!isStringField && typeof rawValue !== "number") {
            webview.postMessage({
                type: "validationError",
                fieldId,
                fieldPath,
                message: `Field ${fieldPath} expects a numeric value`,
            } satisfies ExtensionToWebview);
            return;
        }

        const fieldName = field.name;
        const fieldKey = createSemanticFieldKeyFromId(format, fieldId) ?? fieldPath;

        if (localEditTracker.shouldUndo(fieldId, rawValue)) {
            localEditTracker.clear();
            refreshGate.beginIncrementalEdit();
            await vscode.commands.executeCommand("undo");
            const displayValue = isStringField
                ? (rawValue as string)
                : resolveDisplayValue(format, fieldKey, fieldName, rawValue as number);
            const msg: ExtensionToWebview = {
                type: "updateField",
                fieldId,
                fieldPath,
                displayValue,
                rawValue,
            };
            webview.postMessage(msg);
            return;
        }

        const enumTable = resolveEnumLookup(format, fieldKey, fieldName);
        const flagTable = resolveFlagLookup(format, fieldKey, fieldName);
        const validationError = validateFieldEdit(rawValue, field.type, enumTable, flagTable, {
            format,
            fieldKey,
            maxBytes: isStringField ? field.size : undefined,
            stringCharset: isStringField ? resolveStringCharset(format, fieldKey, fieldName) : undefined,
        });
        if (validationError) {
            const msg: ExtensionToWebview = { type: "validationError", fieldId, fieldPath, message: validationError };
            webview.postMessage(msg);
            return;
        }

        // Compute display value
        const displayValue = isStringField
            ? (rawValue as string)
            : resolveDisplayValue(format, fieldKey, fieldName, rawValue as number);

        const adapter = formatAdapterRegistry.get(format);
        const structuralEdit = adapter?.isStructuralFieldId?.(fieldId) ?? false;
        if (!structuralEdit) {
            refreshGate.beginIncrementalEdit();
        }

        const edit = document.applyEdit(fieldId, fieldPath, rawValue, displayValue);
        if (!edit) {
            refreshGate.cancelIncrementalEdit();
            const message = structuralEdit
                ? `Failed to apply structural edit for ${fieldPath}`
                : `Field not found: ${fieldPath}`;
            const msg: ExtensionToWebview = { type: "validationError", fieldId, fieldPath, message };
            webview.postMessage(msg);
            return;
        }
        localEditTracker.record(edit);

        if (!edit.incrementalSafe) {
            refreshGate.cancelIncrementalEdit();
            return;
        }

        const msg: ExtensionToWebview = {
            type: "updateField",
            fieldId,
            fieldPath,
            displayValue,
            rawValue,
        };
        webview.postMessage(msg);
    }

    // -- File parsing -------------------------------------------------------

    private getEditableParser(extension: string): EditableBinaryParser | undefined {
        const parser = parserRegistry.getByExtension(extension);
        if (!parser?.serialize) {
            return undefined;
        }
        return parser as EditableBinaryParser;
    }

    private getParseOptions(extension: string): { skipMapTiles?: boolean } | undefined {
        return extension === ".map" ? { skipMapTiles: true } : undefined;
    }

    private async parseFile(uri: vscode.Uri): Promise<{ parseResult: ParseResult; parser: EditableBinaryParser }> {
        const extension = path.extname(uri.fsPath);
        const parser = this.getEditableParser(extension);

        if (!parser) {
            const parseResult: ParseResult = {
                format: "unknown",
                formatName: "Unknown Format",
                root: { name: "Error", fields: [], expanded: true },
                errors: [`No editable parser registered for extension: ${extension}`],
            };
            return {
                parseResult,
                parser: {
                    id: "unknown",
                    name: "Unknown",
                    extensions: [],
                    parse: () => parseResult,
                    serialize: () => new Uint8Array(),
                },
            };
        }

        const fileData = await vscode.workspace.fs.readFile(uri);
        return {
            parseResult: parser.parse(fileData, this.getParseOptions(extension)),
            parser,
        };
    }

    // -- HTML rendering (shell only, data sent via postMessage) --------------

    private getHtmlTemplate(): string {
        return getCachedHtmlAsset(
            "binary-editor",
            this.extensionUri.fsPath,
            path.join("client", "src", "editors", "binaryEditor.html"),
        );
    }

    private getCss(): string {
        return getCachedCssAsset("binary-editor", this.extensionUri.fsPath, [
            path.join("client", "src", "webview-common.css"),
            path.join("client", "src", "editors", "binaryEditor.css"),
        ]);
    }

    private getJs(): string {
        return getCachedJsAsset(
            "binary-editor",
            this.extensionUri.fsPath,
            path.join("client", "out", "editors", "binaryEditor-webview.js"),
        );
    }

    /**
     * Generate the HTML shell. The tree content is rendered client-side
     * from data sent via postMessage.
     */
    private getHtmlShell(document: BinaryDocument): string {
        const fileName = path.basename(document.uri.fsPath);
        const nonce = randomBytes(16).toString("base64");
        return (
            this.getHtmlTemplate()
                .replace(/\{\{fileName\}\}/g, escapeHtml(fileName))
                .replace("{{formatName}}", escapeHtml(document.parseResult.formatName))
                .replace("{{styles}}", this.getCss())
                // The {{errors}}/{{warnings}} placeholders sit in the static HTML
                // before the webview script runs; substituting them with empty
                // strings here prevents a brief flash of literal '{{errors}}' text
                // until the init message arrives and renderMessages() takes over.
                .replace("{{errors}}", "")
                .replace("{{warnings}}", "")
                .replace("{{tree}}", '<div class="loading">Loading...</div>')
                .replace("/* __SCRIPT__ */", this.getJs())
                .replace(/\{\{nonce\}\}/g, nonce)
        );
    }
}

/**
 * Register the binary editor provider plus its add-entry / remove-entry
 * commands. The returned disposable composes the editor provider and the
 * two command registrations so the extension teardown cleans everything
 * in one push to `context.subscriptions`.
 */
export function registerBinaryEditor(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new BinaryEditorProvider(context);
    const editorRegistration = vscode.window.registerCustomEditorProvider(BinaryEditorProvider.viewType, provider, {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: {
            retainContextWhenHidden: true,
        },
    });

    const addCommand = vscode.commands.registerCommand("bgforge.binaryEditor.addEntry", () => {
        const ctx = provider.getActiveContext();
        if (!ctx?.selection.addable || !ctx.selection.arrayPath) return;
        ctx.document.addEntity(ctx.selection.arrayPath);
    });

    const removeCommand = vscode.commands.registerCommand("bgforge.binaryEditor.removeEntry", () => {
        const ctx = provider.getActiveContext();
        if (!ctx?.selection.removable || !ctx.selection.entryPath) return;
        ctx.document.removeEntity(ctx.selection.entryPath);
    });

    const insertBeforeCommand = vscode.commands.registerCommand("bgforge.binaryEditor.insertEntryBefore", () => {
        const ctx = provider.getActiveContext();
        if (!ctx?.selection.removable || !ctx.selection.entryPath) return;
        ctx.document.insertEntityBefore(ctx.selection.entryPath);
    });

    const insertAfterCommand = vscode.commands.registerCommand("bgforge.binaryEditor.insertEntryAfter", () => {
        const ctx = provider.getActiveContext();
        if (!ctx?.selection.removable || !ctx.selection.entryPath) return;
        ctx.document.insertEntityAfter(ctx.selection.entryPath);
    });

    const moveUpCommand = vscode.commands.registerCommand("bgforge.binaryEditor.moveEntryUp", () => {
        const ctx = provider.getActiveContext();
        if (!ctx?.selection.removable || !ctx.selection.entryPath) return;
        ctx.document.moveEntityUp(ctx.selection.entryPath);
    });

    const moveDownCommand = vscode.commands.registerCommand("bgforge.binaryEditor.moveEntryDown", () => {
        const ctx = provider.getActiveContext();
        if (!ctx?.selection.removable || !ctx.selection.entryPath) return;
        ctx.document.moveEntityDown(ctx.selection.entryPath);
    });

    return vscode.Disposable.from(
        editorRegistration,
        addCommand,
        removeCommand,
        insertBeforeCommand,
        insertAfterCommand,
        moveUpCommand,
        moveDownCommand,
    );
}
