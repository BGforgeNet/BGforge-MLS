/**
 * Stands in for the `elk-worker-source` virtual module under vitest, which runs no esbuild plugins and so
 * cannot resolve the specifier the webview build supplies (scripts/esbuild-elk-worker.mjs).
 *
 * Empty on purpose: node has no `Worker` global, so layout.ts takes its inline-engine branch and never
 * builds a blob from this. Anything that DID read it here would be testing the stub, not the worker.
 */
export default "";
