/**
 * Tests for core/static-loader.ts - Static symbol loading from JSON.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CompletionItemKind, MarkupKind } from "vscode-languageserver/node";
import { SymbolKind, ScopeLevel, SourceType, type CallableSymbol } from "../../src/core/symbol";
import { CompletionCategory, type CompletionItemWithCategory } from "../../src/shared/completion-context";
import { WEIDU_TP2_STANZAS } from "../../../shared/stanza-names";

// Mock fs.readFileSync before importing the module
vi.mock("fs", () => ({
    readFileSync: vi.fn(),
}));

// Mock conlog to avoid LSP connection requirement
vi.mock("../../src/common", () => ({
    conlog: vi.fn(),
    errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

import { loadStaticSymbols } from "../../src/core/static-loader";
import { readFileSync } from "fs";

const mockReadFileSync = vi.mocked(readFileSync);

describe("static-loader", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("loadStaticSymbols()", () => {
        it("should return empty array when file not found", () => {
            mockReadFileSync.mockImplementation(() => {
                throw new Error("ENOENT: no such file");
            });

            const result = loadStaticSymbols("nonexistent-lang");

            expect(result).toEqual([]);
        });

        it("should return empty array for empty JSON array", () => {
            mockReadFileSync.mockReturnValue("[]");

            const result = loadStaticSymbols("test-lang");

            expect(result).toEqual([]);
        });

        it("should convert simple keyword to Symbol", () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify([
                    {
                        label: "IF",
                        kind: CompletionItemKind.Keyword,
                        category: "keywords",
                    },
                ]),
            );

            const result = loadStaticSymbols("test-lang");

            expect(result).toHaveLength(1);
            expect(result[0]!.name).toBe("IF");
            expect(result[0]!.kind).toBe(SymbolKind.Constant);
            expect(result[0]!.scope.level).toBe(ScopeLevel.Global);
            expect(result[0]!.source.type).toBe(SourceType.Static);
        });

        it("should convert action to Symbol with Action kind", () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify([
                    {
                        label: "ActionOverride",
                        kind: CompletionItemKind.Function,
                        category: "actions",
                        documentation: {
                            kind: "markdown",
                            value: "```\nActionOverride(O:Actor, A:Action)\n```\nThis action...",
                        },
                    },
                ]),
            );

            const result = loadStaticSymbols("test-lang");

            expect(result).toHaveLength(1);
            expect(result[0]!.name).toBe("ActionOverride");
            expect(result[0]!.kind).toBe(SymbolKind.Action);
        });

        it("should convert trigger to Symbol with Trigger kind", () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify([
                    {
                        label: "TriggerOverride",
                        kind: CompletionItemKind.Function,
                        category: "triggers",
                    },
                ]),
            );

            const result = loadStaticSymbols("test-lang");

            expect(result).toHaveLength(1);
            expect(result[0]!.name).toBe("TriggerOverride");
            expect(result[0]!.kind).toBe(SymbolKind.Trigger);
        });

        it("should preserve completion item structure", () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify([
                    {
                        label: "TestAction",
                        kind: CompletionItemKind.Function,
                        category: "actions",
                        detail: "TestAction(I:Param)",
                        tags: [1], // deprecated
                    },
                ]),
            );

            const result = loadStaticSymbols("test-lang");
            const completion = result[0]!.completion;

            expect(completion.label).toBe("TestAction");
            expect(completion.kind).toBe(CompletionItemKind.Function);
            expect(completion.detail).toBe("TestAction(I:Param)");
            expect(completion.tags).toEqual([1]);
        });

        it("should extract hover from documentation", () => {
            const docContent = "```baf\nMyAction()\n```\nDoes something.";
            mockReadFileSync.mockReturnValue(
                JSON.stringify([
                    {
                        label: "MyAction",
                        kind: CompletionItemKind.Function,
                        category: "actions",
                        documentation: {
                            kind: "markdown",
                            value: docContent,
                        },
                    },
                ]),
            );

            const result = loadStaticSymbols("test-lang");
            const hover = result[0]!.hover;

            expect(hover.contents).toEqual({
                kind: MarkupKind.Markdown,
                value: docContent,
            });
        });

        it("should create minimal hover when no documentation", () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify([
                    {
                        label: "SimpleKeyword",
                        kind: CompletionItemKind.Keyword,
                        category: "keywords",
                    },
                ]),
            );

            const result = loadStaticSymbols("test-lang");
            const hover = result[0]!.hover;

            expect(hover.contents).toEqual({
                kind: MarkupKind.Markdown,
                value: "SimpleKeyword",
            });
        });

        it("should handle string documentation", () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify([
                    {
                        label: "OldStyle",
                        kind: CompletionItemKind.Function,
                        documentation: "Plain text documentation",
                    },
                ]),
            );

            const result = loadStaticSymbols("test-lang");
            const hover = result[0]!.hover;

            expect(hover.contents).toEqual({
                kind: MarkupKind.Markdown,
                value: "Plain text documentation",
            });
        });

        it("should fallback to CompletionItemKind when category unknown", () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify([
                    {
                        label: "Unknown",
                        kind: CompletionItemKind.Variable,
                        category: "unknown_category",
                    },
                ]),
            );

            const result = loadStaticSymbols("test-lang");

            expect(result[0]!.kind).toBe(SymbolKind.Variable);
        });

        it("should convert multiple items", () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify([
                    { label: "IF", kind: CompletionItemKind.Keyword, category: "keywords" },
                    { label: "THEN", kind: CompletionItemKind.Keyword, category: "keywords" },
                    { label: "ActionX", kind: CompletionItemKind.Function, category: "actions" },
                    { label: "TriggerY", kind: CompletionItemKind.Function, category: "triggers" },
                ]),
            );

            const result = loadStaticSymbols("test-lang");

            expect(result).toHaveLength(4);
            expect(result.map((s) => s.name)).toEqual(["IF", "THEN", "ActionX", "TriggerY"]);
            expect(result.map((s) => s.kind)).toEqual([
                SymbolKind.Constant,
                SymbolKind.Constant,
                SymbolKind.Action,
                SymbolKind.Trigger,
            ]);
        });

        it("should set null location for static symbols", () => {
            mockReadFileSync.mockReturnValue(JSON.stringify([{ label: "Test", kind: CompletionItemKind.Function }]));

            const result = loadStaticSymbols("test-lang");

            // Static symbols have no source file, so location is null
            expect(result[0]!.location).toBeNull();
        });

        it("should preserve category from JSON on completion item", () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify([
                    {
                        label: "COPY",
                        kind: CompletionItemKind.Function,
                        category: "action",
                    },
                ]),
            );

            const result = loadStaticSymbols("test-lang");
            const completion = result[0]!.completion as CompletionItemWithCategory;

            expect(completion.category).toBe(CompletionCategory.Action);
        });

        it("should preserve category for patch items", () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify([
                    {
                        label: "WRITE_BYTE",
                        kind: CompletionItemKind.Function,
                        category: "patch",
                    },
                ]),
            );

            const result = loadStaticSymbols("test-lang");
            const completion = result[0]!.completion as CompletionItemWithCategory;

            expect(completion.category).toBe(CompletionCategory.Patch);
        });

        it("should set null source.uri for static symbols", () => {
            mockReadFileSync.mockReturnValue(JSON.stringify([{ label: "Test", kind: CompletionItemKind.Function }]));

            const result = loadStaticSymbols("test-lang");

            // Static symbols have no source file
            expect(result[0]!.source.type).toBe(SourceType.Static);
            expect(result[0]!.source.uri).toBeNull();
        });

        it("should map functions category to Function kind", () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify([{ label: "my_func", kind: CompletionItemKind.Function, category: "functions" }]),
            );

            const result = loadStaticSymbols("test-lang");

            expect(result[0]!.kind).toBe(SymbolKind.Function);
        });

        it("should map procedures category to Procedure kind", () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify([{ label: "my_proc", kind: CompletionItemKind.Function, category: "procedures" }]),
            );

            const result = loadStaticSymbols("test-lang");

            expect(result[0]!.kind).toBe(SymbolKind.Procedure);
        });

        it("should map macros category to Macro kind", () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify([{ label: "MY_MACRO", kind: CompletionItemKind.Snippet, category: "macros" }]),
            );

            const result = loadStaticSymbols("test-lang");

            expect(result[0]!.kind).toBe(SymbolKind.Macro);
        });
    });

    describe("callable context and dtype for TP2 categories", () => {
        it("should NOT set callable metadata for action commands (LAF, COPY, etc.)", () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify([
                    {
                        label: "COPY",
                        kind: CompletionItemKind.Function,
                        category: "action",
                        documentation: {
                            kind: "markdown",
                            value: "```weidu-tp2-tooltip\nCOPY ~source~ ~dest~\n```\nCopies a file.",
                        },
                    },
                ]),
            );

            const result = loadStaticSymbols("test-lang");
            const sym = result[0] as CallableSymbol;

            expect(sym.kind).toBe(SymbolKind.Function);
            expect(sym.callable.context).toBeUndefined();
            expect(sym.callable.dtype).toBeUndefined();
        });

        it("should NOT set callable metadata for patch commands (WRITE_BYTE, etc.)", () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify([
                    {
                        label: "WRITE_BYTE",
                        kind: CompletionItemKind.Function,
                        category: "patch",
                        documentation: {
                            kind: "markdown",
                            value: "```weidu-tp2-tooltip\nWRITE_BYTE offset value\n```\nWrites a byte.",
                        },
                    },
                ]),
            );

            const result = loadStaticSymbols("test-lang");
            const sym = result[0] as CallableSymbol;

            expect(sym.kind).toBe(SymbolKind.Function);
            expect(sym.callable.context).toBeUndefined();
            expect(sym.callable.dtype).toBeUndefined();
        });

        it("should pass through pre-baked prefix for action commands", () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify([
                    {
                        label: "COPY",
                        kind: CompletionItemKind.Function,
                        category: "action",
                        documentation: {
                            kind: "markdown",
                            value: "```weidu-tp2-tooltip\nCOPY ~source~ ~dest~\n```\nCopies a file.",
                        },
                    },
                ]),
            );

            const result = loadStaticSymbols("test-lang");
            const value = (result[0]!.hover.contents as { kind: string; value: string }).value;

            // Commands should NOT have "action function" prefix (not in CALLABLE_CATEGORY_META)
            expect(value).toBe("```weidu-tp2-tooltip\nCOPY ~source~ ~dest~\n```\nCopies a file.");
        });

        it("should pass through pre-baked callable prefix (patch_functions)", () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify([
                    {
                        label: "ADD_SPELL_EFFECT",
                        kind: CompletionItemKind.Function,
                        category: WEIDU_TP2_STANZAS.patch_functions,
                        documentation: {
                            kind: "markdown",
                            value: "```weidu-tp2-tooltip\npatch function ADD_SPELL_EFFECT\n```\nAdds an effect.",
                        },
                    },
                ]),
            );

            const result = loadStaticSymbols("test-lang");
            const value = (result[0]!.hover.contents as { kind: string; value: string }).value;

            expect(value).toBe("```weidu-tp2-tooltip\npatch function ADD_SPELL_EFFECT\n```\nAdds an effect.");
        });

        it("should pass through pre-baked callable prefix (action_functions)", () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify([
                    {
                        label: "ADD_WORLDMAP",
                        kind: CompletionItemKind.Function,
                        category: WEIDU_TP2_STANZAS.action_functions,
                        documentation: {
                            kind: "markdown",
                            value: "```weidu-tp2-tooltip\naction function ADD_WORLDMAP\n```\nAdds a worldmap.",
                        },
                    },
                ]),
            );

            const result = loadStaticSymbols("test-lang");
            const value = (result[0]!.hover.contents as { kind: string; value: string }).value;

            expect(value).toBe("```weidu-tp2-tooltip\naction function ADD_WORLDMAP\n```\nAdds a worldmap.");
        });

        it("should have matching hover and completion documentation (single source of truth)", () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify([
                    {
                        label: "ADD_AREA_ITEM",
                        kind: CompletionItemKind.Function,
                        category: WEIDU_TP2_STANZAS.patch_functions,
                        documentation: {
                            kind: "markdown",
                            value: "```weidu-tp2-tooltip\npatch function ADD_AREA_ITEM\n```\nAdds an item to a container.",
                        },
                    },
                ]),
            );

            const result = loadStaticSymbols("test-lang");
            const hoverValue = (result[0]!.hover.contents as { kind: string; value: string }).value;
            const completionDoc = result[0]!.completion.documentation as { kind: string; value: string };

            // Both should contain the pre-baked "patch function" prefix
            expect(hoverValue).toContain("patch function ADD_AREA_ITEM");
            expect(completionDoc.value).toContain("patch function ADD_AREA_ITEM");

            // They should be identical
            expect(completionDoc.value).toBe(hoverValue);
        });

        it("should NOT set callable context for BAF actions (plural category)", () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify([
                    {
                        label: "ActionOverride",
                        kind: CompletionItemKind.Function,
                        category: "actions",
                        documentation: {
                            kind: "markdown",
                            value: "```weidu-baf-tooltip\nActionOverride(O:Actor, A:Action)\n```\nOverrides.",
                        },
                    },
                ]),
            );

            const result = loadStaticSymbols("test-lang");
            const sym = result[0] as CallableSymbol;

            expect(sym.kind).toBe(SymbolKind.Action);
            expect(sym.callable.context).toBeUndefined();
            expect(sym.callable.dtype).toBeUndefined();
        });

        it("should NOT set callable metadata for non-Function kind items", () => {
            // Worldmap "action" stanza has type=Keyword, not Function
            mockReadFileSync.mockReturnValue(
                JSON.stringify([
                    {
                        label: "AMBUSH",
                        kind: CompletionItemKind.Keyword,
                        category: "action",
                    },
                ]),
            );

            const result = loadStaticSymbols("test-lang");

            // Should be Constant (from Keyword fallback), not a callable with metadata
            expect(result[0]!.kind).toBe(SymbolKind.Constant);
        });

        it("should pass through pre-baked dimorphic function prefix", () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify([
                    {
                        label: "RESOLVE_STR_REF",
                        kind: CompletionItemKind.Function,
                        category: WEIDU_TP2_STANZAS.dimorphic_functions,
                        documentation: {
                            kind: "markdown",
                            value: "```weidu-tp2-tooltip\ndimorphic function RESOLVE_STR_REF\n```\nResolves a string reference.",
                        },
                    },
                ]),
            );

            const result = loadStaticSymbols("test-lang");
            const value = (result[0]!.hover.contents as { kind: string; value: string }).value;

            expect(value).toBe(
                "```weidu-tp2-tooltip\ndimorphic function RESOLVE_STR_REF\n```\nResolves a string reference.",
            );
        });

        it("should not crash on callable items without documentation", () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify([
                    {
                        label: "BARE_ACTION",
                        kind: CompletionItemKind.Function,
                        category: "action",
                    },
                ]),
            );

            const result = loadStaticSymbols("test-lang");

            expect(result[0]!.hover.contents).toEqual({
                kind: "markdown",
                value: "BARE_ACTION",
            });
        });
    });

    describe("callable.params from static JSON", () => {
        it("should populate callable.params.intVar and strVar from JSON", () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify([
                    {
                        label: "CLONE_EFFECT",
                        kind: CompletionItemKind.Function,
                        category: WEIDU_TP2_STANZAS.patch_functions,
                        params: {
                            intVar: [{ name: "opcode", type: "int", defaultValue: "-1", description: "Effect opcode" }],
                            strVar: [{ name: "match_resource", type: "string" }],
                            ret: [],
                            retArray: [],
                        },
                    },
                ]),
            );

            const result = loadStaticSymbols("test-lang");
            const sym = result[0] as CallableSymbol;

            expect(sym.callable.params).toBeDefined();
            expect(sym.callable.params!.intVar).toHaveLength(1);
            expect(sym.callable.params!.intVar[0]).toMatchObject({ name: "opcode", type: "int", defaultValue: "-1" });
            expect(sym.callable.params!.strVar).toHaveLength(1);
            expect(sym.callable.params!.strVar[0]).toMatchObject({ name: "match_resource", type: "string" });
        });

        it("should populate callable.params.ret from JSON", () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify([
                    {
                        label: "GET_ITEM_AC",
                        kind: CompletionItemKind.Function,
                        category: WEIDU_TP2_STANZAS.patch_functions,
                        params: {
                            intVar: [],
                            strVar: [],
                            ret: ["base_ac"],
                            retArray: [],
                        },
                    },
                ]),
            );

            const result = loadStaticSymbols("test-lang");
            const sym = result[0] as CallableSymbol;

            expect(sym.callable.params!.ret).toEqual(["base_ac"]);
            expect(sym.callable.params!.retArray).toEqual([]);
        });

        it("should leave callable.params undefined when not in JSON", () => {
            mockReadFileSync.mockReturnValue(
                JSON.stringify([
                    {
                        label: "COPY",
                        kind: CompletionItemKind.Function,
                        category: "action",
                    },
                ]),
            );

            const result = loadStaticSymbols("test-lang");
            const sym = result[0] as CallableSymbol;

            expect(sym.callable.params).toBeUndefined();
        });
    });
});
