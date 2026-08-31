/**
 * Structural gate: every preprocessed script in the corpus must parse into a sane tree.
 *
 * The obvious check - "no ERROR nodes" - is far weaker than it looks. tree-sitter recovers from an
 * unknown construct by lexing keywords as bare identifiers, which produces a complete, error-free and
 * completely wrong tree. Three real defects were found exactly this way and every one of them was
 * invisible to an error check:
 *
 *   - a bare `begin ... end` block: `begin` became an identifier and the block's `end` closed the
 *     enclosing procedure, silently reparenting the rest of the file;
 *   - `pure procedure foo`: the modifier became a top-level macro call beside the procedure;
 *   - `Call Foo;` with a capital C: the statement became two expression statements.
 *
 * So the assertions below are about tree SHAPE, not error presence. Each one is an invariant that holds
 * for a correct parse of any SSL file and breaks under the recovery patterns above.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Language, Parser, type Node } from "web-tree-sitter";
import { preprocess } from "../../src/preprocess.ts";
import { REPO_ROOT } from "../../../../shared/cli/test/repo-root.ts";
import { SPAWN_TIMEOUT_MS } from "../../../../shared/spawn-timeout.ts";
import { builtArtifactsPresent } from "../../../../shared/cli/test/built-artifacts.ts";
import { shardScripts } from "../../../../shared/cli/test/shard.ts";

// The sfall headers the corpus needs are linked in by this project's globalSetup.
const RP_SCRIPTS = path.join(REPO_ROOT, "external/fallout/Fallout2_Restoration_Project/scripts_src");
const WASM_DIR = path.join(REPO_ROOT, "server/out");

/** The population floor the corpus-wide sweep carried; asserted by every shard against the FULL list. */
const CORPUS_FLOOR = 1500;

/** Only declarations may appear at the top level of a translation unit. */
const TOP_LEVEL = new Set([
    "procedure",
    "procedure_forward",
    "variable_decl",
    "export_decl",
    "comment",
    "line_comment",
]);

/**
 * Keywords that can never legitimately be an `identifier` node. Deliberately excludes names the
 * language also permits as ordinary identifiers or engine functions (`wait`, `exit`, `floor`, ...);
 * this set is the structural vocabulary, where an identifier means the parser lost the construct.
 */
const STRUCTURAL_KEYWORDS = new Set([
    "begin",
    "end",
    "procedure",
    "variable",
    "export",
    "import",
    "if",
    "then",
    "else",
    "while",
    "do",
    "for",
    "foreach",
    "switch",
    "case",
    "default",
    "return",
    "break",
    "continue",
    "call",
    "pure",
    "inline",
]);

function listScripts(): string[] {
    if (!fs.existsSync(RP_SCRIPTS)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(RP_SCRIPTS)) {
        if (entry === "template" || entry === "sfall") continue;
        const dir = path.join(RP_SCRIPTS, entry);
        if (!fs.statSync(dir).isDirectory()) continue;
        for (const file of fs.readdirSync(dir)) {
            if (file.toLowerCase().endsWith(".ssl")) out.push(path.join(dir, file));
        }
    }
    return out.sort();
}

function hasGcc(): boolean {
    try {
        execFileSync("gcc", ["--version"], { stdio: "ignore", timeout: SPAWN_TIMEOUT_MS });
        return true;
    } catch {
        return false;
    }
}

export function registerGrammarParseShard(index: number, count: number): void {
    const scripts = listScripts();
    const wasmPresent = builtArtifactsPresent([path.join(WASM_DIR, "tree-sitter-ssl.wasm")], "pnpm build:grammar");

    describe.skipIf(scripts.length === 0 || !wasmPresent || !hasGcc())(
        `preprocessed corpus parses sanely (${index}/${count})`,
        () => {
            const mine = shardScripts(scripts, index, count);
            const errors: string[] = [];
            const missing: string[] = [];
            const strayTopLevel: string[] = [];
            const keywordIdentifiers: string[] = [];
            let parsed = 0;

            beforeAll(async () => {
                await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
                const parser = new Parser();
                parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));

                for (const script of mine) {
                    const rel = path.relative(RP_SCRIPTS, script);
                    const tree = parser.parse(preprocess(script));
                    if (tree === null) {
                        errors.push(`${rel}: parser returned null`);
                        continue;
                    }
                    parsed++;

                    for (const child of tree.rootNode.children) {
                        if (child && !TOP_LEVEL.has(child.type)) {
                            strayTopLevel.push(`${rel}: ${child.type} at top level - ${child.text.slice(0, 40)}`);
                        }
                    }

                    const stack: Node[] = [tree.rootNode];
                    while (stack.length > 0) {
                        const node = stack.pop();
                        if (node === undefined) continue;
                        if (node.type === "ERROR") errors.push(`${rel}: ERROR - ${node.text.slice(0, 50)}`);
                        if (node.isMissing) missing.push(`${rel}: MISSING ${node.type}`);
                        if (node.type === "identifier" && STRUCTURAL_KEYWORDS.has(node.text.toLowerCase())) {
                            keywordIdentifiers.push(`${rel}: keyword '${node.text}' parsed as an identifier`);
                        }
                        for (const child of node.children) if (child !== null) stack.push(child);
                    }
                    tree.delete();
                }
            });

            it("produces no errors, no missing nodes, and no misparse signatures", () => {
                const sample = (xs: string[]): string => xs.slice(0, 8).join("\n");
                expect(errors, `ERROR nodes:\n${sample(errors)}`).toEqual([]);
                expect(missing, `MISSING nodes:\n${sample(missing)}`).toEqual([]);
                expect(strayTopLevel, `non-declaration at top level:\n${sample(strayTopLevel)}`).toEqual([]);
                expect(keywordIdentifiers, `keyword lexed as identifier:\n${sample(keywordIdentifiers)}`).toEqual([]);
                // Guard the denominator from inside the shard: the FULL population, so a corpus that
                // shrank mid-checkout fails here rather than yielding a slice of the wrong thing, and the
                // shard's own count exactly, so a silently skipped script cannot pass as a clean parse.
                expect(scripts.length).toBeGreaterThan(CORPUS_FLOOR);
                expect(parsed).toBe(mine.length);
            });
        },
    );
}
