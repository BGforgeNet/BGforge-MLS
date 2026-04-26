/**
 * Shared infrastructure for dialog tree preview panels.
 * Asset caching, HTML assembly, and panel lifecycle management
 * shared between SSL, D, and TD dialog previews.
 * escapeHtml is re-exported from ../utils.ts (single source of truth).
 * CSS is loaded from ../webview-common.css + ./dialogTree.css (shared with binaryEditor).
 */

import * as vscode from "vscode";
import * as path from "path";
import { randomBytes } from "crypto";
import { type ExecuteCommandParams, LanguageClient, ExecuteCommandRequest } from "vscode-languageclient/node";
import { conlog } from "../logging";
import { escapeHtml } from "../utils";
import { getCachedCssAsset, getCachedHtmlAsset, getCachedJsAsset } from "../webview-assets";
import { LSP_COMMAND_PARSE_DIALOG } from "../../../shared/protocol";

function getHtmlTemplate(extensionPath: string): string {
    return getCachedHtmlAsset(
        "dialog-tree",
        extensionPath,
        path.join("client", "src", "dialog-tree", "dialogTree.html"),
    );
}

function getCss(extensionPath: string): string {
    return getCachedCssAsset("dialog-tree", extensionPath, [
        path.join("client", "src", "webview-common.css"),
        path.join("client", "src", "dialog-tree", "dialogTree.css"),
    ]);
}

function getJs(extensionPath: string): string {
    return getCachedJsAsset(
        "dialog-tree",
        extensionPath,
        path.join("client", "out", "dialog-tree", "dialogTree-webview.js"),
    );
}

// Re-export so dialog tree builders (dialogTree.ts, dialogTree-d.ts) can import from "./shared"
export { escapeHtml };

// ---------------------------------------------------------------------------
// Refresh-failure tracking
// ---------------------------------------------------------------------------

/**
 * Tracks consecutive refresh failures and surfaces a user-visible error after a
 * threshold is reached. Transient failures during typing are common (the LSP
 * parser may be mid-update); a low-threshold escalation would spam the user
 * while a never-surfacing one would let real breakage hide as a frozen preview.
 *
 * Surfaces exactly once per failure streak: after the Nth consecutive failure
 * fires `onSurface`, further failures stay silent until a `recordSuccess`
 * re-arms the tracker.
 */
interface RefreshFailureTracker {
    recordFailure(err: unknown): void;
    recordSuccess(): void;
}

export function createRefreshFailureTracker(options: {
    threshold: number;
    onSurface: (message: string) => void;
}): RefreshFailureTracker {
    let consecutive = 0;
    let surfaced = false;
    return {
        recordFailure(err: unknown): void {
            consecutive++;
            if (!surfaced && consecutive >= options.threshold) {
                surfaced = true;
                const message = err instanceof Error ? err.message : String(err);
                options.onSurface(message);
            }
        },
        recordSuccess(): void {
            consecutive = 0;
            surfaced = false;
        },
    };
}

// ---------------------------------------------------------------------------
// HTML assembly
// ---------------------------------------------------------------------------

/** Convert "a/b/c.ssl" to breadcrumb HTML: "a > b > icon c.ssl" with chevron separators and file icon on the last segment. */
function buildBreadcrumbHtml(filePath: string, iconUri: string): string {
    const segments = filePath.split(/[/\\]/).filter(Boolean);
    if (segments.length === 0) return "";
    const separator = ' <span class="breadcrumb-sep codicon codicon-chevron-right"></span> ';
    return segments
        .map((s, i) => {
            const icon =
                i === segments.length - 1 ? `<img class="breadcrumb-icon" src="${escapeHtml(iconUri)}" alt="" /> ` : "";
            return `<span class="breadcrumb-segment">${icon}${escapeHtml(s)}</span>`;
        })
        .join(separator);
}

function getDialogPreviewHtml(
    treeContent: string,
    codiconsUri: string,
    cspSource: string,
    extensionPath: string,
    fileName: string,
    filePath: string,
    iconUri: string,
): string {
    const nonce = randomBytes(16).toString("base64");
    // Function replacers prevent $-pattern interpretation in replacement strings
    // ($&, $', $` are special even with string search patterns).
    return getHtmlTemplate(extensionPath)
        .replace("{{codiconsUri}}", () => codiconsUri)
        .replace("{{cssUri}}", () => "")
        .replace("{{scriptUri}}", () => "")
        .replace('<link href="" rel="stylesheet" />', () => `<style nonce="${nonce}">${getCss(extensionPath)}</style>`)
        .replace('<script src=""></script>', () => `<script nonce="${nonce}">${getJs(extensionPath)}</script>`)
        .replace("{{filePath}}", () => buildBreadcrumbHtml(filePath, iconUri))
        .replace("{{fileName}}", () => escapeHtml(fileName))
        .replace("{{treeContent}}", () => treeContent)
        .replaceAll("{{cspSource}}", cspSource)
        .replaceAll("{{nonce}}", nonce);
}

// ---------------------------------------------------------------------------
// Panel lifecycle
// ---------------------------------------------------------------------------

interface DialogPanelConfig {
    /** Check whether a document should use this panel. */
    matchDocument: (doc: vscode.TextDocument) => boolean;
    /** Warning message shown when no matching file is open */
    warningMessage: string;
    /** Language ID of translation files that trigger refresh on save */
    translationLangId: string;
    /** Build the tree HTML from server response data */
    buildTreeHtml: (data: unknown) => string;
    /** Check if data is non-empty (to decide whether to show "no data" warning) */
    hasData: (data: unknown) => boolean;
    /** Relative path within extension to the tab icon (e.g. "themes/icons/fallout-ssl.svg") */
    tabIconPath: string;
}

interface DialogTreeRuntimeErrorMessage {
    readonly type: "runtimeError";
    readonly message: string;
    readonly stack?: string;
}

export interface DialogPreviewController {
    matchesDocument: (doc: vscode.TextDocument) => boolean;
    openPreview: () => Promise<void>;
}

/**
 * Register a dialog preview panel with shared lifecycle management.
 * Handles panel creation, debounced refresh, document change watching,
 * save watching, and command registration.
 */
export function registerDialogPanel(
    context: vscode.ExtensionContext,
    client: LanguageClient,
    config: DialogPanelConfig,
): DialogPreviewController {
    let dialogPanel: vscode.WebviewPanel | undefined;
    let currentDocumentUri: string | undefined;
    let currentFileName: string | undefined;
    let currentFilePath: string | undefined;
    let refreshTimeout: NodeJS.Timeout | undefined;

    // Surface a user-visible error after several consecutive refresh failures.
    // A single failure during typing is normal (the parser may be mid-update);
    // sustained failures mean the preview is frozen at the last good state and
    // the user has no other signal that something is wrong.
    const failureTracker = createRefreshFailureTracker({
        threshold: 3,
        onSurface: (message) => {
            void vscode.window.showErrorMessage(
                `Dialog preview refresh failing for ${currentFileName ?? "dialog"}: ${message}`,
            );
        },
    });

    async function refreshPreview() {
        if (!dialogPanel || !currentDocumentUri) return;

        const params: ExecuteCommandParams = {
            command: LSP_COMMAND_PARSE_DIALOG,
            arguments: [{ uri: currentDocumentUri }],
        };

        try {
            const data = (await client.sendRequest(ExecuteCommandRequest.type, params)) as unknown;
            if (data == null || !config.hasData(data)) return;

            const treeContent = config.buildTreeHtml(data);
            const codiconsUri = dialogPanel.webview.asWebviewUri(
                vscode.Uri.joinPath(context.extensionUri, "client", "out", "codicons", "codicon.css"),
            );
            const iconUri = dialogPanel.webview.asWebviewUri(
                vscode.Uri.joinPath(context.extensionUri, config.tabIconPath),
            );
            dialogPanel.webview.html = getDialogPreviewHtml(
                treeContent,
                codiconsUri.toString(),
                dialogPanel.webview.cspSource,
                context.extensionUri.fsPath,
                currentFileName || "dialog",
                currentFilePath || "",
                iconUri.toString(),
            );
            failureTracker.recordSuccess();
        } catch (err) {
            conlog(
                `Dialog preview refresh failed for ${currentFileName ?? "<unknown>"}: ${err instanceof Error ? err.message : String(err)}`,
                "warn",
            );
            failureTracker.recordFailure(err);
        }
    }

    function scheduleRefresh() {
        if (refreshTimeout) {
            clearTimeout(refreshTimeout);
        }
        refreshTimeout = setTimeout(refreshPreview, 300);
    }

    // Watch for changes while editing
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((e) => {
            if (dialogPanel && e.document.uri.toString() === currentDocumentUri) {
                scheduleRefresh();
            }
        }),
    );

    // Refresh on save (source file or translation file)
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((doc) => {
            if (!dialogPanel) return;
            if (doc.uri.toString() === currentDocumentUri || doc.languageId === config.translationLangId) {
                void refreshPreview();
            }
        }),
    );

    async function openPreview() {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !config.matchDocument(editor.document)) {
            vscode.window.showWarningMessage(config.warningMessage);
            return;
        }

        currentDocumentUri = editor.document.uri.toString();

        const params: ExecuteCommandParams = {
            command: LSP_COMMAND_PARSE_DIALOG,
            arguments: [{ uri: currentDocumentUri }],
        };

        try {
            const data = (await client.sendRequest(ExecuteCommandRequest.type, params)) as unknown;

            if (data == null || !config.hasData(data)) {
                vscode.window.showWarningMessage("No dialog data found");
                return;
            }

            const fileName = editor.document.fileName.split(/[/\\]/).pop() || "dialog";
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
            const filePath = workspaceFolder
                ? path.relative(workspaceFolder.uri.fsPath, editor.document.fileName)
                : fileName;
            currentFileName = fileName;
            currentFilePath = filePath;

            if (dialogPanel) {
                dialogPanel.reveal(vscode.ViewColumn.Active);
            } else {
                dialogPanel = vscode.window.createWebviewPanel(
                    "bgforgeDialogPreview",
                    `Dialog: ${fileName}`,
                    vscode.ViewColumn.Active,
                    {
                        enableScripts: true,
                        localResourceRoots: [
                            vscode.Uri.joinPath(context.extensionUri, "client", "out", "codicons"),
                            vscode.Uri.joinPath(context.extensionUri, path.dirname(config.tabIconPath)),
                        ],
                    },
                );
                dialogPanel.iconPath = vscode.Uri.joinPath(context.extensionUri, config.tabIconPath);
                dialogPanel.webview.onDidReceiveMessage((message: DialogTreeRuntimeErrorMessage) => {
                    if (message.type !== "runtimeError") {
                        return;
                    }
                    console.error(
                        `Dialog preview runtime error for ${currentFilePath ?? fileName}: ${message.message}`,
                        message.stack ?? "",
                    );
                    void vscode.window.showErrorMessage(`Dialog preview failed for ${fileName}: ${message.message}`);
                });
                dialogPanel.onDidDispose(() => {
                    dialogPanel = undefined;
                    currentDocumentUri = undefined;
                    currentFileName = undefined;
                    currentFilePath = undefined;
                    if (refreshTimeout) {
                        clearTimeout(refreshTimeout);
                    }
                });
            }

            const treeContent = config.buildTreeHtml(data);
            const codiconsUri = dialogPanel.webview.asWebviewUri(
                vscode.Uri.joinPath(context.extensionUri, "client", "out", "codicons", "codicon.css"),
            );
            const iconUri = dialogPanel.webview.asWebviewUri(
                vscode.Uri.joinPath(context.extensionUri, config.tabIconPath),
            );

            dialogPanel.title = `Dialog: ${fileName}`;
            dialogPanel.webview.html = getDialogPreviewHtml(
                treeContent,
                codiconsUri.toString(),
                dialogPanel.webview.cspSource,
                context.extensionUri.fsPath,
                fileName,
                filePath,
                iconUri.toString(),
            );
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            // Log full stack trace to Developer Tools for debugging (showErrorMessage only gets the message)
            console.error("Dialog preview error:", error);
            vscode.window.showErrorMessage(`Failed to generate dialog preview: ${msg}`);
        }
    }

    return {
        matchesDocument: config.matchDocument,
        openPreview,
    };
}
