import { defineConfig } from "tsdown";

export default defineConfig({
    entry: ["src/index.ts", "src/cli.ts"],
    format: ["esm"],
    // Only the library entry gets DTS. The CLI is a bin script, not a module
    // consumers import — emitting .d.ts for it would be misleading.
    dts: { entry: "src/index.ts" },
    clean: true,
    sourcemap: false,
    target: "node20",
    outDir: "out",
    // Emit .js (not .mjs); the package is "type": "module" so .js IS ESM,
    // and the published bin path / npm exports map both reference cli.js / index.js.
    fixedExtension: false,
    // Rolldown enables code-splitting by default — index.js and cli.js share
    // the heavy ts-morph + transpiler code via a chunk so the tarball avoids
    // a ~12 MB duplication.
    minify: false,
    // esbuild-wasm detects at runtime whether it has been bundled by checking that
    // __filename/path.basename(__dirname) equal "main.js"/"lib" respectively.
    // Bundling it breaks this check and throws an error on first use. It must remain
    // external so the package resolves from node_modules with its real filesystem path.
    // It is therefore listed as a runtime dependency in package.json.
    deps: {
        neverBundle: ["esbuild-wasm"],
    },
    // ts-morph bundles typescript.js, which is CJS-only. typescript.js reads
    // __filename and __dirname at module-evaluation time. tsdown/rolldown
    // already injects an ESM-style createRequire/require shim for inlined
    // CJS, but it does NOT define __filename / __dirname — emit those at the
    // top of the bundle so the inlined code resolves correctly.
    // Using fileURLToPath/dirname (vs URL.pathname) is required for
    // cross-platform correctness — URL.pathname produces malformed paths on
    // Windows (leading slash, forward separators).
    outputOptions: {
        banner: [
            `import { fileURLToPath as __bgforgeFileURLToPath } from "node:url";`,
            `import { dirname as __bgforgeDirname } from "node:path";`,
            `const __filename = __bgforgeFileURLToPath(import.meta.url);`,
            `const __dirname = __bgforgeDirname(__filename);`,
        ].join("\n"),
    },
});
