import { build } from "esbuild";
import esbuildSvelte from "esbuild-svelte";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DARK_THEME_VARS } from "./theme-vars";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../../..");

// web-tree-sitter's Emscripten glue carries a Node-only branch - `await import("fs/promises")` to read a
// grammar from a path, `await import("module")` for createRequire - behind a `globalThis.process?.versions
// .node` guard. A browser never enters it, and the tokenizer hands Language.load BYTES rather than a path
// anyway, so the code is dead here; esbuild still has to resolve the specifiers to bundle, so stub them.
// Switching to platform:"node" would silence the same error by asserting a target this is not.
const stubNodeOnlyImports = {
    name: "stub-node-only-imports",
    setup(build: { onResolve: Function; onLoad: Function }) {
        build.onResolve({ filter: /^(fs\/promises|module)$/ }, (args: { path: string }) => ({
            path: args.path,
            namespace: "node-stub",
        }));
        build.onLoad({ filter: /.*/, namespace: "node-stub" }, () => ({ contents: "export default {};" }));
    },
};

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
    // The BAF tokenizer's grammar/runtime wasm and its highlight query are embedded in the bundle (see
    // harness-main.ts): with no host there is no asWebviewUri to fetch them from, and the harness page is a
    // single file loaded over file://, where a fetch would be blocked anyway.
    loader: { ".wasm": "binary", ".scm": "text" },
    plugins: [esbuildSvelte({ compilerOptions: { dev: true, css: "injected" } }), stubNodeOnlyImports],
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
