import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

describe("webview CSP", () => {
    it("binary editor template uses nonce-based CSP (no unsafe-inline)", () => {
        const html = fs.readFileSync(path.resolve("client/src/editors/binaryEditor.html"), "utf8");
        expect(html).not.toContain("'unsafe-inline'");
        expect(html).toContain("default-src 'none'");
        expect(html).toContain("style-src 'nonce-{{nonce}}'");
        expect(html).toContain("script-src 'nonce-{{nonce}}'");
        expect(html).toContain('<style nonce="{{nonce}}">');
        expect(html).toContain('<script nonce="{{nonce}}">');
    });

    it("dialog tree template declares a nonce-based CSP", () => {
        const html = fs.readFileSync(path.resolve("client/src/dialog-tree/dialogTree.html"), "utf8");
        expect(html).not.toContain("'unsafe-inline'");
        expect(html).toContain('http-equiv="Content-Security-Policy"');
        expect(html).toContain("default-src 'none'");
        expect(html).toContain("'nonce-{{nonce}}'");
        expect(html).toContain("{{cspSource}}");
    });
});
