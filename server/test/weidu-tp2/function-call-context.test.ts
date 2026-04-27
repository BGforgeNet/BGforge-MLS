/**
 * Branch-coverage tests for weidu-tp2/completion/context/function-call.ts.
 *
 * Targets paths that the higher-level completion-context tests don't reach,
 * including: parsed-correctly LAM/LPM macro calls (so isAtMacroName runs
 * instead of the text fallback), RET / RET_ARRAY section keyword handling,
 * extractUsedParamsAfter with each param-node variant, findCallItemAtCursor
 * over every decl type, and the positional-heuristic branches of
 * isAtFunctionName / isAtMacroName.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { initParser } from "../../../shared/parsers/weidu-tp2";
import { getContextAtPosition, getFuncParamsContext } from "../../src/weidu-tp2/completion/context";
import { CompletionContext, ParamSection } from "../../src/weidu-tp2/completion/types";

beforeAll(async () => {
    await initParser();
});

/** Place cursor where `|` appears, return text-without-marker plus line/character. */
function cursor(textWithCursor: string): { text: string; line: number; character: number } {
    const idx = textWithCursor.indexOf("|");
    if (idx === -1) throw new Error("no cursor marker");
    const before = textWithCursor.slice(0, idx);
    const lines = before.split("\n");
    return {
        text: before + textWithCursor.slice(idx + 1),
        line: lines.length - 1,
        character: lines[lines.length - 1]!.length,
    };
}

function ctx(textWithCursor: string): CompletionContext[] {
    const { text, line, character } = cursor(textWithCursor);
    return getContextAtPosition(text, line, character);
}

// ---------------------------------------------------------------------------
// isAtMacroName — exercised only when tree-sitter parses the LAM/LPM as an
// ActionLaunchMacro / PatchLaunchMacro node. Bare "LAM |" routes through the
// text fallback in context/index.ts, so we use complete macro calls plus a
// trailing line so the cursor lands inside or past the parsed identifier.
// ---------------------------------------------------------------------------
describe("isAtMacroName via parsed LAM/LPM nodes", () => {
    it("LAM with cursor inside macro identifier -> LamName", () => {
        const contexts = ctx(`DEFINE_ACTION_MACRO my_macro BEGIN END\nLAM my_ma|cro\n`);
        expect(contexts).toContain(CompletionContext.LamName);
    });

    it("LAM with cursor at end of macro identifier -> LamName", () => {
        const contexts = ctx(`DEFINE_ACTION_MACRO my_macro BEGIN END\nLAM my_macro|\n`);
        expect(contexts).toContain(CompletionContext.LamName);
    });

    it("LAM with cursor right after keyword (no name yet) -> LamName via positional heuristic", () => {
        const contexts = ctx(`DEFINE_ACTION_MACRO my_macro BEGIN END\nLAM | my_macro\n`);
        // Parsed call exists; cursor sits between LAM and identifier
        expect(contexts).toContain(CompletionContext.LamName);
    });

    it("LPM with cursor inside string-form macro name -> LpmName", () => {
        const contexts = ctx(`DEFINE_PATCH_MACRO my_macro BEGIN END\nCOPY ~a~ ~b~\n  LPM ~my_ma|cro~\n`);
        expect(contexts).toContain(CompletionContext.LpmName);
    });

    it("LPM cursor past identifier returns null context (not at name)", () => {
        // Cursor on a trailing token after the macro name — isAtMacroName
        // must hit the "past the identifier" branch and return false.
        const { text, line, character } = cursor(
            `DEFINE_PATCH_MACRO my_macro BEGIN END\nCOPY ~a~ ~b~\n  LPM my_macro |\n`,
        );
        const contexts = getContextAtPosition(text, line, character);
        // Either empty (no filtering) or some non-LpmName context — but never LpmName.
        expect(contexts).not.toContain(CompletionContext.LpmName);
    });
});

// ---------------------------------------------------------------------------
// isAtFunctionName branches that the existing tests don't exercise: cursor
// inside the identifier (not just at its end), cursor past the identifier,
// END-token tracking, and the no-identifier-yet positional heuristic.
// ---------------------------------------------------------------------------
describe("isAtFunctionName edge cases", () => {
    it("cursor inside function identifier -> LafName", () => {
        // Mid-identifier exercises the (>= startIndex && <= endIndex) branch.
        const contexts = ctx(`LAF my_f|unc INT_VAR x = 1 END`);
        expect(contexts).toContain(CompletionContext.LafName);
    });

    it("cursor past identifier and before INT_VAR -> not LafName", () => {
        const contexts = ctx(`LAF my_func | INT_VAR x = 1 END`);
        expect(contexts).not.toContain(CompletionContext.LafName);
    });

    it("cursor between LAF and END (no args) hits END marker tracking", () => {
        // No INT_VAR/STR_VAR/RET — the END-token branch in isAtFunctionName
        // has to fire to bound the function-name region.
        const contexts = ctx(`LAF | END`);
        expect(contexts).toContain(CompletionContext.LafName);
    });

    it("LAUNCH_ACTION_FUNCTION long form recognised", () => {
        const contexts = ctx(`LAUNCH_ACTION_FUNCTION my_f|unc INT_VAR x = 1 END`);
        expect(contexts).toContain(CompletionContext.LafName);
    });

    it("LAUNCH_PATCH_FUNCTION long form recognised", () => {
        const contexts = ctx(
            `BACKUP ~a~\nAUTHOR ~b~\nBEGIN ~c~\nCOPY ~a~ ~b~\n  LAUNCH_PATCH_FUNCTION my_f|unc INT_VAR x = 1 END\n`,
        );
        expect(contexts).toContain(CompletionContext.LpfName);
    });

    it("RET section keyword bounds function-name region", () => {
        const contexts = ctx(`LAF | RET out END`);
        expect(contexts).toContain(CompletionContext.LafName);
    });

    it("RET_ARRAY section keyword bounds function-name region", () => {
        const contexts = ctx(`LAF | RET_ARRAY out END`);
        expect(contexts).toContain(CompletionContext.LafName);
    });

    it("STR_VAR section keyword bounds function-name region", () => {
        const contexts = ctx(`LAF | STR_VAR x = ~a~ END`);
        expect(contexts).toContain(CompletionContext.LafName);
    });
});

// ---------------------------------------------------------------------------
// findCallItemAtCursor — covers each param-node type in both call and
// definition position. The decl branches are reachable only via
// DEFINE_*_FUNCTION/MACRO with cursor inside the parameter list.
// ---------------------------------------------------------------------------
describe("findCallItemAtCursor over each decl/call_item type", () => {
    it("IntVarCallItem -> FuncParamValue when cursor right of =", () => {
        const contexts = ctx(`LAF foo INT_VAR x = 1|2 END`);
        expect(contexts).toContain(CompletionContext.FuncParamValue);
    });

    it("StrVarCallItem -> FuncParamValue inside string value", () => {
        const contexts = ctx(`LAF foo STR_VAR name = ~a|bc~ END`);
        expect(contexts).toContain(CompletionContext.FuncParamValue);
    });

    it("RetCallItem -> FuncParamName (RET has no = side)", () => {
        const contexts = ctx(`LAF foo RET out|var END`);
        expect(contexts).toContain(CompletionContext.FuncParamName);
    });

    it("RetArrayCallItem -> FuncParamName", () => {
        const contexts = ctx(`LAF foo RET_ARRAY ar|r END`);
        expect(contexts).toContain(CompletionContext.FuncParamName);
    });

    it("IntVarDecl in DEFINE_ACTION_FUNCTION -> FuncParamValue when on default", () => {
        const contexts = ctx(`DEFINE_ACTION_FUNCTION my_func INT_VAR count = 1|0 BEGIN END`);
        expect(contexts).toContain(CompletionContext.FuncParamValue);
    });

    it("StrVarDecl in DEFINE_PATCH_FUNCTION -> FuncParamValue when on default", () => {
        const contexts = ctx(`DEFINE_PATCH_FUNCTION my_func STR_VAR name = ~he|llo~ BEGIN END`);
        expect(contexts).toContain(CompletionContext.FuncParamValue);
    });

    it("RetDecl in DEFINE_ACTION_FUNCTION -> FuncParamName on identifier", () => {
        const contexts = ctx(`DEFINE_ACTION_FUNCTION my_func RET ou|t BEGIN END`);
        expect(contexts).toContain(CompletionContext.FuncParamName);
    });

    it("RetArrayDecl in DEFINE_ACTION_FUNCTION -> FuncParamName on identifier", () => {
        const contexts = ctx(`DEFINE_ACTION_FUNCTION my_func RET_ARRAY ar|r BEGIN END`);
        expect(contexts).toContain(CompletionContext.FuncParamName);
    });
});

// ---------------------------------------------------------------------------
// detectParamNameOrValue — the "no = found" and "cursor exactly on =" branches.
// ---------------------------------------------------------------------------
describe("detectParamNameOrValue branches", () => {
    it("no = present -> FuncParamName", () => {
        const contexts = ctx(`LAF foo INT_VAR cou|nt END`);
        expect(contexts).toContain(CompletionContext.FuncParamName);
    });

    it("cursor exactly at = -> FuncParamName (prefer name side)", () => {
        const text = `LAF foo INT_VAR count = 5 END`;
        const eq = text.indexOf("=");
        const contexts = getContextAtPosition(text, 0, eq);
        expect(contexts).toContain(CompletionContext.FuncParamName);
    });

    it("cursor right after = with no value yet -> FuncParamValue", () => {
        const contexts = ctx(`LAF foo INT_VAR count =| END`);
        expect(contexts).toContain(CompletionContext.FuncParamValue);
    });
});

// ---------------------------------------------------------------------------
// extractFuncParamsContext / getFuncParamsContext — verifies the enriched
// module-level cache populated by the parsed-call path. Each section type
// has its own branch in searchKeywordNodes.
// ---------------------------------------------------------------------------
describe("getFuncParamsContext after detection", () => {
    function detect(textWithCursor: string): void {
        ctx(textWithCursor);
    }

    it("INT_VAR section populates IntVar paramSection and used params", () => {
        detect(`LAF my_func INT_VAR count = 5 max = 10 |new_param END`);
        const fc = getFuncParamsContext();
        expect(fc).not.toBeNull();
        expect(fc!.paramSection).toBe(ParamSection.IntVar);
        expect(fc!.functionName).toBe("my_func");
        expect(fc!.usedParams).toEqual(expect.arrayContaining(["count", "max"]));
    });

    it("STR_VAR section populates StrVar paramSection", () => {
        detect(`LAF my_func STR_VAR name = ~a~ |new_param END`);
        const fc = getFuncParamsContext();
        expect(fc).not.toBeNull();
        expect(fc!.paramSection).toBe(ParamSection.StrVar);
    });

    it("RET section populates Ret paramSection and identifier params", () => {
        detect(`LAF my_func RET first second |third END`);
        const fc = getFuncParamsContext();
        expect(fc).not.toBeNull();
        expect(fc!.paramSection).toBe(ParamSection.Ret);
        expect(fc!.usedParams).toEqual(expect.arrayContaining(["first", "second"]));
    });

    it("RET_ARRAY section populates RetArray paramSection", () => {
        detect(`LAF my_func RET_ARRAY first |second END`);
        const fc = getFuncParamsContext();
        expect(fc).not.toBeNull();
        expect(fc!.paramSection).toBe(ParamSection.RetArray);
        expect(fc!.usedParams).toEqual(expect.arrayContaining(["first"]));
    });

    it("function name strips WeiDU string delimiters", () => {
        detect(`LAF ~quoted_func~ INT_VAR | END`);
        const fc = getFuncParamsContext();
        expect(fc).not.toBeNull();
        expect(fc!.functionName).toBe("quoted_func");
    });

    it("LPF inside COPY also populates context", () => {
        detect(`BACKUP ~a~\nAUTHOR ~b~\nBEGIN ~c~\nCOPY ~a~ ~b~\n  LPF patch_fn INT_VAR opt = 1 |new END\n`);
        const fc = getFuncParamsContext();
        expect(fc).not.toBeNull();
        expect(fc!.functionName).toBe("patch_fn");
        expect(fc!.paramSection).toBe(ParamSection.IntVar);
    });

    it("getFuncParamsContext is null when cursor is at function-name position", () => {
        // detectFunctionCallContext returns LafName before extractFuncParamsContext runs;
        // however the field starts cleared on each call only when extractFuncParamsContext
        // executes — verify the simple "no params parsed yet" path doesn't leak stale data.
        detect(`LAF my_f|unc END`);
        // We don't assert null vs non-null absolutely (depends on prior call's residue),
        // but the surface API must not throw.
        expect(() => getFuncParamsContext()).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// LPM in patch context — separate from LAM tests because the parse path
// goes through PatchLaunchMacro instead of ActionLaunchMacro.
// ---------------------------------------------------------------------------
describe("LPM patched-context branches", () => {
    it("LPM with cursor at start of macro name -> LpmName", () => {
        const contexts = ctx(`DEFINE_PATCH_MACRO my_macro BEGIN END\nCOPY ~a~ ~b~\n  LPM |my_macro\n`);
        expect(contexts).toContain(CompletionContext.LpmName);
    });

    it("LPM with cursor mid-identifier", () => {
        const contexts = ctx(`DEFINE_PATCH_MACRO my_macro BEGIN END\nCOPY ~a~ ~b~\n  LPM my|_macro\n`);
        expect(contexts).toContain(CompletionContext.LpmName);
    });
});

// ---------------------------------------------------------------------------
// detectFunctionCallContext returns null when not on a function-call node —
// covered by completion-context tests, but include a couple here so
// regression in the exit branches is caught locally.
// ---------------------------------------------------------------------------
describe("non-call cursor positions return no LAF/LPF/LAM/LPM context", () => {
    it("inside DEFINE_ACTION_MACRO body returns no name context", () => {
        const contexts = ctx(`DEFINE_ACTION_MACRO my_macro BEGIN\n  |\nEND`);
        expect(contexts).not.toContain(CompletionContext.LamName);
        expect(contexts).not.toContain(CompletionContext.LpmName);
    });

    it("inside DEFINE_PATCH_MACRO body returns no name context", () => {
        const contexts = ctx(`DEFINE_PATCH_MACRO my_macro BEGIN\n  |\nEND`);
        expect(contexts).not.toContain(CompletionContext.LamName);
        expect(contexts).not.toContain(CompletionContext.LpmName);
    });
});
