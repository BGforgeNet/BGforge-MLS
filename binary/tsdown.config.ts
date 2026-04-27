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
    // parser code via a chunk so the tarball avoids duplication.
    minify: false,
    // tsdown/rolldown already injects an ESM-style createRequire/require shim
    // for inlined CJS modules. It does NOT emit __filename / __dirname —
    // any inlined CJS that reads those at evaluation time needs them at the
    // top of the bundle. Using fileURLToPath/dirname is required for
    // cross-platform correctness.
    outputOptions: {
        banner: [
            `import { fileURLToPath as __bgforgeFileURLToPath } from "node:url";`,
            `import { dirname as __bgforgeDirname } from "node:path";`,
            `const __filename = __bgforgeFileURLToPath(import.meta.url);`,
            `const __dirname = __bgforgeDirname(__filename);`,
        ].join("\n"),
    },
});
