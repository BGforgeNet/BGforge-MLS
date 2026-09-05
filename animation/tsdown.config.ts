import { defineConfig } from "tsdown";

export default defineConfig({
    // The barrel plus the pure group-label table as its own entry. The animation editor's webview needs
    // the labels, and the barrel reaches @bgforge/image's Node-only codecs through the stance reader - so
    // a browser bundle importing the barrel for them would fail on load with "Buffer is not defined".
    entry: ["src/index.ts", "src/group-labels.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: false,
    platform: "node",
    target: "node20",
    outDir: "out",
    fixedExtension: false,
});
