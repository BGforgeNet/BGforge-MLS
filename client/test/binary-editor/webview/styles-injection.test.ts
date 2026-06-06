import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

describe("binary-editor styles loading", () => {
    it("index.html links styles.css via an asWebviewUri <link>, no inline rules", () => {
        const html = fs.readFileSync(path.resolve("client/src/binary-editor/webview/index.html"), "utf8");
        // Styles load as a cspSource-authorised <link> (placeholder filled by the provider with
        // webview.asWebviewUri), never inlined: VS Code's webview layer drops nonce-only inline
        // stylesheets, leaving the panel unstyled. The CSP shape is guarded in webview-csp.test.ts.
        expect(html).toContain("{{stylesUri}}");
        expect(html).toContain('rel="stylesheet"');
        expect(html).not.toContain("<style");
        expect(html).not.toMatch(/\.field\s*\{/); // CSS lives in styles.css, not inlined here
    });
    it("styles.css is themed with vscode variables", () => {
        const css = fs.readFileSync(path.resolve("client/src/binary-editor/webview/styles.css"), "utf8");
        expect(css).toContain("var(--vscode-");
    });
    it("theme covers the core vscode surfaces", () => {
        const css = fs.readFileSync(path.resolve("client/src/binary-editor/webview/styles.css"), "utf8");
        for (const v of [
            "--vscode-foreground",
            "--vscode-input-background",
            "--vscode-input-border",
            "--vscode-focusBorder",
            "--vscode-button-background",
            "--vscode-list-hoverBackground",
            "--vscode-list-activeSelectionBackground",
            "--vscode-errorForeground",
            "--vscode-font-family",
        ])
            expect(css).toContain(v);
    });
});
