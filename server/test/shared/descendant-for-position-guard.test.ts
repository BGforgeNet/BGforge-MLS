/**
 * Visibility guard for tree-sitter `descendantForPosition` call sites.
 *
 * `descendantForPosition({ row, column })` returns the leaf node whose half-open [start, end) range
 * contains the point. At a token's EXCLUSIVE end - most importantly the end of a `//` line comment,
 * which is exactly where the cursor sits while typing - it returns the PARENT node, not the token.
 * A gate keyed on the node at the exact cursor column therefore misclassifies that boundary (a
 * comment reads as code, leaking completions). The fix is `classifyAtCursorBoundary` in
 * shared/comment-check.ts, which also probes one column back.
 *
 * That bug was invisible because nothing made the raw pattern stand out - it looked correct and was
 * duplicated across four languages. This guard makes every call site EXPLICIT: it fails when a new
 * file starts calling `descendantForPosition`, forcing a conscious choice - route a cursor-position
 * comment/feature gate through `classifyAtCursorBoundary`, or add the file to ALLOWED with a reason
 * (exact-column is correct for non-gate uses like ancestor walks and symbol lookup).
 *
 * File-set granularity, not per-line: the goal is to surface a NEW gating site, not to freeze counts.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "../../src");

// The call form `descendantForPosition({...})`, so prose in doc comments that merely names the
// method (no argument list) does not count as a call site.
const CALL = /descendantForPosition\(\{/;

/**
 * Every source file allowed to call `descendantForPosition` directly, keyed by its path relative to
 * server/src, with the reason exact-column probing is correct there. A cursor-position comment or
 * feature gate does NOT belong here - it belongs behind `classifyAtCursorBoundary`.
 */
const ALLOWED: Readonly<Record<string, string>> = {
    "shared/comment-check.ts": "the boundary-aware primitive (classifyAtCursorBoundary) itself",
    "shared/selection-ranges.ts": "ancestor walk from the cursor; exact column is correct, not a gate",
    "fallout-ssl/definition.ts": "go-to-definition symbol resolution at the cursor",
    "weidu-tp2/completion/context/index.ts":
        "function-call context node; comment gating here routes through detectCommentKind",
    "weidu-d/embedded-baf.ts": "embedded-BAF region detection at the cursor",
};

function tsFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            return tsFiles(full);
        }
        return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [full] : [];
    });
}

const callSites = tsFiles(SRC)
    .filter((file) => CALL.test(fs.readFileSync(file, "utf8")))
    .map((file) => path.relative(SRC, file).split(path.sep).join("/"))
    .sort();

describe("descendantForPosition call sites stay explicit", () => {
    it("finds the known call sites (guard is actually scanning)", () => {
        expect(callSites.length).toBeGreaterThan(0);
    });

    it("every call site is on the allowlist with a reason", () => {
        const unexpected = callSites.filter((file) => !(file in ALLOWED));
        expect(
            unexpected,
            `New descendantForPosition call site(s): ${unexpected.join(", ")}.\n` +
                "If this drives a cursor-position comment/feature gate, route it through " +
                "classifyAtCursorBoundary (server/src/shared/comment-check.ts) so it is robust to the " +
                "end-of-line boundary. If exact-column probing is genuinely correct here, add the file " +
                "to ALLOWED in this test with a one-line reason.",
        ).toEqual([]);
    });

    it("the allowlist has no stale entries (every listed file still calls it)", () => {
        const stale = Object.keys(ALLOWED).filter((file) => !callSites.includes(file));
        expect(stale, `Stale ALLOWED entries (no longer call descendantForPosition): ${stale.join(", ")}`).toEqual([]);
    });
});
