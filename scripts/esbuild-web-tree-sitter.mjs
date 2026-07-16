/**
 * Shared esbuild pieces for bundling web-tree-sitter into a browser IIFE - used by the production webview
 * build (scripts/build-webviews.mjs) and the dialog render harness (client/src/dialog-editor/test/harness/
 * build.mts), so the two agree on how the tokenizer's assets and Node-only imports are handled.
 */

/**
 * Loaders for the two asset kinds the BAF tokenizer imports directly, so they are embedded in the bundle
 * rather than fetched: the grammar/runtime `.wasm` as raw bytes (Uint8Array), the highlight query `.scm` as
 * a string. Embedding keeps the webview off a network fetch entirely, so the CSP needs no connect-src.
 * Harmless for entry points that import neither (the binary editor): a loader only fires on a real import.
 */
export const webTreeSitterLoaders = { ".wasm": "binary", ".scm": "text" };

/**
 * web-tree-sitter's Emscripten glue statically references two Node-only modules - `fs/promises` (to read a
 * grammar from a path) and `module` (createRequire) - behind a `globalThis.process?.versions.node` guard a
 * browser never enters. The code is dead in a webview, and the tokenizer hands Language.load BYTES rather
 * than a path anyway, but esbuild still has to RESOLVE the specifiers to bundle. Stub them to an empty module
 * so the browser build succeeds without asserting a Node target (platform:"node" would silence the same
 * error by lying about where this runs). No effect on an entry point whose graph never imports them.
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
