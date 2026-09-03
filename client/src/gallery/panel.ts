/**
 * The gallery's webview panel: the editor-area window, its worker, and the pump between them.
 *
 * The repo's first plain webview panel rather than a custom editor. A custom editor restores itself from the
 * document it was opened on; a panel has no document, so surviving a window reload takes a serializer plus
 * the matching `onWebviewPanel` activation event - both wired in `register.ts`.
 */
import * as path from "path";
import { Worker } from "node:worker_threads";
import * as vscode from "vscode";
import { generateNonce, getCachedHtmlAsset, getCachedJsAsset, inlineWebviewScript } from "../webview-assets";
import { surfaceWebviewRuntimeError } from "../webview-error";
import { ThumbnailPump } from "./panel-core";
import { type GallerySource } from "./source";
import { galleryWorkerPort, type GalleryPort } from "./worker-port";
import { type HostToWebview, type WebviewToHost } from "./webview/messages";

const WEBVIEW_DIR = path.join("client", "src", "gallery", "webview");
const WEBVIEW_HTML = path.join(WEBVIEW_DIR, "index.html");
const WEBVIEW_CSS = path.join(WEBVIEW_DIR, "styles.css");
const WEBVIEW_JS = path.join("client", "out", "gallery", "webview", "main.js");
const WORKER_JS = path.join("client", "out", "gallery", "worker.js");
const CODICONS_DIR = path.join("client", "out", "codicons");

export const GALLERY_VIEW_TYPE = "bgforge.gallery";

/** What a restored panel needs to rebuild itself. Structured-clone safe - VS Code persists it as JSON. */
export interface GalleryPanelState {
    source: "game" | "workspace";
}

export interface GalleryDeps {
    /** The source for a kind, or undefined when it is not available (no game open, no workspace folders). */
    sourceFor(kind: "game" | "workspace"): GallerySource | undefined;
    /** Open an item in its editor. */
    open(source: GallerySource, id: string): Promise<void>;
    /** Injected so a test can drive the panel without spawning a thread. */
    makePort?(extensionUri: vscode.Uri): GalleryPort;
}

function defaultPort(extensionUri: vscode.Uri): GalleryPort {
    // `process.execPath`-relative, not a bare PATH lookup: the worker bundle is shipped beside the extension
    // and `worker_threads` resolves it from the extension host's own runtime.
    return galleryWorkerPort(new Worker(vscode.Uri.joinPath(extensionUri, WORKER_JS).fsPath));
}

/**
 * Wire one panel: mount the webview, start a worker, and pump thumbnails between them until it closes.
 *
 * Each panel gets its own worker. They are cheap next to what they hold - an archive-handle cache and a
 * decoded-page cache, both of which are per-corpus - and a shared one would keep those alive after the last
 * gallery closed.
 */
export function wireGalleryPanel(
    panel: vscode.WebviewPanel,
    state: GalleryPanelState,
    context: vscode.ExtensionContext,
    deps: GalleryDeps,
): void {
    panel.webview.options = {
        enableScripts: true,
        localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, "client", "out"),
            // The stylesheet is a source file, not a build output, so its directory is a root too - without
            // it `asWebviewUri` resolves to a URI the webview refuses to load and the panel renders unstyled.
            vscode.Uri.joinPath(context.extensionUri, "client", "src", "gallery", "webview"),
        ],
    };
    panel.webview.html = buildGalleryHtml(panel.webview, context.extensionUri);

    const source = deps.sourceFor(state.source);
    const port = (deps.makePort ?? defaultPort)(context.extensionUri);

    if (source === undefined) {
        // Nothing to show is a legitimate state, not a failure: the user can open a game or a folder and
        // reopen the gallery. Say so in the panel rather than leaving an empty grid that looks broken.
        panel.webview.postMessage({ type: "init", source: state.source, title: state.source, items: [] });
    }

    const pump =
        source &&
        new ThumbnailPump({
            source,
            post: (message: HostToWebview) => void panel.webview.postMessage(message),
            send: (request) => port.postMessage(request),
        });

    port.onMessage((response) => pump?.handle(response));
    port.onError((err) => {
        // A dead worker cannot answer anything still in flight, so say so once rather than leaving every
        // pending tile spinning with no explanation.
        void vscode.window.showErrorMessage(`Image gallery worker stopped: ${err.message}`);
    });

    panel.webview.onDidReceiveMessage((message: WebviewToHost) => {
        switch (message.type) {
            case "ready":
                if (source) {
                    panel.webview.postMessage({
                        type: "init",
                        source: state.source,
                        title: state.source === "game" ? "resources" : "files",
                        items: source.list(),
                    } satisfies HostToWebview);
                }
                break;
            case "requestThumbnails":
                pump?.request(message.ids, message.size);
                break;
            case "open":
                if (source) void deps.open(source, message.id);
                break;
            // Parity with the other panels: a fatal error in the webview reaches the output channel and a
            // toast instead of leaving a silently blank panel.
            case "runtimeError":
                surfaceWebviewRuntimeError({
                    editor: "Image gallery",
                    file: state.source,
                    message: message.message,
                    stack: message.stack,
                });
                break;
        }
    });

    panel.onDidDispose(() => port.dispose());
}

function buildGalleryHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const extensionPath = extensionUri.fsPath;
    let html = getCachedHtmlAsset("gallery", extensionPath, WEBVIEW_HTML);
    // See docs/architecture.md (Webview CSP): styles load as <link> stylesheets resolved through
    // asWebviewUri and authorised by `style-src {{cspSource}}`, not inlined with a nonce.
    const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, WEBVIEW_CSS));
    const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, CODICONS_DIR, "codicon.css"));
    // Function replacers: the URIs contain `$`-adjacent characters String.replace would read as patterns.
    html = html.replace("{{stylesUri}}", () => stylesUri.toString());
    html = html.replace("{{codiconsUri}}", () => codiconsUri.toString());
    html = inlineWebviewScript(html, getCachedJsAsset("gallery", extensionPath, WEBVIEW_JS), generateNonce());
    return html.replaceAll("{{cspSource}}", webview.cspSource);
}
