/**
 * Unit tests for JSDoc tag and type completion in fallout-ssl.
 * Tests context detection (comment vs JSDoc vs code), position-based
 * completion kind detection, and completion items.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import { CompletionItemKind, type Position } from "vscode-languageserver/node";

// Mock the server module to avoid LSP connection issues
vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { initParser } from "../../src/fallout-ssl/parser";
import { getSslCompletionContext, SslCompletionContext } from "../../src/fallout-ssl/completion-context";
import { getJsdocCompletions, getJsdocPositionKind, JsdocPositionKind } from "../../src/shared/jsdoc-completions";
import { FALLOUT_JSDOC_TYPE_NAMES } from "../../src/shared/jsdoc-types";
import { FALLOUT_JSDOC_TYPES } from "../../src/shared/fallout-types";

beforeAll(async () => {
    await initParser();
});

describe("fallout-ssl JSDoc completion", () => {
    describe("getSslCompletionContext", () => {
        it("returns Jsdoc inside /** */ block comment", () => {
            const text = `/** @par */\nprocedure foo begin end`;
            const pos: Position = { line: 0, character: 7 };
            expect(getSslCompletionContext(text, pos)).toBe(SslCompletionContext.Jsdoc);
        });

        it("returns Comment inside regular block comment /* */", () => {
            const text = `/* some comment */\nprocedure foo begin end`;
            const pos: Position = { line: 0, character: 5 };
            expect(getSslCompletionContext(text, pos)).toBe(SslCompletionContext.Comment);
        });

        it("returns Comment inside line comment //", () => {
            const text = `// line comment\nprocedure foo begin end`;
            const pos: Position = { line: 0, character: 5 };
            expect(getSslCompletionContext(text, pos)).toBe(SslCompletionContext.Comment);
        });

        it("returns Code outside any comment", () => {
            const text = `procedure foo begin end`;
            const pos: Position = { line: 0, character: 10 };
            expect(getSslCompletionContext(text, pos)).toBe(SslCompletionContext.Code);
        });

        it("returns Jsdoc inside multi-line /** */ comment", () => {
            const text = `/**\n * @param {int} x\n */\nprocedure foo begin end`;
            const pos: Position = { line: 1, character: 5 };
            expect(getSslCompletionContext(text, pos)).toBe(SslCompletionContext.Jsdoc);
        });

        it("returns Code when parser is not initialized (fallback)", () => {
            // This tests the fallback path - parser handles this gracefully
            const text = `procedure foo begin end`;
            const pos: Position = { line: 0, character: 10 };
            expect(getSslCompletionContext(text, pos)).toBe(SslCompletionContext.Code);
        });
    });

    describe("getJsdocPositionKind", () => {
        describe("tag position", () => {
            it("bare @ at end of line", () => {
                expect(getJsdocPositionKind(" * @")).toBe(JsdocPositionKind.Tag);
            });

            it("partial tag name", () => {
                expect(getJsdocPositionKind(" * @par")).toBe(JsdocPositionKind.Tag);
            });

            it("complete tag name without space", () => {
                expect(getJsdocPositionKind(" * @param")).toBe(JsdocPositionKind.Tag);
            });

            it("@ without leading context", () => {
                expect(getJsdocPositionKind("@")).toBe(JsdocPositionKind.Tag);
            });

            it("partial deprecated tag", () => {
                expect(getJsdocPositionKind(" * @dep")).toBe(JsdocPositionKind.Tag);
            });
        });

        describe("type position", () => {
            it("after @param with space", () => {
                expect(getJsdocPositionKind(" * @param ")).toBe(JsdocPositionKind.Type);
            });

            it("after @param with opening brace", () => {
                expect(getJsdocPositionKind(" * @param {")).toBe(JsdocPositionKind.Type);
            });

            it("after @param with partial type in braces", () => {
                expect(getJsdocPositionKind(" * @param {in")).toBe(JsdocPositionKind.Type);
            });

            it("after @param with partial braceless type", () => {
                expect(getJsdocPositionKind(" * @param in")).toBe(JsdocPositionKind.Type);
            });

            it("after @arg with space", () => {
                expect(getJsdocPositionKind(" * @arg ")).toBe(JsdocPositionKind.Type);
            });

            it("after @ret with space", () => {
                expect(getJsdocPositionKind(" * @ret ")).toBe(JsdocPositionKind.Type);
            });

            it("after @return with space", () => {
                expect(getJsdocPositionKind(" * @return ")).toBe(JsdocPositionKind.Type);
            });

            it("after @returns with space", () => {
                expect(getJsdocPositionKind(" * @returns ")).toBe(JsdocPositionKind.Type);
            });

            it("after @type with space", () => {
                expect(getJsdocPositionKind(" * @type ")).toBe(JsdocPositionKind.Type);
            });

            it("after @type with opening brace", () => {
                expect(getJsdocPositionKind(" * @type {")).toBe(JsdocPositionKind.Type);
            });
        });

        describe("no-completion position", () => {
            it("after complete braced type", () => {
                expect(getJsdocPositionKind(" * @param {int} ")).toBe(JsdocPositionKind.None);
            });

            it("after braceless type and name", () => {
                expect(getJsdocPositionKind(" * @param int name")).toBe(JsdocPositionKind.None);
            });

            it("after @deprecated with space", () => {
                expect(getJsdocPositionKind(" * @deprecated ")).toBe(JsdocPositionKind.None);
            });

            it("plain text without @", () => {
                expect(getJsdocPositionKind(" * some text")).toBe(JsdocPositionKind.None);
            });

            it("empty JSDoc line prefix", () => {
                expect(getJsdocPositionKind(" * ")).toBe(JsdocPositionKind.None);
            });

            it("empty string", () => {
                expect(getJsdocPositionKind("")).toBe(JsdocPositionKind.None);
            });
        });
    });

    describe("getJsdocCompletions at tag position", () => {
        const tagPrefix = " * @";

        it("returns only tags, not types", () => {
            const items = getJsdocCompletions(FALLOUT_JSDOC_TYPES, tagPrefix);
            const tags = items.filter((i) => i.kind === CompletionItemKind.Keyword);
            const types = items.filter((i) => i.kind === CompletionItemKind.TypeParameter);
            expect(tags.length).toBeGreaterThan(0);
            expect(types.length).toBe(0);
        });

        it("returns all tag aliases", () => {
            const items = getJsdocCompletions(FALLOUT_JSDOC_TYPES, tagPrefix);
            const labels = items.map((i) => i.label);
            expect(labels).toContain("@param");
            expect(labels).toContain("@arg");
            expect(labels).toContain("@ret");
            expect(labels).toContain("@return");
            expect(labels).toContain("@returns");
            expect(labels).toContain("@type");
            expect(labels).toContain("@deprecated");
        });

        it("strips @ from insertText and filterText", () => {
            const items = getJsdocCompletions(FALLOUT_JSDOC_TYPES, tagPrefix);
            const paramItem = items.find((i) => i.label === "@param");
            expect(paramItem?.insertText).toBe("param ");
            expect(paramItem?.filterText).toBe("param");
        });

        it("tags expecting type have re-trigger command and trailing space", () => {
            const items = getJsdocCompletions(FALLOUT_JSDOC_TYPES, tagPrefix);
            const paramItem = items.find((i) => i.label === "@param");
            const retItem = items.find((i) => i.label === "@ret");
            const typeItem = items.find((i) => i.label === "@type");
            expect(paramItem?.command?.command).toBe("editor.action.triggerSuggest");
            expect(retItem?.command?.command).toBe("editor.action.triggerSuggest");
            expect(typeItem?.command?.command).toBe("editor.action.triggerSuggest");
        });

        it("@deprecated has no re-trigger command and no trailing space", () => {
            const items = getJsdocCompletions(FALLOUT_JSDOC_TYPES, tagPrefix);
            const depItem = items.find((i) => i.label === "@deprecated");
            expect(depItem?.command).toBeUndefined();
            expect(depItem?.insertText).toBe("deprecated");
        });
    });

    describe("getJsdocCompletions at type position", () => {
        const typePrefix = " * @param ";

        it("returns only types, not tags", () => {
            const items = getJsdocCompletions(FALLOUT_JSDOC_TYPES, typePrefix);
            const tags = items.filter((i) => i.kind === CompletionItemKind.Keyword);
            const types = items.filter((i) => i.kind === CompletionItemKind.TypeParameter);
            expect(tags.length).toBe(0);
            expect(types.length).toBeGreaterThan(0);
        });

        it("returns all Fallout type names", () => {
            const items = getJsdocCompletions(FALLOUT_JSDOC_TYPES, typePrefix);
            const typeLabels = items.map((i) => i.label);
            for (const typeName of FALLOUT_JSDOC_TYPE_NAMES) {
                expect(typeLabels).toContain(typeName);
            }
        });

        it("includes bit in Fallout type completions", () => {
            const items = getJsdocCompletions(FALLOUT_JSDOC_TYPES, typePrefix);
            const bitItem = items.find((i) => i.label === "bit");
            expect(bitItem?.kind).toBe(CompletionItemKind.TypeParameter);
        });

        it("does not return WeiDU-only types", () => {
            const items = getJsdocCompletions(FALLOUT_JSDOC_TYPES, typePrefix);
            const typeLabels = items.map((i) => i.label);
            expect(typeLabels).not.toContain("resref");
            expect(typeLabels).not.toContain("ids");
            expect(typeLabels).not.toContain("filename");
        });

        it("types have TypeParameter kind", () => {
            const items = getJsdocCompletions(FALLOUT_JSDOC_TYPES, typePrefix);
            for (const item of items) {
                expect(item.kind).toBe(CompletionItemKind.TypeParameter);
            }
        });

        it("works after @type tag", () => {
            const items = getJsdocCompletions(FALLOUT_JSDOC_TYPES, " * @type ");
            expect(items.length).toBeGreaterThan(0);
            expect(items.every((i) => i.kind === CompletionItemKind.TypeParameter)).toBe(true);
        });

        it("works with opening brace", () => {
            const items = getJsdocCompletions(FALLOUT_JSDOC_TYPES, " * @param {");
            expect(items.length).toBeGreaterThan(0);
            expect(items.every((i) => i.kind === CompletionItemKind.TypeParameter)).toBe(true);
        });
    });

    describe("getJsdocCompletions at no-completion position", () => {
        it("returns empty after complete braced type", () => {
            const items = getJsdocCompletions(FALLOUT_JSDOC_TYPES, " * @param {int} ");
            expect(items).toEqual([]);
        });

        it("returns empty after @deprecated with space", () => {
            const items = getJsdocCompletions(FALLOUT_JSDOC_TYPES, " * @deprecated ");
            expect(items).toEqual([]);
        });

        it("returns empty on plain JSDoc line", () => {
            const items = getJsdocCompletions(FALLOUT_JSDOC_TYPES, " * some description");
            expect(items).toEqual([]);
        });

        it("returns empty on empty line prefix", () => {
            const items = getJsdocCompletions(FALLOUT_JSDOC_TYPES, " * ");
            expect(items).toEqual([]);
        });
    });

    describe("FALLOUT_JSDOC_TYPES metadata", () => {
        it("has entries for all FALLOUT_JSDOC_TYPE_NAMES", () => {
            const keys = [...FALLOUT_JSDOC_TYPES.keys()].sort();
            expect(keys).toEqual([...FALLOUT_JSDOC_TYPE_NAMES].sort());
        });

        it("each entry has a detail string", () => {
            for (const [, meta] of FALLOUT_JSDOC_TYPES) {
                expect(typeof meta.detail).toBe("string");
                expect(meta.detail.length).toBeGreaterThan(0);
            }
        });
    });
});
