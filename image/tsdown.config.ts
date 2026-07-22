import { defineConfig } from "tsdown";

export default defineConfig({
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: false,
    platform: "node",
    target: "node20",
    outDir: "out",
    fixedExtension: false,
});
