/**
 * Unit tests for core/position-utils.ts - shared position/range helpers.
 */

import { describe, expect, it } from "vitest";
import { containsPosition } from "../../src/core/position-utils";

/** Minimal node carrying only the start/end positions containsPosition reads. */
function nodeAt(startRow: number, startCol: number, endRow: number, endCol: number) {
    return {
        startPosition: { row: startRow, column: startCol },
        endPosition: { row: endRow, column: endCol },
    };
}

describe("containsPosition", () => {
    const node = nodeAt(2, 4, 5, 10);

    it("returns true for a position strictly inside a multi-line node", () => {
        expect(containsPosition({ line: 3, character: 0 }, node)).toBe(true);
    });

    it("returns false for a position on a line before the node", () => {
        expect(containsPosition({ line: 1, character: 99 }, node)).toBe(false);
    });

    it("returns false for a position on a line after the node", () => {
        expect(containsPosition({ line: 6, character: 0 }, node)).toBe(false);
    });

    it("includes the start boundary (character === startColumn)", () => {
        expect(containsPosition({ line: 2, character: 4 }, node)).toBe(true);
    });

    it("excludes one column before the start on the start line", () => {
        expect(containsPosition({ line: 2, character: 3 }, node)).toBe(false);
    });

    it("includes the end boundary (character === endColumn)", () => {
        expect(containsPosition({ line: 5, character: 10 }, node)).toBe(true);
    });

    it("excludes one column past the end on the end line", () => {
        expect(containsPosition({ line: 5, character: 11 }, node)).toBe(false);
    });

    it("handles a single-line node", () => {
        const single = nodeAt(0, 2, 0, 6);
        expect(containsPosition({ line: 0, character: 4 }, single)).toBe(true);
        expect(containsPosition({ line: 0, character: 1 }, single)).toBe(false);
        expect(containsPosition({ line: 0, character: 7 }, single)).toBe(false);
    });
});
