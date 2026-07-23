import { defineConfig } from "tsdown";

export default defineConfig({
    // The full barrel (Node-only codecs included) plus pure, browser-safe subpaths for the frame-anchor
    // and IE-direction helpers. The webview renderer imports the subpaths so it never pulls the barrel's
    // Buffer/zlib-using png/bamc modules into a browser bundle (which throws "Buffer is not defined" on load).
    entry: ["src/index.ts", "src/model/frame-anchor.ts", "src/model/ie-direction.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: false,
    platform: "node",
    target: "node20",
    outDir: "out",
    fixedExtension: false,
});
