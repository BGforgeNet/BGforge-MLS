/**
 * Integration: COPY/COMPILE/INCLUDE file-path go-to-definition against real WeiDU mods.
 *
 * The safety invariant this guards: for every navigable path position in the real corpus,
 * getDefinition either returns null or a location that actually exists (a file on disk, or a
 * same-file heredoc block) - it must NEVER point at a nonexistent path (a wrong jump) or throw.
 * Also asserts the resolver is not vacuously all-null: a real fraction of literal paths resolve,
 * which exercises the WeiDU %MOD_FOLDER% resolution on the real nested `<repo>/<mod>/...` layout.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { describe, expect, it, beforeAll } from "vitest";
import type { Node as SyntaxNode } from "web-tree-sitter";
import { initParser, parseWithCache } from "../../../shared/parsers/weidu-tp2";
import { getDefinition } from "../../src/weidu-tp2/definition";
import { loadFixture, IE_FIXTURES } from "./test-helpers";

beforeAll(async () => {
    await initParser();
});

/** All WeiDU install scripts under the corpus (empty when external/ is not checked out). */
function corpusScripts(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            return;
        }
        for (const e of entries) {
            const full = join(dir, e);
            if (statSync(full).isDirectory()) {
                walk(full);
            } else if (/\.(tp2|tph|tpa|tpp)$/i.test(e)) {
                out.push(full);
            }
        }
    };
    walk(IE_FIXTURES);
    return out;
}

/** Collect COPY `from`, COMPILE `source`/`tra`, and INCLUDE `file` value nodes across the tree. */
function navigableValueNodes(root: SyntaxNode): SyntaxNode[] {
    const found: SyntaxNode[] = [];
    const visit = (node: SyntaxNode) => {
        if (node.type === "action_copy" || node.type === "action_copy_large") {
            for (const pair of node.namedChildren) {
                if (pair?.type === "file_pair") {
                    const from = pair.childForFieldName("from");
                    if (from) found.push(from);
                }
            }
        } else if (node.type === "action_compile" || node.type === "action_include") {
            for (const child of node.namedChildren) {
                if (child && (child.type === "value" || child.type.endsWith("_string"))) {
                    found.push(child);
                }
            }
        }
        for (const child of node.namedChildren) {
            if (child) visit(child);
        }
    };
    visit(root);
    return found;
}

const scripts = corpusScripts();

describe.skipIf(scripts.length === 0)("weidu-tp2 file-reference navigation (real corpus)", () => {
    it("never resolves a navigable path to a nonexistent location, and resolves a real fraction", () => {
        let positions = 0;
        let resolvedToFile = 0;
        let resolvedToHeredoc = 0;

        for (const scriptPath of scripts) {
            const { text } = loadFixture(IE_FIXTURES, scriptPath.slice(IE_FIXTURES.length + 1));
            const uri = pathToFileURL(scriptPath).toString();
            const tree = parseWithCache(text);
            if (!tree) continue;

            for (const node of navigableValueNodes(tree.rootNode)) {
                // Cursor at the midpoint of the value node.
                const start = node.startPosition;
                const end = node.endPosition;
                const position =
                    start.row === end.row
                        ? { line: start.row, character: Math.floor((start.column + end.column) / 2) }
                        : { line: start.row, character: start.column + 1 };
                positions++;

                const result = getDefinition(text, uri, position);
                if (result === null) continue;

                if (result.uri === uri) {
                    // Same-file target: a heredoc block or the authoritative no-op self-location; either
                    // way it must land within this document.
                    resolvedToHeredoc++;
                    expect(result.range.start.line).toBeLessThan(text.split("\n").length);
                } else {
                    // Cross-file target: the file it points at MUST exist. A nonexistent target is a wrong jump.
                    resolvedToFile++;
                    expect(existsSync(fileURLToPath(result.uri))).toBe(true);
                }
            }
        }

        // Not vacuous, and filename-first genuinely resolves cross-file targets on the real corpus.
        expect(positions).toBeGreaterThan(0);
        expect(resolvedToFile).toBeGreaterThan(0);
    });

    it("resolves a variable-prefixed INCLUDE by unique basename (the reported balthazar case)", () => {
        const rel = "Ascension/ascension/balthazar/tougher_balthazar.tpa";
        const scriptPath = join(IE_FIXTURES, rel);
        if (!existsSync(scriptPath)) return; // Ascension not checked out
        const { text } = loadFixture(IE_FIXTURES, rel);
        const uri = pathToFileURL(scriptPath).toString();

        const lines = text.split("\n");
        const line = lines.findIndex((l) => l.includes(`INCLUDE "%balth_loc%/balthazar_monk_resources.tpa"`));
        expect(line).toBeGreaterThanOrEqual(0);
        const col = lines[line]!.indexOf("balthazar_monk_resources") + 3;

        const result = getDefinition(text, uri, { line, character: col });
        // Opens the referenced file - NOT the same-named DEFINE_ACTION_FUNCTION.
        const target = result ? fileURLToPath(result.uri) : "";
        expect(target.endsWith("balthazar_monk_resources.tpa")).toBe(true);
    });
});
