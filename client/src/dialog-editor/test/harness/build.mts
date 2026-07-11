import { build } from "esbuild";
import esbuildSvelte from "esbuild-svelte";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../../..");

// Bundle the production root App.svelte. css: "injected" so component <style> blocks
// reach the page as inline <style> elements (allowed by style-src 'unsafe-inline').
const outdir = fs.mkdtempSync(path.join(os.tmpdir(), "dlg-harness-"));
await build({
    entryPoints: [path.join(here, "harness-main.ts")],
    bundle: true,
    format: "iife",
    write: true,
    outdir,
    logLevel: "info",
    plugins: [esbuildSvelte({ compilerOptions: { dev: true, css: "injected" } })],
});
const js = fs.readFileSync(path.join(outdir, "harness-main.js"), "utf8");
fs.rmSync(outdir, { recursive: true, force: true });

// Svelte Flow's base stylesheet (node/edge/handle/viewport rules).
const flowCss = fs.readFileSync(path.join(repo, "client/node_modules/@xyflow/svelte/dist/style.css"), "utf8");

// Mirror the production CSP *shape* (panel.ts / dialog-webview-html.ts): a nonce'd inline
// script and style-src 'unsafe-inline' (Svelte Flow positions nodes via inline transform
// style attributes; elkjs runs inline, no blob: worker). A fixed nonce is fine here - the
// file is static and the gate only checks that this policy shape renders without violations.
const NONCE = "dlgharnessnonce";
const csp =
    `default-src 'none'; img-src data:; font-src data:; ` + `style-src 'unsafe-inline'; script-src 'nonce-${NONCE}';`;
const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  html,body{margin:0;background:#191c21;}
  ${flowCss}
</style></head>
<body><div id="app"></div><script nonce="${NONCE}">${js}</script></body></html>`;

fs.writeFileSync(path.join(here, "app.html"), html);
console.log("wrote app.html (" + (html.length / 1024).toFixed(0) + " kb)");
