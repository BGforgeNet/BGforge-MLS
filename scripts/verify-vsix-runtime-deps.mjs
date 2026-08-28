/**
 * Checks that every runtime dependency the packaged server declares can actually be resolved from
 * inside the VSIX, that dependency's own dependencies included.
 *
 * Externalising a package moves it out of the bundle and into `server/node_modules`, where nothing
 * else looks at it: the size check passes, no source file leaked, every path is allowed - and the
 * extension still dies on the user's machine with an unresolvable require. That gap is what this
 * covers. It matters most for a package that has dependencies of its own, since pnpm stores those
 * as SIBLINGS of the symlink target rather than inside it, so a packaging step that copies one
 * directory yields a package whose own imports resolve to nothing.
 *
 * The manifest is the source of truth, not the bundles: a bare `require("x")` in minified output
 * cannot be told apart from the same text inside a string literal (ts-morph's codegen emits exactly
 * that), nor from an optional `try { require(...) } catch {}` that is meant to fail. Declaring a
 * runtime dependency is the deliberate act, so that is what gets checked - which also means a
 * package newly moved from devDependencies to dependencies comes under this gate for free.
 *
 * Resolution is static - `require.resolve`, never `require` - so a package that spawns a child or
 * touches the filesystem on load is inspected without being run.
 *
 * Usage: node scripts/verify-vsix-runtime-deps.mjs <extracted-vsix-dir>
 */

import { createRequire, isBuiltin } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

const root = process.argv[2];
if (!root) {
    console.error("usage: verify-vsix-runtime-deps.mjs <extracted-vsix-dir>");
    process.exit(2);
}

/** Supplied by the editor at runtime, never resolvable from the package itself. */
const HOST_PROVIDED = new Set(["vscode"]);

const nodeRequire = createRequire(import.meta.url);

/** Resolve one package from `fromDir`, then follow what it declares it needs. */
function check(pkgName, fromDir, failures, seen) {
    if (seen.has(pkgName) || HOST_PROVIDED.has(pkgName) || isBuiltin(pkgName)) return;
    seen.add(pkgName);

    let entry;
    try {
        entry = nodeRequire.resolve(pkgName, { paths: [fromDir] });
    } catch {
        failures.push(`${pkgName} does not resolve from ${fromDir.replace(root, "") || "/"}`);
        return;
    }
    if (!entry.startsWith(root)) {
        failures.push(`${pkgName} resolved outside the package (${entry}) - it would be absent on a user's machine`);
        return;
    }

    // Walk up from the entry to the owning package root, to read what it declares it needs.
    let dir = dirname(entry);
    while (dir.startsWith(root)) {
        const manifestPath = join(dir, "package.json");
        if (existsSync(manifestPath)) {
            const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
            if (manifest.name === pkgName) {
                for (const dep of Object.keys(manifest.dependencies ?? {})) check(dep, dir, failures, seen);
                return;
            }
        }
        dir = dirname(dir);
    }

    // Reaching here means the entry resolved but no manifest above it names the package. Reported
    // rather than passed over: the walk is also how this package's own dependencies are discovered, so
    // a silent return marks it checked while never looking at the subtree beneath it.
    failures.push(`${pkgName} resolved to ${entry.replace(root, "")} but no package.json above it names it`);
}

const serverManifest = join(root, "extension/server/package.json");
if (!existsSync(serverManifest)) {
    console.error(`verify-vsix-runtime-deps: no ${serverManifest.replace(root, "")} in the package`);
    process.exit(1);
}

const declared = Object.keys(JSON.parse(readFileSync(serverManifest, "utf8")).dependencies ?? {});
const failures = [];
const seen = new Set();
for (const dep of declared) check(dep, join(root, "extension/server/out"), failures, seen);

if (failures.length > 0) {
    console.error(`verify-vsix-runtime-deps: FAILED (${failures.length} unresolvable)`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
}

const followed = [...seen].filter((p) => !declared.includes(p));
console.error(
    `verify-vsix-runtime-deps: OK (${declared.length} declared: ${declared.join(", ")}` +
        `${followed.length > 0 ? `; ${followed.length} transitive: ${followed.sort().join(", ")}` : ""})`,
);
