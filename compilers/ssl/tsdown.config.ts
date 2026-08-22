import { defineConfig } from "tsdown";

export default defineConfig({
    // cli-worker is a third entry rather than a chunk: the pool starts it by path at runtime
    // (out/cli-worker.js), so it has to be a file rather than something folded into the CLI bundle.
    entry: ["src/index.ts", "src/cli.ts", "src/cli-worker.ts"],
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
    // The CLI resolves the SSL grammar next to itself via __dirname at runtime.
    onSuccess: "bash ../../scripts/build-ssl-postbuild.sh",
    // Re-create the CJS globals the shared parser factory reads to find its WASM.
    banner: {
        js: [
            `import { createRequire } from "module";`,
            `const require = createRequire(import.meta.url);`,
            `const __filename = require("url").fileURLToPath(import.meta.url);`,
            `const __dirname = require("path").dirname(__filename);`,
        ].join("\n"),
    },
});
