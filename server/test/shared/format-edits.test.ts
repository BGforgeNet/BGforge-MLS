/**
 * Tests for shared/format-edits.ts — LSP document edit helpers.
 */

import { describe, expect, it } from "vitest";
import { createFullDocumentEdit } from "../../src/shared/format-edits";

describe("shared/format-edits", () => {
    describe("createFullDocumentEdit()", () => {
        it("should create a single edit replacing entire document", () => {
            const original = "line1\nline2\nline3";
            const newText = "new content";

            const edits = createFullDocumentEdit(original, newText);

            expect(edits).toHaveLength(1);
            expect(edits[0]!.newText).toBe(newText);
        });

        it("should set correct range for single line", () => {
            const original = "single line";
            const newText = "replaced";

            const edits = createFullDocumentEdit(original, newText);

            expect(edits[0]!.range.start).toEqual({ line: 0, character: 0 });
            expect(edits[0]!.range.end).toEqual({ line: 0, character: 11 });
        });

        it("should set correct range for multiple lines", () => {
            const original = "line1\nline2\nline3";
            const newText = "replaced";

            const edits = createFullDocumentEdit(original, newText);

            expect(edits[0]!.range.start).toEqual({ line: 0, character: 0 });
            expect(edits[0]!.range.end).toEqual({ line: 2, character: 5 });
        });

        it("should handle empty last line", () => {
            const original = "line1\nline2\n";
            const newText = "replaced";

            const edits = createFullDocumentEdit(original, newText);

            expect(edits[0]!.range.end).toEqual({ line: 2, character: 0 });
        });

        it("should handle empty document", () => {
            const original = "";
            const newText = "new content";

            const edits = createFullDocumentEdit(original, newText);

            expect(edits[0]!.range.start).toEqual({ line: 0, character: 0 });
            expect(edits[0]!.range.end).toEqual({ line: 0, character: 0 });
        });
    });
});
