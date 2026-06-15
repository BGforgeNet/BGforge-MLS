/**
 * Wiring guard for the binary-editor UI guidelines.
 *
 * The actionable UI rules are co-located with the code they govern - a nested
 * AGENTS.md/CLAUDE.md pair in the webview (render) dir and the binary/src
 * (schema) dir - and the index + review brief lives at
 * docs/binary-editor-ui-guidelines.md, pointed at from the root AGENTS.md. This
 * test pins those paths and their cross-references so a relocation that updates
 * the code but forgets the wiring fails here instead of leaving a dangling
 * pointer that rots silently. (See the global rule "Co-located instructions and
 * config move with their code".)
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const INDEX = "docs/binary-editor-ui-guidelines.md";
const RENDER_RULES = "client/src/binary-editor/webview/AGENTS.md";
const SCHEMA_RULES = "binary/src/AGENTS.md";
const ROOT_AGENTS = "AGENTS.md";
const SELF = "scripts/utils/test/ui-guidelines-refs.test.ts";
const OLD_PATH = "binary-editor/test/harness/UI-GUIDELINES.md";

const read = (p: string): string => fs.readFileSync(p, "utf8");

describe("binary-editor UI-guidelines wiring", () => {
    it("the index doc and both co-located rule files exist", () => {
        for (const p of [INDEX, RENDER_RULES, SCHEMA_RULES]) {
            expect(fs.existsSync(p), `${p} is missing`).toBe(true);
        }
    });

    it("each rule dir has a CLAUDE.md symlink to its AGENTS.md", () => {
        for (const agents of [RENDER_RULES, SCHEMA_RULES]) {
            const claude = path.join(path.dirname(agents), "CLAUDE.md");
            expect(fs.existsSync(claude), `${claude} is missing`).toBe(true);
            expect(fs.lstatSync(claude).isSymbolicLink(), `${claude} should be a symlink`).toBe(true);
            expect(fs.readlinkSync(claude)).toBe("AGENTS.md");
        }
    });

    it("the root AGENTS.md points at the index doc", () => {
        expect(read(ROOT_AGENTS)).toContain(INDEX);
    });

    it("the index doc links both co-located rule files and names this guard", () => {
        const idx = read(INDEX);
        expect(idx).toContain(RENDER_RULES);
        expect(idx).toContain(SCHEMA_RULES);
        expect(idx).toContain(SELF);
    });

    it("the pre-move path is referenced nowhere", () => {
        // git grep exits non-zero (no match) when clean; -F = fixed string, over tracked files.
        // Exclude this guard's own source - it names OLD_PATH as a constant, which would
        // otherwise match itself.
        let matches = "";
        try {
            matches = execSync(`git grep -lF "${OLD_PATH}" -- . ':!${SELF}'`, { encoding: "utf8" });
        } catch {
            matches = ""; // exit 1 == no matches
        }
        expect(matches.trim(), `stale references to ${OLD_PATH}`).toBe("");
    });
});
