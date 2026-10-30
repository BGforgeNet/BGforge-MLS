/**
 * Unit tests for hover-content.ts buildVariableHover and buildFunctionHover.
 *
 * Covers:
 *  - the file name shown when no displayPath is given: URI with a directory vs. without one
 *  - truncateDesc: cut point inside a markdown link (moved before link)
 *  - truncateDesc: cut point at/before start of first link (return desc as-is)
 *
 * These tests import the exported functions directly to avoid LSP setup.
 */

import { describe, expect, it, vi, beforeAll } from "vitest";
import { MarkupKind } from "vscode-languageserver/node";
import { DeclarationKind, CallableContext, CallableDefType } from "../../src/core/symbol";

vi.mock("../../src/diagnostics", () => ({
    errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

vi.mock("../../src/logger", () => ({
    conlog: vi.fn(),
}));

import { buildVariableHover, buildFunctionHover } from "../../src/weidu-tp2/hover-content";
import { initParser } from "@bgforge/shared/parsers/weidu-tp2";
import { cpuTimeMs } from "@bgforge/shared/cpu-time";
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
    it("uses extractFilename when displayPath is undefined - URI with slashes", () => {
        // The URI's last path segment -> "setup.tp2"
        const hover = buildVariableHover(makeVarInfo());
        const value = (hover.contents as { kind: string; value: string }).value;
        expect(hover.contents).toHaveProperty("kind", MarkupKind.Markdown);
        expect(value).toContain("setup.tp2");
    });

    it("uses extractFilename for a URI with no directory after the scheme", () => {
        // No directory after the scheme: the name after `file://` -> "nopath.tp2"
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

describe("weidu-tp2/hover buildFunctionHover() - truncateDesc branches", () => {
    it("truncates long parameter description preserving links - cutPoint inside link moves before it (line 384-386)", () => {
        // DESC_MAX_LENGTH=80, cutPoint=77.
        // Parameter description: 70 'a' chars + a markdown link -> link starts at 70 (inside [70,116)).
        // cutPoint=77 is inside [70,116) -> moved to 70 -> truncate at 70 and append "..."
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
        // DESC_MAX_LENGTH=80, cutPoint=77. Link starts at 0 -> cutPoint becomes 0 -> return desc unchanged.
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
        // When cutPoint <= 0, desc returned as-is - the link text should appear in full
        expect(value).toContain("x".repeat(76));
    });

    /** The hover markdown for a function whose one parameter carries `description`. */
    function hoverWithParamDescription(description: string): string {
        const hover = buildFunctionHover(
            makeFuncInfo({
                params: { intVar: [{ name: "param_a", defaultValue: "0" }], strVar: [], ret: [], retArray: [] },
                jsdoc: { desc: undefined, args: [{ name: "param_a", type: "int", description }], rets: [] },
            }),
            null,
        );
        return (hover.contents as { kind: string; value: string }).value;
    }

    it("cuts a description without links at 77 characters", () => {
        const value = hoverWithParamDescription("a".repeat(100));

        expect(value).toContain(`${"a".repeat(77)}...`);
        expect(value).not.toContain("a".repeat(78));
    });

    it("keeps a link that ends before the cut and cuts the text after it", () => {
        const value = hoverWithParamDescription(`[a](u)${"b".repeat(100)}`);

        expect(value).toContain(`[a](u)${"b".repeat(71)}...`);
        expect(value).not.toContain("b".repeat(72));
    });

    it("does not move the cut for a link that ends exactly at it", () => {
        const value = hoverWithParamDescription(`${"a".repeat(71)}[b](c)${"d".repeat(30)}`);

        expect(value).toContain(`${"a".repeat(71)}[b](c)...`);
    });

    it("treats an empty link text or an empty target as plain text", () => {
        const emptyText = hoverWithParamDescription(`${"a".repeat(74)}[](http://example.com/long)${"z".repeat(20)}`);
        const emptyTarget = hoverWithParamDescription(`${"a".repeat(74)}[text]()${"z".repeat(40)}`);

        expect(emptyText).toContain(`${"a".repeat(74)}[](...`);
        expect(emptyTarget).toContain(`${"a".repeat(74)}[te...`);
    });

    it("starts a link at the first bracket of an unclosed run before the real one", () => {
        // "[x" has no "]" of its own, so the link text runs from it to the first "]": the cut inside moves to 0.
        const desc = `[x${"a".repeat(80)}[l](http://example.com/u)${"t".repeat(30)}`;

        expect(hoverWithParamDescription(desc)).toContain(desc);
    });

    it("truncates a description made of opening brackets in linear time", () => {
        const description = "[".repeat(100_000);

        let value: ReturnType<typeof hoverWithParamDescription> | undefined;
        const elapsed = cpuTimeMs(() => {
            value = hoverWithParamDescription(description);
        });

        expect(value).toContain(`${"[".repeat(77)}...`);
        expect(elapsed).toBeLessThan(500);
    });
});
