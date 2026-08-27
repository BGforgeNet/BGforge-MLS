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
    // Rolldown's plugin-timing advisory fires on every build of this package and reports the same
    // thing each time: .d.ts generation is about half of it. That is inherent to emitting types for
    // two library entries, not a regression to act on, so the profiler stays off here. The other
    // tsdown configs build fast enough never to trip it and leave the default alone; re-enable with
    // `checks: { pluginTimings: true }` when actually profiling this build.
    checks: { pluginTimings: false },
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
