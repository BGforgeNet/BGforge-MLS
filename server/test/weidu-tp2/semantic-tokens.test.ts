/**
 * Unit tests for weidu-tp2/semantic-tokens.ts - function parameter reference highlighting.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import { SemanticTokenTypes } from "vscode-languageserver/node";

vi.mock("../../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    }),
    getDocuments: () => ({ get: vi.fn() }),
    initLspConnection: vi.fn(),
}));

import { initParser } from "../../../shared/parsers/weidu-tp2";
import { getSemanticTokenSpans } from "../../src/weidu-tp2/semantic-tokens";
import {
    RESREF_TOKEN_TYPE,
    BYTE_TOKEN_TYPE,
    CHAR_TOKEN_TYPE,
    DWORD_TOKEN_TYPE,
    INT_TOKEN_TYPE,
} from "../../src/shared/semantic-tokens";

beforeAll(async () => {
    await initParser();
});

function getLine(text: string, line: number): string {
    return text.split("\n")[line] ?? "";
}

function tokenTexts(text: string): string[] {
    return getSemanticTokenSpans(text).map((span) =>
        getLine(text, span.line).slice(span.startChar, span.startChar + span.length),
    );
}

describe("weidu-tp2/semantic-tokens", () => {
    it("highlights INT_VAR parameter references in function body", () => {
        const text = `
DEFINE_PATCH_FUNCTION MyFunc
    INT_VAR count = 0
BEGIN
    SET total = count * 2
END
`;

        const spans = getSemanticTokenSpans(text);

        expect(spans).toHaveLength(1);
        expect(spans[0]!.tokenType).toBe(SemanticTokenTypes.parameter);
        expect(tokenTexts(text)).toEqual(["count"]);
    });

    it("highlights STR_VAR parameter references in function body", () => {
        const text = `
DEFINE_ACTION_FUNCTION MyFunc
    STR_VAR name = ~~
BEGIN
    PRINT ~Hello %name%~
END
`;

        const spans = getSemanticTokenSpans(text);

        expect(spans).toHaveLength(1);
        expect(spans[0]!.tokenType).toBe(SemanticTokenTypes.parameter);
        expect(tokenTexts(text)).toEqual(["name"]);
    });

    it("highlights RET parameter references in function body", () => {
        const text = `
DEFINE_PATCH_FUNCTION MyFunc
    RET result
BEGIN
    SET result = 42
END
`;

        const spans = getSemanticTokenSpans(text);

        expect(spans).toHaveLength(1);
        expect(tokenTexts(text)).toEqual(["result"]);
    });

    it("highlights multiple parameters from different declaration types", () => {
        const text = `
DEFINE_PATCH_FUNCTION MyFunc
    INT_VAR x = 0
    STR_VAR label = ~~
    RET output
BEGIN
    SET output = x
    SPRINT output ~%label%~
END
`;

        const spans = getSemanticTokenSpans(text);

        expect(spans.every((s) => s.tokenType === SemanticTokenTypes.parameter)).toBe(true);
        expect(tokenTexts(text)).toEqual(["output", "x", "output", "label"]);
    });

    it("does not highlight parameter names in the declaration itself", () => {
        const text = `
DEFINE_PATCH_FUNCTION MyFunc
    INT_VAR count = 0
BEGIN
END
`;

        const spans = getSemanticTokenSpans(text);

        expect(spans).toHaveLength(0);
    });

    it("does not highlight variables that are not function parameters", () => {
        const text = `
DEFINE_PATCH_FUNCTION MyFunc
    INT_VAR count = 0
BEGIN
    SET local_var = 5
    SET total = count + local_var
END
`;

        expect(tokenTexts(text)).toEqual(["count"]);
    });

    it("does not highlight variables outside function definitions", () => {
        const text = `
OUTER_SET my_var = 5
OUTER_SET result = my_var + 1
`;

        const spans = getSemanticTokenSpans(text);

        expect(spans).toHaveLength(0);
    });

    it("keeps parameters scoped to their own function", () => {
        const text = `
DEFINE_PATCH_FUNCTION First
    INT_VAR value = 0
BEGIN
    SET x = value
END

DEFINE_PATCH_FUNCTION Second
    INT_VAR value = 0
BEGIN
    SET y = value
END
`;

        const spans = getSemanticTokenSpans(text);

        expect(spans).toHaveLength(2);
        expect(spans[0]!.line).not.toBe(spans[1]!.line);
    });

    it("highlights RET_ARRAY parameter references", () => {
        const text = `
DEFINE_PATCH_FUNCTION MyFunc
    RET_ARRAY results
BEGIN
    SET $results(~key~) = 1
END
`;

        const spans = getSemanticTokenSpans(text);

        expect(spans).toHaveLength(1);
        expect(tokenTexts(text)).toEqual(["results"]);
    });

    it("handles DEFINE_ACTION_FUNCTION the same as DEFINE_PATCH_FUNCTION", () => {
        const text = `
DEFINE_ACTION_FUNCTION MyFunc
    INT_VAR count = 0
BEGIN
    PRINT ~%count%~
END
`;

        const spans = getSemanticTokenSpans(text);

        expect(spans).toHaveLength(1);
        expect(tokenTexts(text)).toEqual(["count"]);
    });

    it("handles multiple params declared on the same INT_VAR line", () => {
        const text = `
DEFINE_PATCH_FUNCTION MyFunc
    INT_VAR a = 0 b = 0 c = 0
BEGIN
    SET x = a + b + c
END
`;

        expect(tokenTexts(text)).toEqual(["a", "b", "c"]);
    });

    it("handles multiple param references on the same body line", () => {
        const text = `
DEFINE_PATCH_FUNCTION MyFunc
    INT_VAR x = 0 y = 0
BEGIN
    SET total = x + y + x
END
`;

        expect(tokenTexts(text)).toEqual(["x", "y", "x"]);
    });

    it("handles multiple %var% references in the same string", () => {
        const text = `
DEFINE_ACTION_FUNCTION MyFunc
    STR_VAR first = ~~ last = ~~
BEGIN
    PRINT ~%first% %last%~
END
`;

        expect(tokenTexts(text)).toEqual(["first", "last"]);
    });

    it("handles %var% in multiline string content", () => {
        const text = `
DEFINE_ACTION_FUNCTION MyFunc
    STR_VAR name = ~~
BEGIN
    PRINT ~Hello
%name%
world~
END
`;

        const spans = getSemanticTokenSpans(text);

        expect(spans).toHaveLength(1);
        expect(tokenTexts(text)).toEqual(["name"]);
    });

    it("highlights PHP_EACH loop variables with variable token type", () => {
        const text = `
DEFINE_PATCH_FUNCTION MyFunc
    INT_VAR count = 0
BEGIN
    PHP_EACH my_array AS key => value BEGIN
        SET x = key + value
    END
END
`;

        const spans = getSemanticTokenSpans(text);
        const loopSpans = spans.filter((s) => s.tokenType === SemanticTokenTypes.variable);

        expect(loopSpans).toHaveLength(4);
        expect(loopSpans.map((s) => getLine(text, s.line).slice(s.startChar, s.startChar + s.length))).toEqual([
            "key",
            "value",
            "key",
            "value",
        ]);
    });

    it("highlights ACTION_PHP_EACH loop variables", () => {
        const text = `
ACTION_PHP_EACH my_array AS k => v BEGIN
    PRINT ~%k% %v%~
END
`;

        const spans = getSemanticTokenSpans(text);
        const loopSpans = spans.filter((s) => s.tokenType === SemanticTokenTypes.variable);

        expect(loopSpans).toHaveLength(4);
        expect(loopSpans.map((s) => getLine(text, s.line).slice(s.startChar, s.startChar + s.length))).toEqual([
            "k",
            "v",
            "k",
            "v",
        ]);
    });

    it("highlights PATCH_FOR_EACH loop variable", () => {
        const text = `
DEFINE_PATCH_FUNCTION MyFunc
BEGIN
    PATCH_FOR_EACH item IN ~a~ ~b~ ~c~ BEGIN
        SPRINT x ~%item%~
    END
END
`;

        const spans = getSemanticTokenSpans(text);
        const loopSpans = spans.filter((s) => s.tokenType === SemanticTokenTypes.variable);

        expect(loopSpans).toHaveLength(2);
        expect(loopSpans.map((s) => getLine(text, s.line).slice(s.startChar, s.startChar + s.length))).toEqual([
            "item",
            "item",
        ]);
    });

    it("highlights ACTION_FOR_EACH loop variable", () => {
        const text = `
ACTION_FOR_EACH item IN ~a~ ~b~ BEGIN
    PRINT ~%item%~
END
`;

        const spans = getSemanticTokenSpans(text);
        const loopSpans = spans.filter((s) => s.tokenType === SemanticTokenTypes.variable);

        expect(loopSpans).toHaveLength(2);
        expect(loopSpans.map((s) => getLine(text, s.line).slice(s.startChar, s.startChar + s.length))).toEqual([
            "item",
            "item",
        ]);
    });

    it("uses different token types for function params and loop vars", () => {
        const text = `
DEFINE_PATCH_FUNCTION MyFunc
    INT_VAR count = 0
BEGIN
    PHP_EACH arr AS key => val BEGIN
        SET x = count + key + val
    END
END
`;

        const spans = getSemanticTokenSpans(text);
        const paramSpans = spans.filter((s) => s.tokenType === SemanticTokenTypes.parameter);
        const loopSpans = spans.filter((s) => s.tokenType === SemanticTokenTypes.variable);

        expect(paramSpans.map((s) => getLine(text, s.line).slice(s.startChar, s.startChar + s.length))).toEqual([
            "count",
        ]);
        expect(loopSpans.map((s) => getLine(text, s.line).slice(s.startChar, s.startChar + s.length))).toEqual([
            "key",
            "val",
            "key",
            "val",
        ]);
    });

    it("highlights loop variable names in the declaration itself", () => {
        const text = `
ACTION_PHP_EACH my_array AS key => value BEGIN
END
`;

        const spans = getSemanticTokenSpans(text);

        expect(spans).toHaveLength(2);
        expect(spans.every((s) => s.tokenType === SemanticTokenTypes.variable)).toBe(true);
        expect(tokenTexts(text)).toEqual(["key", "value"]);
    });

    it("produces no tokens for macro definitions", () => {
        const text = `
DEFINE_ACTION_MACRO MyMacro BEGIN
    SET x = 1
END

DEFINE_PATCH_MACRO MyPatchMacro BEGIN
    SET y = 2
END
`;

        expect(getSemanticTokenSpans(text)).toEqual([]);
    });

    it("returns empty array for empty or unparseable text", () => {
        expect(getSemanticTokenSpans("")).toEqual([]);
    });

    describe("typed constant semantic tokens", () => {
        it("highlights bare identifier matching a resref name", () => {
            const typedNames = new Map([["CLERIC_BLESS", RESREF_TOKEN_TYPE]]);
            const text = `
OUTER_SPRINT var CLERIC_BLESS
`;

            const spans = getSemanticTokenSpans(text, typedNames);
            const resrefSpans = spans.filter((s) => s.tokenType === RESREF_TOKEN_TYPE);

            expect(resrefSpans).toHaveLength(1);
            expect(resrefSpans.map((s) => getLine(text, s.line).slice(s.startChar, s.startChar + s.length))).toEqual([
                "CLERIC_BLESS",
            ]);
        });

        it("highlights %resref% in string content", () => {
            const typedNames = new Map([["CLERIC_BLESS", RESREF_TOKEN_TYPE]]);
            const text = `
COPY_EXISTING ~%CLERIC_BLESS%.spl~ override
`;

            const spans = getSemanticTokenSpans(text, typedNames);
            const resrefSpans = spans.filter((s) => s.tokenType === RESREF_TOKEN_TYPE);

            expect(resrefSpans).toHaveLength(1);
            expect(resrefSpans.map((s) => getLine(text, s.line).slice(s.startChar, s.startChar + s.length))).toEqual([
                "CLERIC_BLESS",
            ]);
        });

        it("highlights percent_string resref reference", () => {
            const typedNames = new Map([["CLERIC_BLESS", RESREF_TOKEN_TYPE]]);
            const text = `
COPY_EXISTING %CLERIC_BLESS% override
`;

            const spans = getSemanticTokenSpans(text, typedNames);
            const resrefSpans = spans.filter((s) => s.tokenType === RESREF_TOKEN_TYPE);

            expect(resrefSpans).toHaveLength(1);
            expect(resrefSpans.map((s) => getLine(text, s.line).slice(s.startChar, s.startChar + s.length))).toEqual([
                "CLERIC_BLESS",
            ]);
        });

        it("does not highlight identifiers not in the typed names map", () => {
            const typedNames = new Map([["CLERIC_BLESS", RESREF_TOKEN_TYPE]]);
            const text = `
OUTER_SET my_var = 5
`;

            const spans = getSemanticTokenSpans(text, typedNames);
            const resrefSpans = spans.filter((s) => s.tokenType === RESREF_TOKEN_TYPE);

            expect(resrefSpans).toHaveLength(0);
        });

        it("works alongside function parameter tokens", () => {
            const typedNames = new Map([["CLERIC_BLESS", RESREF_TOKEN_TYPE]]);
            const text = `
DEFINE_PATCH_FUNCTION MyFunc
    STR_VAR spell = ~~
BEGIN
    SPRINT spell CLERIC_BLESS
END
`;

            const spans = getSemanticTokenSpans(text, typedNames);
            const paramSpans = spans.filter((s) => s.tokenType === SemanticTokenTypes.parameter);
            const resrefSpans = spans.filter((s) => s.tokenType === RESREF_TOKEN_TYPE);

            expect(paramSpans.map((s) => getLine(text, s.line).slice(s.startChar, s.startChar + s.length))).toEqual([
                "spell",
            ]);
            expect(resrefSpans.map((s) => getLine(text, s.line).slice(s.startChar, s.startChar + s.length))).toEqual([
                "CLERIC_BLESS",
            ]);
        });

        it("returns no typed tokens when typedNames is not provided", () => {
            const text = `
OUTER_SPRINT var CLERIC_BLESS
`;

            const spans = getSemanticTokenSpans(text);
            const resrefSpans = spans.filter((s) => s.tokenType === RESREF_TOKEN_TYPE);

            expect(resrefSpans).toHaveLength(0);
        });

        it("highlights byte-typed constant with byte token type", () => {
            const typedNames = new Map([["ITEM_FLAGS", BYTE_TOKEN_TYPE]]);
            const text = `
WRITE_BYTE ITEM_FLAGS 0
`;

            const spans = getSemanticTokenSpans(text, typedNames);
            const byteSpans = spans.filter((s) => s.tokenType === BYTE_TOKEN_TYPE);

            expect(byteSpans).toHaveLength(1);
            expect(byteSpans.map((s) => getLine(text, s.line).slice(s.startChar, s.startChar + s.length))).toEqual([
                "ITEM_FLAGS",
            ]);
        });

        it("highlights dword-typed constant with dword token type", () => {
            const typedNames = new Map([["SPL_FLAGS", DWORD_TOKEN_TYPE]]);
            const text = `
WRITE_LONG SPL_FLAGS 0
`;

            const spans = getSemanticTokenSpans(text, typedNames);
            const dwordSpans = spans.filter((s) => s.tokenType === DWORD_TOKEN_TYPE);

            expect(dwordSpans).toHaveLength(1);
            expect(dwordSpans.map((s) => getLine(text, s.line).slice(s.startChar, s.startChar + s.length))).toEqual([
                "SPL_FLAGS",
            ]);
        });

        it("highlights int-typed constant with int token type", () => {
            const typedNames = new Map([["MYCONST", INT_TOKEN_TYPE]]);
            const text = `
SET x = MYCONST
`;

            const spans = getSemanticTokenSpans(text, typedNames);
            const intSpans = spans.filter((s) => s.tokenType === INT_TOKEN_TYPE);

            expect(intSpans).toHaveLength(1);
            expect(intSpans.map((s) => getLine(text, s.line).slice(s.startChar, s.startChar + s.length))).toEqual([
                "MYCONST",
            ]);
        });

        it("assigns different token types to different typed constants", () => {
            const typedNames = new Map([
                ["CLERIC_BLESS", RESREF_TOKEN_TYPE],
                ["ITEM_FLAGS", BYTE_TOKEN_TYPE],
                ["SPL_TYPE", DWORD_TOKEN_TYPE],
                ["CHAR_NAME", CHAR_TOKEN_TYPE],
            ]);
            const text = `
SET x = ITEM_FLAGS
SPRINT y CLERIC_BLESS
WRITE_LONG SPL_TYPE 0
WRITE_ASCII CHAR_NAME ~test~
`;

            const spans = getSemanticTokenSpans(text, typedNames);

            expect(spans.filter((s) => s.tokenType === BYTE_TOKEN_TYPE)).toHaveLength(1);
            expect(spans.filter((s) => s.tokenType === RESREF_TOKEN_TYPE)).toHaveLength(1);
            expect(spans.filter((s) => s.tokenType === DWORD_TOKEN_TYPE)).toHaveLength(1);
            expect(spans.filter((s) => s.tokenType === CHAR_TOKEN_TYPE)).toHaveLength(1);
        });
    });
});
