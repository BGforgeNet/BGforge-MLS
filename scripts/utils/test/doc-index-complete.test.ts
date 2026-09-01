/**
 * Completeness guard for docs/README.md, which calls itself "the index of every document in
 * the repo". `remark-validate-links` proves the links it carries resolve, never that a doc
 * exists which it omits - nothing breaks when that claim goes stale, the sentence just
 * becomes false. Every tracked `*.md` must be listed, under a listed directory, or in
 * EXCLUDED with a reason.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout.ts";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const INDEX = "docs/README.md";

/** Docs the index deliberately omits: each is written for a reader who never opens the index. */
const EXCLUDED = new Map<string, string>([
    ["README.md", "the repo landing page, which links TO the index rather than from it"],
    [INDEX, "the index itself"],
    ["AGENTS.md", "machine-targeted contributor rules, not a document to browse"],
    ["CLAUDE.md", "symlink to AGENTS.md"],
    [".github/ISSUE_TEMPLATE/bug_report.md", "GitHub issue-form template, rendered by the forge"],
]);

/** Suffixes that mark a nested machine-targeted rules file, excluded wherever it appears. */
const EXCLUDED_BASENAMES = new Set(["AGENTS.md", "CLAUDE.md"]);

const trackedDocs = execSync("git ls-files '*.md'", {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS,
})
    .split("\n")
    .filter(Boolean);

/** Index link targets as repo-relative paths (the index lives in `docs/`, so bare targets are docs-relative). */
function indexTargets(): string[] {
    const text = fs.readFileSync(path.join(REPO_ROOT, INDEX), "utf8");
    const out: string[] = [];
    for (const m of text.matchAll(/\]\(([^)]+)\)/g)) {
        const raw = m[1];
        if (raw === undefined || raw.startsWith("http")) continue;
        out.push(path.posix.normalize(path.posix.join("docs", raw.split("#")[0] ?? "")));
    }
    return out;
}

describe("documentation index", () => {
    const targets = indexTargets();
    const files = new Set(targets.filter((t) => t.endsWith(".md")));
    // A target with no `.md` suffix is a directory entry, standing in for its contents.
    const dirs = targets.filter((t) => !t.endsWith(".md")).map((t) => (t.endsWith("/") ? t : `${t}/`));

    it("carries every tracked document, or excludes it with a reason", () => {
        const missing = trackedDocs.filter((doc) => {
            if (EXCLUDED.has(doc)) return false;
            if (EXCLUDED_BASENAMES.has(path.basename(doc))) return false;
            if (files.has(doc)) return false;
            return !dirs.some((d) => doc.startsWith(d));
        });
        expect(missing).toEqual([]);
    });

    it("lists nothing that no longer exists", () => {
        const tracked = new Set(trackedDocs);
        const dangling = [...files].filter((f) => !tracked.has(f));
        expect(dangling).toEqual([]);
    });

    it("excludes only documents that are actually tracked", () => {
        const tracked = new Set(trackedDocs);
        const stale = [...EXCLUDED.keys()].filter((f) => !tracked.has(f));
        expect(stale).toEqual([]);
    });
});
