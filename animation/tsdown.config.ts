import { defineConfig } from "tsdown";

export default defineConfig({
    // The barrel plus the two pure label tables as their own entries. Both webviews need the labels, and
    // the barrel reaches @bgforge/image's Node-only codecs through the stance reader - so a browser bundle
    // importing the barrel for them fails to build on "zlib", or at load on "Buffer is not defined".
    entry: ["src/index.ts", "src/group-labels.ts", "src/facet-labels.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: false,
    platform: "node",
    target: "node20",
    outDir: "out",
    fixedExtension: false,
});
