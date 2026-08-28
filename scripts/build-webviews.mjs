import { build } from "esbuild";
import esbuildSvelte from "esbuild-svelte";
import { stubNodeOnlyImports, webTreeSitterLoaders } from "./esbuild-web-tree-sitter.mjs";
import { dropThirdPartyWarnings } from "./esbuild-svelte-warnings.mjs";

const dev = process.argv.includes("--sourcemap");
const minify = process.argv.includes("--minify");

await build({
    entryPoints: [
        "./client/src/binary-editor/webview/main.ts",
        "./client/src/dialog-editor/webview/main.ts",
        "./client/src/image-editor/webview/main.ts",
    ],
    outdir: "client/out",
    bundle: true,
    format: "iife",
    sourcemap: dev,
    minify,
    logLevel: "info",
    // The dialog webview embeds the BAF tokenizer's grammar/runtime wasm and highlight query (see
    // webview/main.ts): .wasm as bytes, .scm as text. Bundling web-tree-sitter for the browser also needs
    // its Node-only imports stubbed. Both are shared with the dialog render harness's build so the two do
    // not drift. The binary-editor entry imports none of these, so both are no-ops for it.
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
    ],
});
