import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: false,
    target: "node20",
    outDir: "out",
    splitting: false,
    minify: false,
    // esbuild-wasm detects at runtime whether it has been bundled by checking that
    // __filename/path.basename(__dirname) equal "main.js"/"lib" respectively.
    // Bundling it breaks this check and throws an error on first use. It must remain
    // external so the package resolves from node_modules with its real filesystem path.
    // It is therefore listed as a runtime dependency in package.json.
    external: ["esbuild-wasm"],
    // ts-morph bundles typescript.js, which is CJS-only. typescript.js calls
    // require(), __filename, and __dirname at module-evaluation time. The banner
    // re-creates these CJS globals at the top of the ESM bundle so the inlined
    // code resolves correctly. Using fileURLToPath/dirname (vs URL.pathname) is
    // required for cross-platform correctness — URL.pathname produces malformed
    // paths on Windows (leading slash, forward separators).
    banner: {
        js: [
            `import { createRequire } from "module";`,
            `const require = createRequire(import.meta.url);`,
            `const __filename = require("url").fileURLToPath(import.meta.url);`,
            `const __dirname = require("path").dirname(__filename);`,
        ].join("\n"),
    },
});
