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

// VS Code Dark+ fallbacks for every --vscode-* variable styles.css consumes, so the harness renders the
// themed UI faithfully outside the real VS Code webview (which would otherwise inject these at runtime).
const html = `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" />
<style>
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
<body><div id="app"></div><script>${js}</script></body></html>`;

fs.writeFileSync(path.join(here, "app.html"), html);
console.log("wrote app.html (" + (html.length / 1024).toFixed(0) + " kb)");
