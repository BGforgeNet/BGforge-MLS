/**
 * Tests for shared/folding-ranges.ts - tree-sitter based folding range extraction.
 */

import { describe, expect, it, vi } from "vitest";
import { FoldingRangeKind } from "vscode-languageserver/node";
import { getFoldingRanges, createFoldingRangesProvider } from "../../src/shared/folding-ranges";

interface MockNode {
    type: string;
    startPosition: { row: number };
    endPosition: { row: number };
    children: MockNode[];
}

/** Minimal tree-sitter node mock for testing. */
function mockNode(type: string, startRow: number, endRow: number, children: MockNode[] = []): MockNode {
    return {
        type,
        startPosition: { row: startRow },
        endPosition: { row: endRow },
        children,
    };
}

describe("shared/folding-ranges", () => {
    const blockTypes = new Set(["procedure", "if_stmt", "while_stmt"]);

    it("returns empty array for empty tree", () => {
        const root = mockNode("program", 0, 0, []);
        const result = getFoldingRanges(root as never, blockTypes);
        expect(result).toEqual([]);
    });

    it("creates folding range for multi-line block node", () => {
        const root = mockNode("program", 0, 5, [
            mockNode("procedure", 0, 5),
        ]);
        const result = getFoldingRanges(root as never, blockTypes);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            startLine: 0,
            endLine: 5,
            kind: undefined,
        });
    });

    it("skips single-line nodes", () => {
        const root = mockNode("program", 0, 3, [
            mockNode("procedure", 2, 2),
        ]);
        const result = getFoldingRanges(root as never, blockTypes);
        expect(result).toEqual([]);
    });

    it("handles nested blocks", () => {
        const root = mockNode("program", 0, 10, [
            mockNode("procedure", 0, 10, [
                mockNode("if_stmt", 2, 5),
                mockNode("while_stmt", 6, 9),
            ]),
        ]);
        const result = getFoldingRanges(root as never, blockTypes);
        expect(result).toHaveLength(3);
        expect(result.map(r => [r.startLine, r.endLine])).toEqual([
            [0, 10],
            [2, 5],
            [6, 9],
        ]);
    });

    it("ignores node types not in the foldable set", () => {
        const root = mockNode("program", 0, 5, [
            mockNode("expression", 0, 5),
        ]);
        const result = getFoldingRanges(root as never, blockTypes);
        expect(result).toEqual([]);
    });

    it("folds multi-line comments with Comment kind", () => {
        const root = mockNode("program", 0, 10, [
            mockNode("comment", 0, 3),
        ]);
        const result = getFoldingRanges(root as never, blockTypes);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            startLine: 0,
            endLine: 3,
            kind: FoldingRangeKind.Comment,
        });
    });

    it("folds line_comment as Comment kind", () => {
        const root = mockNode("program", 0, 5, [
            mockNode("line_comment", 1, 3),
        ]);
        const result = getFoldingRanges(root as never, blockTypes);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            startLine: 1,
            endLine: 3,
            kind: FoldingRangeKind.Comment,
        });
    });

    it("skips single-line comments", () => {
        const root = mockNode("program", 0, 5, [
            mockNode("comment", 2, 2),
        ]);
        const result = getFoldingRanges(root as never, blockTypes);
        expect(result).toEqual([]);
    });

    it("handles deeply nested structures", () => {
        const root = mockNode("program", 0, 20, [
            mockNode("procedure", 0, 20, [
                mockNode("if_stmt", 1, 15, [
                    mockNode("while_stmt", 3, 10),
                ]),
            ]),
        ]);
        const result = getFoldingRanges(root as never, blockTypes);
        expect(result).toHaveLength(3);
        expect(result.map(r => r.startLine)).toEqual([0, 1, 3]);
    });

    it("handles mixed block types and comments", () => {
        const root = mockNode("program", 0, 15, [
            mockNode("comment", 0, 2),
            mockNode("procedure", 4, 10),
            mockNode("comment", 12, 15),
        ]);
        const result = getFoldingRanges(root as never, blockTypes);
        expect(result).toHaveLength(3);
        expect(result[0].kind).toBe(FoldingRangeKind.Comment);
        expect(result[1].kind).toBeUndefined();
        expect(result[2].kind).toBe(FoldingRangeKind.Comment);
    });

    it("finds foldable nodes nested inside non-foldable parents", () => {
        const root = mockNode("program", 0, 15, [
            mockNode("expression", 0, 12, [
                mockNode("procedure", 2, 8),
                mockNode("if_stmt", 9, 11),
            ]),
        ]);
        const result = getFoldingRanges(root as never, blockTypes);
        // The expression node is not foldable, but its children are
        expect(result).toHaveLength(2);
        expect(result.map(r => [r.startLine, r.endLine])).toEqual([
            [2, 8],
            [9, 11],
        ]);
    });

    it("works with empty blockTypes set", () => {
        const root = mockNode("program", 0, 5, [
            mockNode("procedure", 0, 5),
            mockNode("comment", 6, 8),
        ]);
        const result = getFoldingRanges(root as never, new Set());
        // Only comment should fold
        expect(result).toHaveLength(1);
        expect(result[0].kind).toBe(FoldingRangeKind.Comment);
    });
});

describe("shared/folding-ranges — createFoldingRangesProvider", () => {
    const blockTypes = new Set(["procedure", "if_stmt"]);

    function makeRoot(children: ReturnType<typeof mockNode>[] = []) {
        return mockNode("program", 0, 10, children);
    }

    it("returns empty array when parser is not initialized", () => {
        const isInitialized = vi.fn().mockReturnValue(false);
        const parseWithCache = vi.fn();
        const provider = createFoldingRangesProvider(isInitialized, parseWithCache as never, blockTypes);

        expect(provider("some text")).toEqual([]);
        expect(parseWithCache).not.toHaveBeenCalled();
    });

    it("returns empty array when parseWithCache returns null", () => {
        const isInitialized = vi.fn().mockReturnValue(true);
        const parseWithCache = vi.fn().mockReturnValue(null);
        const provider = createFoldingRangesProvider(isInitialized, parseWithCache as never, blockTypes);

        expect(provider("some text")).toEqual([]);
    });

    it("returns folding ranges for a parsed tree", () => {
        const root = makeRoot([mockNode("procedure", 1, 5)]);
        const isInitialized = vi.fn().mockReturnValue(true);
        const parseWithCache = vi.fn().mockReturnValue({ rootNode: root });
        const provider = createFoldingRangesProvider(isInitialized, parseWithCache as never, blockTypes);

        const result = provider("procedure text");

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ startLine: 1, endLine: 5 });
    });

    it("passes text argument to parseWithCache", () => {
        const isInitialized = vi.fn().mockReturnValue(true);
        const parseWithCache = vi.fn().mockReturnValue(null);
        const provider = createFoldingRangesProvider(isInitialized, parseWithCache as never, blockTypes);

        provider("the document text");

        expect(parseWithCache).toHaveBeenCalledWith("the document text");
    });
});
