/**
 * Ambient types for the non-JS assets the dialog editor's bundles import directly.
 *
 * esbuild turns these imports into inline data at build time via its `binary` and `text` loaders (see the
 * `loader` maps in scripts/build-webviews.mjs and test/harness/build.mts), so nothing is fetched at runtime
 * and the shapes below are what the bundle actually holds. tsc has no such loaders and would otherwise
 * report the imports as unresolved modules.
 */

declare module "*.wasm" {
    /** esbuild's `binary` loader: the file's bytes, base64-embedded in the bundle. */
    const bytes: Uint8Array;
    export default bytes;
}

declare module "*.scm" {
    /** esbuild's `text` loader: the file's contents as a string. */
    const source: string;
    export default source;
}
