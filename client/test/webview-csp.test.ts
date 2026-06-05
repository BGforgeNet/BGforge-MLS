import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { inlineWebviewScript } from "../src/webview-assets";

describe("webview script inlining", () => {
    it("preserves $$ sequences in the inlined script (no String.replace pattern corruption)", () => {
        // Svelte 5 / esbuild output is full of `$$props`, `$$anchor`, etc. A string replacement would treat
        // `$$` as an escaped `$` and collapse them, breaking the script. The helper must use a function replacement.
        const html = '<script nonce="{{nonce}}">/* __SCRIPT__ */</script>';
        const script = "function f($$anchor, $$props) { return $$props.x; } // and a bare $$ pair";
        const out = inlineWebviewScript(html, script, "NONCE-XYZ");
        expect(out).toContain("$$anchor");
        expect(out).toContain("$$props");
        expect(out).not.toContain("/* __SCRIPT__ */");
        expect(out).toContain('nonce="NONCE-XYZ"');
        expect((out.match(/\$\$/g) ?? []).length).toBe((script.match(/\$\$/g) ?? []).length);
    });

    it("inlines the real built binary-editor bundle without corrupting it", () => {
        // Exercise the real producer (the esbuild-svelte bundle), not only a hand-built fixture: a synthetic
        // script understates how many `$$` and which special sequences the real bundle actually carries.
        const built = path.resolve("client/out/binary-editor/webview/main.js");
        if (!fs.existsSync(built)) return; // build artifact absent in lint-only stages
        const html = fs.readFileSync(path.resolve("client/src/binary-editor/webview/index.html"), "utf8");
        const script = fs.readFileSync(built, "utf8");
        const before = (script.match(/\$\$/g) ?? []).length;
        expect(before).toBeGreaterThan(0); // sanity: the real bundle does contain `$$`
        const out = inlineWebviewScript(html, script, "n");
        expect((out.match(/\$\$/g) ?? []).length).toBe(before);
        expect(out).not.toContain("/* __SCRIPT__ */");
    });

    it("binary-editor bundle installs the fatal runtime-error handler", () => {
        // Symmetric to dialogTree-webview-bundle.test.ts: a webview that throws with no error hook leaves a
        // silently blank panel and nothing in the output channel. Guard that the hooks stay wired.
        const built = path.resolve("client/out/binary-editor/webview/main.js");
        if (!fs.existsSync(built)) return; // build artifact absent in lint-only stages
        const out = fs.readFileSync(built, "utf8");
        expect(out).toContain("runtimeError");
        expect(out).toContain("unhandledrejection");
    });
});

describe("webview CSP", () => {
    it("binary editor template uses nonce-based CSP (no unsafe-inline)", () => {
        const html = fs.readFileSync(path.resolve("client/src/binary-editor/webview/index.html"), "utf8");
        expect(html).not.toContain("'unsafe-inline'");
        expect(html).toContain("default-src 'none'");
        expect(html).toContain("style-src 'nonce-{{nonce}}'");
        expect(html).toContain("script-src 'nonce-{{nonce}}'");
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
