/**
 * Drift guard for path and command references in the public docs.
 *
 * docs/architecture.md and docs/lsp-api.md cite source-file paths and command ids.
 * When code is renamed or moved, those citations rot into dangling pointers - a
 * whole `dialog-tree/` -> `dialog-editor/` rename once left the architecture doc
 * describing files that no longer existed, and the lsp-api doc described a
 * `workspace/symbol` encoding and custom methods the server never implemented.
 * This test pins every backticked repo-root source path to `git ls-files` and
 * every backticked bgforge command id to a real code usage, so a future rename
 * fails here instead of silently misleading third-party integrators.
 *
 * The extractors are deliberately conservative (a guard that false-positives on a
 * correct doc trains readers to ignore it): only backticked tokens that
 * unambiguously look like a repo-root-anchored source path or a bgforge command id
 * are checked. Shorthand relative paths (`core/capabilities.ts`), globs, and
 * build-output paths are skipped rather than risk a false alarm.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import { describe, expect, it } from "vitest";

const DOCS = ["docs/architecture.md", "docs/lsp-api.md"] as const;

const trackedFiles = new Set(execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean));

// Real repo top-level directories, so only repo-root-anchored path citations are checked.
const topLevelDirs = new Set([...trackedFiles].map((f) => f.split("/")[0]));

// Every line mentioning "bgforge" across tracked non-doc files - contains each
// command id / method literal the code actually uses (protocol constants,
// package.json contributions, source registrations).
const codeMentions = execSync("git grep -hF bgforge -- ':!docs/'", { encoding: "utf8" });

const read = (p: string): string => fs.readFileSync(p, "utf8");

/** All backticked inline-code spans in a markdown file. */
function backtickedTokens(text: string): string[] {
    const out: string[] = [];
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
        if (m[1] !== undefined) out.push(m[1]);
    }
    return out;
}

// A token treated as "this tracked source file exists". Conservative: repo-root
// anchored (first segment is a real top-level dir), ends in a source extension,
// carries no glob/placeholder metachars, and is not a build-output/dependency path.
const SOURCE_EXT = /\.(ts|svelte|scm|sh|mjs)$/;
const OUTPUT_OR_DEP = /^(client|server|format|binary|transpilers)\/out\/|(^|\/)node_modules\//;
function isSourcePathClaim(tok: string): boolean {
    if (!tok.includes("/")) return false;
    if (/[*{}<>|\s]/.test(tok)) return false;
    if (!topLevelDirs.has(tok.split("/")[0] ?? "")) return false;
    if (OUTPUT_OR_DEP.test(tok)) return false;
    return SOURCE_EXT.test(tok);
}

// bgforge / bgforge-mls command and method ids the docs may cite.
const COMMAND_RE = /^(bgforge\.[\w.-]+|extension\.bgforge\.[\w.-]+|bgforge-mls\/[\w.-]+)$/;
function commandIsKnown(cmd: string): boolean {
    if (codeMentions.includes(cmd)) return true;
    // Scoped executeCommand ids are built from a prefix constant plus a runtime
    // suffix (e.g. bgforge.workspaceSymbols.weidu-d from "bgforge.workspaceSymbols.").
    // Accept a cited id whose parent prefix appears as a quoted literal in code.
    const prefix = cmd.slice(0, cmd.lastIndexOf(".") + 1);
    return prefix.length > 0 && codeMentions.includes(`"${prefix}"`);
}

describe("public doc references resolve", () => {
    for (const doc of DOCS) {
        const tokens = backtickedTokens(read(doc));

        const pathClaims = [...new Set(tokens.filter((t) => isSourcePathClaim(t)))];
        it.each(pathClaims)(`${doc}: source path \`%s\` is tracked`, (p) => {
            expect(trackedFiles.has(p), `${doc} cites ${p}, which is not a tracked file`).toBe(true);
        });

        const commandClaims = [...new Set(tokens.filter((t) => COMMAND_RE.test(t)))];
        it.each(commandClaims)(`${doc}: command \`%s\` is used in code`, (cmd) => {
            expect(commandIsKnown(cmd), `${doc} cites command ${cmd}, absent from tracked source`).toBe(true);
        });
    }

    it("actually checked some references (extractors are not silently empty)", () => {
        const all = DOCS.flatMap((doc) => backtickedTokens(read(doc)));
        expect(all.filter((t) => isSourcePathClaim(t)).length).toBeGreaterThan(0);
        expect(all.filter((t) => COMMAND_RE.test(t)).length).toBeGreaterThan(0);
    });
});
