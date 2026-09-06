/**
 * Guard: the packaged extension carries no workspace package's own directory.
 *
 * `.vscodeignore` is a denylist (its own header says so), so it fails open: a newly added workspace
 * package ships wholesale unless someone remembers to add it to the "Bundled library workspaces" or
 * "Dev-only directories" block. That is exactly what happened when `animation/` was added and left off
 * the wholesale-exclude list. The expected-excluded set here comes from `pnpm-workspace.yaml`, the
 * authoritative list of workspace packages, rather than a second hand-written copy of the same list -
 * so a package added later is covered without anyone updating this test.
 *
 * `client` and `server` are the two exceptions: they ship their own `out/` plus curated runtime assets
 * under `src/` (webview HTML/CSS), so their directory legitimately appears in the package. Every other
 * workspace package is bundled into `client/out`/`server/out` at build time and none of its own tree
 * should ship.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { describe, expect, it } from "vitest";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout.ts";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Workspace package directories, `pnpm-workspace.yaml` globs expanded, minus client/server (see above). */
function bundledWorkspacePackageDirs(): string[] {
    // YAML.parse returns `any`, so a plain annotation narrows it without a cast.
    const manifest: { packages: string[] } = YAML.parse(
        fs.readFileSync(path.join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8"),
    );
    const dirs = manifest.packages.flatMap((entry) => {
        if (!entry.endsWith("/*")) return [entry];
        const parent = entry.slice(0, -2);
        return fs
            .readdirSync(path.join(REPO_ROOT, parent), { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => `${parent}/${d.name}`);
    });
    return dirs.filter((dir) => dir !== "client" && dir !== "server");
}

/**
 * `vsce ls` walks the real `.vscodeignore`/glob rules with no build required, so this catches the
 * regression at the same cost as any other suite in `pnpm test:scripts` - unlike
 * `scripts/verify-package-contents.sh`, which needs an actual built VSIX. `--no-dependencies` skips
 * `npm`/`yarn` dependency-tree resolution (not needed here and far slower without it).
 */
function packagedPaths(): string[] {
    const result = spawnSync("pnpm", ["exec", "vsce", "ls", "--no-dependencies"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: SPAWN_TIMEOUT_MS,
    });
    if (result.status !== 0) {
        throw new Error(`vsce ls failed (status ${String(result.status)}): ${result.stderr}`);
    }
    return result.stdout.split("\n").filter(Boolean);
}

describe("packaged extension excludes workspace source directories", () => {
    const dirs = bundledWorkspacePackageDirs();

    it("finds workspace packages to check, so a broken parse cannot read as a clean repo", () => {
        // Positive control: animation is the package the wholesale-exclude list was once missing.
        expect(dirs).toContain("animation");
        expect(dirs.length).toBeGreaterThan(10);
    });

    it(
        "vsce ls lists no path under a bundled workspace package's own directory",
        () => {
            const paths = packagedPaths();
            const violations = paths.filter((p) => dirs.some((dir) => p === dir || p.startsWith(`${dir}/`)));
            expect(violations).toEqual([]);
        },
        // vsce ls walks node_modules across every workspace package, well past a typical spawn - give it
        // more headroom above SPAWN_TIMEOUT_MS than the suite's own testTimeout, so a genuine hang is
        // reported by the spawn's own timeout rather than vitest's.
        SPAWN_TIMEOUT_MS + 30_000,
    );
});
