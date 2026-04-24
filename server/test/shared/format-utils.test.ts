/**
 * Tests for shared/format-utils.ts - formatting utilities.
 */

import { describe, expect, it } from "vitest";
import {
    createFullDocumentEdit,
    stripCommentsWeidu,
    stripCommentsFalloutSsl,
    stripCommentsTra,
    stripCommentsFalloutMsg,
    stripComments2da,
    stripCommentsFalloutScriptsLst,
    validateFormatting,
} from "../../src/shared/format-utils";

describe("shared/format-utils", () => {
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

    describe("stripCommentsWeidu()", () => {
        it("should remove line comments", () => {
            const input = "code // comment\nmore";
            const result = stripCommentsWeidu(input);

            expect(result).toBe("code \nmore");
        });

        it("should remove block comments", () => {
            const input = "code /* block comment */ more";
            const result = stripCommentsWeidu(input);

            expect(result).toBe("code  more");
        });

        it("should remove multiline block comments", () => {
            const input = "code /* line1\nline2\nline3 */ more";
            const result = stripCommentsWeidu(input);

            expect(result).toBe("code  more");
        });

        it("should preserve tilde strings", () => {
            const input = "~string with // comment~";
            const result = stripCommentsWeidu(input);

            expect(result).toBe("~string with // comment~");
        });

        it("should preserve double-quoted strings", () => {
            const input = '"string with // comment"';
            const result = stripCommentsWeidu(input);

            expect(result).toBe('"string with // comment"');
        });

        it("should handle escaped characters in strings", () => {
            const input = '"string with \\" quote"';
            const result = stripCommentsWeidu(input);

            expect(result).toBe('"string with \\" quote"');
        });

        it("should handle five-tilde strings", () => {
            const input = "~~~~~string with ~ tilde~~~~~";
            const result = stripCommentsWeidu(input);

            expect(result).toBe("~~~~~string with ~ tilde~~~~~");
        });

        it("should handle unclosed block comments", () => {
            const input = "code /* unclosed";
            const result = stripCommentsWeidu(input);

            expect(result).toBe("code ");
        });

        it("should preserve normal content", () => {
            const input = "ACTION IF_EXISTS";
            const result = stripCommentsWeidu(input);

            expect(result).toBe("ACTION IF_EXISTS");
        });
    });

    describe("stripCommentsFalloutSsl()", () => {
        it("should remove line comments", () => {
            const input = "code // comment\nmore";
            const result = stripCommentsFalloutSsl(input);

            expect(result).toBe("code \nmore");
        });

        it("should remove block comments", () => {
            const input = "code /* block comment */ more";
            const result = stripCommentsFalloutSsl(input);

            expect(result).toBe("code  more");
        });

        it("should preserve double-quoted strings", () => {
            const input = '"string with // comment"';
            const result = stripCommentsFalloutSsl(input);

            expect(result).toBe('"string with // comment"');
        });

        it("should handle escaped characters in strings", () => {
            const input = '"string with \\" quote"';
            const result = stripCommentsFalloutSsl(input);

            expect(result).toBe('"string with \\" quote"');
        });

        it("should handle unclosed block comments", () => {
            const input = "code /* unclosed";
            const result = stripCommentsFalloutSsl(input);

            expect(result).toBe("code ");
        });

        it("should preserve normal content", () => {
            const input = "procedure my_proc begin end";
            const result = stripCommentsFalloutSsl(input);

            expect(result).toBe("procedure my_proc begin end");
        });
    });

    describe("validateFormatting()", () => {
        it("should return null when content is unchanged", () => {
            const original = "code()";
            const formatted = "  code()  ";

            const result = validateFormatting(original, formatted, stripCommentsFalloutSsl);

            expect(result).toBeNull();
        });

        it("should return null when only whitespace changed", () => {
            const original = "func(a,b)";
            const formatted = "func( a , b )";

            const result = validateFormatting(original, formatted, stripCommentsFalloutSsl);

            expect(result).toBeNull();
        });

        it("should return error when content changed", () => {
            const original = "func(a)";
            const formatted = "func(b)";

            const result = validateFormatting(original, formatted, stripCommentsFalloutSsl);

            expect(result).not.toBeNull();
            expect(result).toContain("Formatter changed content");
        });

        it("should return error with context when content changed", () => {
            const original = "something original here";
            const formatted = "something modified here";

            const result = validateFormatting(original, formatted, stripCommentsFalloutSsl);

            expect(result).toContain("position");
        });

        it("should ignore comments when validating", () => {
            const original = "code() // comment";
            const formatted = "code()";

            const result = validateFormatting(original, formatted, stripCommentsFalloutSsl);

            expect(result).toBeNull();
        });

        it("should detect added characters", () => {
            const original = "abc";
            const formatted = "abcd";

            const result = validateFormatting(original, formatted, stripCommentsFalloutSsl);

            expect(result).not.toBeNull();
        });

        it("should detect removed characters", () => {
            const original = "abcd";
            const formatted = "abc";

            const result = validateFormatting(original, formatted, stripCommentsFalloutSsl);

            expect(result).not.toBeNull();
        });

        it("should work with WeiDU comment stripper", () => {
            const original = "ACTION /* comment */";
            const formatted = "ACTION";

            const result = validateFormatting(original, formatted, stripCommentsWeidu);

            expect(result).toBeNull();
        });
    });

    describe("stripCommentsTra()", () => {
        it("should remove line comments", () => {
            const result = stripCommentsTra("@1 = ~text~ // comment\n@2 = ~more~");
            expect(result).not.toContain("// comment");
            expect(result).toContain("1");
            expect(result).toContain("text");
        });

        it("should remove block comments", () => {
            const result = stripCommentsTra("/* block */ @1 = ~text~");
            expect(result).not.toContain("block");
            expect(result).toContain("text");
        });

        it("should strip single tilde delimiters, keeping content", () => {
            const result = stripCommentsTra("@1 = ~hello world~");
            expect(result).not.toContain("~");
            expect(result).toContain("hello world");
        });

        it("should strip multi-tilde delimiters, keeping content", () => {
            const result = stripCommentsTra("@1 = ~~~~~text with ~ tildes~~~~~");
            expect(result).not.toContain("~~~~~");
            expect(result).toContain("text with ~ tildes");
        });

        it("should strip double-quote delimiters, keeping content", () => {
            const result = stripCommentsTra('@1 = "double quoted"');
            expect(result).not.toContain('"');
            expect(result).toContain("double quoted");
        });

        it("should handle backslash escapes in double-quoted strings", () => {
            const result = stripCommentsTra('@1 = "line one\\nnew"');
            expect(result).not.toContain('"');
            expect(result).toContain("line one\\nnew");
        });

        it("should remove [SOUNDFILE] sound references", () => {
            const result = stripCommentsTra("@100 = ~text~ [SOUND01]");
            expect(result).not.toContain("[SOUND01]");
            expect(result).toContain("text");
        });

        it("should keep entry numbers and @ and = signs", () => {
            const result = stripCommentsTra("@1 = ~text~");
            expect(result).toContain("@");
            expect(result).toContain("1");
            expect(result).toContain("=");
        });

        it("should handle empty input", () => {
            expect(stripCommentsTra("")).toBe("");
        });

        it("should handle text with no strings or comments", () => {
            const input = "@1 = ";
            const result = stripCommentsTra(input);
            expect(result).toContain("@");
            expect(result).toContain("1");
        });
    });

    describe("stripCommentsFalloutMsg()", () => {
        it("should remove comment lines (lines not starting with {)", () => {
            const result = stripCommentsFalloutMsg("This is a comment\n{100}{}{text}");
            expect(result).not.toContain("This is a comment");
            expect(result).toContain("100");
            expect(result).toContain("text");
        });

        it("should keep entry numbers and text content", () => {
            const result = stripCommentsFalloutMsg("{100}{audio}{Hello world}");
            expect(result).toContain("100");
            expect(result).toContain("Hello world");
        });

        it("should remove braces from entries", () => {
            const result = stripCommentsFalloutMsg("{100}{}{text}");
            expect(result).not.toContain("{");
            expect(result).not.toContain("}");
        });

        it("should remove the audio field", () => {
            const result = stripCommentsFalloutMsg("{100}{audio_file}{text}");
            expect(result).not.toContain("audio_file");
            expect(result).toContain("100");
            expect(result).toContain("text");
        });

        it("should handle multiline text fields", () => {
            const result = stripCommentsFalloutMsg("{100}{}{line one\nline two}");
            expect(result).toContain("100");
            expect(result).toContain("line one");
            expect(result).toContain("line two");
        });

        it("should handle empty input", () => {
            expect(stripCommentsFalloutMsg("")).toBe("");
        });

        it("should handle multiple entries", () => {
            const input = "{100}{}{first}\n{200}{}{second}";
            const result = stripCommentsFalloutMsg(input);
            expect(result).toContain("100");
            expect(result).toContain("first");
            expect(result).toContain("200");
            expect(result).toContain("second");
        });
    });

    describe("stripComments2da()", () => {
        it("should return text unchanged (2DA has no comments)", () => {
            const input = "2DA V1.0\nDEFAULT 0\n  COL1 COL2\nROW1  val1 val2";
            expect(stripComments2da(input)).toBe(input);
        });

        it("should handle empty input", () => {
            expect(stripComments2da("")).toBe("");
        });

        it("should preserve all tokens", () => {
            const input = "  COL1 COL2\nROW1  val1 val2";
            expect(stripComments2da(input)).toBe(input);
        });
    });

    describe("stripCommentsFalloutScriptsLst()", () => {
        it("returns the input unchanged (no stripping needed for scripts.lst)", () => {
            const input = "SCRIPT_SOME_PROC  // comment\nSCRIPT_OTHER";
            expect(stripCommentsFalloutScriptsLst(input)).toBe(input);
        });

        it("returns empty string for empty input", () => {
            expect(stripCommentsFalloutScriptsLst("")).toBe("");
        });
    });
});
