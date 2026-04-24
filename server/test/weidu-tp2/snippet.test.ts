/**
 * Unit tests for WeiDU TP2 function call snippet generation.
 * Tests auto-completion snippets for LAF/LPF/LAM/LPM.
 */

import { describe, expect, it } from "vitest";
import { buildFunctionCallSnippet, getKeywordSnippet } from "../../src/weidu-tp2/snippets";
import { CallableContext, CallableDefType, type CallableInfo, type CallableParam } from "../../src/core/symbol";

// Helper to create a CallableInfo with known params
function createCallableInfo(
    intVarParams: CallableParam[],
    strVarParams: CallableParam[],
    retParams: string[] = [],
    retArrayParams: string[] = [],
): CallableInfo {
    return {
        context: CallableContext.Action,
        dtype: CallableDefType.Function,
        params: {
            intVar: intVarParams,
            strVar: strVarParams,
            ret: retParams,
            retArray: retArrayParams,
        },
    };
}

// Helper to create a CallableInfo with known-empty params
function createNoParamsCallable(): CallableInfo {
    return createCallableInfo([], []);
}

// Helper to create a CallableInfo with unknown params (static YAML symbols)
function createUnknownParamsCallable(): CallableInfo {
    return {
        context: CallableContext.Action,
        dtype: CallableDefType.Function,
    };
}

describe("weidu-tp2: function call snippet generation", () => {
    // ---- No prefix (lafName/lpfName context — user already typed LAF/LPF) ----

    it("returns null without prefix when function has known-empty params", () => {
        const callable = createNoParamsCallable();
        expect(buildFunctionCallSnippet(callable, "no_param_func")).toBeNull();
    });

    it("returns null without prefix for macro with known-empty params", () => {
        const callable: CallableInfo = {
            context: CallableContext.Action,
            dtype: CallableDefType.Macro,
            params: { intVar: [], strVar: [], ret: [], retArray: [] },
        };
        expect(buildFunctionCallSnippet(callable, "my_macro")).toBeNull();
    });

    it("generates snippet without prefix when params exist (even optional)", () => {
        const callable = createCallableInfo([{ name: "x", type: "int", defaultValue: "0" }], []);
        expect(buildFunctionCallSnippet(callable, "my_func")).toBe("my_func\n    $0\nEND");
    });

    it("generates snippet without prefix for static symbol with unknown params", () => {
        const callable = createUnknownParamsCallable();
        expect(buildFunctionCallSnippet(callable, "INSTALL_PVRZ")).toBe("INSTALL_PVRZ\n    $0\nEND");
    });

    // ---- LAF/LPF prefix with known params ----

    it("generates single-line snippet with prefix when known-empty params", () => {
        const callable = createNoParamsCallable();
        expect(buildFunctionCallSnippet(callable, "my_func", "LAF")).toBe("LAF my_func END$0");
    });

    it("auto-inserts INT_VAR block for required int param", () => {
        const callable = createCallableInfo([{ name: "count", type: "int", required: true }], []);
        expect(buildFunctionCallSnippet(callable, "my_func", "LAF")).toBe(
            "LAF my_func\n    INT_VAR\n        count = ${1}\nEND$0",
        );
    });

    it("generates multi-line snippet with prefix when only optional params exist", () => {
        const callable = createCallableInfo(
            [{ name: "x", type: "int", defaultValue: "0" }],
            [{ name: "y", type: "string", defaultValue: '""' }],
        );
        expect(buildFunctionCallSnippet(callable, "my_func", "LPF")).toBe("LPF my_func\n    $0\nEND");
    });

    it("auto-inserts both INT_VAR and STR_VAR blocks for mixed required params", () => {
        const callable = createCallableInfo(
            [{ name: "x", type: "int", required: true }],
            [{ name: "name", type: "string", required: true }],
        );
        expect(buildFunctionCallSnippet(callable, "complex_func", "LAF")).toBe(
            "LAF complex_func\n    INT_VAR\n        x = ${1}\n    STR_VAR\n        name = ${2}\nEND$0",
        );
    });

    // ---- LAF/LPF prefix with unknown params (static YAML symbols) ----

    it("generates multi-line snippet with prefix for static symbol with unknown params", () => {
        const callable = createUnknownParamsCallable();
        expect(buildFunctionCallSnippet(callable, "INSTALL_PVRZ", "LAF")).toBe("LAF INSTALL_PVRZ\n    $0\nEND");
    });

    it("generates multi-line snippet with LPF prefix for static symbol with unknown params", () => {
        const callable = createUnknownParamsCallable();
        expect(buildFunctionCallSnippet(callable, "ADD_AREA_ITEM", "LPF")).toBe("LPF ADD_AREA_ITEM\n    $0\nEND");
    });

    // ---- Required params: additional cases ----

    it("auto-inserts STR_VAR block only when only STR_VAR params are required", () => {
        const callable = createCallableInfo([], [{ name: "resource", type: "string", required: true }]);
        expect(buildFunctionCallSnippet(callable, "my_func", "LAF")).toBe(
            "LAF my_func\n    STR_VAR\n        resource = ${1}\nEND$0",
        );
    });

    it("inserts only required params, skipping optional ones", () => {
        const callable = createCallableInfo(
            [
                { name: "optional_int", type: "int", defaultValue: "0" },
                { name: "required_int", type: "int", required: true },
            ],
            [
                { name: "required_str", type: "string", required: true },
                { name: "optional_str", type: "string", defaultValue: '""' },
            ],
        );
        expect(buildFunctionCallSnippet(callable, "mixed_func", "LPF")).toBe(
            "LPF mixed_func\n    INT_VAR\n        required_int = ${1}\n    STR_VAR\n        required_str = ${2}\nEND$0",
        );
    });

    it("handles multiple required params in same section", () => {
        const callable = createCallableInfo(
            [
                { name: "x", type: "int", required: true },
                { name: "y", type: "int", required: true },
            ],
            [],
        );
        // Same-length names: no padding needed
        expect(buildFunctionCallSnippet(callable, "my_func", "LAF")).toBe(
            "LAF my_func\n    INT_VAR\n        x = ${1}\n        y = ${2}\nEND$0",
        );
    });

    it("aligns = signs to longest name within each block", () => {
        const callable = createCallableInfo(
            [
                { name: "x", type: "int", required: true },
                { name: "longname", type: "int", required: true },
            ],
            [
                { name: "resource", type: "string", required: true },
                { name: "a", type: "string", required: true },
            ],
        );
        // "x" padded to match "longname" (8 chars), "a" padded to match "resource" (8 chars)
        expect(buildFunctionCallSnippet(callable, "my_func", "LAF")).toBe(
            "LAF my_func\n" +
                "    INT_VAR\n" +
                "        x        = ${1}\n" +
                "        longname = ${2}\n" +
                "    STR_VAR\n" +
                "        resource = ${3}\n" +
                "        a        = ${4}\n" +
                "END$0",
        );
    });

    it("auto-inserts required params without prefix (lafName context)", () => {
        const callable = createCallableInfo(
            [{ name: "count", type: "int", required: true }],
            [{ name: "name", type: "string", required: true }],
        );
        expect(buildFunctionCallSnippet(callable, "my_func")).toBe(
            "my_func\n    INT_VAR\n        count = ${1}\n    STR_VAR\n        name = ${2}\nEND$0",
        );
    });

    // ---- LAM/LPM prefix (macro launch — no params, no END) ----

    it("generates LAM snippet without END", () => {
        const callable: CallableInfo = {
            context: CallableContext.Action,
            dtype: CallableDefType.Macro,
        };
        expect(buildFunctionCallSnippet(callable, "my_macro", "LAM")).toBe("LAM my_macro$0");
    });

    it("generates LPM snippet without END", () => {
        const callable: CallableInfo = {
            context: CallableContext.Patch,
            dtype: CallableDefType.Macro,
        };
        expect(buildFunctionCallSnippet(callable, "SET_BG2_PROFICIENCY", "LPM")).toBe("LPM SET_BG2_PROFICIENCY$0");
    });

    // ---- Keyword snippets (SET/SPRINT family) ----

    it("returns snippet for SET keyword", () => {
        expect(getKeywordSnippet("SET")).toBe("SET ${1} = ${2}$0");
    });

    it("returns snippet for OUTER_SET keyword", () => {
        expect(getKeywordSnippet("OUTER_SET")).toBe("OUTER_SET ${1} = ${2}$0");
    });

    it("returns snippet for SPRINT keyword", () => {
        expect(getKeywordSnippet("SPRINT")).toBe('SPRINT ${1} "${2}"$0');
    });

    it("returns snippet for OUTER_SPRINT keyword", () => {
        expect(getKeywordSnippet("OUTER_SPRINT")).toBe('OUTER_SPRINT ${1} "${2}"$0');
    });

    it("returns snippet for TEXT_SPRINT keyword", () => {
        expect(getKeywordSnippet("TEXT_SPRINT")).toBe('TEXT_SPRINT ${1} "${2}"$0');
    });

    it("returns snippet for OUTER_TEXT_SPRINT keyword", () => {
        expect(getKeywordSnippet("OUTER_TEXT_SPRINT")).toBe('OUTER_TEXT_SPRINT ${1} "${2}"$0');
    });

    it("returns undefined for non-snippet keywords", () => {
        expect(getKeywordSnippet("COPY")).toBeUndefined();
        expect(getKeywordSnippet("LPF")).toBeUndefined();
        expect(getKeywordSnippet("BEGIN")).toBeUndefined();
    });

    it("generates LAM snippet ignoring params", () => {
        const callable = createCallableInfo([{ name: "count", type: "int", defaultValue: "0", required: true }], []);
        const macroCallable: CallableInfo = {
            ...callable,
            context: CallableContext.Action,
            dtype: CallableDefType.Macro,
        };
        // LAM/LPM don't take inline params — variables are set in calling scope
        expect(buildFunctionCallSnippet(macroCallable, "my_macro", "LAM")).toBe("LAM my_macro$0");
    });

    // ---- RET / RET_ARRAY auto-insertion in snippets ----

    it("auto-inserts RET block for function with ret params", () => {
        const callable = createCallableInfo([], [], ["result"]);
        expect(buildFunctionCallSnippet(callable, "my_func", "LAF")).toBe(
            "LAF my_func\n    RET\n        result\nEND$0",
        );
    });

    it("auto-inserts RET_ARRAY block for function with retArray params", () => {
        const callable = createCallableInfo([], [], [], ["items"]);
        expect(buildFunctionCallSnippet(callable, "my_func", "LAF")).toBe(
            "LAF my_func\n    RET_ARRAY\n        items\nEND$0",
        );
    });

    it("auto-inserts both RET and RET_ARRAY blocks", () => {
        const callable = createCallableInfo([], [], ["result"], ["items"]);
        expect(buildFunctionCallSnippet(callable, "my_func", "LAF")).toBe(
            "LAF my_func\n    RET\n        result\n    RET_ARRAY\n        items\nEND$0",
        );
    });

    it("auto-inserts all param sections: INT_VAR, STR_VAR, RET, RET_ARRAY", () => {
        const callable = createCallableInfo(
            [{ name: "count", type: "int", required: true }],
            [{ name: "name", type: "string", required: true }],
            ["result"],
            ["items"],
        );
        expect(buildFunctionCallSnippet(callable, "full_func", "LAF")).toBe(
            "LAF full_func\n" +
                "    INT_VAR\n" +
                "        count = ${1}\n" +
                "    STR_VAR\n" +
                "        name = ${2}\n" +
                "    RET\n" +
                "        result\n" +
                "    RET_ARRAY\n" +
                "        items\n" +
                "END$0",
        );
    });

    it("auto-inserts multiple RET params", () => {
        const callable = createCallableInfo([], [], ["a", "b", "longname"]);
        expect(buildFunctionCallSnippet(callable, "my_func", "LAF")).toBe(
            "LAF my_func\n    RET\n        a\n        b\n        longname\nEND$0",
        );
    });

    it("auto-inserts RET with optional INT_VAR/STR_VAR (no required input params)", () => {
        const callable = createCallableInfo([{ name: "x", type: "int", defaultValue: "0" }], [], ["result"]);
        // Has optional input params + RET: should show RET block, cursor in body for optional params
        expect(buildFunctionCallSnippet(callable, "my_func", "LAF")).toBe(
            "LAF my_func\n    RET\n        result\nEND$0",
        );
    });

    it("generates snippet without prefix when only RET params exist", () => {
        const callable = createCallableInfo([], [], ["result"]);
        expect(buildFunctionCallSnippet(callable, "my_func")).toBe("my_func\n    RET\n        result\nEND$0");
    });

    it("treats function with only RET params as having params (not empty)", () => {
        const callable = createCallableInfo([], [], ["result"]);
        // Should NOT be null — there are RET params to show
        expect(buildFunctionCallSnippet(callable, "my_func")).not.toBeNull();
    });

    it("generates LAM snippet ignoring RET params", () => {
        const callable = createCallableInfo([], [], ["result"], ["items"]);
        const macroCallable: CallableInfo = {
            ...callable,
            context: CallableContext.Action,
            dtype: CallableDefType.Macro,
        };
        expect(buildFunctionCallSnippet(macroCallable, "my_macro", "LAM")).toBe("LAM my_macro$0");
    });
});
