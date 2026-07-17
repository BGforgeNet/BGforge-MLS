/**
 * Tests for shared/string-check.ts - createIsInsideString factory.
 *
 * Unlike comments (leaf nodes), a string literal usually has child tokens - the
 * cursor's leaf node is a descendant of the string node, so the check walks
 * ancestors, not just the leaf. Covers the not-initialized and null-parse
 * short-circuits plus the ancestor-walk classification.
 */

import { describe, expect, it, vi } from "vitest";
import { createIsInsideString } from "../../src/shared/string-check";
import type { Position } from "vscode-languageserver/node";

const STRING_TYPES = new Set(["double_string", "tilde_string"]);
const POS: Position = { line: 0, character: 3 };

describe("shared/string-check - createIsInsideString", () => {
    it("returns false when parser is not initialized", () => {
        const isInitialized = vi.fn().mockReturnValue(false);
        const parseWithCache = vi.fn();
        const check = createIsInsideString(isInitialized, parseWithCache as never, STRING_TYPES);

        expect(check("text", POS)).toBe(false);
        expect(parseWithCache).not.toHaveBeenCalled();
    });

    it("returns false when parseWithCache returns null", () => {
        const isInitialized = vi.fn().mockReturnValue(true);
        const parseWithCache = vi.fn().mockReturnValue(null);
        const check = createIsInsideString(isInitialized, parseWithCache as never, STRING_TYPES);

        expect(check("text", POS)).toBe(false);
    });

    it("returns true when the leaf node itself is a string", () => {
        const leaf = { type: "double_string", parent: null };
        const rootNode = { descendantForPosition: vi.fn().mockReturnValue(leaf) };
        const check = createIsInsideString(
            vi.fn().mockReturnValue(true),
            vi.fn().mockReturnValue({ rootNode }) as never,
            STRING_TYPES,
        );

        expect(check('"file.baf"', POS)).toBe(true);
    });

    it("returns true when a string is an ANCESTOR of the cursor's leaf token", () => {
        // leaf (path content) -> double_string -> action_include
        const stringNode = { type: "double_string", parent: { type: "action_include", parent: null } };
        const leaf = { type: "string_content", parent: stringNode };
        const rootNode = { descendantForPosition: vi.fn().mockReturnValue(leaf) };
        const check = createIsInsideString(
            vi.fn().mockReturnValue(true),
            vi.fn().mockReturnValue({ rootNode }) as never,
            STRING_TYPES,
        );

        expect(check('INCLUDE "file.tpa"', POS)).toBe(true);
    });

    it("returns false when no ancestor is a string (plain code identifier)", () => {
        const leaf = { type: "identifier", parent: { type: "function_call", parent: null } };
        const rootNode = { descendantForPosition: vi.fn().mockReturnValue(leaf) };
        const check = createIsInsideString(
            vi.fn().mockReturnValue(true),
            vi.fn().mockReturnValue({ rootNode }) as never,
            STRING_TYPES,
        );

        expect(check("Foo()", POS)).toBe(false);
    });

    it("returns false when descendantForPosition returns null", () => {
        const rootNode = { descendantForPosition: vi.fn().mockReturnValue(null) };
        const check = createIsInsideString(
            vi.fn().mockReturnValue(true),
            vi.fn().mockReturnValue({ rootNode }) as never,
            STRING_TYPES,
        );

        expect(check("", POS)).toBe(false);
    });

    it("probes one column back at the string's closing boundary", () => {
        // At the exclusive end column the leaf resolves to a non-string parent; the
        // one-back probe lands inside the string.
        const stringNode = { type: "tilde_string", parent: null };
        const insideLeaf = { type: "string_content", parent: stringNode };
        const outsideLeaf = { type: "action", parent: null };
        const descendantForPosition = vi.fn((p: { column: number }) =>
            p.column === POS.character ? outsideLeaf : insideLeaf,
        );
        const rootNode = { descendantForPosition };
        const check = createIsInsideString(
            vi.fn().mockReturnValue(true),
            vi.fn().mockReturnValue({ rootNode }) as never,
            STRING_TYPES,
        );

        expect(check("~file~", POS)).toBe(true);
        expect(descendantForPosition).toHaveBeenCalledWith({ row: POS.line, column: POS.character - 1 });
    });
});
