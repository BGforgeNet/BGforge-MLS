import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { inlineWebviewStyles } from "../../../src/webview-assets";

describe("binary-editor styles injection", () => {
    it("inlines the stylesheet at the {{styles}} placeholder", () => {
        const html = '<style nonce="{{nonce}}">{{styles}}</style>';
        const out = inlineWebviewStyles(html, ".field{color:red}");
        expect(out).toContain(".field{color:red}");
        expect(out).not.toContain("{{styles}}");
    });
    it("index.html declares a {{styles}} placeholder, no literal rules", () => {
        const html = fs.readFileSync(path.resolve("client/src/binary-editor/webview/index.html"), "utf8");
        expect(html).toContain("{{styles}}");
        expect(html).not.toMatch(/\.field\s*\{/); // CSS lives in styles.css now
    });
    it("styles.css is themed with vscode variables", () => {
        const css = fs.readFileSync(path.resolve("client/src/binary-editor/webview/styles.css"), "utf8");
        expect(css).toContain("var(--vscode-");
    });
});
