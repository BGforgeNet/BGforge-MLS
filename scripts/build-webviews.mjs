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
    ],
    outdir: "client/out",
    bundle: true,
    format: "iife",
    sourcemap: dev,
    minify,
    logLevel: "info",
    // The dialog webview embeds the oniguruma wasm its TextMate highlighter loads (see
    // webview/highlight/textmate.ts) through the .wasm-as-bytes loader. The .scm loader and the Node-import
    // stub are inert for every current entry - the tree-sitter tokenizer they served was retired - and stay
    // only because the helper is shared with the dialog render harness's build. The binary-editor and
    // image-editor entries import none of these, so all of it is a no-op for them.
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
        // The dialog webview lays its graph out in a Worker built from this embedded source; the binary and
        // image entries import nothing from it, so the plugin never fires for them.
        elkWorkerAsText,
    ],
});
