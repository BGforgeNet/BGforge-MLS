/**
 * Unit tests for weidu-tp2/completion/context/detectors.ts -- detectContextFromNode().
 *
 * These tests drive detectContextFromNode() directly against real tree-sitter nodes
 * (parsed from actual TP2 source), rather than through the getContextAtPosition()
 * wrapper in ./index.ts. getContextAtPosition() layers a text-based fallback on top
 * for syntax tree-sitter cannot parse (see completion-context.test.ts); these tests
 * isolate detectContextFromNode()'s own ancestor-walking behavior, including cases
 * where the immediate node at the cursor does not itself match and the walk must
 * climb several levels to the enclosing call/definition node.
 */

import { describe, expect, it, beforeAll } from "vitest";
import type { Node as SyntaxNode, Tree } from "web-tree-sitter";
import { getParser, initParser } from "../../../shared/parsers/weidu-tp2";
import { getUtf8ByteOffset } from "../../src/shared/completion-context";
import { detectContextFromNode } from "../../src/weidu-tp2/completion/context/detectors";
import { CompletionContext } from "../../src/weidu-tp2/completion/types";

beforeAll(async () => {
    await initParser();
});

/** Parse textWithCursor (cursor marked by `|`) and return the node + byte offset at the cursor. */
function parseAtCursor(textWithCursor: string): { node: SyntaxNode; cursorOffset: number; tree: Tree } {
    const cursorIndex = textWithCursor.indexOf("|");
    if (cursorIndex === -1) throw new Error("No cursor marker | found");
    const text = textWithCursor.slice(0, cursorIndex) + textWithCursor.slice(cursorIndex + 1);
    const before = textWithCursor.slice(0, cursorIndex);
    const lines = before.split("\n");
    const line = lines.length - 1;
    const character = lines[lines.length - 1]!.length;

    const parser = getParser();
    const tree = parser.parse(text);
    if (!tree) throw new Error("Parser produced no tree");

    const node = tree.rootNode.descendantForPosition({ row: line, column: character });
    if (!node) throw new Error("No node found at cursor position");

    return { node, cursorOffset: getUtf8ByteOffset(text, line, character), tree };
}

function detectAt(textWithCursor: string): CompletionContext[] {
    const { node, cursorOffset } = parseAtCursor(textWithCursor);
    return detectContextFromNode(node, cursorOffset);
}

describe("detectContextFromNode", () => {
    describe("name contexts -- matched via ancestor walk from a leaf identifier", () => {
        it("cursor inside an LAF function name resolves to LafName", () => {
            const contexts = detectAt(`BACKUP ~a~\nAUTHOR ~b~\nBEGIN ~c~\nLAF fu|nc INT_VAR x = 5 END`);
            expect(contexts).toEqual([CompletionContext.LafName]);
        });

        it("cursor inside an LPF function name (inside a patches block) resolves to LpfName", () => {
            const contexts = detectAt(`BACKUP ~a~\nAUTHOR ~b~\nBEGIN ~c~\nCOPY ~a~ ~b~\n  LPF fu|nc INT_VAR x = 5 END`);
            expect(contexts).toEqual([CompletionContext.LpfName]);
        });

        it("cursor inside an LAM macro name resolves to LamName", () => {
            const contexts = detectAt(`BACKUP ~a~\nAUTHOR ~b~\nBEGIN ~c~\nLAM fo|o`);
            expect(contexts).toEqual([CompletionContext.LamName]);
        });

        it("cursor inside an LPM macro name (inside a patches block) resolves to LpmName", () => {
            const contexts = detectAt(`BACKUP ~a~\nAUTHOR ~b~\nBEGIN ~c~\nCOPY ~a~ ~b~\n  LPM fo|o`);
            expect(contexts).toEqual([CompletionContext.LpmName]);
        });
    });

    describe("parameter contexts -- ancestor walk climbs multiple levels from a value leaf", () => {
        it("cursor at the start of a parameter name resolves to FuncParamName", () => {
            const contexts = detectAt(`LAF func INT_VAR |x = 5 END`);
            expect(contexts).toEqual([CompletionContext.FuncParamName]);
        });

        it("cursor inside a parameter's value literal climbs number -> value -> call_item -> call to FuncParamValue", () => {
            const { node } = parseAtCursor(`LAF func INT_VAR x = |5 END`);
            // The node returned at this cursor position is the innermost "number" leaf, not
            // the enclosing call -- proving the walk-up loop, not a direct type match, resolves this.
            expect(node.type).toBe("number");

            const contexts = detectAt(`LAF func INT_VAR x = |5 END`);
            expect(contexts).toEqual([CompletionContext.FuncParamValue]);
        });

        it("cursor in a DEFINE_ACTION_FUNCTION parameter name resolves to FuncParamName", () => {
            const contexts = detectAt(`DEFINE_ACTION_FUNCTION my_func INT_VAR |x BEGIN END`);
            expect(contexts).toEqual([CompletionContext.FuncParamName]);
        });
    });

    describe("no match -- empty array (no filtering)", () => {
        it("cursor in a function-definition body (past params, before the matching boundary check) returns []", () => {
            const contexts = detectAt(`DEFINE_ACTION_FUNCTION my_func BEGIN\n  |\nEND`);
            expect(contexts).toEqual([]);
        });

        it("cursor inside the LAM keyword token itself (before the macro name) returns [] -- rejected, not matched", () => {
            const contexts = detectAt(`BACKUP ~a~\nAUTHOR ~b~\nBEGIN ~c~\nL|AM foo`);
            expect(contexts).toEqual([]);
        });

        it("cursor inside an ordinary action-command body (COPY, no function context) returns []", () => {
            const contexts = detectAt(`BACKUP ~a~\nAUTHOR ~b~\nBEGIN ~c~\nCOPY ~a~ ~b~\n  |`);
            expect(contexts).toEqual([]);
        });

        it("cursor on an ERROR node (incomplete LAF, tree-sitter recovery) returns [] -- no ancestor matches", () => {
            const { node } = parseAtCursor(`BACKUP ~a~\nAUTHOR ~b~\nBEGIN ~c~\nLAF |`);
            expect(node.type).toBe("source_file");

            const contexts = detectAt(`BACKUP ~a~\nAUTHOR ~b~\nBEGIN ~c~\nLAF |`);
            expect(contexts).toEqual([]);
        });

        it("cursor at the top level with no enclosing construct returns []", () => {
            const contexts = detectAt(`BACKUP ~a~\nAUTHOR ~b~\n|`);
            expect(contexts).toEqual([]);
        });
    });
});
