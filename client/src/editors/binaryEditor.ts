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
import { type BinaryEditorTreeState, buildBinaryEditorTreeState } from "./binaryEditor-tree";
import { validateFieldEdit } from "./binaryEditor-validation";
import type { WebviewToExtension, ExtensionToWebview, InitMessage } from "./binaryEditor-messages";
import { resolveDisplayValue, resolveEnumLookup, resolveFlagLookup } from "./binaryEditor-lookups";
import { saveBinaryDocumentArtifacts, writeBinaryJsonSnapshot } from "./binaryEditor-save";
import { BinaryEditorRefreshGate } from "./binaryEditor-refreshGate";
import { BinaryEditorLocalEditTracker } from "./binaryEditor-localEditTracker";

type EditableBinaryParser = BinaryParser & {
    serialize: NonNullable<BinaryParser["serialize"]>;
};

class BinaryEditorProvider implements vscode.CustomEditorProvider<BinaryDocument> {
    public static readonly viewType = "bgforge.binaryEditor";

    private readonly extensionUri: vscode.Uri;

    /** Per-document disposables, cleaned up when document is disposed */
    private readonly documentSubscriptions = new Map<BinaryDocument, vscode.Disposable[]>();
    private readonly treeStates = new Map<BinaryDocument, BinaryEditorTreeState>();

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
        vscode.CustomDocumentEditEvent<BinaryDocument>
    >();
    readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    constructor(context: vscode.ExtensionContext) {
        this.extensionUri = context.extensionUri;
    }

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

        // Clean up subscriptions when document is disposed
        subscriptions.push(
            doc.onDidDispose(() => {
                const subs = this.documentSubscriptions.get(doc);
                if (subs) {
                    for (const sub of subs) sub.dispose();
                    this.documentSubscriptions.delete(doc);
                }
                this.treeStates.delete(doc);
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
            localResourceRoots: [this.extensionUri],
        };

        // Set the initial HTML shell
        webviewPanel.webview.html = this.getHtmlShell(document);

        // Handle messages from webview.
        //
        // The `msg` is type-asserted, not runtime-discriminated. VSCode's
        // webview postMessage channel is same-origin: the only producer is the
        // extension's own webview JS (loaded under the nonce-gated CSP set in
        // binaryEditor.html), so external injection is not possible. A runtime
        // discriminated-union guard would only catch bugs in our own webview
        // code — not a trust-boundary concern — and is intentionally omitted to
        // keep the dispatcher legible.
        webviewPanel.webview.onDidReceiveMessage((msg: WebviewToExtension) => {
            switch (msg.type) {
                case "ready":
                    this.sendInit(webviewPanel.webview, document);
                    break;
                case "getChildren":
                    this.sendChildren(webviewPanel.webview, document, msg.nodeId);
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
                    console.error(
                        `Binary editor runtime error for ${document.uri.fsPath}: ${msg.message}`,
                        msg.stack ?? "",
                    );
                    void vscode.window.showErrorMessage(
                        `Binary editor failed for ${path.basename(document.uri.fsPath)}: ${msg.message}`,
                    );
                    break;
            }
        });

        // Re-send data when content changes (undo/redo)
        document.onDidChangeContent(() => {
            if (refreshGate.consumeShouldSkipFullRefresh()) {
                return;
            }
            localEditTracker.clear();
            this.sendInit(webviewPanel.webview, document);
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

    private sendInit(webview: vscode.Webview, document: BinaryDocument): void {
        const treeState = buildBinaryEditorTreeState(document.parseResult);
        this.treeStates.set(document, treeState);
        const payload = treeState.getInitMessagePayload();
        const msg: InitMessage = {
            type: "init",
            format: payload.format,
            formatName: payload.formatName,
            rootChildren: payload.rootChildren,
            warnings: payload.warnings,
            errors: payload.errors,
        };
        webview.postMessage(msg);
    }

    private sendChildren(webview: vscode.Webview, document: BinaryDocument, nodeId: string): void {
        const treeState = this.treeStates.get(document) ?? buildBinaryEditorTreeState(document.parseResult);
        this.treeStates.set(document, treeState);
        const msg: ExtensionToWebview = {
            type: "children",
            nodeId,
            children: treeState.getChildren(nodeId),
        };
        webview.postMessage(msg);
    }

    private async handleEdit(
        webview: vscode.Webview,
        document: BinaryDocument,
        fieldId: string,
        fieldPath: string,
        rawValue: number,
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

        const fieldName = field.name;
        const fieldKey = createSemanticFieldKeyFromId(format, fieldId) ?? fieldPath;

        if (localEditTracker.shouldUndo(fieldId, rawValue)) {
            localEditTracker.clear();
            refreshGate.beginIncrementalEdit();
            await vscode.commands.executeCommand("undo");
            const displayValue = resolveDisplayValue(format, fieldKey, fieldName, rawValue);
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
        });
        if (validationError) {
            const msg: ExtensionToWebview = { type: "validationError", fieldId, fieldPath, message: validationError };
            webview.postMessage(msg);
            return;
        }

        // Compute display value
        const displayValue = resolveDisplayValue(format, fieldKey, fieldName, rawValue);

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
 * Register the binary editor provider
 */
export function registerBinaryEditor(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new BinaryEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(BinaryEditorProvider.viewType, provider, {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: {
            retainContextWhenHidden: true,
        },
    });
}
