/**
 * Stage the server's runtime dependency closure as one flat, symlink-free directory.
 *
 * vsce's zip writer (yazl) crashes on pnpm's symlinks, and pnpm's isolated layout stores a package's
 * own dependencies as SIBLINGS of the symlink target rather than inside it - so copying each declared
 * dependency's directory yields a package whose imports resolve to nothing. This walks what each
 * package DECLARES, the way Node resolves it, and copies every package reached into one flat tree.
 *
 * `pnpm deploy --node-linker=hoisted` produces the same shape and was used here first. It is not
 * usable from inside this workspace: `--prod` rewrites the workspace's recorded install state, after
 * which every later `pnpm <script>` runs a deps-status check that tries `pnpm install --production`
 * and aborts with no TTY. The failure lands on an unrelated command, so it reads as anything but the
 * packaging step that caused it.
 *
 * Only `dependencies` are followed, plus the entry package's `optionalDependencies` (the SSL compiler
 * ships that way). That is also what keeps rolldown's platform-native bindings out: they are its
 * optionalDependencies, ~20 MB each, and useless in a VSIX published as one platform-neutral artifact.
 * The wasm binding is reached because the server declares it directly.
 *
 * The same declared-dependency walk is what scripts/verify-vsix-runtime-deps.mjs checks against the
 * packaged artifact, so the producer and the verifier agree on the closure by construction.
 *
 * Usage: node scripts/stage-server-runtime-deps.mjs <out-dir>
 */

import { isBuiltin } from "node:module";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { packageDir, readManifest } from "./package-dir.mjs";

const outDir = process.argv[2];
if (!outDir) {
    console.error("usage: stage-server-runtime-deps.mjs <out-dir>");
    process.exit(2);
}

/** Supplied by the editor at runtime, never resolvable from the package itself. */
const HOST_PROVIDED = new Set(["vscode"]);

const repoRoot = resolve(import.meta.dirname, "..");
const serverDir = join(repoRoot, "server");

const staged = new Set();
const failures = [];

function stage(name, fromDir) {
    if (staged.has(name) || HOST_PROVIDED.has(name) || isBuiltin(name)) return;
    staged.add(name);

    let dir;
    try {
        dir = packageDir(name, fromDir);
    } catch {
        failures.push(`${name} does not resolve from ${fromDir}`);
        return;
    }

    // dereference: the source is a pnpm symlink, and the whole point is to leave none behind.
    cpSync(dir, join(outDir, name), { recursive: true, dereference: true });

    const manifest = readManifest(dir);
    for (const dep of Object.keys(manifest.dependencies ?? {})) stage(dep, dir);
}

const serverManifest = JSON.parse(readFileSync(join(serverDir, "package.json"), "utf8"));
const entryDeps = [
    ...Object.keys(serverManifest.dependencies ?? {}),
    // Optional at the entry only: the SSL compiler is a GitHub-release tarball that may legitimately
    // be absent, and an absent one is reported below rather than silently dropped.
    ...Object.keys(serverManifest.optionalDependencies ?? {}),
];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const dep of entryDeps) stage(dep, serverDir);

const optional = new Set(Object.keys(serverManifest.optionalDependencies ?? {}));
const hard = failures.filter((f) => !optional.has(f.split(" ")[0]));
for (const f of failures) {
    if (!hard.includes(f)) console.error(`stage-server-runtime-deps: optional dependency skipped: ${f}`);
}
if (hard.length > 0) {
    console.error(`stage-server-runtime-deps: FAILED (${hard.length} unresolvable)`);
    for (const f of hard) console.error(`  ${f}`);
    process.exit(1);
}

if (!existsSync(join(outDir, entryDeps[0] ?? ""))) {
    console.error(`stage-server-runtime-deps: staged nothing into ${outDir}`);
    process.exit(1);
}
console.error(`stage-server-runtime-deps: staged ${staged.size} packages into ${outDir}`);
