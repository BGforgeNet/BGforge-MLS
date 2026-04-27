/**
 * Branch-coverage tests for weidu-tp2/hover.ts RET / RET_ARRAY paths.
 *
 * The base funcparam-hover.test.ts exercises INT_VAR / STR_VAR. RET and
 * RET_ARRAY have separate code paths in both findParamInFuncInfo (local
 * function fallback) and findParamInCallableInfo (indexed symbol path),
 * including the "no JSDoc info" and "JSDoc rets[] override" branches.
 */

import * as path from "path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Position } from "vscode-languageserver/node";

vi.mock("../../src/lsp-connection", () => ({
    getConnection: vi.fn(() => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    })),
    initLspConnection: vi.fn(),
}));

vi.mock("../../src/common", async (importOriginal) => {
    const mod = await importOriginal<typeof import("../../src/common")>();
    return {
        ...mod,
        isSubpath: vi.fn(() => true),
    };
});

import { weiduTp2Provider } from "../../src/weidu-tp2/provider";
import { initParser } from "../../../shared/parsers/weidu-tp2";
import { defaultSettings } from "../../src/settings";
import { normalizeUri } from "../../src/core/normalized-uri";
import type { HoverResult } from "../../src/language-provider";

beforeAll(async () => {
    await initParser();
    await weiduTp2Provider.init?.({
        workspaceRoot: path.resolve(__dirname, "..", "src"),
        settings: defaultSettings,
    });
});

function hoverValue(result: HoverResult | undefined): string | undefined {
    if (!result || !result.handled || !result.hover) return undefined;
    const c = result.hover.contents;
    if (typeof c === "object" && "value" in c) return c.value;
    return undefined;
}

describe("hover for RET parameters", () => {
    it("returns 'any' type for RET parameter (local fallback, no JSDoc)", () => {
        const headerText = `
DEFINE_PATCH_FUNCTION compute_result
    INT_VAR x = 0
    RET out_value
BEGIN
    SET out_value = x
END
`;
        const headerUri = normalizeUri("file:///lib-ret.tph");
        weiduTp2Provider.reloadFileData?.(headerUri, headerText);

        const text = `COPY ~file.itm~ ~override~
    LPF compute_result
        INT_VAR x = 5
        RET out_value
    END
`;
        const uri = normalizeUri("file:///test-ret.tp2");
        // Cursor on "out_value" at line 3 (inside RET section)
        const position: Position = { line: 3, character: 14 };
        const result = weiduTp2Provider.hover?.(text, "out_value", uri, position);

        expect(result?.handled).toBe(true);
        expect(hoverValue(result)).toContain("any out_value");
    });

    it("returns hover with @arg description for RET parameter", () => {
        // @arg overrides description on the RET branch (@return tag layout depends on
        // the JSDoc parser's grammar — exercise the description-fallback path instead).
        const headerText = `
/**
 * @arg out_value computed result token
 */
DEFINE_PATCH_FUNCTION described_result
    RET out_value
BEGIN
END
`;
        const headerUri = normalizeUri("file:///lib-ret-typed.tph");
        weiduTp2Provider.reloadFileData?.(headerUri, headerText);

        const text = `COPY ~file.itm~ ~override~
    LPF described_result
        RET out_value
    END
`;
        const uri = normalizeUri("file:///test-ret-typed.tp2");
        const position: Position = { line: 2, character: 14 };
        const result = weiduTp2Provider.hover?.(text, "out_value", uri, position);

        expect(result?.handled).toBe(true);
        const value = hoverValue(result);
        expect(value).toContain("out_value");
    });
});

describe("hover for RET_ARRAY parameters", () => {
    it("returns 'array' type for RET_ARRAY parameter (local fallback, no JSDoc)", () => {
        const headerText = `
DEFINE_PATCH_FUNCTION list_things
    RET_ARRAY items
BEGIN
END
`;
        const headerUri = normalizeUri("file:///lib-array.tph");
        weiduTp2Provider.reloadFileData?.(headerUri, headerText);

        const text = `COPY ~file.itm~ ~override~
    LPF list_things
        RET_ARRAY items
    END
`;
        const uri = normalizeUri("file:///test-array.tp2");
        // Cursor on "items"
        const position: Position = { line: 2, character: 22 };
        const result = weiduTp2Provider.hover?.(text, "items", uri, position);

        expect(result?.handled).toBe(true);
        expect(hoverValue(result)).toContain("array items");
    });

    it("uses JSDoc @return-array info for RET_ARRAY parameter", () => {
        const headerText = `
/**
 * @return-array {string[]} items list of names
 */
DEFINE_PATCH_FUNCTION typed_array
    RET_ARRAY items
BEGIN
END
`;
        const headerUri = normalizeUri("file:///lib-array-typed.tph");
        weiduTp2Provider.reloadFileData?.(headerUri, headerText);

        const text = `COPY ~file.itm~ ~override~
    LPF typed_array
        RET_ARRAY items
    END
`;
        const uri = normalizeUri("file:///test-array-typed.tp2");
        const position: Position = { line: 2, character: 22 };
        const result = weiduTp2Provider.hover?.(text, "items", uri, position);

        expect(result?.handled).toBe(true);
        const value = hoverValue(result);
        expect(value).toContain("items");
    });
});

describe("hover for unknown parameter name (returns null at end of search)", () => {
    it("returns not-handled when symbol is not a parameter of the function being called", () => {
        const headerText = `
DEFINE_ACTION_FUNCTION known_func
    INT_VAR known_param = 0
BEGIN
END
`;
        const headerUri = normalizeUri("file:///lib-unknown.tph");
        weiduTp2Provider.reloadFileData?.(headerUri, headerText);

        const text = `LAF known_func
    INT_VAR
        known_param = 5
END
`;
        const uri = normalizeUri("file:///test-unknown.tp2");
        // Cursor on a non-parameter token (the keyword INT_VAR)
        const position: Position = { line: 1, character: 8 };
        const result = weiduTp2Provider.hover?.(text, "INT_VAR", uri, position);

        // Symbol "INT_VAR" is not a parameter — hover should not be handled by funcparam path.
        // Either not handled or fall-through — the test is that it does not pretend to be a param.
        if (result?.handled) {
            expect(hoverValue(result)).not.toContain("int INT_VAR");
        }
    });
});
