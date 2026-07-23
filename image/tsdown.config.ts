import { defineConfig } from "tsdown";

export default defineConfig({
    // Two entries: the full barrel (Node-only codecs included) and a pure, browser-safe subpath for the
    // frame-anchor helpers. The webview renderer imports the subpath so it never pulls the barrel's
    // Buffer/zlib-using png/bamc modules into a browser bundle (which throws "Buffer is not defined" on load).
    entry: ["src/index.ts", "src/model/frame-anchor.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: false,
    platform: "node",
    target: "node20",
    outDir: "out",
    fixedExtension: false,
});
