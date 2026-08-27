import { defineConfig } from "tsdown";

export default defineConfig({
    entry: ["src/index.ts", "src/cli.ts"],
    format: ["esm"],
    // Only the library entry has an importable contract; the CLI is a bin, not a module.
    dts: { entry: "src/index.ts" },
    clean: true,
    sourcemap: false,
    platform: "node",
    target: "node20",
    outDir: "out",
    // Emit .js rather than tsdown's default .mjs: package.json is type:module and bin/main point at
    // out/cli.js and out/index.js.
    fixedExtension: false,
    // Inlining the one small transitive dependency this bundle picks up (an LRU cache) is intended -
    // it keeps the published tarball self-contained. onlyBundle: false says so; tsdown otherwise hints
    // once per build. The allowlist form is the alternative, and would additionally fail the build on
    // anything new entering the bundle.
    deps: { onlyBundle: false },
});
