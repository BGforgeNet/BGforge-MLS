import { build } from "esbuild";
import esbuildSvelte from "esbuild-svelte";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DARK_THEME_VARS } from "./theme-vars";
import { stubNodeOnlyImports, webTreeSitterLoaders } from "../../../../../scripts/esbuild-web-tree-sitter.mjs";
import { dropThirdPartyWarnings } from "../../../../../scripts/esbuild-svelte-warnings.mjs";

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
    // Embed the tokenizer's assets exactly as the production webview build does
    // (scripts/esbuild-web-tree-sitter.mjs) - so this harness bundles them the same way the shipped webview
    // does, and cannot pass while production's bundling breaks. The tokenizer is now TextMate
    // (vscode-textmate + oniguruma): the .wasm loader embeds onig.wasm as bytes; the grammar JSONs load
    // through esbuild's default json loader. The .scm loader and the web-tree-sitter node stub are retained
    // from the shared helper but no longer exercised here (nothing imports web-tree-sitter).
    loader: webTreeSitterLoaders,
    plugins: [
        esbuildSvelte({ compilerOptions: { dev: true, css: "injected" }, filterWarnings: dropThirdPartyWarnings }),
        stubNodeOnlyImports,
    ],
});
const js = fs.readFileSync(path.join(outdir, "harness-main.js"), "utf8");
fs.rmSync(outdir, { recursive: true, force: true });

// Svelte Flow's base stylesheet (node/edge/handle/viewport rules).
const flowCss = fs.readFileSync(path.join(repo, "client/node_modules/@xyflow/svelte/dist/style.css"), "utf8");

// Mirror the production CSP *shape* (panel.ts / dialog-webview-html.ts): a nonce'd inline
// script and style-src 'unsafe-inline' (Svelte Flow positions nodes via inline transform
// style attributes; elkjs runs inline, no blob: worker). A fixed nonce is fine here - the
// file is static. 'wasm-unsafe-eval' is here because the tokenizer compiles a grammar and the real
// policy will need it; no connect-src, because the harness embeds the wasm rather than fetching it.
//
// This policy is DECORATIVE, and knowing that matters: Chromium does not enforce a <meta>-delivered CSP on
// a file:// page, so the driver's "no CSP violations" check cannot fail on a script-src mistake here (probed
// directly - `eval()` runs despite no 'unsafe-eval', and wasm compiles with 'wasm-unsafe-eval' removed).
// Keep the shape honest anyway, so this file is not read as a statement that the real policy is smaller -
// but the CSP is verified ONLY by driving the live host, never here.
const NONCE = "dlgharnessnonce";
const csp =
    `default-src 'none'; img-src data:; font-src data:; ` +
    `style-src 'unsafe-inline'; script-src 'nonce-${NONCE}' 'wasm-unsafe-eval';`;
// The dialog editor's styles consume --vscode-* theme variables (see theme-vars.ts); the real VS Code
// webview injects these from the active color theme, so the harness needs its own fallback block or
// every themed color renders unset. Dark+ is the baked-in default here (matching the pre-theming
// visual baseline); a driver that wants the light palette overrides it with page.addStyleTag() after
// load - see render-theme-compare.mts.
const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  html,body{margin:0;}
  ${DARK_THEME_VARS}
  body{background:var(--vscode-editor-background);}
  ${flowCss}
</style></head>
<body><div id="app"></div><script nonce="${NONCE}">${js}</script></body></html>`;

fs.writeFileSync(path.join(here, "app.html"), html);
console.log("wrote app.html (" + (html.length / 1024).toFixed(0) + " kb)");
