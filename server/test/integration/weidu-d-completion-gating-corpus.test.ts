/**
 * Corpus sweep for the D completion position gate.
 *
 * The gate WITHHOLDS completions, so its dangerous failure is the false positive - suppressing at a position
 * where the D vocabulary is exactly what the user wants. A hand-written fixture cannot measure that; the rate
 * across real dialogue is the oracle, and it must be zero in both directions: never suppressed at a structural
 * keyword, never offered inside a string. Per-position behaviour classes are pinned by the unit tests in
 * `server/test/weidu-d/embedded-baf-provider.test.ts`; this one measures them against argument and text shapes
 * nobody wrote a fixture for.
 *
 * Requires external repos (`pnpm test:integration`, which needs `pnpm test:external` first).
 */

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import * as fg from "fast-glob";
import type { CompletionItem } from "vscode-languageserver/node";
import type { Node as SyntaxNode } from "web-tree-sitter";
import { initParser, parseWithCache } from "../../../shared/parsers/weidu-d";
import { weiduDProvider } from "../../src/weidu-d/provider";
import { SyntaxType } from "../../src/weidu-d/syntax-type";
import { normalizeUri } from "../../src/core/normalized-uri";
import { IE_FIXTURES } from "./test-helpers";

const URI = normalizeUri("file:///corpus.d");
const D_ITEMS: CompletionItem[] = [{ label: "SENTINEL_D_ITEM" }];

/** Nodes whose start position is a structural keyword (`IF`, `SAY`, a state's own `IF`) - always code. */
const KEYWORD_NODES: ReadonlySet<string> = new Set([
    SyntaxType.State,
    SyntaxType.TransitionFull,
    SyntaxType.AddStateTrigger,
    SyntaxType.AddTransAction,
    SyntaxType.ReplaceSay,
]);

/** String bodies: dialogue, filenames, embedded BAF. None of them takes the D vocabulary. */
const CONTENT_NODES: ReadonlySet<string> = new Set([SyntaxType.TildeContent, SyntaxType.DoubleContent]);

/**
 * Probes per file per kind. The corpus runs to four figures of files and a long dialogue holds hundreds of
 * each, so the sweep is capped to keep it inside the suite's timeout; the totals are asserted so a cap that
 * silently collected nothing cannot read as a pass.
 */
const PROBES_PER_FILE = 25;

interface Sweep {
    /** Keyword positions that kept the D vocabulary - the correct outcome. */
    keywordOffered: number;
    /** Keyword positions the gate suppressed - the false positive this suite exists for. */
    keywordSuppressed: string[];
    /** String bodies that withheld the D vocabulary (empty, or the embedded BAF set instead). */
    contentGated: number;
    /** String bodies that leaked the D vocabulary. */
    contentLeaked: string[];
}

function walk(root: SyntaxNode, visit: (node: SyntaxNode) => void): void {
    const stack: SyntaxNode[] = [root];
    for (let node = stack.pop(); node; node = stack.pop()) {
        visit(node);
        for (let i = node.childCount - 1; i >= 0; i--) {
            const child = node.child(i);
            if (child) stack.push(child);
        }
    }
}

function sweepFile(file: string, sweep: Sweep): void {
    const text = readFileSync(file, "utf-8");
    const tree = parseWithCache(text);
    if (!tree) return;

    let keywords = 0;
    let contents = 0;
    walk(tree.rootNode, (node) => {
        if (keywords < PROBES_PER_FILE && KEYWORD_NODES.has(node.type)) {
            keywords++;
            const position = { line: node.startPosition.row, character: node.startPosition.column };
            const out = weiduDProvider.filterCompletions!(D_ITEMS, text, position, URI);
            if (out === D_ITEMS) sweep.keywordOffered++;
            else sweep.keywordSuppressed.push(`${file}:${position.line + 1}:${position.character + 1} ${node.type}`);
            return;
        }
        if (
            contents < PROBES_PER_FILE &&
            CONTENT_NODES.has(node.type) &&
            node.startPosition.row === node.endPosition.row
        ) {
            contents++;
            // Mid-body, so the probe is unambiguously inside rather than on a delimiter boundary.
            const column = Math.floor((node.startPosition.column + node.endPosition.column) / 2);
            const position = { line: node.startPosition.row, character: column };
            const out = weiduDProvider.filterCompletions!(D_ITEMS, text, position, URI);
            if (out === D_ITEMS) sweep.contentLeaked.push(`${file}:${position.line + 1}:${position.character + 1}`);
            else sweep.contentGated++;
        }
    });
}

const files = fg.sync("**/*.d", { cwd: IE_FIXTURES, absolute: true, caseSensitiveMatch: false });

describe.skipIf(files.length === 0)("weidu-d completion gate against the real corpus", () => {
    const sweep: Sweep = { keywordOffered: 0, keywordSuppressed: [], contentGated: 0, contentLeaked: [] };

    beforeAll(async () => {
        await initParser();
        for (const file of files) {
            sweepFile(file, sweep);
        }
    });

    it("never suppresses the D vocabulary at a structural keyword", () => {
        expect(sweep.keywordSuppressed).toEqual([]);
        // 17563 keyword probes across the corpus at the time of writing; the floor guards against a sweep
        // that silently collected nothing, not against corpus growth.
        expect(sweep.keywordOffered).toBeGreaterThan(1000);
    });

    it("never offers the D vocabulary inside a string body", () => {
        expect(sweep.contentLeaked).toEqual([]);
        // 9480 string-body probes at the time of writing - same floor rationale as above.
        expect(sweep.contentGated).toBeGreaterThan(1000);
    });
});
