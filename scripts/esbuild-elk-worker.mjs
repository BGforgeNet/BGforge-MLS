/**
 * Shared esbuild plugin for embedding elkjs's layout worker - used by the production webview build
 * (scripts/build-webviews.mjs) and the dialog render harness (client/src/dialog-editor/test/harness/
 * build.mts), so the two agree on how the worker reaches the page.
 */

import { readFile } from "node:fs/promises";

/** The specifier the dialog editor imports the worker source under. Virtual on purpose: it resolves to no
 *  file on disk, so tsc takes the ambient `declare module` (assets.d.ts) instead of the package's own
 *  types, which describe the worker as a class rather than as the text this loads. */
export const ELK_WORKER_SOURCE_SPECIFIER = "elk-worker-source";

/** Where the specifier points, resolved through esbuild so it lands in the importer's own node_modules. */
const ELK_WORKER_FILE = "elkjs/lib/elk-worker.min.js";

/**
 * The API-only ELK entry a browser build uses in place of the one layout.ts imports. Same ELK class,
 * without the embedded layout engine that only the in-process fallback worker needs (~10 KB against
 * ~1.6 MB minified).
 */
const ELK_API_ENTRY = "elkjs/lib/elk-api.js";

/**
 * Resolve `elk-worker-source` to elkjs's worker script and load it as TEXT, so the dialog editor can hand
 * its source to `new Worker` through a blob: URL.
 *
 * A webview's own resources are served from a different origin than the page, and a Worker script must be
 * same-origin - so the worker cannot be loaded by URL and has to be embedded and blob-constructed instead.
 * The `.wasm`/`.scm` assets are embedded for the same reason (see esbuild-web-tree-sitter.mjs).
 *
 * Since that worker carries the engine, this also redirects `elkjs/lib/elk.bundled.js` - which layout.ts
 * imports for the ELK class - to the API-only `elkjs/lib/elk-api.js`. elk.bundled.js embeds a SECOND copy
 * of the engine for the in-process fallback worker the webview never takes, costing ~3.4 MB of JS the main
 * thread had to compile before first paint; both entries export the same class.
 *
 * The redirect lives in THIS plugin, not its own, so a build cannot embed the worker without it and ship
 * the engine twice again. Node is unaffected: vitest runs no esbuild plugins, so layout.ts resolves
 * elk.bundled.js there and its no-`Worker` branch keeps a real engine (client/test/dialog-layout.test.ts).
 */
export const elkWorkerAsText = {
    name: "elk-worker-as-text",
    setup(build) {
        build.onResolve({ filter: /^elkjs\/lib\/elk\.bundled\.js$/ }, async (args) => {
            const resolved = await build.resolve(ELK_API_ENTRY, {
                kind: "import-statement",
                resolveDir: args.resolveDir,
            });
            if (resolved.errors.length > 0) return { errors: resolved.errors };
            return { path: resolved.path };
        });
        build.onResolve({ filter: /^elk-worker-source$/ }, async (args) => {
            const resolved = await build.resolve(ELK_WORKER_FILE, {
                kind: "import-statement",
                resolveDir: args.resolveDir,
            });
            if (resolved.errors.length > 0) return { errors: resolved.errors };
            return { path: resolved.path, namespace: "elk-worker-source" };
        });
        build.onLoad({ filter: /.*/, namespace: "elk-worker-source" }, async (args) => ({
            contents: await readFile(args.path, "utf8"),
            loader: "text",
        }));
    },
};
