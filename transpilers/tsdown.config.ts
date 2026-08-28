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
    // rolldown resolves its own native or wasm binding relative to its package directory, so bundling
    // it would cut it off from the file it has to load. It stays external and resolves from
    // node_modules, and is therefore a runtime dependency in package.json.
    // onlyBundle: false says the inlining is intended (it otherwise hints once per build, listing the
    // ts-morph tree). The allowlist form is the alternative, but it errors on any dependency outside
    // it, so it would have to name ts-morph's transitive set and be re-checked on every bump.
    deps: { neverBundle: ["rolldown"], onlyBundle: false },
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
