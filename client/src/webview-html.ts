/**
 * The chrome shared by the panels that mount the `webview-ui/` stylesheets.
 *
 * The binary editor, the animation editor and the gallery link the same codicon and shared-UI sheets under the
 * same CSP, so their HTML assembly and their `localResourceRoots` are one implementation here rather than three
 * copies that drift apart on the next sheet. The dialog editor keeps its own builder: it links neither sheet and
 * carries a different policy (see `dialog-editor/webview-host-html.ts`).
 *
 * Kept out of `webview-assets.ts` because that module must stay free of a runtime `vscode` import - the pure
 * dialog HTML builder and its unit test load it outside the extension host.
 *
 * Webview CSP: scripts are locked to a per-load nonce, but `style-src` must name `{{cspSource}}`. VS Code wraps
 * the webview in its own CSP layer that honours only style sources it can attribute to the webview origin, so a
 * nonce-only `style-src` passes any headless or standalone render yet is silently dropped in the real panel,
 * which then comes up unstyled while its script still runs. Stylesheets therefore load as `asWebviewUri` links,
 * each directory declared in `localResourceRoots`; `client/test/webview-csp.test.ts` pins the shape.
 */

import * as path from "path";
import * as vscode from "vscode";
import { generateNonce, getCachedHtmlAsset, getCachedJsAsset, inlineWebviewScript } from "./webview-assets";

const CODICONS_DIR = path.join("client", "out", "codicons");
const SHARED_UI_DIR = path.join("client", "src", "webview-ui");
const SHARED_UI_BASE_CSS = path.join(SHARED_UI_DIR, "base.css");
const SHARED_UI_CSS = path.join(SHARED_UI_DIR, "primitives.css");
/** The animation tiles' sheet, linked by both surfaces that draw them. */
export const SHARED_TILES_CSS = path.join(SHARED_UI_DIR, "animation-tiles.css");

export interface SharedWebviewHtmlSpec {
    /** Asset-cache key, one per panel so two panels never read each other's cached template or bundle. */
    readonly cacheKey: string;
    readonly extensionUri: vscode.Uri;
    /** The panel's own template, bundle and stylesheet, repo-relative. */
    readonly html: string;
    readonly js: string;
    readonly css: string;
    /**
     * Extra `{{placeholder}}` to repo-relative stylesheet, for a panel linking more than the shared set.
     * Every placeholder the template carries must appear here or the unreplaced text ships to the webview.
     */
    readonly extraStyles?: Readonly<Record<string, string>>;
}

/**
 * Resolve one panel's template against a live webview: the shared stylesheets, its own, its bundle and the CSP.
 *
 * Styles load as <link> elements resolved through asWebviewUri and authorised by `style-src {{cspSource}}`, not
 * inlined with a nonce - the wrapped webview silently drops a nonce-only style-src (see the file header).
 * codicon.css links directly too: its @font-face url resolves relative to the stylesheet's own
 * webview URI, so no font-URL rewrite is needed.
 */
export function buildSharedWebviewHtml(webview: vscode.Webview, spec: SharedWebviewHtmlSpec): string {
    const asUri = (relativePath: string): string =>
        webview.asWebviewUri(vscode.Uri.joinPath(spec.extensionUri, relativePath)).toString();
    const styles: Record<string, string> = {
        "{{codiconsUri}}": path.join(CODICONS_DIR, "codicon.css"),
        "{{baseUri}}": SHARED_UI_BASE_CSS,
        "{{primitivesUri}}": SHARED_UI_CSS,
        ...spec.extraStyles,
        // The panel's own sheet goes last, so a rule of its own wins over a shared one naming the same thing.
        "{{stylesUri}}": spec.css,
    };
    let html = getCachedHtmlAsset(spec.cacheKey, spec.extensionUri.fsPath, spec.html);
    for (const [placeholder, relativePath] of Object.entries(styles)) {
        // Function replacers: the URIs contain `$`-adjacent characters String.replace would read as patterns.
        html = html.replace(placeholder, () => asUri(relativePath));
    }
    const script = getCachedJsAsset(spec.cacheKey, spec.extensionUri.fsPath, spec.js);
    return inlineWebviewScript(html, script, generateNonce()).replaceAll("{{cspSource}}", webview.cspSource);
}

/**
 * The roots a panel built by `buildSharedWebviewHtml` must declare: the codicon and shared-UI directories plus
 * whichever of its own it links from. `asWebviewUri` only resolves resources beneath a declared root, and a
 * sheet outside one is dropped as silently as a nonce-only style-src.
 */
export function sharedWebviewRoots(extensionUri: vscode.Uri, ...ownDirs: readonly string[]): vscode.Uri[] {
    return [CODICONS_DIR, SHARED_UI_DIR, ...ownDirs].map((dir) => vscode.Uri.joinPath(extensionUri, dir));
}
