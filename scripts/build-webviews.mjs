import { build } from "esbuild";
import esbuildSvelte from "esbuild-svelte";

const dev = process.argv.includes("--sourcemap");
const minify = process.argv.includes("--minify");

await build({
    entryPoints: ["./client/src/dialog-tree/dialogTree-webview.ts", "./client/src/binary-editor/webview/main.ts"],
    outdir: "client/out",
    bundle: true,
    format: "iife",
    sourcemap: dev,
    minify,
    logLevel: "info",
    plugins: [esbuildSvelte({ compilerOptions: { dev } })],
});
