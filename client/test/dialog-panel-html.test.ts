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

    test("locks script-src to the nonce only (no external host, no unsafe-inline)", () => {
        const html = buildDialogWebviewHtml({ cspSource: CSP_SOURCE, cssUri: CSS_URI, nonce: NONCE, scriptBody: "0;" });
        expect(html).toContain(`script-src 'nonce-${NONCE}'`);
        const scriptSrc = /script-src ([^;]*);/.exec(html)?.[1] ?? "";
        expect(scriptSrc).not.toContain("unsafe-inline");
        expect(scriptSrc).not.toContain(CSP_SOURCE);
    });

    test("allows style-src from the webview source plus unsafe-inline (Svelte Flow inline transforms)", () => {
        const html = buildDialogWebviewHtml({ cspSource: CSP_SOURCE, cssUri: CSS_URI, nonce: NONCE, scriptBody: "0;" });
        const styleSrc = /style-src ([^;]*);/.exec(html)?.[1] ?? "";
        expect(styleSrc).toContain(CSP_SOURCE);
        expect(styleSrc).toContain("'unsafe-inline'");
        expect(html).toContain("default-src 'none'");
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
