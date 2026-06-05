import { build } from "esbuild";
import esbuildSvelte from "esbuild-svelte";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");

// Bundle UI only (App.svelte + Bridge + components). No @bgforge value imports here - those are type-only (erased),
// so no Node builtins reach the browser bundle. The core runs in Node via render.mts.
const result = await build({
    entryPoints: [path.join(here, "harness-main.ts")],
    bundle: true,
    format: "iife",
    write: false,
    logLevel: "info",
    plugins: [esbuildSvelte({ compilerOptions: { dev: true } })],
});
const js = result.outputFiles[0].text;

const css = fs.readFileSync(path.join(repo, "client/src/binary-editor/webview/styles.css"), "utf8");

const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" />
<style>
:root { --vscode-list-activeSelectionBackground: #094771; }
body { margin: 0; background: #1e1e1e; color: #d4d4d4; font: 13px/1.4 system-ui, sans-serif; }
button { background: #3a3d41; color: #d4d4d4; border: 1px solid #555; border-radius: 2px; cursor: pointer; }
button:disabled { opacity: 0.4; cursor: default; }
input { background: #3c3c3c; color: #d4d4d4; border: 1px solid #555; }
.tabs button { padding: 0.15rem 0.6rem; }
${css}
</style></head>
<body><div id="app"></div><script>${js}</script></body></html>`;

fs.writeFileSync(path.join(here, "app.html"), html);
console.log("wrote app.html (" + (html.length / 1024).toFixed(0) + " kb)");
