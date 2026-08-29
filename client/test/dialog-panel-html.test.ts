/**
 * Production-path guard for the dialog editor's webview HTML construction.
 *
 * The "stuck on Parsing dialog..." debugging saga began with the panel serving the
 * bundle as an EXTERNAL `<script src=...>`, which code-server's webview silently
 * refuses (leaving the panel blank). The fix inlines the bundle, matching the binary
 * editor. These tests pin that contract on the pure HTML builder so a regression to an
 * external script tag fails here in the gating suite, not only in a manual dev:web run.
 */

import { describe, expect, test } from "vitest";
import { buildDialogWebviewHtml } from "../src/dialog-editor/dialog-webview-html";

const CSP_SOURCE = "vscode-webview://abc";
const CSS_URI = "https://file%2B.vscode-resource.vscode-cdn.net/out/main.css";
const NONCE = "TESTNONCE123==";

describe("buildDialogWebviewHtml", () => {
    test("inlines the bundle rather than referencing it as an external <script src>", () => {
        const script = "globalThis.__loaded = true;";
        const html = buildDialogWebviewHtml({
            cspSource: CSP_SOURCE,
            cssUri: CSS_URI,
            nonce: NONCE,
            scriptBody: script,
        });
        // The bundle body is present verbatim, inside a nonce'd inline <script>.
        expect(html).toContain(script);
        // No external script tag: code-server refuses a nonce-authorised external src.
        expect(html).not.toMatch(/<script[^>]*\bsrc=/i);
    });

    test("stamps the nonce on the inline script and leaves no placeholder", () => {
        const html = buildDialogWebviewHtml({ cspSource: CSP_SOURCE, cssUri: CSS_URI, nonce: NONCE, scriptBody: "0;" });
        expect(html).toContain(`<script nonce="${NONCE}">`);
        expect(html).not.toContain("{{nonce}}");
    });

    test("script-src is the nonce plus wasm-unsafe-eval only (no external host, no unsafe-inline)", () => {
        const html = buildDialogWebviewHtml({ cspSource: CSP_SOURCE, cssUri: CSS_URI, nonce: NONCE, scriptBody: "0;" });
        expect(html).toContain(`script-src 'nonce-${NONCE}'`);
        const scriptSrc = /script-src ([^;]*);/.exec(html)?.[1] ?? "";
        // The BAF tokenizer compiles a tree-sitter grammar; WebAssembly.compile is gated by script-src, so
        // without 'wasm-unsafe-eval' every condition/action field renders flat. It is NOT 'unsafe-eval':
        // wasm compilation has its own narrower directive, and plain eval() stays forbidden.
        expect(scriptSrc).toContain("'wasm-unsafe-eval'");
        expect(scriptSrc).not.toContain("'unsafe-eval'"); // the broad one; wasm-unsafe-eval is the narrow grant
        expect(scriptSrc).not.toContain("unsafe-inline");
        expect(scriptSrc).not.toContain(CSP_SOURCE);
    });

    test("adds no connect-src: the tokenizer wasm is embedded in the bundle, never fetched", () => {
        // Embedding rather than fetching is what keeps default-src 'none' intact for network. A regression to
        // fetching the wasm via asWebviewUri would need connect-src back; assert it stays absent so that
        // change cannot land silently.
        const html = buildDialogWebviewHtml({ cspSource: CSP_SOURCE, cssUri: CSS_URI, nonce: NONCE, scriptBody: "0;" });
        expect(html).not.toContain("connect-src");
    });

    test("allows style-src from the webview source plus unsafe-inline (Svelte Flow inline transforms)", () => {
        const html = buildDialogWebviewHtml({ cspSource: CSP_SOURCE, cssUri: CSS_URI, nonce: NONCE, scriptBody: "0;" });
        const styleSrc = /style-src ([^;]*);/.exec(html)?.[1] ?? "";
        expect(styleSrc).toContain(CSP_SOURCE);
        expect(styleSrc).toContain("'unsafe-inline'");
        expect(html).toContain("default-src 'none'");
    });

    test("allows a blob-backed worker, which is where the graph layout runs", () => {
        // elkjs lays out on the calling thread unless it is given a worker, and a dialog of a few hundred
        // states is a multi-hundred-millisecond freeze of the webview. The worker script is embedded in the
        // bundle and handed to `new Worker` as a blob: URL, so `worker-src` must admit blob:. `default-src
        // 'none'` does NOT fall back to script-src for workers - without this directive the Worker is blocked.
        const html = buildDialogWebviewHtml({ cspSource: CSP_SOURCE, cssUri: CSS_URI, nonce: NONCE, scriptBody: "0;" });
        const workerSrc = /worker-src ([^;]*);/.exec(html)?.[1] ?? "";
        expect(workerSrc).toContain("blob:");
    });

    test("links the stylesheet via the passed webview URI", () => {
        const html = buildDialogWebviewHtml({ cspSource: CSP_SOURCE, cssUri: CSS_URI, nonce: NONCE, scriptBody: "0;" });
        expect(html).toContain(`<link rel="stylesheet" href="${CSS_URI}" />`);
    });

    test("inlines a bundle containing $& verbatim (the replace-pattern regression)", () => {
        // The minified Svelte bundle contains `$&`; a plain string replace would expand it
        // to the matched placeholder and corrupt the script. The builder must inline verbatim.
        const script = "const re = s.replace(/x/, '$&!');";
        const html = buildDialogWebviewHtml({
            cspSource: CSP_SOURCE,
            cssUri: CSS_URI,
            nonce: NONCE,
            scriptBody: script,
        });
        expect(html).toContain(script);
    });
});
