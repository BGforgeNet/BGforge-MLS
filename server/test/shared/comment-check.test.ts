/**
 * Tests for shared/comment-check.ts — createIsInsideComment factory.
 * Covers the not-initialized branch (line 23) and the null-parse branch (line 27),
 * as well as the normal path where a position is checked against comment node types.
 */

import { describe, expect, it, vi } from "vitest";
import { createIsInsideComment } from "../../src/shared/comment-check";
import type { Position } from "vscode-languageserver/node";

const COMMENT_TYPES = new Set(["comment", "line_comment"]);

describe("shared/comment-check — createIsInsideComment", () => {
    it("returns false when parser is not initialized", () => {
        const isInitialized = vi.fn().mockReturnValue(false);
        const parseWithCache = vi.fn();
        const check = createIsInsideComment(isInitialized, parseWithCache as never, COMMENT_TYPES);
        const pos: Position = { line: 0, character: 0 };

        expect(check("text", pos)).toBe(false);
        expect(parseWithCache).not.toHaveBeenCalled();
    });

    it("returns false when parseWithCache returns null", () => {
        const isInitialized = vi.fn().mockReturnValue(true);
        const parseWithCache = vi.fn().mockReturnValue(null);
        const check = createIsInsideComment(isInitialized, parseWithCache as never, COMMENT_TYPES);
        const pos: Position = { line: 0, character: 0 };

        expect(check("text", pos)).toBe(false);
    });

    it("returns true when descendant node type is in commentTypes", () => {
        const commentNode = { type: "comment" };
        const rootNode = {
            descendantForPosition: vi.fn().mockReturnValue(commentNode),
        };
        const isInitialized = vi.fn().mockReturnValue(true);
        const parseWithCache = vi.fn().mockReturnValue({ rootNode });
        const check = createIsInsideComment(isInitialized, parseWithCache as never, COMMENT_TYPES);
        const pos: Position = { line: 1, character: 5 };

        expect(check("// some comment", pos)).toBe(true);
    });

    it("returns false when descendant node type is not in commentTypes", () => {
        const codeNode = { type: "identifier" };
        const rootNode = {
            descendantForPosition: vi.fn().mockReturnValue(codeNode),
        };
        const isInitialized = vi.fn().mockReturnValue(true);
        const parseWithCache = vi.fn().mockReturnValue({ rootNode });
        const check = createIsInsideComment(isInitialized, parseWithCache as never, COMMENT_TYPES);
        const pos: Position = { line: 0, character: 3 };

        expect(check("foo", pos)).toBe(false);
    });

    it("returns false when descendantForPosition returns null", () => {
        const rootNode = {
            descendantForPosition: vi.fn().mockReturnValue(null),
        };
        const isInitialized = vi.fn().mockReturnValue(true);
        const parseWithCache = vi.fn().mockReturnValue({ rootNode });
        const check = createIsInsideComment(isInitialized, parseWithCache as never, COMMENT_TYPES);
        const pos: Position = { line: 0, character: 0 };

        expect(check("", pos)).toBe(false);
    });

    it("passes correct position row and column to descendantForPosition", () => {
        const node = { type: "line_comment" };
        const descendantForPosition = vi.fn().mockReturnValue(node);
        const rootNode = { descendantForPosition };
        const isInitialized = vi.fn().mockReturnValue(true);
        const parseWithCache = vi.fn().mockReturnValue({ rootNode });
        const check = createIsInsideComment(isInitialized, parseWithCache as never, COMMENT_TYPES);
        const pos: Position = { line: 3, character: 7 };

        check("text", pos);

        expect(descendantForPosition).toHaveBeenCalledWith({ row: 3, column: 7 });
    });
});
