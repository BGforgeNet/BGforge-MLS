import { defineConfig } from "tsup";

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
    // splitting: true shares heavy formatter + helper code between index.js and
    // cli.js via a shared chunk, avoiding duplication in the tarball.
    splitting: true,
    minify: false,
    // No external entries: unlike transpilers (which externalises esbuild-wasm),
    // the format package's WASM files are loaded via __dirname at runtime inside
    // parser-factory.ts (Phase 5). The banner below re-creates the CJS globals
    // so any inlined CJS code resolves correctly in the ESM bundle.
    // ts-morph / esbuild-wasm are NOT a dependency here, so no external[] needed.
    banner: {
        js: [
            `import { createRequire } from "module";`,
            `const require = createRequire(import.meta.url);`,
            `const __filename = require("url").fileURLToPath(import.meta.url);`,
            `const __dirname = require("path").dirname(__filename);`,
        ].join("\n"),
    },
});
