import { defineConfig } from "tsdown";

export default defineConfig({
    entry: ["src/index.ts", "src/cli.ts"],
    format: ["esm"],
    // Only the library entry's .d.ts is part of the published contract; the CLI
    // is a bin, not an imported module.
    dts: { entry: "src/index.ts" },
    clean: true,
    sourcemap: false,
    platform: "node",
    target: "node20",
    outDir: "out",
    // Emit .js (not .mjs): package.json is type:module, and bin/exports point at
    // out/cli.js / out/index.js. fixedExtension defaults to true on node, forcing
    // .mjs - turn it off so the extension follows the package type.
    fixedExtension: false,
    // Copy the 5 tree-sitter WASM files next to out/cli.js so the CLI can load
    // them via __dirname at runtime (shared helper keeps the list in one place).
    onSuccess: "bash ../scripts/build-format-postbuild.sh",
    // Re-create CJS globals so any inlined CJS resolves in the ESM bundle, and so
    // parser-factory.ts can resolve the WASM via __dirname.
    banner: {
        js: [
            `import { createRequire } from "module";`,
            `const require = createRequire(import.meta.url);`,
            `const __filename = require("url").fileURLToPath(import.meta.url);`,
            `const __dirname = require("path").dirname(__filename);`,
        ].join("\n"),
    },
});
