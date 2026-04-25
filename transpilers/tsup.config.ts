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
    // ts-morph bundles typescript.js which is CJS-only: it calls require(), __filename,
    // and __dirname at module-evaluation time. Injecting these shims makes the CJS
    // globals available in the ESM scope so the inlined code resolves correctly.
    //
    // fileURLToPath and path.dirname are NOT re-imported here because tsup also emits
    // a top-level `import { fileURLToPath } from "url"` for transpiler source that uses
    // them — a second import binding would produce a SyntaxError duplicate. Values are
    // derived inline via the URL constructor to avoid the conflict.
    banner: {
        js: [
            `import { createRequire } from "module";`,
            `const require = createRequire(import.meta.url);`,
            `const __filename = new URL(import.meta.url).pathname;`,
            `const __dirname = new URL(".", import.meta.url).pathname.replace(/\\/$/, "");`,
        ].join("\n"),
    },
});
