/**
 * Tests for format utilities (comment stripping, validation).
 */

import { describe, expect, it } from "vitest";
import {
    stripCommentsWeidu,
    stripCommentsWeiduD,
    stripCommentsFalloutSsl,
    stripCommentsForCompareFalloutSsl,
    stripCommentsTra,
    stripCommentsFalloutMsg,
    stripComments2da,
    stripCommentsFalloutScriptsLst,
    validateFormatting,
} from "@bgforge/format";
import {
    scanTildeDelimiter,
    normalizeComment,
    normalizeLineComment,
    normalizeBlockComment,
    weiduLineCommentStart,
} from "@bgforge/format/internal";

describe("shared/format-utils", () => {
    describe("weiduLineCommentStart()", () => {
        it("finds a line comment after code", () => {
            expect(weiduLineCommentStart("COPY ~a~ ~b~ // note")).toBe(13);
        });

        it("ignores // inside a tilde, quote or five-tilde string", () => {
            expect(weiduLineCommentStart("PRINT ~http://a.b~")).toBe(-1);
            expect(weiduLineCommentStart('PRINT "http://a.b"')).toBe(-1);
            expect(weiduLineCommentStart("PRINT ~~~~~http://a.b~~~~~")).toBe(-1);
        });

        it("finds the comment that follows a string holding //", () => {
            expect(weiduLineCommentStart("PRINT ~http://a.b~ // note")).toBe(19);
        });

        it("ignores // inside a block comment", () => {
            expect(weiduLineCommentStart("/* see http://a.b */ PRINT ~x~")).toBe(-1);
        });
    });

    describe("normalizeLineComment()", () => {
        it("adds one space after // when missing", () => {
            expect(normalizeLineComment("//foo")).toBe("// foo");
        });

        it("keeps a single existing space", () => {
            expect(normalizeLineComment("// foo")).toBe("// foo");
        });

        it("collapses intentional multi-space alignment", () => {
            expect(normalizeLineComment("//   aligned")).toBe("// aligned");
        });

        it("collapses a leading tab to one space", () => {
            expect(normalizeLineComment("//\tindented")).toBe("// indented");
        });

        it("trims trailing whitespace", () => {
            expect(normalizeLineComment("//foo   ")).toBe("// foo");
        });

        it("returns bare // for an empty comment", () => {
            expect(normalizeLineComment("//")).toBe("//");
        });

        it("preserves all-slash decorative dividers verbatim", () => {
            expect(normalizeLineComment("//////////")).toBe("//////////");
        });
    });

    describe("normalizeBlockComment()", () => {
        it("normalizes single-line block spacing", () => {
            expect(normalizeBlockComment("/*foo*/")).toBe("/* foo */");
            expect(normalizeBlockComment("/*  x  */")).toBe("/* x */");
        });

        it("returns /* */ for an empty block", () => {
            expect(normalizeBlockComment("/**/")).toBe("/* */");
        });

        it("normalizes only the edges of a multiline block, preserving interior", () => {
            expect(normalizeBlockComment("/*Multi\n * line\n * end*/")).toBe("/* Multi\n * line\n * end */");
        });

        it("leaves a JSDoc-shaped multiline block unchanged", () => {
            const jsdoc = "/*\n * line one\n * line two\n */";
            expect(normalizeBlockComment(jsdoc)).toBe(jsdoc);
        });

        it("preserves a /** doc-comment opener instead of splitting it into /* *", () => {
            const doc = "/**\n * test\n * @arg {int} x\n */";
            expect(normalizeBlockComment(doc)).toBe(doc);
        });

        it("keeps a single-line /** opener tight", () => {
            expect(normalizeBlockComment("/** foo */")).toBe("/** foo */");
            expect(normalizeBlockComment("/**foo*/")).toBe("/** foo */");
        });

        it("treats empty /**/ as an empty block, not a doc comment", () => {
            expect(normalizeBlockComment("/**/")).toBe("/* */");
        });
    });

    describe("normalizeComment()", () => {
        it("dispatches to line normalization", () => {
            expect(normalizeComment("//   x")).toBe("// x");
        });

        it("dispatches to block normalization", () => {
            expect(normalizeComment("/*  x  */")).toBe("/* x */");
        });

        it("preserves dividers via the line branch", () => {
            expect(normalizeComment("//////")).toBe("//////");
        });
    });

    describe("scanTildeDelimiter()", () => {
        it("scans a single-tilde string", () => {
            expect(scanTildeDelimiter("~hello~", 0)).toEqual({ delimLen: 1, contentStart: 1, closerStart: 6 });
        });

        it("scans a multi-tilde (five-tilde) string", () => {
            expect(scanTildeDelimiter("~~~~~hi~~~~~", 0)).toEqual({ delimLen: 5, contentStart: 5, closerStart: 7 });
        });

        it("treats 2-4 consecutive tildes as single-tilde delimiters", () => {
            // ~~ is an empty single-tilde string: opener at 0, closer (the second ~) at 1
            expect(scanTildeDelimiter("~~rest", 0)).toEqual({ delimLen: 1, contentStart: 1, closerStart: 1 });
        });

        it("reports closerStart -1 for an unclosed single-tilde string", () => {
            expect(scanTildeDelimiter("~unterminated", 0)).toEqual({ delimLen: 1, contentStart: 1, closerStart: -1 });
        });

        it("reports closerStart -1 for an unclosed multi-tilde string", () => {
            expect(scanTildeDelimiter("~~~~~unterminated", 0)).toEqual({
                delimLen: 5,
                contentStart: 5,
                closerStart: -1,
            });
        });

        it("ignores internal single tildes inside a multi-tilde string", () => {
            // The internal ` ~ ` must not be mistaken for the closer.
            const text = "~~~~~a ~ b~~~~~";
            expect(scanTildeDelimiter(text, 0)).toEqual({ delimLen: 5, contentStart: 5, closerStart: 10 });
        });

        it("scans from a non-zero start position", () => {
            expect(scanTildeDelimiter("code ~x~", 5)).toEqual({ delimLen: 1, contentStart: 6, closerStart: 7 });
        });
    });

    // The strippers keep each string's whitespace as visible `\\u{..}` escapes (dropping `\\r`), so
    // validateFormatting, which deletes all whitespace, still sees whitespace changed inside a string.
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

            expect(result).toBe("~string\\u{20}with\\u{20}//\\u{20}comment~");
        });

        it("should preserve double-quoted strings", () => {
            const input = '"string with // comment"';
            const result = stripCommentsWeidu(input);

            expect(result).toBe('"string\\u{20}with\\u{20}//\\u{20}comment"');
        });

        it("should handle escaped characters in strings", () => {
            const input = '"string with \\" quote"';
            const result = stripCommentsWeidu(input);

            expect(result).toBe('"string\\u{20}with\\u{20}\\"\\u{20}quote"');
        });

        it("should handle five-tilde strings", () => {
            const input = "~~~~~string with ~ tilde~~~~~";
            const result = stripCommentsWeidu(input);

            expect(result).toBe("~~~~~string\\u{20}with\\u{20}~\\u{20}tilde~~~~~");
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

            expect(result).toBe('"string\\u{20}with\\u{20}//\\u{20}comment"');
        });

        it("should handle escaped characters in strings", () => {
            const input = '"string with \\" quote"';
            const result = stripCommentsFalloutSsl(input);

            expect(result).toBe('"string\\u{20}with\\u{20}\\"\\u{20}quote"');
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

    describe("validateFormatting() on whitespace inside strings", () => {
        // Whitespace between tokens is the formatter's to change; whitespace inside a string is content.
        it("catches changed whitespace inside a WeiDU string", () => {
            expect(validateFormatting("PRINT ~a  b~", "PRINT ~a b~", stripCommentsWeidu)).not.toBeNull();
        });

        it("catches a tab in a Fallout SSL string turned into spaces", () => {
            expect(
                validateFormatting('x := "a\tb";', 'x := "a    b";', stripCommentsForCompareFalloutSsl),
            ).not.toBeNull();
        });

        it("catches changed whitespace inside a .tra string", () => {
            expect(validateFormatting("@1 = ~a  b~", "@1 = ~a b~", stripCommentsTra)).not.toBeNull();
            expect(validateFormatting("@1 = %a  b%", "@1 = %a b%", stripCommentsTra)).not.toBeNull();
        });

        // A multi-byte encoding such as Big5 can put a `~` byte inside a %-delimited string; it is content there,
        // as it is to the grammar, so it must not open a string that swallows the blank lines after it.
        it("reads a tilde inside a .tra %string% as content", () => {
            expect(validateFormatting("@1 = %x~y%\n\n\n@2 = ~z~", "@1 = %x~y%\n@2 = ~z~", stripCommentsTra)).toBeNull();
        });

        it("catches changed whitespace inside a .msg text field", () => {
            expect(validateFormatting("{1}{}{a  b}", "{1}{}{a b}", stripCommentsFalloutMsg)).not.toBeNull();
        });

        it("catches a .msg entry dropped from the end of a line", () => {
            expect(validateFormatting("{1}{}{a}{2}{}{b}\n", "{1}{}{a}\n", stripCommentsFalloutMsg)).not.toBeNull();
        });

        it("still lets whitespace between tokens change", () => {
            expect(validateFormatting("COPY   ~a b~  ~c~", "COPY ~a b~ ~c~", stripCommentsWeidu)).toBeNull();
            expect(validateFormatting("{ 1 }{ }{a b}", "{1}{}{a b}", stripCommentsFalloutMsg)).toBeNull();
        });

        it("treats a CRLF inside a string as the same line break as LF", () => {
            expect(validateFormatting("PRINT ~a\r\nb~", "PRINT ~a\nb~", stripCommentsWeidu)).toBeNull();
        });

        // A D trigger or action string is code the D formatter reformats, so D compares strings as code.
        it("lets the D formatter re-indent a trigger's continuation lines", () => {
            const source = 'IF ~Global("A","LOCALS",1)\nGlobal("B","LOCALS",0)~ THEN GOTO x';
            const formatted = 'IF ~Global("A","LOCALS",1)\n    Global("B","LOCALS",0)~ THEN GOTO x';
            expect(validateFormatting(source, formatted, stripCommentsWeiduD)).toBeNull();
            expect(validateFormatting(source, formatted, stripCommentsWeidu)).not.toBeNull();
        });

        it("lets the D formatter space a comment inside an action", () => {
            const source = 'DO ~CreateItem("POTN10",Myself) // Potion~';
            const formatted = 'DO ~CreateItem("POTN10",Myself)  // Potion~';
            expect(validateFormatting(source, formatted, stripCommentsWeiduD)).toBeNull();
        });

        it("still catches D content changed inside a string", () => {
            expect(validateFormatting("SAY ~ab~", "SAY ~a~", stripCommentsWeiduD)).not.toBeNull();
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
            expect(result).toContain("content changed");
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
            expect(result).toContain("hello\\u{20}world");
        });

        it("should strip multi-tilde delimiters, keeping content", () => {
            const result = stripCommentsTra("@1 = ~~~~~text with ~ tildes~~~~~");
            expect(result).not.toContain("~~~~~");
            expect(result).toContain("text\\u{20}with\\u{20}~\\u{20}tildes");
        });

        it("should strip double-quote delimiters, keeping content", () => {
            const result = stripCommentsTra('@1 = "double quoted"');
            expect(result).not.toContain('"');
            expect(result).toContain("double\\u{20}quoted");
        });

        it("should handle backslash escapes in double-quoted strings", () => {
            const result = stripCommentsTra('@1 = "line one\\nnew"');
            expect(result).not.toContain('"');
            expect(result).toContain("line\\u{20}one\\nnew");
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
            expect(result).toContain("Hello\\u{20}world");
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
            expect(result).toContain("line\\u{20}one\\u{a}line\\u{20}two");
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
