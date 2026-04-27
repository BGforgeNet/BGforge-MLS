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
    // formatter + helper code via a chunk so the tarball avoids duplication.
    minify: false,
    // The format package's WASM files are loaded via __dirname at runtime
    // inside parser-factory.ts. tsdown/rolldown injects createRequire for
    // inlined CJS modules, but does not emit __filename / __dirname; emit
    // those at the top of the bundle so the runtime path lookup works.
    // Using fileURLToPath/dirname is required for cross-platform correctness.
    outputOptions: {
        banner: [
            `import { fileURLToPath as __bgforgeFileURLToPath } from "node:url";`,
            `import { dirname as __bgforgeDirname } from "node:path";`,
            `const __filename = __bgforgeFileURLToPath(import.meta.url);`,
            `const __dirname = __bgforgeDirname(__filename);`,
        ].join("\n"),
    },
});
