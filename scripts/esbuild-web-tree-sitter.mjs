/**
 * Shared esbuild pieces for the webview IIFE builds - used by the production webview build
 * (scripts/build-webviews.mjs) and the dialog render harness (client/src/dialog-editor/test/harness/
 * build.mts), so the two embed assets the same way.
 */

/**
 * Asset loaders, so an imported asset is embedded in the bundle rather than fetched: `.wasm` as raw bytes
 * (the dialog highlighter's oniguruma engine, imported by the render harness only - the panel gets it from its
 * host), `.scm` as a string (no current importer). A loader only fires on a real import.
 */
export const webTreeSitterLoaders = { ".wasm": "binary", ".scm": "text" };

/**
 * web-tree-sitter's Emscripten glue statically references two Node-only modules - `fs/promises` (to read a
 * grammar from a path) and `module` (createRequire) - behind a `globalThis.process?.versions.node` guard a
 * browser never enters. The code is dead in a webview, but esbuild still has to RESOLVE the specifiers to
 * bundle. Stub them to an empty module so the browser build succeeds without asserting a Node target
 * (platform:"node" would silence the same error by lying about where this runs). No current webview entry
 * imports web-tree-sitter, so for now it has no effect.
 */
export const stubNodeOnlyImports = {
    name: "stub-node-only-imports",
    setup(build) {
        build.onResolve({ filter: /^(fs\/promises|module)$/ }, (args) => ({
            path: args.path,
            namespace: "web-tree-sitter-node-stub",
        }));
        build.onLoad({ filter: /.*/, namespace: "web-tree-sitter-node-stub" }, () => ({
            contents: "export default {};",
        }));
    },
};
