import { build } from "esbuild";
import esbuildSvelte from "esbuild-svelte";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_VARS } from "./theme-vars";

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
${THEME_VARS}${css}
</style></head>
<body><div id="app"></div><script nonce="${nonce}">${js}</script></body></html>`;

fs.writeFileSync(path.join(here, "app.html"), html);
console.log("wrote app.html (" + (html.length / 1024).toFixed(0) + " kb)");
