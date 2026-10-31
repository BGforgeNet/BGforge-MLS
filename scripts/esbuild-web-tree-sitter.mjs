/**
 * Shared esbuild pieces for the webview IIFE builds - used by the production webview build
 * (scripts/build-webviews.mjs) and the dialog render harness (client/src/dialog-editor/test/harness/
 * build.mts), so the two embed assets the same way.
 */

/**
 * Asset loaders, so an imported asset is embedded in the bundle rather than fetched: `.wasm` as raw bytes
 * (the dialog highlighter's oniguruma engine, imported by the render harness only - the panel gets it from its
 * host). A loader only fires on a real import.
 */
export const webTreeSitterLoaders = { ".wasm": "binary" };
