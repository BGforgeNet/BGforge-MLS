import { beforeAll, describe, expect, it } from "vitest";
import * as tp2 from "@bgforge/shared/parsers/weidu-tp2";
import { SyntaxType } from "@bgforge/shared/syntax-types/weidu-tp2";
import { formatWeiduTp2 } from "@bgforge/format";
import { collectParseDiagnostics } from "../../src/shared/tree-sitter-diagnostics";

beforeAll(async () => {
    await tp2.initParser();
});

describe("WeiDU TP2 syntax regressions", () => {
    it.each(["DEFINE_ARRAY", "PATCH_DEFINE_ARRAY"])("accepts %s in patches", (keyword) => {
        const tree = tp2.parseWithCache(`COPY_EXISTING ~test.itm~ ~override~
    ${keyword} items BEGIN ~one~ ~two~ END
`)!;
        expect(collectParseDiagnostics(tree.rootNode)).toEqual([]);
        expect(tree.rootNode.descendantsOfType(SyntaxType.PatchDefineArray)).toHaveLength(1);
    });

    it("returns a function result into an array element", () => {
        const tree = tp2.parseWithCache(`COPY_EXISTING ~test.itm~ ~override~
    LPF ~delete_opcode~
        INT_VAR opcode match_position
        RET $opcodes(~12~) = count
        RET_ARRAY EVAL ~opcodes_12~ = opcodes_xx
    END
`)!;
        expect(collectParseDiagnostics(tree.rootNode)).toEqual([]);
        const result = tree.rootNode.descendantsOfType(SyntaxType.RetCallItem);
        expect(result).toHaveLength(1);
        expect(result[0]!.descendantsOfType(SyntaxType.ArrayAccess)).toHaveLength(1);
    });

    it("treats an evaluated return-array destination as one assignment", () => {
        const tree = tp2.parseWithCache(`COPY_EXISTING ~test.itm~ ~override~
    LPF ~delete_opcode~ RET_ARRAY EVAL ~opcodes_12~ = opcodes_xx END
`)!;
        expect(collectParseDiagnostics(tree.rootNode)).toEqual([]);
        const results = tree.rootNode.descendantsOfType(SyntaxType.RetArrayCallItem);
        expect(results).toHaveLength(1);
        expect(results[0]!.text).toBe("EVAL ~opcodes_12~ = opcodes_xx");
    });

    it("accepts OUTER_SNPRINT in an action function", () => {
        const tree = tp2.parseWithCache(`DEFINE_ACTION_FUNCTION ~ucfirst~ STR_VAR value = ~~ RET string BEGIN
    OUTER_SNPRINT 1 first ~%value%~
    ACTION_TO_UPPER first
    OUTER_PATCH_SAVE string ~%value%~ BEGIN
        REPLACE_TEXTUALLY EVALUATE_REGEXP ~^.?~ ~%first%~
    END
END
`)!;
        expect(collectParseDiagnostics(tree.rootNode)).toEqual([]);
    });

    it("accepts a quoted CREATE type without swallowing the following actions", () => {
        const tree = tp2.parseWithCache(`CREATE ~ITM~ ~m#book~ // "History of the Drow"
COPY_EXISTING ~m#book.itm~ ~override~
    WRITE_SHORT 0x1c 37 // See "laf/!_types.tpa"
BUT_ONLY
`)!;
        expect(collectParseDiagnostics(tree.rootNode)).toEqual([]);
        expect(tree.rootNode.descendantsOfType(SyntaxType.ActionCreate)).toHaveLength(1);
        expect(tree.rootNode.descendantsOfType(SyntaxType.ActionCopyExisting)).toHaveLength(1);
    });

    it("keeps a lone PATCH_TIME out of the COPY file list", () => {
        const tree = tp2.parseWithCache(`COPY_EXISTING ~test.itm~ ~override~
    PATCH_TIME ~timer~ BEGIN PATCH_PRINT ~hello~ END
`)!;
        expect(collectParseDiagnostics(tree.rootNode)).toEqual([]);
        expect(tree.rootNode.descendantsOfType(SyntaxType.FilePair)).toHaveLength(1);
    });

    it("accepts consecutive PATCH_TIME blocks between other patches", () => {
        const tree = tp2.parseWithCache(`DEFINE_ACTION_MACRO ~update_item_descriptions~ BEGIN
    OUTER_SET totalItems = 0
    COPY_EXISTING_REGEXP GLOB ~^.+\\.itm$~ ~override~
        SET foo = 0
        PATCH_TIME ~first~ BEGIN LPM ~update_item_description~ END
        PATCH_TIME ~second~ BEGIN LPM ~update_item_description~ END
        SET foo = 1
    BUT_ONLY_IF_IT_CHANGES
END
`)!;
        expect(collectParseDiagnostics(tree.rootNode)).toEqual([]);
        expect(tree.rootNode.descendantsOfType(SyntaxType.PatchLaunchMacro)).toHaveLength(2);
        expect(tree.rootNode.descendantsOfType(SyntaxType.PatchSet)).toHaveLength(2);
    });

    it("preserves return destinations when formatting a function call", () => {
        const tree = tp2.parseWithCache(`COPY_EXISTING ~test.itm~ ~override~
LPF ~delete_opcode~ RET $opcodes(~12~) = count RET_ARRAY EVAL ~opcodes_12~ = opcodes_xx END
`)!;
        expect(formatWeiduTp2(tree.rootNode).text).toBe(`COPY_EXISTING ~test.itm~ ~override~
    LPF ~delete_opcode~
        RET
            $opcodes(~12~) = count
        RET_ARRAY
            EVAL ~opcodes_12~ = opcodes_xx
    END
`);
    });

    it("indents the body of PATCH_TIME when formatting", () => {
        const tree = tp2.parseWithCache(`COPY_EXISTING ~test.itm~ ~override~
PATCH_TIME ~timer~ BEGIN
PATCH_PRINT ~hello~
END
`)!;
        expect(formatWeiduTp2(tree.rootNode).text).toBe(`COPY_EXISTING ~test.itm~ ~override~
    PATCH_TIME ~timer~ BEGIN
        PATCH_PRINT ~hello~
    END
`);
    });
});

// WeiDU accepts an empty parameter list, and completion needs one to parse as a list node: right after
// typing `INT_VAR ` the list is empty, and parameter-name completion keys on that node.
describe("WeiDU TP2 empty parameter lists", () => {
    it.each([
        ["INT_VAR", SyntaxType.IntVarCall],
        ["STR_VAR", SyntaxType.StrVarCall],
        ["RET", SyntaxType.RetCall],
        ["RET_ARRAY", SyntaxType.RetArrayCall],
    ])("accepts an empty %s list in a call", (keyword, listType) => {
        const tree = tp2.parseWithCache(`COPY_EXISTING ~test.itm~ ~override~
    LPF f ${keyword} END
`)!;
        expect(collectParseDiagnostics(tree.rootNode)).toEqual([]);
        expect(tree.rootNode.descendantsOfType(listType)).toHaveLength(1);
    });

    it.each([
        ["INT_VAR", SyntaxType.IntVarDecl],
        ["STR_VAR", SyntaxType.StrVarDecl],
        ["RET", SyntaxType.RetDecl],
        ["RET_ARRAY", SyntaxType.RetArrayDecl],
    ])("accepts an empty %s list in a declaration", (keyword, listType) => {
        const tree = tp2.parseWithCache(`DEFINE_PATCH_FUNCTION f ${keyword} BEGIN
    PATCH_PRINT ~hello~
END
`)!;
        expect(collectParseDiagnostics(tree.rootNode)).toEqual([]);
        expect(tree.rootNode.descendantsOfType(listType)).toHaveLength(1);
    });
});

describe("WeiDU TP2 syntax error wording", () => {
    it("names the first code token of an error, not a comment before it", () => {
        const tree = tp2.parseWithCache(
            "/** doc */\nDEFINE_PATCH_FUNCTION f BEGIN\n  PATCH_IF x BEGIN\n    SET y = 1\n    SET z = 2\n",
        )!;
        const messages = collectParseDiagnostics(tree.rootNode).map((d) => d.message);
        expect(messages).toContain("Syntax error near 'DEFINE_PATCH_FUNCTION'");
    });
});
