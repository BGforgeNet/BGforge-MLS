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
import { type AnimationStageHost, createAnimationStage } from "./stage";
import { type HostToWebview, type SetTile, type WebviewToHost } from "./webview/messages";

const WEBVIEW_DIR = path.join("client", "src", "gallery", "webview");
const WEBVIEW_HTML = path.join(WEBVIEW_DIR, "index.html");
const WEBVIEW_CSS = path.join(WEBVIEW_DIR, "styles.css");
const WEBVIEW_JS = path.join("client", "out", "gallery", "webview", "main.js");
const WORKER_JS = path.join("client", "out", "gallery", "worker.js");
const CODICONS_DIR = path.join("client", "out", "codicons");
/**
 * The animation surface's own stylesheets, loaded into this panel too.
 *
 * The panel draws that surface with its own components, so it needs the rules they were written against;
 * anything else would be a second stylesheet for one set of components, drifting on the first change.
 */
const ANIMATION_WEBVIEW_DIR = path.join("client", "src", "image-editor", "webview");
const ANIMATION_CSS = path.join(ANIMATION_WEBVIEW_DIR, "styles.css");
const SHARED_UI_DIR = path.join("client", "src", "webview-ui");
const SHARED_UI_BASE_CSS = path.join(SHARED_UI_DIR, "base.css");
const SHARED_UI_CSS = path.join(SHARED_UI_DIR, "primitives.css");
const SHARED_TILES_CSS = path.join(SHARED_UI_DIR, "animation-tiles.css");

export const GALLERY_VIEW_TYPE = "bgforge.gallery";

/** What a restored panel needs to rebuild itself. Structured-clone safe - VS Code persists it as JSON. */
export interface GalleryPanelState {
    source: "game" | "workspace";
    /**
     * The animation to open on, when the panel was opened by a link rather than by the command.
     *
     * Deliberately not restored: the serializer rebuilds a panel from its source alone, so a reloaded
     * window shows the gallery rather than re-answering a click made an hour ago.
     */
    focusSet?: number;
}

export interface GalleryDeps {
    /** The source for a kind, or undefined when it is not available (no game open, no workspace folders). */
    sourceFor(kind: "game" | "workspace"): GallerySource | undefined;
    /**
     * Open an item this panel has no stage for, in whichever editor owns it.
     *
     * Only for those: an animation is drawn on the panel's own stage, which is what makes the gallery one
     * surface rather than a launcher.
     */
    open(source: GallerySource, id: string): Promise<void>;
    /**
     * Where an item of this source lives, as a URI the animation surface can open, or undefined for one
     * it cannot draw. The source knows the format, so the branch stays on the side that does.
     */
    animationUri(source: GallerySource, id: string): vscode.Uri | undefined;
    /** The animation editor, which this panel draws inside itself. Absent when it is not registered. */
    animation?: AnimationStageHost;
    /**
     * The open game's animations, or an empty list with no game.
     *
     * Its own dep rather than a `GallerySource` method: a source lists drawable FILES, and the workspace
     * source has no game behind it to answer for. Empty is what hides the tab strip.
     */
    sets(): readonly SetTile[];
    /** An animation set's address, by id. Undefined with no game open. */
    setUri(id: number): vscode.Uri | undefined;
    /**
     * Fires when the open game changes - opened, replaced, or closed.
     *
     * A panel is wired once and would otherwise keep whatever was open at that moment. That is not a corner
     * case: a restored panel is deserialized during activation, while the resource view opens the game only
     * once it becomes visible, so on a window reload the panel is always wired with no game.
     */
    onDidChangeGame(listener: () => void): vscode.Disposable;
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
            // The stylesheets are source files, not build outputs, so their directories are roots too -
            // without them `asWebviewUri` resolves to a URI the webview refuses to load and the panel
            // renders unstyled. Three of them, because the animation surface drawn here brings its own.
            vscode.Uri.joinPath(context.extensionUri, "client", "src", "gallery", "webview"),
            vscode.Uri.joinPath(context.extensionUri, ANIMATION_WEBVIEW_DIR),
            vscode.Uri.joinPath(context.extensionUri, SHARED_UI_DIR),
        ],
    };
    panel.webview.html = buildGalleryHtml(panel.webview, context.extensionUri);

    const port = (deps.makePort ?? defaultPort)(context.extensionUri);

    // Nothing to browse is a legitimate state, not a failure - and the panel must say WHICH state, because
    // "no pictures here" and "you have not opened a game" send the reader in opposite directions.
    const emptyNote =
        state.source === "game"
            ? 'No game is open. Run "BGforge: Open IE Game..." to browse an install.'
            : "No folder is open. Open a folder to browse the images in it.";

    let source: GallerySource | undefined;
    let pump: ThumbnailPump | undefined;
    /** What the stage is drawing, echoed to the webview so the browse list can mark the row it came from. */
    let showing: { set?: number; item?: string } = {};

    const stage =
        deps.animation &&
        createAnimationStage({
            host: deps.animation,
            post: (message) => void panel.webview.postMessage({ type: "viewer", message } satisfies HostToWebview),
            showSet: (_gameDir, id) => showSet(id),
        });

    /**
     * Draw something on the stage, and say what.
     *
     * Attached before `showing` goes out, and the picture only after: `showing` is what mounts the surface
     * in the webview, and a mounted surface asks for its own contents. Announcing it before the document
     * is attached would put that request to a stage holding nothing.
     */
    const showOnStage = async (uri: vscode.Uri, at: { set?: number; item?: string }): Promise<void> => {
        if (stage === undefined) return;
        // Only what actually landed is announced: a show overtaken by a later pick would otherwise mark a
        // row the stage is not drawing.
        if (!(await stage.show(uri))) return;
        showing = at;
        void panel.webview.postMessage({ type: "showing", ...at } satisfies HostToWebview);
    };

    const showSet = async (id: number): Promise<void> => {
        const uri = deps.setUri(id);
        if (uri !== undefined) await showOnStage(uri, { set: id });
    };

    /**
     * Take a reading of the corpus this panel browses.
     *
     * Re-run whenever the game changes, so everything downstream is rebuilt against the new install rather
     * than left pointing at the old one: the pump's thumbnail cache is keyed per item, not per game.
     */
    const mount = (): void => {
        source = deps.sourceFor(state.source);
        pump =
            source &&
            new ThumbnailPump({
                source,
                post: (message: HostToWebview) => void panel.webview.postMessage(message),
                send: (request) => port.postMessage(request),
            });
    };

    /** The whole reading in one message: which corpus, what is in it, and the note shown when it is empty. */
    const postInit = (): void => {
        void panel.webview.postMessage({
            type: "init",
            source: state.source,
            title: state.source === "game" ? "resources" : "files",
            items: source?.list() ?? [],
            sets: [...deps.sets()],
            ...(state.focusSet === undefined ? {} : { focusSet: state.focusSet }),
            ...(source === undefined ? { note: emptyNote } : {}),
        } satisfies HostToWebview);
        // Stated on every reading, not only when it changes: `init` replaces the webview's whole world, so
        // a stage left drawn without this would be a picture the browse list no longer marks a row for.
        void panel.webview.postMessage({ type: "showing", ...showing } satisfies HostToWebview);
    };

    mount();

    port.onMessage((response) => pump?.handle(response));
    port.onError((err) => {
        // A dead worker cannot answer anything still in flight, so say so once rather than leaving every
        // pending tile spinning with no explanation.
        void vscode.window.showErrorMessage(`Image gallery worker stopped: ${err.message}`);
    });

    panel.webview.onDidReceiveMessage((message: WebviewToHost) => {
        switch (message.type) {
            case "ready":
                postInit();
                // A panel opened ON an animation draws it straight away: the link was a request to look at
                // that set, and landing on its row with an empty stage would answer only half of it.
                if (state.focusSet !== undefined) void showSet(state.focusSet);
                break;
            case "requestThumbnails":
                pump?.request(message.ids, message.size);
                break;
            case "open": {
                if (source === undefined) break;
                // Drawn here when this panel has a stage for it, handed to its own editor when it does not:
                // the gallery lists more formats than the animation surface can draw. The handed-over path
                // still reveals the item in the resource tree and this one does not, deliberately: a reveal
                // answers "where did the thing I am now looking at come from" when the view has moved, and
                // moving focus out of the panel to answer it here would take the reader off the picture.
                const uri = deps.animationUri(source, message.id);
                if (uri === undefined) void deps.open(source, message.id);
                else void showOnStage(uri, { item: message.id });
                break;
            }
            case "showSet":
                void showSet(message.id);
                break;
            case "viewer":
                stage?.receive(message.message);
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

    const gameChanged = deps.onDidChangeGame(() => {
        // The stage is cleared, not redrawn: what it holds was opened out of the install that just went
        // away, and a picture of an archive nobody has open any more is worse than an empty stage.
        stage?.dispose();
        showing = {};
        mount();
        postInit();
    });

    panel.onDidDispose(() => {
        gameChanged.dispose();
        port.dispose();
        stage?.dispose();
    });
}

function buildGalleryHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    const extensionPath = extensionUri.fsPath;
    let html = getCachedHtmlAsset("gallery", extensionPath, WEBVIEW_HTML);
    // See docs/architecture.md (Webview CSP): styles load as <link> stylesheets resolved through
    // asWebviewUri and authorised by `style-src {{cspSource}}`, not inlined with a nonce.
    const asUri = (...segments: string[]): string =>
        webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...segments)).toString();
    // Function replacers: the URIs contain `$`-adjacent characters String.replace would read as patterns.
    // The gallery's own sheet goes LAST, so a rule of its own wins over the animation surface's where the
    // two name the same thing.
    html = html.replace("{{stylesUri}}", () => asUri(WEBVIEW_CSS));
    html = html.replace("{{codiconsUri}}", () => asUri(CODICONS_DIR, "codicon.css"));
    html = html.replace("{{baseUri}}", () => asUri(SHARED_UI_BASE_CSS));
    html = html.replace("{{primitivesUri}}", () => asUri(SHARED_UI_CSS));
    html = html.replace("{{sharedTilesUri}}", () => asUri(SHARED_TILES_CSS));
    html = html.replace("{{animationStylesUri}}", () => asUri(ANIMATION_CSS));
    html = inlineWebviewScript(html, getCachedJsAsset("gallery", extensionPath, WEBVIEW_JS), generateNonce());
    return html.replaceAll("{{cspSource}}", webview.cspSource);
}
