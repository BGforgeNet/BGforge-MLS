/**
 * Locate an installed package's own directory, and say whether anything can `require` it.
 *
 * Shared by scripts/stage-server-runtime-deps.mjs (which copies the server's runtime closure into the
 * VSIX) and scripts/verify-vsix-runtime-deps.mjs (which checks that closure resolves once packaged).
 * The two have to agree on what "reachable" means, so they agree by importing the same answer.
 */

import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The directory a package's own files live in, resolved from `fromDir`.
 *
 * Two routes, because neither covers every package. `<name>/package.json` handles one with no
 * requirable entry at all, but an `exports` map that does not list `./package.json` refuses it -
 * `@napi-rs/wasm-runtime` is that shape. Resolving the entry and walking up to the manifest that names
 * the package handles the rest. Throws when neither route lands.
 */
export function packageDir(name, fromDir) {
    const req = createRequire(join(fromDir, "noop.js"));
    try {
        return dirname(req.resolve(`${name}/package.json`));
    } catch {
        let dir = dirname(req.resolve(name));
        // Stop at the manifest that actually names this package: a nested one would be a dependency's.
        while (dir !== dirname(dir)) {
            const manifest = join(dir, "package.json");
            if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).name === name) return dir;
            dir = dirname(dir);
        }
        throw new Error(`no package.json naming ${name} above its entry point`);
    }
}

/**
 * Whether a manifest offers anything loadable at runtime.
 *
 * A types-only package declares `types` and nothing else - `@oxc-project/types`, which rolldown lists
 * under `dependencies`, is one. It is unresolvable by design, in a dev tree as much as in a packaged
 * artifact, so requiring it to `require.resolve` would fail on a correct install. Its directory still
 * has to be present, which is what the callers check instead.
 */
export function hasRuntimeEntry(manifest) {
    return (
        manifest.main !== undefined ||
        manifest.module !== undefined ||
        manifest.bin !== undefined ||
        manifest.exports !== undefined
    );
}

/** Read a package directory's manifest. */
export function readManifest(dir) {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}
