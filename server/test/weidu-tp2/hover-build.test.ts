/**
 * Unit tests for hover.ts buildVariableHover and buildFunctionHover.
 *
 * Covers:
 *  - extractFilename: URI with slashes vs. no slashes after stripping file://
 *  - truncateDesc: cut point inside a markdown link (moved before link)
 *  - truncateDesc: cut point at/before start of first link (return desc as-is)
 *
 * These tests import the exported functions directly to avoid LSP setup.
 */

import { describe, expect, it, vi, beforeAll } from "vitest";
import { MarkupKind } from "vscode-languageserver/node";
import { DeclarationKind, CallableContext, CallableDefType } from "../../src/core/symbol";

vi.mock("../../src/common", () => ({
    conlog: vi.fn(),
    errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

import { buildVariableHover, buildFunctionHover } from "../../src/weidu-tp2/hover";
import { initParser } from "../../../shared/parsers/weidu-tp2";
import type { VariableInfo, FunctionInfo } from "../../src/weidu-tp2/header-parser";

function makeVarInfo(overrides: Partial<VariableInfo> = {}): VariableInfo {
    return {
        name: "MY_VAR",
        location: {
            uri: "file:///some/path/setup.tp2",
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
        },
        declarationKind: DeclarationKind.Set,
        inferredType: "int",
        ...overrides,
    };
}

function makeFuncInfo(overrides: Partial<FunctionInfo> = {}): FunctionInfo {
    return {
        name: "my_func",
        context: CallableContext.Action,
        dtype: CallableDefType.Function,
        location: {
            uri: "file:///some/path/lib.tph",
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } },
        },
        params: { intVar: [], strVar: [], ret: [], retArray: [] },
        ...overrides,
    };
}

beforeAll(async () => {
    await initParser();
});

describe("weidu-tp2/hover buildVariableHover()", () => {
    it("uses extractFilename when displayPath is undefined — URI with slashes", () => {
        // extractFilename: strip file://, find last slash → "setup.tp2"
        const hover = buildVariableHover(makeVarInfo());
        const value = (hover.contents as { kind: string; value: string }).value;
        expect(hover.contents).toHaveProperty("kind", MarkupKind.Markdown);
        expect(value).toContain("setup.tp2");
    });

    it("uses extractFilename for URI with no slashes after stripping file:// prefix", () => {
        // extractFilename: strip file:// → "nopath.tp2"; lastSlash = -1 → return whole string
        const varInfo = makeVarInfo({
            location: {
                uri: "file://nopath.tp2",
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
            },
        });
        const hover = buildVariableHover(varInfo);
        const value = (hover.contents as { kind: string; value: string }).value;
        expect(value).toContain("nopath.tp2");
    });

    it("skips path block when displayPath is null", () => {
        const hover = buildVariableHover(makeVarInfo(), null);
        const value = (hover.contents as { kind: string; value: string }).value;
        expect(value).not.toContain("setup.tp2");
    });

    it("uses provided displayPath string instead of extractFilename", () => {
        const hover = buildVariableHover(makeVarInfo(), "custom/display/path.tp2");
        const value = (hover.contents as { kind: string; value: string }).value;
        expect(value).toContain("custom/display/path.tp2");
    });
});

describe("weidu-tp2/hover buildFunctionHover() — truncateDesc branches", () => {
    it("truncates long parameter description preserving links — cutPoint inside link moves before it (line 384-386)", () => {
        // DESC_MAX_LENGTH=80, cutPoint=77.
        // Parameter description: 70 'a' chars + a markdown link → link starts at 70 (inside [70,116)).
        // cutPoint=77 is inside [70,116) → moved to 70 → truncate at 70 and append "..."
        const prefix = "a".repeat(70);
        const link = "[click here](http://example.com/very-long-url)";
        const paramDesc = prefix + link + " trailing";

        const funcInfo = makeFuncInfo({
            params: {
                intVar: [{ name: "stacking_id", defaultValue: "0" }],
                strVar: [],
                ret: [],
                retArray: [],
            },
            jsdoc: {
                desc: undefined,
                args: [{ name: "stacking_id", type: "int", description: paramDesc }],
                rets: [],
            },
        });

        const hover = buildFunctionHover(funcInfo, null);
        const value = (hover.contents as { kind: string; value: string }).value;
        // Truncation should have moved the cut point before the link
        expect(value).toContain("...");
        // The full link text should NOT appear (it was cut before it)
        expect(value).not.toContain("[click here]");
    });

    it("returns full description when first link starts at position 0, making cutPoint <= 0 (line 390-392)", () => {
        // DESC_MAX_LENGTH=80, cutPoint=77. Link starts at 0 → cutPoint becomes 0 → return desc unchanged.
        const link = "[" + "x".repeat(76) + "](http://example.com/url)";
        const suffix = " more text that pushes past 80 chars";
        const paramDesc = link + suffix; // > 80 chars, link at position 0

        const funcInfo = makeFuncInfo({
            params: {
                intVar: [{ name: "param_a", defaultValue: "0" }],
                strVar: [],
                ret: [],
                retArray: [],
            },
            jsdoc: {
                desc: undefined,
                args: [{ name: "param_a", type: "int", description: paramDesc }],
                rets: [],
            },
        });

        const hover = buildFunctionHover(funcInfo, null);
        const value = (hover.contents as { kind: string; value: string }).value;
        // When cutPoint <= 0, desc returned as-is — the link text should appear in full
        expect(value).toContain("x".repeat(76));
    });
});
