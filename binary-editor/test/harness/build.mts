import { build } from "esbuild";
import esbuildSvelte from "esbuild-svelte";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_VARS } from "./theme-vars";
import { dropThirdPartyWarnings } from "../../../scripts/esbuild-svelte-warnings.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");

// Inline the codicon font (the X / arrow / warning / info glyphs) so the harness renders icon-only buttons the
// same as the real webview. The real editor links codicon.css + codicon.ttf via asWebviewUri under
// localResourceRoots; the harness has no file server, so the font is embedded as a data: URI (and the CSP below
// allows font-src data:). Without this, icon buttons render blank and screenshot reviews misread them as missing.
// Shared by both bundles below (binary-editor and animation-editor both use codicon buttons).
const codiconsDir = path.join(repo, "node_modules/@vscode/codicons/dist");
const codiconTtf = fs.readFileSync(path.join(codiconsDir, "codicon.ttf")).toString("base64");
const codiconCss = fs
    .readFileSync(path.join(codiconsDir, "codicon.css"), "utf8")
    .replace(
        /src:\s*url\("[^"]*"\)\s*format\("truetype"\)/,
        `src: url("data:font/ttf;base64,${codiconTtf}") format("truetype")`,
    );

/**
 * Bundles one harness entry (UI only: the App component + Bridge + components. No @bgforge value imports
 * reach the browser bundle - those are type-only and erased - so no Node builtins leak in; each editor's
 * core runs in Node, in the driver files) and writes the CSP-wrapped standalone HTML the drivers `page.goto()`.
 */
async function buildHarnessHtml(entryFile: string, cssFile: string, outFile: string): Promise<void> {
    // esbuild-svelte default css: "external" emits component <style> blocks (e.g. bits-ui's Viewport) to a
    // separate .css file that we deliberately do not load - mirroring the production webview, which also never
    // loads that file. External-css mode requires an on-disk output path, so we write to a temp dir.
    const outdir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-harness-"));
    const entryName = path.basename(entryFile, path.extname(entryFile));
    await build({
        entryPoints: [path.join(here, entryFile)],
        bundle: true,
        format: "iife",
        write: true,
        outdir,
        logLevel: "info",
        plugins: [esbuildSvelte({ compilerOptions: { dev: true }, filterWarnings: dropThirdPartyWarnings })],
    });
    const js = fs.readFileSync(path.join(outdir, `${entryName}.js`), "utf8");
    fs.rmSync(outdir, { recursive: true, force: true });

    const css = fs.readFileSync(path.join(repo, cssFile), "utf8");

    // Strict nonce CSP mirrors the real webview (provider.ts). font-src allows data: so the inlined codicon
    // @font-face (data: URI above) loads; the same nonce is applied to both the inlined <style> and the
    // inlined <script> so Chromium enforces the policy identically to the real webview. `img-src data:`
    // matches index.html exactly, and matching MATTERS in this direction: a laxer harness policy would render
    // thumbnails that the real panel's CSP silently blocks.
    const nonce = crypto.randomBytes(16).toString("base64");

    // VS Code Dark+ fallbacks for every --vscode-* variable styles.css consumes, so the harness renders the
    // themed UI faithfully outside the real VS Code webview (which would otherwise inject these at runtime).
    const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; font-src data:; img-src data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
<style nonce="${nonce}">
${THEME_VARS}${codiconCss}${css}
</style></head>
<body><div id="app"></div><script nonce="${nonce}">${js}</script></body></html>`;

    fs.writeFileSync(path.join(here, outFile), html);
    console.log(`wrote ${outFile} (${(html.length / 1024).toFixed(0)} kb)`);
}

await buildHarnessHtml("harness-main.ts", "client/src/binary-editor/webview/styles.css", "app.html");
await buildHarnessHtml("image-harness-main.ts", "client/src/image-editor/webview/styles.css", "image-app.html");
