/**
 * Tests for scripts/verify-vsix-runtime-deps.mjs.
 *
 * Drives the script against synthetic extracted-VSIX trees rather than a real package: the failures it
 * exists to catch are shapes a correct build never produces, so they cannot be reached by packaging the
 * repo. Each fixture is one such shape.
 *
 * The case that matters most is the third. The script discovers a package's own dependencies by walking
 * up from its resolved entry to the manifest that names it, so an entry with no such manifest above it
 * is not merely unlabelled - it is a subtree the gate never looks at. Returning quietly there marks the
 * package checked while skipping everything beneath it.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout.ts";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "verify-vsix-runtime-deps.mjs");
const TMP_BASE = path.join(REPO_ROOT, "tmp", "verify-vsix-runtime-deps-test");

interface RunResult {
    status: number;
    stderr: string;
}

function runScript(root: string): RunResult {
    const proc = spawnSync(process.execPath, [SCRIPT, root], {
        encoding: "utf8",
        timeout: SPAWN_TIMEOUT_MS,
    });
    return { status: proc.status ?? -1, stderr: proc.stderr };
}

/**
 * Build an extracted-VSIX tree: a server manifest declaring `dependencies`, plus each named package
 * written under `extension/server/node_modules/`.
 */
function makeFixture(
    name: string,
    dependencies: Record<string, string>,
    packages: Record<string, { manifest?: Record<string, unknown>; entry?: string }>,
): string {
    const root = path.join(TMP_BASE, name);
    fs.rmSync(root, { recursive: true, force: true });

    const serverDir = path.join(root, "extension/server");
    fs.mkdirSync(path.join(serverDir, "out"), { recursive: true });
    fs.writeFileSync(path.join(serverDir, "package.json"), JSON.stringify({ name: "server", dependencies }));

    for (const [pkgName, spec] of Object.entries(packages)) {
        const dir = path.join(serverDir, "node_modules", pkgName);
        fs.mkdirSync(dir, { recursive: true });
        if (spec.manifest !== undefined) {
            fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(spec.manifest));
        }
        fs.writeFileSync(path.join(dir, "index.js"), spec.entry ?? "module.exports = {};\n");
    }
    return root;
}

afterEach(() => {
    fs.rmSync(TMP_BASE, { recursive: true, force: true });
});

describe("verify-vsix-runtime-deps", () => {
    it("passes a tree where every declared dependency resolves", () => {
        const root = makeFixture(
            "resolves",
            { alpha: "1.0.0" },
            { alpha: { manifest: { name: "alpha", version: "1.0.0", main: "index.js" } } },
        );

        const result = runScript(root);

        expect(result.status).toBe(0);
        expect(result.stderr).toContain("OK");
    });

    it("fails when a declared dependency is absent from the tree", () => {
        const root = makeFixture("absent", { alpha: "1.0.0" }, {});

        const result = runScript(root);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("alpha does not resolve");
    });

    it("fails when a package resolves but no manifest above its entry names it", () => {
        // A manifest naming something else is what a mis-copied or renamed directory leaves behind:
        // Node still resolves `alpha/index.js`, so the entry check passes, and only the walk notices.
        const root = makeFixture(
            "misnamed",
            { alpha: "1.0.0" },
            { alpha: { manifest: { name: "not-alpha", version: "1.0.0", main: "index.js" } } },
        );

        const result = runScript(root);

        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/alpha resolved to .* but no package\.json above it names it/);
    });

    it("follows a dependency's own dependencies, and fails on a missing one", () => {
        // The subtree the walk exists to reach: nothing declares `beta` at the top level, so it is
        // discovered only by reading alpha's manifest.
        const root = makeFixture(
            "transitive",
            { alpha: "1.0.0" },
            {
                alpha: {
                    manifest: { name: "alpha", version: "1.0.0", main: "index.js", dependencies: { beta: "1.0.0" } },
                },
            },
        );

        const result = runScript(root);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("beta does not resolve");
    });
});
