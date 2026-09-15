/**
 * Completeness guard for `scripts/README.md`'s "Scripts in this directory" table. Nothing
 * fails when a new script lands with no row, or when a row outlives the file it names -
 * the table just stops describing the directory. Every tracked `scripts/*.{sh,mts,mjs}`
 * is a row or an EXCLUDED entry with a reason, and every row names a tracked file.
 *
 * Rows may carry a directory hint (`` `vitest.smoke.config.mts` _(server/)_ ``) for a
 * file the table documents from elsewhere; the hint is what the row resolves against.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout.ts";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const INDEX = "scripts/README.md";
const HEADING = "## Scripts in this directory";

/** Scripts the table deliberately omits. */
const EXCLUDED = new Map<string, string>([
    ["scripts/esbuild-elk-worker.d.mts", "ambient declarations for the sibling .mjs, not a script"],
    ["scripts/esbuild-svelte-warnings.d.mts", "ambient declarations for the sibling .mjs, not a script"],
    ["scripts/esbuild-web-tree-sitter.d.mts", "ambient declarations for the sibling .mjs, not a script"],
]);

const trackedScripts = execSync("git ls-files 'scripts/*.sh' 'scripts/*.mts' 'scripts/*.mjs'", {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
})
    .split("\n")
    .filter(Boolean);

const tracked = new Set(
    execSync("git ls-files", { cwd: REPO_ROOT, encoding: "utf8", timeout: SPAWN_TIMEOUT_MS })
        .split("\n")
        .filter(Boolean),
);

/** Repo-relative path each table row names. */
function rowPaths(): string[] {
    const text = fs.readFileSync(path.join(REPO_ROOT, INDEX), "utf8");
    const start = text.indexOf(HEADING);
    if (start === -1) {
        throw new Error(`${INDEX} has no "${HEADING}" section`);
    }
    const rest = text.slice(start + HEADING.length);
    const end = rest.indexOf("\n## ");
    const section = end === -1 ? rest : rest.slice(0, end);

    const out: string[] = [];
    for (const line of section.split("\n")) {
        const m = /^\|\s*`([^`]+)`\s*(?:_\(([^)]+)\)_\s*)?\|/.exec(line);
        if (m?.[1] === undefined) continue;
        out.push(m[2] === undefined ? `scripts/${m[1]}` : path.posix.join(m[2], m[1]));
    }
    return out;
}

describe("scripts/README.md script table", () => {
    const rows = rowPaths();

    it("finds the table", () => {
        expect(rows.length).toBeGreaterThan(0);
    });

    it("carries every tracked script, or excludes it with a reason", () => {
        const listed = new Set(rows);
        const missing = trackedScripts.filter((file) => !listed.has(file) && !EXCLUDED.has(file));
        expect(missing).toEqual([]);
    });

    it("lists nothing that no longer exists", () => {
        const dangling = rows.filter((file) => !tracked.has(file));
        expect(dangling).toEqual([]);
    });

    it("excludes only scripts that are actually tracked", () => {
        const stale = [...EXCLUDED.keys()].filter((file) => !tracked.has(file));
        expect(stale).toEqual([]);
    });
});
