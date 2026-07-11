import { build } from "esbuild";
import esbuildSvelte from "esbuild-svelte";

const dev = process.argv.includes("--sourcemap");
const minify = process.argv.includes("--minify");

await build({
    entryPoints: ["./client/src/binary-editor/webview/main.ts", "./client/src/dialog-editor/webview/main.ts"],
    outdir: "client/out",
    bundle: true,
    format: "iife",
    sourcemap: dev,
    minify,
    logLevel: "info",
    // Keep esbuild-svelte in its default css: "external" mode. Component <style> blocks (e.g. bits-ui's
    // Select.Viewport in the binary editor) are then emitted to a separate .css file the webview never loads,
    // never injected at runtime. Switching to css: "injected" would inject those <style> tags without a
    // nonce, which the strict webview CSP (style-src 'nonce-...') refuses. The render-primitives.mts harness
    // gates this but is e2e-tier (not in CI), so this is the in-build warning.
    plugins: [esbuildSvelte({ compilerOptions: { dev } })],
});
