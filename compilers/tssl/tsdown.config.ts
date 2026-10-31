import { defineConfig } from "tsdown";

export default defineConfig({
    entry: ["src/index.ts", "src/internal.ts", "src/cli.ts"],
    format: ["esm"],
    // Only the library entry has an importable contract; the CLI is a bin, not a module. internal.ts ships no
    // .d.ts: it returns the SSL compiler's IR, and inlining those declarations from its source fails the build.
    dts: { entry: "src/index.ts" },
    // Package lint (publint, are-the-types-wrong) runs only under CI, where the publish path is exercised.
    publint: "ci-only",
    attw: "ci-only",
    clean: true,
    sourcemap: false,
    platform: "node",
    target: "node22",
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
