/**
 * Test suite for WeiDU TP2 function parameter context detection.
 * Tests funcParamName (left of =) vs funcParamValue (right of =) context distinction.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { getContextAtPosition } from "../../src/weidu-tp2/completion/context";
import { CompletionContext } from "../../src/weidu-tp2/completion/types";
import { initParser } from "../../src/weidu-tp2/parser";

beforeAll(async () => {
    await initParser();
});

describe("WeiDU TP2 Function Parameter Context Detection", () => {
    describe("funcParamName context (left of = or no =)", () => {
        it("should detect funcParamName at start of INT_VAR section", () => {
            const text = `LAF foo INT_VAR END`;
            const pos = text.indexOf("INT_VAR") + "INT_VAR".length + 1; // After INT_VAR
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamName);
        });

        it("should detect funcParamName while typing param name", () => {
            const text = `LAF foo INT_VAR cou`;
            const pos = text.indexOf("cou") + 2; // Middle of "cou"
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamName);
        });

        it("should detect funcParamName after complete implicit param", () => {
            const text = `LAF foo INT_VAR count END`;
            const pos = text.indexOf("count") + "count".length + 1; // After "count "
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamName);
        });

        it("should detect funcParamName after explicit param with =", () => {
            const text = `LAF foo INT_VAR count = 5 END`;
            const pos = text.indexOf("5") + 2; // After value
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamName);
        });

        it("should detect funcParamName after implicit param before another", () => {
            const text = `LAF foo INT_VAR count max END`;
            const pos = text.indexOf("max") + 4; // After "max "
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamName);
        });

        it("should detect funcParamName in STR_VAR section", () => {
            const text = `LAF foo STR_VAR END`;
            const pos = text.indexOf("STR_VAR") + "STR_VAR".length + 1; // After STR_VAR
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamName);
        });

        it("should detect funcParamName in function definition", () => {
            const text = `DEFINE_PATCH_FUNCTION foo INT_VAR count BEGIN END`;
            const pos = text.indexOf("count") + "count".length + 1; // After "count "
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamName);
        });

        it("should detect funcParamName in DEFINE_ACTION_FUNCTION", () => {
            const text = `DEFINE_ACTION_FUNCTION bar STR_VAR name BEGIN END`;
            const pos = text.indexOf("name") + "name".length + 1; // After "name "
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamName);
        });

        it("should detect funcParamName with LPF", () => {
            const text = `LPF bar INT_VAR END`;
            const pos = text.indexOf("INT_VAR") + "INT_VAR".length + 1; // After INT_VAR
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamName);
        });

        it("should detect funcParamName on left side of = before value", () => {
            const text = `LAF foo INT_VAR count`;
            const pos = text.indexOf("count") + 3; // In middle of "count"
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamName);
        });
    });

    describe("funcParamValue context (right of =)", () => {
        it("should detect funcParamValue right after = in INT_VAR", () => {
            const text = `LAF foo INT_VAR count = 5 END`;
            const pos = text.indexOf("=") + 2; // Right after "= "
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamValue);
        });

        it("should detect funcParamValue while typing value", () => {
            const text = `LAF foo INT_VAR count = my_var END`;
            const pos = text.indexOf("my_var") + 3; // Middle of "my_var"
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamValue);
        });

        it("should detect funcParamValue in STR_VAR with string value", () => {
            const text = `LAF foo STR_VAR name = ~test~ END`;
            const pos = text.indexOf("~test~") + 2; // Inside string value
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamValue);
        });

        it("should detect funcParamValue in function definition default value", () => {
            const text = `DEFINE_PATCH_FUNCTION foo INT_VAR count = 10 BEGIN END`;
            const pos = text.indexOf("10") + 1; // Inside default value
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamValue);
        });

        it("should detect funcParamValue with LPF", () => {
            const text = `LPF bar STR_VAR msg = ~hello~ END`;
            const pos = text.indexOf("~hello~") + 3; // Inside string value
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamValue);
        });

        it("should detect funcParamValue in middle of numeric literal", () => {
            const text = `LAF foo INT_VAR count = 42 END`;
            const pos = text.indexOf("42") + 1; // In middle of "42"
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamValue);
        });

        it("should detect funcParamValue in string literal", () => {
            const text = `LAF foo STR_VAR name = ~test~ END`;
            const pos = text.indexOf("test") + 2; // In middle of "test"
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamValue);
        });

        it("should detect funcParamValue while typing on right side of = in multiline LPF", () => {
            // Reproduction case: cursor after "s" in "stacking_id_base = s|"
            const text = `LPF unstack_armor_bonus
INT_VAR
    bonus = allowed_pips
    stacking_id_base = s
STR_VAR
    xxxs = "qqq"
END`;
            // Position at line 3 (0-indexed), char 24 (AFTER the "s" in "stacking_id_base = s")
            // Line is "    stacking_id_base = s" - chars 0-3 spaces, 4-19 name, 20-22 " = ", 23 "s"
            // Cursor at 24 = end of line, right after 's'
            const line = 3;
            const char = 24;

            const contexts = getContextAtPosition(text, line, char);
            expect(contexts).toContain(CompletionContext.FuncParamValue);
            expect(contexts).not.toContain(CompletionContext.FuncParamName);
        });

        it("should detect funcParamValue with no space after =", () => {
            // No space between = and value: "count=5"
            const text = `LAF foo INT_VAR count=5 END`;
            const pos = text.indexOf("5") + 1; // Right after "5"
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamValue);
        });
    });

    describe("edge cases with broken/incomplete code", () => {
        it("should handle incomplete function call without END", () => {
            const text = `LAF foo INT_VAR count = 5`;
            const pos = text.indexOf("5"); // At value
            const contexts = getContextAtPosition(text, 0, pos);
            // Should still detect funcParamValue even without END
            expect(contexts.length).toBeGreaterThan(0);
        });

        it("should handle typing in middle with END present", () => {
            const text = `LAF foo INT_VAR  END`;
            const pos = text.indexOf("INT_VAR") + "INT_VAR".length + 1; // Space after INT_VAR
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamName);
        });

        it("should handle parser error with STR_VAR after incomplete INT_VAR", () => {
            const text = `LAF foo INT_VAR count = 5 STR_VAR END`;
            const pos = text.indexOf("STR_VAR") + "STR_VAR".length + 1; // After STR_VAR
            const contexts = getContextAtPosition(text, 0, pos);
            // Should detect funcParamName in STR_VAR section
            expect(contexts).toContain(CompletionContext.FuncParamName);
        });

        it("should handle no = present as funcParamName", () => {
            const text = `LAF foo INT_VAR myvar END`;
            const pos = text.indexOf("myvar") + 3; // In "myvar"
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamName);
        });

        it("should handle cursor directly on = character", () => {
            const text = `LAF foo INT_VAR count = 5 END`;
            const pos = text.indexOf(" = ") + 1; // On the "=" character
            const contexts = getContextAtPosition(text, 0, pos);
            // Could be either, but prefer name side (left)
            expect(contexts).toContain(CompletionContext.FuncParamName);
        });

        it("should handle multiline function call", () => {
            const text = `LAF foo
  INT_VAR
    count = 5
  STR_VAR
END`;
            // Position after "count = " on line 2
            const pos = text.indexOf("count = ") + "count = ".length;
            const line = text.substring(0, pos).split("\n").length - 1;
            const char = pos - text.lastIndexOf("\n", pos - 1) - 1;
            const contexts = getContextAtPosition(text, line, char);
            expect(contexts).toContain(CompletionContext.FuncParamValue);
        });
    });

    describe("RET and RET_ARRAY sections", () => {
        it("should detect funcParamName in RET section", () => {
            const text = `LAF foo RET END`;
            const pos = text.indexOf("RET") + "RET".length + 1; // After RET
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamName);
        });

        it("should detect funcParamName in RET_ARRAY section", () => {
            const text = `LAF foo RET_ARRAY END`;
            const pos = text.indexOf("RET_ARRAY") + "RET_ARRAY".length + 1; // After RET_ARRAY
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamName);
        });

        // Note: RET and RET_ARRAY don't support default values, so no funcParamValue tests
    });

    describe("mixed sections", () => {
        it("should detect correct context when switching from INT_VAR to STR_VAR", () => {
            const text = `LAF foo INT_VAR count = 5 STR_VAR END`;
            const pos = text.indexOf("STR_VAR") + "STR_VAR".length + 1; // After STR_VAR
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamName);
        });

        it("should detect funcParamValue in second section", () => {
            const text = `LAF foo INT_VAR count = 5 STR_VAR name = ~test~ END`;
            const pos = text.indexOf("~test~") + 2; // Inside value
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamValue);
        });

        it("should handle implicit param followed by explicit in same section", () => {
            const text = `LAF foo INT_VAR implicit_one explicit = 10 END`;
            const pos = text.indexOf("10") + 3; // After explicit param value
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamName);
        });
    });

    describe("function definitions (DEFINE_*_FUNCTION)", () => {
        it("should detect funcParamName in DEFINE_PATCH_FUNCTION INT_VAR", () => {
            const text = `DEFINE_PATCH_FUNCTION my_func INT_VAR BEGIN END`;
            const pos = text.indexOf("INT_VAR") + "INT_VAR".length + 1;
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamName);
        });

        it("should detect funcParamValue for default value in function definition", () => {
            const text = `DEFINE_ACTION_FUNCTION my_func STR_VAR msg = ~test~ BEGIN END`;
            const pos = text.indexOf("~test~") + 2;
            const contexts = getContextAtPosition(text, 0, pos);
            expect(contexts).toContain(CompletionContext.FuncParamValue);
        });
    });
});
