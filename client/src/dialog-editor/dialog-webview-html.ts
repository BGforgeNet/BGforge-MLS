/**
 * Pure HTML construction for the dialog editor webview.
 *
 * Split out of webview-host-html.ts (which owns the vscode/webview boundary: asWebviewUri,
 * the cached bundle read, nonce generation) so the CSP shape and the inline-script
 * contract are unit-testable without the vscode runtime. The caller supplies the
 * already-resolved cspSource, css URI, nonce, and bundle text.
 *
 * Inlining (not an external `<script src>`) is the load-bearing choice: code-server's
 * webview can silently refuse a nonce-authorised external script, leaving the panel
 * blank, whereas an inline nonce'd script loads reliably - the other editors' shared
 * builder (webview-html.ts) inlines the same way; its header says why this one is separate.
 */

import { inlineWebviewScript } from "../webview-assets";

export interface DialogWebviewHtmlOptions {
    /** `webview.cspSource` - the origin webview-served resources load from. */
    cspSource: string;
    /** `webview.asWebviewUri(main.css)` as a string. */
    cssUri: string;
    /** Fresh per-load CSP nonce. */
    nonce: string;
    /** The webview bundle text, inlined verbatim into the page. */
    scriptBody: string;
}

export function buildDialogWebviewHtml(opts: DialogWebviewHtmlOptions): string {
    const { cspSource, cssUri, nonce, scriptBody } = opts;
    // style-src needs 'unsafe-inline' (not just a nonce) because Svelte Flow positions
    // nodes via runtime inline `transform` styles; a strict nonce-only style policy would
    // block them and nodes would stack at the origin. script-src is nonce + 'wasm-unsafe-eval':
    // the TextMate highlighter's oniguruma engine is WebAssembly, and WebAssembly compilation is
    // gated by script-src, so a nonce alone leaves the fields flat. No connect-src is needed -
    // the wasm arrives as a host message, not a fetch (see webview/dialog-assets.ts).
    //
    // worker-src admits blob: for the graph layout worker. elkjs lays out on the calling thread unless it is
    // constructed with one, which froze the webview for the length of the layout; its worker script is
    // posted by the host and handed to `new Worker` as a blob: URL, since a webview resource URL is a
    // different origin and a Worker must be same-origin. Workers do not fall back to script-src, so without
    // this directive `default-src 'none'` blocks it.
    const csp =
        `default-src 'none'; img-src ${cspSource} data:; font-src ${cspSource}; ` +
        `style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'wasm-unsafe-eval'; ` +
        `worker-src blob:;`;
    const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<link rel="stylesheet" href="${cssUri}" /></head>
<body><div id="app"></div><script nonce="{{nonce}}">/* __SCRIPT__ */</script></body></html>`;
    // Function-replacement inlining (never a plain string) so `$&`/`$$` in the minified
    // bundle are not interpreted as replacement patterns - see inlineWebviewScript.
    return inlineWebviewScript(html, scriptBody, nonce);
}
