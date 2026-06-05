import { build } from "esbuild";
import esbuildSvelte from "esbuild-svelte";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");

// Bundle UI only (App.svelte + Bridge + components). No @bgforge value imports here - those are type-only (erased),
// so no Node builtins reach the browser bundle. The core runs in Node via render.mts.
// esbuild-svelte default css: "external" emits component <style> blocks (e.g. bits-ui's Viewport) to a
// separate .css file that we deliberately do not load - mirroring the production webview, which also never
// loads that file. External-css mode requires an on-disk output path, so we write to a temp dir.
const outdir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-harness-"));
await build({
    entryPoints: [path.join(here, "harness-main.ts")],
    bundle: true,
    format: "iife",
    write: true,
    outdir,
    logLevel: "info",
    plugins: [esbuildSvelte({ compilerOptions: { dev: true } })],
});
const js = fs.readFileSync(path.join(outdir, "harness-main.js"), "utf8");
fs.rmSync(outdir, { recursive: true, force: true });

const css = fs.readFileSync(path.join(repo, "client/src/binary-editor/webview/styles.css"), "utf8");

// Strict nonce CSP mirrors the real binary-editor webview (provider.ts). font-src is omitted (none)
// because the harness does not load the codicon font. The same nonce is applied to both the inlined
// <style> and the inlined <script> so Chromium enforces the policy identically to the real webview.
const nonce = crypto.randomBytes(16).toString("base64");

// VS Code Dark+ fallbacks for every --vscode-* variable styles.css consumes, so the harness renders the
// themed UI faithfully outside the real VS Code webview (which would otherwise inject these at runtime).
const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; font-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
<style nonce="${nonce}">
:root {
    --vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Ubuntu", "Droid Sans", sans-serif;
    --vscode-font-size: 13px;
    --vscode-editor-font-family: "Droid Sans Mono", "monospace", monospace;
    --vscode-foreground: #cccccc;
    --vscode-editor-background: #1e1e1e;
    --vscode-editor-foreground: #d4d4d4;
    --vscode-descriptionForeground: #9d9d9d;
    --vscode-errorForeground: #f48771;
    --vscode-panel-border: #2b2b2b;
    --vscode-focusBorder: #007fd4;
    --vscode-textLink-foreground: #3794ff;
    --vscode-button-background: #0e639c;
    --vscode-button-foreground: #ffffff;
    --vscode-button-hoverBackground: #1177bb;
    --vscode-button-border: transparent;
    --vscode-button-secondaryBackground: #3a3d41;
    --vscode-button-secondaryForeground: #ffffff;
    --vscode-button-secondaryHoverBackground: #45494e;
    --vscode-input-background: #3c3c3c;
    --vscode-input-foreground: #cccccc;
    --vscode-input-border: #3c3c3c;
    --vscode-input-placeholderForeground: #a6a6a6;
    --vscode-checkbox-background: #3c3c3c;
    --vscode-checkbox-foreground: #cccccc;
    --vscode-checkbox-border: #6b6b6b;
    --vscode-list-hoverBackground: #2a2d2e;
    --vscode-list-activeSelectionBackground: #094771;
    --vscode-list-activeSelectionForeground: #ffffff;
    --vscode-editorWarning-foreground: #cca700;
    --vscode-inputValidation-warningBackground: #352a05;
    --vscode-inputValidation-warningForeground: #cccccc;
    --vscode-inputValidation-warningBorder: #cca700;
}
${css}
</style></head>
<body><div id="app"></div><script nonce="${nonce}">${js}</script></body></html>`;

fs.writeFileSync(path.join(here, "app.html"), html);
console.log("wrote app.html (" + (html.length / 1024).toFixed(0) + " kb)");
