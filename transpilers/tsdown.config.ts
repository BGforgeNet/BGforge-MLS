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
    // Emit .js (not .mjs): package.json is type:module and bin/exports point at
    // out/cli.js / out/index.js. Rolldown shares the heavy ts-morph + transpiler
    // code between the two entries via an automatic chunk.
    fixedExtension: false,
    // esbuild-wasm detects at runtime whether it has been bundled by checking that
    // __filename/path.basename(__dirname) equal "main.js"/"lib". Bundling it breaks
    // that check, so it must stay external and resolve from node_modules with its
    // real filesystem path. It is therefore a runtime dependency in package.json.
    deps: { neverBundle: ["esbuild-wasm"] },
    // ts-morph bundles typescript.js (CJS), which references require/__filename/
    // __dirname at module-evaluation time. Rolldown injects its own `require`/
    // `createRequire` for the inlined CJS, so the banner must NOT redeclare those
    // (doing so crashes the bundle with "createRequire has already been declared").
    // It only needs to add __filename/__dirname, which Rolldown does not shim -
    // via uniquely-aliased imports so nothing collides with Rolldown's injections.
    banner: {
        js: [
            `import { fileURLToPath as __tsdownFileURLToPath } from "node:url";`,
            `import { dirname as __tsdownDirname } from "node:path";`,
            `const __filename = __tsdownFileURLToPath(import.meta.url);`,
            `const __dirname = __tsdownDirname(__filename);`,
        ].join("\n"),
    },
});
