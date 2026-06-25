import { build } from "esbuild";
import esbuildSvelte from "esbuild-svelte";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../../..");

// Bundle the dialog graph webview. css: "injected" so component <style> blocks
// reach the page (the harness uses a permissive style CSP, unlike the production
// webview - Svelte Flow positions nodes via inline transform styles, which the
// strict nonce CSP would block; wiring Svelte Flow under the real webview CSP is
// a Phase-3 integration item).
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
const flowCss = fs.readFileSync(
    path.join(repo, "client/node_modules/@xyflow/svelte/dist/style.css"),
    "utf8",
);

const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" />
<style>
  html,body{margin:0;background:#191c21;}
  ${flowCss}
</style></head>
<body><div id="app"></div><script>${js}</script></body></html>`;

fs.writeFileSync(path.join(here, "app.html"), html);
console.log("wrote app.html (" + (html.length / 1024).toFixed(0) + " kb)");
