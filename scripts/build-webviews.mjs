import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";
import esbuildSvelte from "esbuild-svelte";
import { stubNodeOnlyImports, webTreeSitterLoaders } from "./esbuild-web-tree-sitter.mjs";
import { elkWorkerAsText } from "./esbuild-elk-worker.mjs";
import { dropThirdPartyWarnings } from "./esbuild-svelte-warnings.mjs";

const dev = process.argv.includes("--sourcemap");
const minify = process.argv.includes("--minify");

await build({
    entryPoints: [
        "./client/src/binary-editor/webview/main.ts",
        "./client/src/dialog-editor/webview/main.ts",
        "./client/src/image-editor/webview/main.ts",
        "./client/src/gallery/webview/main.ts",
    ],
    outdir: "client/out",
    bundle: true,
    format: "iife",
    sourcemap: dev,
    minify,
    logLevel: "info",
    // Inert for every current entry: the dialog webview's oniguruma wasm is copied beside the bundle below,
    // not embedded, and the .scm loader and the Node-import stub served the retired tree-sitter tokenizer. They
    // stay because the helper is shared with the dialog render harness's build, which still embeds the wasm.
    loader: webTreeSitterLoaders,
    // Keep esbuild-svelte in its default css: "external" mode. Component <style> blocks (e.g. bits-ui's
    // Select.Viewport in the binary editor) are then emitted to a separate .css file the webview never loads,
    // never injected at runtime. Switching to css: "injected" would inject those <style> tags without a
    // nonce, which the strict webview CSP (style-src 'nonce-...') refuses. The render-primitives.mts harness
    // gates this but is e2e-tier (not in CI), so this is the in-build warning.
    plugins: [
        esbuildSvelte({
            compilerOptions: { dev },
            filterWarnings: dropThirdPartyWarnings,
        }),
        stubNodeOnlyImports,
        // Redirects layout.ts's elkjs import to the API-only entry (the layout engine runs in the worker below).
        elkWorkerAsText,
    ],
});

// The dialog webview's two large payloads, which the host posts to it after "ready" rather than the bundle
// embedding them (client/src/dialog-editor/webview/dialog-assets.ts says why). Names mirror
// client/src/dialog-editor/dialog-asset-files.ts, pinned by client/test/dialog-webview-bundle.test.ts.
const fromClient = createRequire(new URL("../client/package.json", import.meta.url));
await mkdir("client/out/dialog-editor/webview", { recursive: true });
await copyFile(fromClient.resolve("elkjs/lib/elk-worker.min.js"), "client/out/dialog-editor/webview/elk-worker.js");
await copyFile(fromClient.resolve("vscode-oniguruma/release/onig.wasm"), "client/out/dialog-editor/webview/onig.wasm");
