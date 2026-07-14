/**
 * Tests for shared/selection-ranges.ts - tree-sitter based selection-range extraction.
 */

import { describe, expect, it, vi } from "vitest";
import type { SelectionRange } from "vscode-languageserver/node";
import { getSelectionRange, createSelectionRangesProvider } from "../../src/shared/selection-ranges";

interface MockPoint {
    row: number;
    column: number;
}

interface MockNode {
    type: string;
    startPosition: MockPoint;
    endPosition: MockPoint;
    parent: MockNode | null;
    children: MockNode[];
    descendantForPosition(pos: MockPoint): MockNode;
}

function containsPos(node: MockNode, pos: MockPoint): boolean {
    const afterStart =
        pos.row > node.startPosition.row ||
        (pos.row === node.startPosition.row && pos.column >= node.startPosition.column);
    const beforeEnd =
        pos.row < node.endPosition.row || (pos.row === node.endPosition.row && pos.column <= node.endPosition.column);
    return afterStart && beforeEnd;
}

/**
 * Minimal tree-sitter node mock with parent links and a real descendantForPosition
 * implementation (smallest child containing the position, recursively), so tests
 * exercise the actual traversal behavior rather than a canned return value.
 */
function mockNode(type: string, start: [number, number], end: [number, number], children: MockNode[] = []): MockNode {
    const node: MockNode = {
        type,
        startPosition: { row: start[0], column: start[1] },
        endPosition: { row: end[0], column: end[1] },
        parent: null,
        children,
        descendantForPosition(pos: MockPoint): MockNode {
            for (const child of node.children) {
                if (containsPos(child, pos)) {
                    return child.descendantForPosition(pos);
                }
            }
            return node;
        },
    };
    for (const child of children) {
        child.parent = node;
    }
    return node;
}

/** Walk a SelectionRange chain (innermost first) into a flat array via .parent links. */
function chainToArray(range: SelectionRange): SelectionRange[] {
    const result: SelectionRange[] = [];
    let current: SelectionRange | undefined = range;
    while (current) {
        result.push(current);
        current = current.parent;
    }
    return result;
}

/** True when `outer` fully contains `inner` (LSP Range, line/character positions). */
function rangeContains(outer: SelectionRange["range"], inner: SelectionRange["range"]): boolean {
    const startsBefore =
        outer.start.line < inner.start.line ||
        (outer.start.line === inner.start.line && outer.start.character <= inner.start.character);
    const endsAfter =
        outer.end.line > inner.end.line ||
        (outer.end.line === inner.end.line && outer.end.character >= inner.end.character);
    return startsBefore && endsAfter;
}

function rangesEqual(a: SelectionRange["range"], b: SelectionRange["range"]): boolean {
    return (
        a.start.line === b.start.line &&
        a.start.character === b.start.character &&
        a.end.line === b.end.line &&
        a.end.character === b.end.character
    );
}

describe("shared/selection-ranges - getSelectionRange", () => {
    it("yields a chain of strictly-widening ranges, innermost first, each containing the position", () => {
        // program -> procedure -> if_stmt -> block, cursor inside the innermost block.
        // Each ancestor has a distinct span so none collapse into the next.
        const block = mockNode("block", [3, 4], [3, 10]);
        const ifStmt = mockNode("if_stmt", [2, 0], [4, 1], [block]);
        const procedure = mockNode("procedure", [1, 0], [5, 2], [ifStmt]);
        const program = mockNode("program", [0, 0], [6, 0], [procedure]);

        const position = { line: 3, character: 6 };
        const result = getSelectionRange(program as never, position);
        const chain = chainToArray(result);

        expect(chain.map((r) => [r.range.start, r.range.end])).toEqual([
            [
                { line: 3, character: 4 },
                { line: 3, character: 10 },
            ],
            [
                { line: 2, character: 0 },
                { line: 4, character: 1 },
            ],
            [
                { line: 1, character: 0 },
                { line: 5, character: 2 },
            ],
            [
                { line: 0, character: 0 },
                { line: 6, character: 0 },
            ],
        ]);

        // Every range in the chain contains the cursor position.
        for (const r of chain) {
            expect(rangeContains(r.range, { start: position, end: position })).toBe(true);
        }

        // Every range strictly widens (or is equal to, never smaller than) its child,
        // and consecutive ranges in the chain are never identical (duplicates are collapsed).
        for (let i = 1; i < chain.length; i++) {
            expect(rangeContains(chain[i]!.range, chain[i - 1]!.range)).toBe(true);
            expect(rangesEqual(chain[i]!.range, chain[i - 1]!.range)).toBe(false);
        }

        // Outermost link has no parent.
        expect(chain[chain.length - 1]!.parent).toBeUndefined();
    });

    it("collapses ancestors whose span matches their child's (no duplicate consecutive ranges)", () => {
        // expression and identifier share the exact same span - the chain must
        // report that span once, not twice back-to-back.
        const identifier = mockNode("identifier", [0, 0], [0, 5]);
        const expression = mockNode("expression", [0, 0], [0, 5], [identifier]);
        const program = mockNode("program", [0, 0], [1, 0], [expression]);

        const result = getSelectionRange(program as never, { line: 0, character: 2 });
        const chain = chainToArray(result);

        expect(chain).toHaveLength(2);
        expect(chain[0]!.range).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 5 } });
        expect(chain[1]!.range).toEqual({ start: { line: 0, character: 0 }, end: { line: 1, character: 0 } });
    });

    it("yields a short chain (just the enclosing node) for a top-level/whitespace position", () => {
        const procedure = mockNode("procedure", [1, 0], [1, 10]);
        const program = mockNode("program", [0, 0], [3, 0], [procedure]);

        // Position on the blank line after the procedure - not inside any child.
        const result = getSelectionRange(program as never, { line: 2, character: 0 });
        const chain = chainToArray(result);

        expect(chain).toHaveLength(1);
        expect(chain[0]!.range).toEqual({ start: { line: 0, character: 0 }, end: { line: 3, character: 0 } });
        expect(chain[0]!.parent).toBeUndefined();
    });

    it("falls back to a zero-width range at the position when no node is found", () => {
        // Simulate the defensive WASM-binding edge case: descendantForPosition
        // returns null despite its non-nullable type.
        const root = {
            descendantForPosition: () => null,
        } as unknown as Parameters<typeof getSelectionRange>[0];

        const position = { line: 4, character: 2 };
        const result = getSelectionRange(root, position);

        expect(result).toEqual({ range: { start: position, end: position } });
    });
});

describe("shared/selection-ranges - createSelectionRangesProvider", () => {
    it("returns [] when the parser is not initialized", () => {
        const isInitialized = vi.fn().mockReturnValue(false);
        const parseWithCache = vi.fn();
        const provider = createSelectionRangesProvider(isInitialized, parseWithCache as never);

        expect(provider("text", [{ line: 0, character: 0 }])).toEqual([]);
        expect(parseWithCache).not.toHaveBeenCalled();
    });

    it("returns [] when parseWithCache returns null (unparseable/empty document)", () => {
        const isInitialized = vi.fn().mockReturnValue(true);
        const parseWithCache = vi.fn().mockReturnValue(null);
        const provider = createSelectionRangesProvider(isInitialized, parseWithCache as never);

        expect(() => provider("", [{ line: 0, character: 0 }])).not.toThrow();
        expect(provider("", [{ line: 0, character: 0 }])).toEqual([]);
    });

    it("returns one chain per requested position, in the same order", () => {
        const outer = mockNode(
            "program",
            [0, 0],
            [2, 0],
            [mockNode("procedure_a", [0, 0], [0, 5]), mockNode("procedure_b", [1, 0], [1, 5])],
        );
        const isInitialized = vi.fn().mockReturnValue(true);
        const parseWithCache = vi.fn().mockReturnValue({ rootNode: outer });
        const provider = createSelectionRangesProvider(isInitialized, parseWithCache as never);

        const positions = [
            { line: 0, character: 2 },
            { line: 1, character: 2 },
        ];
        const result = provider("procedure_a\nprocedure_b\n", positions);

        expect(result).toHaveLength(2);
        expect(result[0]!.range).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 5 } });
        expect(result[1]!.range).toEqual({ start: { line: 1, character: 0 }, end: { line: 1, character: 5 } });
    });

    it("passes text to parseWithCache", () => {
        const isInitialized = vi.fn().mockReturnValue(true);
        const parseWithCache = vi.fn().mockReturnValue(null);
        const provider = createSelectionRangesProvider(isInitialized, parseWithCache as never);

        provider("the document text", [{ line: 0, character: 0 }]);

        expect(parseWithCache).toHaveBeenCalledWith("the document text");
    });
});
