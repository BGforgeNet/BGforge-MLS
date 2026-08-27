import { defineConfig } from "tsdown";

export default defineConfig({
    entry: ["src/index.ts", "src/archive/index.ts", "src/cli.ts"],
    format: ["esm"],
    // Both library entries ship .d.ts; the CLI is a bin, not an imported module.
    dts: { entry: ["src/index.ts", "src/archive/index.ts"] },
    clean: true,
    sourcemap: false,
    platform: "node",
    target: "node20",
    outDir: "out",
    // Emit .js (not .mjs): package.json is type:module and bin/exports point at
    // out/cli.js / out/index.js. Rolldown shares parser code between the two
    // entries via an automatic chunk, avoiding duplication in the tarball.
    fixedExtension: false,
    // Re-create CJS globals so any inlined CJS code resolves in the ESM bundle.
    banner: {
        js: [
            `import { createRequire } from "module";`,
            `const require = createRequire(import.meta.url);`,
            `const __filename = require("url").fileURLToPath(import.meta.url);`,
            `const __dirname = require("path").dirname(__filename);`,
        ].join("\n"),
    },
});
