/**
 * Formatter defects found while keeping comments in place, each with the output the formatter's own rules give:
 * array flags of an SSL variable, an INNER_ACTION after a PATCH_IF's ELSE, comments after a COPY file pair, and a blank
 * line before a comment between TP2 actions. Every case is also stable under a second pass and passes the content
 * guard.
 */

import { describe, expect, it } from "vitest";
import { SSL, TP2, initFormatParsers, type Language } from "./format-languages";
import { validateFormatting } from "@bgforge/format";

initFormatParsers();

/** Formats `input` and expects exactly `expected`, the guard silent and a second pass identical. */
function expectFormatted(language: Language, input: string, expected: string): void {
    const result = language.format(language.parse(input));
    expect(result.notice).toBeUndefined();
    expect(result.warning).toBeUndefined();
    expect(result.text).toBe(expected);
    expect(validateFormatting(input, result.text, language.normalize)).toBeNull();
    expect(language.format(language.parse(result.text)).text).toBe(result.text);
}

describe("SSL variable array flags", () => {
    it("keeps the flags of a static array", () => {
        expectFormatted(SSL, "variable b[4, 2];\n", "variable b[4, 2];\n");
    });

    it("keeps the flags of an array in a variable block, with its comment", () => {
        expectFormatted(
            SSL,
            "variable begin\n b[4, 2]; // c\n a;\nend\n",
            "variable begin\n    b[4, 2];    // c\n    a;\nend\n",
        );
    });
});

describe("TP2 ELSE INNER_ACTION", () => {
    it("lays the INNER_ACTION out as a block of its own", () => {
        expectFormatted(
            TP2,
            "BEGIN ~c~\nCOPY ~a~ ~b~\n  PATCH_IF (1 = 1) BEGIN\n    PATCH_PRINT ~a~\n  END ELSE INNER_ACTION BEGIN\n    ACTION_IF (1 = 1) BEGIN\n      PRINT ~x~\n    END\n  END\n",
            "BEGIN ~c~\nCOPY ~a~ ~b~\n    PATCH_IF (1 = 1) BEGIN\n        PATCH_PRINT ~a~\n    END ELSE INNER_ACTION BEGIN\n        ACTION_IF (1 = 1) BEGIN\n            PRINT ~x~\n        END\n    END\n",
        );
    });
});

describe("TP2 COPY header with two comments after the file pair", () => {
    it("keeps the header on one line and the second comment on the line below", () => {
        expectFormatted(
            TP2,
            "BEGIN ~c~\nCOPY_EXISTING ~a~ ~b~ /* z */  // d\n  WRITE_BYTE 0 1\n",
            "BEGIN ~c~\nCOPY_EXISTING ~a~ ~b~  /* z */\n    // d\n    WRITE_BYTE 0 1\n",
        );
    });
});

describe("TP2 two comments after a BEGIN", () => {
    it("keeps a block and a line comment on the BEGIN line, in order", () => {
        expectFormatted(
            TP2,
            "BEGIN ~c~\nACTION_IF (1 = 1) BEGIN\n  PRINT ~a~\nEND ELSE BEGIN /* z */  // BGT\n  PRINT ~b~\nEND\n",
            "BEGIN ~c~\nACTION_IF (1 = 1) BEGIN\n    PRINT ~a~\nEND ELSE BEGIN  /* z */  // BGT\n    PRINT ~b~\nEND\n",
        );
    });
});

describe("TP2 comment before the closing parenthesis of a condition", () => {
    const cond = "ACTION_IF (FILE_EXISTS_IN_GAME ~a~ AND FILE_EXISTS_IN_GAME ~b~";
    it("moves a block comment after the parenthesis and keeps the condition on one line", () => {
        expectFormatted(
            TP2,
            `BEGIN ~c~\n${cond} /* y */ ) BEGIN\n  PRINT ~c~\nEND\n`,
            `BEGIN ~c~\n${cond})  /* y */\nBEGIN\n    PRINT ~c~\nEND\n`,
        );
    });

    it("moves a line comment after the parenthesis", () => {
        expectFormatted(
            TP2,
            `BEGIN ~c~\n${cond} // y\n) BEGIN\n  PRINT ~c~\nEND\n`,
            `BEGIN ~c~\n${cond})  // y\nBEGIN\n    PRINT ~c~\nEND\n`,
        );
    });
});

describe("TP2 blank line before a comment", () => {
    it("keeps the blank line above a comment between actions", () => {
        expectFormatted(
            TP2,
            "BEGIN ~c~\nOUTER_SET a = 1\n\n// about b\nOUTER_SET b = 2\n\n/* about c */\nCOPY ~a~ ~b~\n  WRITE_BYTE 0 1\n",
            "BEGIN ~c~\nOUTER_SET a = 1\n\n// about b\nOUTER_SET b = 2\n\n/* about c */\nCOPY ~a~ ~b~\n    WRITE_BYTE 0 1\n",
        );
    });

    it("keeps the blank line above a comment in the body of an IF", () => {
        expectFormatted(
            TP2,
            "BEGIN ~c~\nACTION_IF (1 = 1) BEGIN\n  OUTER_SET a = 1\n\n  // about b\n  OUTER_SET b = 2\nEND\n",
            "BEGIN ~c~\nACTION_IF (1 = 1) BEGIN\n    OUTER_SET a = 1\n\n    // about b\n    OUTER_SET b = 2\nEND\n",
        );
    });

    it("keeps the blank line above a comment that a COPY header moves above its keyword, inside an IF", () => {
        expectFormatted(
            TP2,
            "BEGIN ~c~\nACTION_IF (1 = 1) BEGIN\n  OUTER_SET a = 1\n\n  COPY /* c */ ~a~ ~b~ // d\n    WRITE_BYTE 0 1\nEND\n",
            "BEGIN ~c~\nACTION_IF (1 = 1) BEGIN\n    OUTER_SET a = 1\n\n    /* c */\n    COPY ~a~ ~b~  // d\n        WRITE_BYTE 0 1\nEND\n",
        );
    });

    it("keeps the blank line above a comment that a COPY header moves above its keyword", () => {
        expectFormatted(
            TP2,
            "BEGIN ~c~\nOUTER_SET a = 1\n\nCOPY /* c */ ~a~ ~b~ // d\n  WRITE_BYTE 0 1\n",
            "BEGIN ~c~\nOUTER_SET a = 1\n\n/* c */\nCOPY ~a~ ~b~  // d\n    WRITE_BYTE 0 1\n",
        );
    });
});
