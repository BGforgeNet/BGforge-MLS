/**
 * The tree-sitter node-type convention: code compares `node.type` against a `SyntaxType` member, never against
 * the string the member spells. The lint rule in `.oxlint/oxlint-plugin-node-type-literal.mjs` enforces it,
 * keyed on the generated enums in `shared/syntax-types/`, so a literal with no member (an anonymous keyword
 * token such as `"then"`) stays legal. These cases drive the rule through oxlint itself on throwaway files.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SPAWN_TIMEOUT_MS } from "../../../shared/spawn-timeout.ts";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const OXLINT = path.join(REPO_ROOT, "node_modules", ".bin", "oxlint");
const PLUGIN = path.join(REPO_ROOT, ".oxlint", "oxlint-plugin-node-type-literal.mjs");
const RULE = "bgforge-syntax/no-node-type-literal";
/** How oxlint names the rule in a printed diagnostic, which differs from the config spelling above. */
const REPORTED = "bgforge-syntax(no-node-type-literal)";

let dir: string;

beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "node-type-literal-"));
    // A config of its own, so the assertion is about the rule and not about the repo's path overrides.
    fs.writeFileSync(
        path.join(dir, ".oxlintrc.json"),
        JSON.stringify({ jsPlugins: [PLUGIN], rules: { [RULE]: "error" } }),
    );
});

afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

/** Lint one source through oxlint with the plugin loaded; returns the diagnostics it printed. */
function lint(name: string, source: string): string {
    const file = path.join(dir, name);
    fs.writeFileSync(file, source);
    try {
        return execFileSync(OXLINT, ["-c", path.join(dir, ".oxlintrc.json"), file], {
            cwd: dir,
            encoding: "utf8",
            timeout: SPAWN_TIMEOUT_MS,
            stdio: ["ignore", "pipe", "pipe"],
        });
    } catch (error) {
        // oxlint exits non-zero on a finding; the diagnostics are the stdout it already produced.
        const failed = error as { stdout?: string; stderr?: string };
        return `${failed.stdout ?? ""}${failed.stderr ?? ""}`;
    }
}

describe("no-node-type-literal", () => {
    it("flags a node.type comparison against the string a SyntaxType member spells", () => {
        const out = lint(
            "member.ts",
            'declare const node: { type: string };\nexport const s = node.type === "state";\n',
        );
        expect(out).toContain(REPORTED);
        expect(out).toContain("SyntaxType");
    });

    it("flags the inequality form and a literal on the left", () => {
        const out = lint(
            "left.ts",
            'declare const node: { type: string };\nexport const s = "do_feature" !== node.type;\n',
        );
        expect(out).toContain(REPORTED);
    });

    it("stays silent on a literal no generated enum spells", () => {
        const out = lint("anon.ts", 'declare const node: { type: string };\nexport const s = node.type === "then";\n');
        expect(out).not.toContain(REPORTED);
    });

    it("stays silent on the SyntaxType member itself", () => {
        const out = lint(
            "enum.ts",
            'enum SyntaxType { State = "state" }\ndeclare const node: { type: string };\nexport const s = node.type === SyntaxType.State;\n',
        );
        expect(out).not.toContain(REPORTED);
    });

    it("stays silent on a property that is not `type`", () => {
        const out = lint(
            "other.ts",
            'declare const node: { kind: string };\nexport const s = node.kind === "state";\n',
        );
        expect(out).not.toContain(REPORTED);
    });
});
