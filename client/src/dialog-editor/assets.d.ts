/**
 * Ambient types for the non-JS assets the dialog editor's bundles import directly.
 *
 * esbuild turns the `*.wasm` and `*.scm` imports into inline data at build time via its `binary` and `text`
 * loaders (see the `loader` maps in scripts/build-webviews.mjs and test/harness/build.mts), so nothing is
 * fetched at runtime and the shapes below are what the bundle actually holds. tsc has no such loaders and
 * would otherwise report the imports as unresolved modules.
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

/**
 * Side-effect imports only: esbuild bundles the file into the webview's `main.css`, which the panel loads
 * through a `<link>` tag. Declared with no exports because no caller imports a binding from it.
 */
declare module "*.css";

/**
 * A virtual specifier resolved by scripts/esbuild-elk-worker.mjs to elkjs's worker script, loaded through
 * esbuild's `text` loader. It names no file on disk, which is what lets this declaration stand rather than
 * losing to the package's own types (those describe the worker as a class, not as the source text).
 * layout.ts blob-constructs a Worker from it.
 */
declare module "elk-worker-source" {
    const source: string;
    export default source;
}
