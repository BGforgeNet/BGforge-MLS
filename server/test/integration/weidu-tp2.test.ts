/**
 * Integration tests for WeiDU TP2 language features using real fixture files.
 *
 * Tests: document symbols, definition, references, rename, folding ranges,
 * workspace symbols (via FileIndex). Uses files from external/infinity-engine/ repos.
 */

import { join } from "node:path";
import { FoldingRangeKind } from "vscode-languageserver/node";
import { describe, expect, it, beforeAll } from "vitest";
import { initParser, isInitialized, parseWithCache } from "../../src/weidu-tp2/parser";
import { getDocumentSymbols } from "../../src/weidu-tp2/symbol";
import { getDefinition } from "../../src/weidu-tp2/definition";
import { findReferences } from "../../src/weidu-tp2/references";
import { renameSymbol, prepareRenameSymbol } from "../../src/weidu-tp2/rename";
import { parseFile } from "../../src/weidu-tp2/header-parser";
import { getFunctionParamHover } from "../../src/weidu-tp2/hover";
import { getLocalSymbols } from "../../src/weidu-tp2/local-symbols";
import { formatDocument } from "../../src/weidu-tp2/format/core";
import { createFoldingRangesProvider } from "../../src/shared/folding-ranges";
import { SyntaxType } from "../../src/weidu-tp2/tree-sitter.d";
import { FileIndex } from "../../src/core/file-index";
import { loadFixture, loadFixtures, findIdentifierPosition, IE_FIXTURES } from "./test-helpers";
import { normalizeUri } from "../../src/core/normalized-uri";

const TNT_BASE = join(IE_FIXTURES, "bg2-tweaks-and-tricks");
const RR_BASE = join(IE_FIXTURES, "rr");

beforeAll(async () => {
    await initParser();
});

describe("weidu-tp2 integration", () => {
    // =========================================================================
    // Document Symbols
    // =========================================================================

    describe("document symbols", () => {
        it("extracts function definitions from functions.tph", () => {
            const f = loadFixture(TNT_BASE, "tnt/lib/functions.tph");
            const symbols = getDocumentSymbols(f.text);

            expect(symbols).toHaveLength(5);
            expect(symbols.map((s) => s.name)).toEqual([
                "LIST_WEB_SPELLS",
                "unstack_armor_bonus",
                "CREATE_SHELL_SPELL",
                "CREATE_SHELL_BLINDNESS",
                "CREATE_SHELL_CONFUSION",
            ]);
        });

        it("extracts function body variables as children", () => {
            const f = loadFixture(TNT_BASE, "tnt/lib/functions.tph");
            const symbols = getDocumentSymbols(f.text);

            const listWebSpells = symbols.find((s) => s.name === "LIST_WEB_SPELLS");
            expect(listWebSpells).toBeDefined();
            expect(listWebSpells!.children?.map((c) => c.name)).toEqual(["spells"]);
        });

        it("extracts components from a tp2 file", () => {
            const f = loadFixture(RR_BASE, "rr/setup-rr.tp2");
            const symbols = getDocumentSymbols(f.text);

            expect(symbols).toHaveLength(28);
        });

        it("extracts function children (parameters and body variables)", () => {
            const f = loadFixture(TNT_BASE, "tnt/lib/functions.tph");
            const symbols = getDocumentSymbols(f.text);

            const unstack = symbols.find((s) => s.name === "unstack_armor_bonus");
            expect(unstack).toBeDefined();
            expect(unstack!.children?.map((c) => c.name)).toEqual([
                "bonus",
                "stacking_id_base",
                "found",
                "int",
                "fx_off",
                "opcode",
                "type",
                "ac_mod",
                "i",
            ]);
        });
    });

    // =========================================================================
    // Go to Definition
    // =========================================================================

    describe("go to definition", () => {
        it("navigates to a variable definition within a function", () => {
            const f = loadFixture(TNT_BASE, "tnt/lib/functions.tph");

            const pos = findIdentifierPosition(f.text, "found", 2);
            expect(pos).not.toBeNull();

            const location = getDefinition(f.text, f.uri, pos!);
            expect(location).not.toBeNull();
            expect(location!.uri).toBe(f.uri);
            expect(location!.range.start.line).toBe(36);
        });

        it("navigates to a function definition from LAF call", () => {
            const f = loadFixture(TNT_BASE, "tnt/lib/functions.tph");

            // LAF CREATE_SHELL_BLINDNESS on line 90 — cursor on the function name in the call
            const pos = findIdentifierPosition(f.text, "CREATE_SHELL_BLINDNESS", 1);
            expect(pos).not.toBeNull();

            const location = getDefinition(f.text, f.uri, pos!);
            expect(location).not.toBeNull();
            expect(location!.uri).toBe(f.uri);
            // Should point to the DEFINE_ACTION_FUNCTION definition (line 112, 0-indexed: 111)
            expect(location!.range.start.line).toBe(111);
        });
    });

    // =========================================================================
    // Find References
    // =========================================================================

    describe("find references", () => {
        it("finds all references to a variable within a function", () => {
            const f = loadFixture(TNT_BASE, "tnt/lib/functions.tph");

            // "found" variable in unstack_armor_bonus: definition + assignment + check
            const pos = findIdentifierPosition(f.text, "found", 1);
            expect(pos).not.toBeNull();

            const refs = findReferences(f.text, pos!, f.uri, true);
            expect(refs).toHaveLength(3);
            for (const ref of refs) {
                expect(ref.uri).toBe(f.uri);
            }
        });

        it("excludes declaration when includeDeclaration is false", () => {
            const f = loadFixture(TNT_BASE, "tnt/lib/functions.tph");

            const pos = findIdentifierPosition(f.text, "found", 1);
            expect(pos).not.toBeNull();

            const refsInclude = findReferences(f.text, pos!, f.uri, true);
            const refsExclude = findReferences(f.text, pos!, f.uri, false);

            expect(refsInclude).toHaveLength(3);
            expect(refsExclude).toHaveLength(1);
        });

        it("finds references to a function name", () => {
            const f = loadFixture(TNT_BASE, "tnt/lib/functions.tph");

            // CREATE_SHELL_BLINDNESS: definition + LAF call
            const pos = findIdentifierPosition(f.text, "CREATE_SHELL_BLINDNESS", 1);
            expect(pos).not.toBeNull();

            const refs = findReferences(f.text, pos!, f.uri, true);
            expect(refs).toHaveLength(2);
        });
    });

    // =========================================================================
    // Rename
    // =========================================================================

    describe("rename", () => {
        it("renames a variable and all its usages within a function", () => {
            const f = loadFixture(TNT_BASE, "tnt/lib/functions.tph");

            // Rename "found" variable in unstack_armor_bonus
            const pos = findIdentifierPosition(f.text, "found", 1);
            expect(pos).not.toBeNull();

            const result = renameSymbol(f.text, pos!, "has_ac_effect", f.uri);
            expect(result).not.toBeNull();

            const edits = result!.changes?.[f.uri];
            expect(edits).toBeDefined();
            expect(edits!).toHaveLength(3);
            for (const edit of edits!) {
                expect(edit.newText).toBe("has_ac_effect");
            }
        });

        it("prepareRename returns range and placeholder for a function name", () => {
            const f = loadFixture(TNT_BASE, "tnt/lib/functions.tph");

            const pos = findIdentifierPosition(f.text, "LIST_WEB_SPELLS", 1);
            expect(pos).not.toBeNull();

            const prep = prepareRenameSymbol(f.text, pos!);
            expect(prep).not.toBeNull();
            expect(prep!.placeholder).toBe("LIST_WEB_SPELLS");
        });

        it("renames a function and all its call sites", () => {
            const f = loadFixture(TNT_BASE, "tnt/lib/functions.tph");

            // Rename CREATE_SHELL_BLINDNESS — defined and called
            const pos = findIdentifierPosition(f.text, "CREATE_SHELL_BLINDNESS", 1);
            expect(pos).not.toBeNull();

            const result = renameSymbol(f.text, pos!, "CREATE_SHELL_BLIND", f.uri);
            expect(result).not.toBeNull();

            const edits = result!.changes?.[f.uri];
            expect(edits).toBeDefined();
            expect(edits!).toHaveLength(2);
        });
    });

    // =========================================================================
    // Workspace Symbols (via FileIndex)
    // =========================================================================

    describe("workspace symbols", () => {
        it("searches for function definitions across indexed files", () => {
            const files = loadFixtures(TNT_BASE, ["tnt/lib/functions.tph"]);

            const fileIndex = new FileIndex();
            for (const { uri, text } of files.values()) {
                const result = parseFile(uri, text);
                fileIndex.updateFile(normalizeUri(uri), result);
            }

            const results = fileIndex.symbols.searchWorkspaceSymbols("unstack");
            expect(results).toHaveLength(1);
            expect(results[0].name).toBe("unstack_armor_bonus");
        });

        it("searches across multiple files", () => {
            const files = loadFixtures(TNT_BASE, ["tnt/lib/functions.tph"]);
            const rrFiles = loadFixtures(RR_BASE, ["rr/lib/rr#afix.tph"]);
            const allFiles = new Map([...files, ...rrFiles]);

            const fileIndex = new FileIndex();
            for (const { uri, text } of allFiles.values()) {
                const result = parseFile(uri, text);
                fileIndex.updateFile(normalizeUri(uri), result);
            }

            const results = fileIndex.symbols.searchWorkspaceSymbols("");
            expect(results).toHaveLength(6);
        });
    });

    // =========================================================================
    // Folding Ranges
    // =========================================================================

    describe("folding ranges", () => {
        const TP2_FOLDABLE_TYPES = new Set([
            SyntaxType.ActionDefineFunction,
            SyntaxType.ActionDefineMacro,
            SyntaxType.ActionDefinePatchFunction,
            SyntaxType.ActionDefinePatchMacro,
            SyntaxType.ActionIf,
            SyntaxType.ActionTry,
            SyntaxType.PatchBlock,
            SyntaxType.PatchFor,
            SyntaxType.PatchForEach,
            SyntaxType.PatchIf,
            SyntaxType.PatchWhile,
            SyntaxType.Component,
            SyntaxType.AlwaysBlock,
            SyntaxType.ActionCopy,
            SyntaxType.InnerAction,
            SyntaxType.InnerPatch,
            SyntaxType.InnerPatchFile,
            SyntaxType.InnerPatchSave,
        ]);
        const getFoldingRanges = createFoldingRangesProvider(isInitialized, parseWithCache, TP2_FOLDABLE_TYPES);

        it("produces folding ranges for function definitions", () => {
            const f = loadFixture(TNT_BASE, "tnt/lib/functions.tph");

            const ranges = getFoldingRanges(f.text);
            expect(ranges).toHaveLength(12);
        });

        it("produces folding ranges for components in a tp2 file", () => {
            const f = loadFixture(RR_BASE, "rr/setup-rr.tp2");

            const ranges = getFoldingRanges(f.text);
            expect(ranges).toHaveLength(327);
        });

        it("includes comment folding for JSDoc blocks", () => {
            const f = loadFixture(TNT_BASE, "tnt/lib/functions.tph");

            const ranges = getFoldingRanges(f.text);
            const commentRanges = ranges.filter((r) => r.kind === FoldingRangeKind.Comment);
            expect(commentRanges).toHaveLength(2);
        });
    });

    // =========================================================================
    // Formatting
    // =========================================================================

    describe("formatting", () => {
        it("formats a TP2 header file without errors", () => {
            const f = loadFixture(TNT_BASE, "tnt/lib/functions.tph");

            const tree = parseWithCache(f.text);
            expect(tree).not.toBeNull();

            const result = formatDocument(tree!.rootNode);
            expect(result.text).toBeTruthy();
            expect(result.text).toContain("DEFINE_ACTION_FUNCTION");
        });

        it("produces idempotent output", () => {
            const f = loadFixture(TNT_BASE, "tnt/lib/functions.tph");

            const tree1 = parseWithCache(f.text);
            const result1 = formatDocument(tree1!.rootNode);

            const tree2 = parseWithCache(result1.text);
            const result2 = formatDocument(tree2!.rootNode);

            expect(result2.text).toBe(result1.text);
        });

        it("formats a tp2 installer file", () => {
            const f = loadFixture(RR_BASE, "rr/setup-rr.tp2");

            const tree = parseWithCache(f.text);
            expect(tree).not.toBeNull();

            const result = formatDocument(tree!.rootNode);
            expect(result.text).toBeTruthy();
        });
    });

    // =========================================================================
    // Hover (JSDoc on function parameters)
    // =========================================================================

    describe("hover", () => {
        it("returns hover for a function parameter in a LAF call", () => {
            const f = loadFixture(TNT_BASE, "tnt/lib/functions.tph");

            // LAF CREATE_SHELL_BLINDNESS INT_VAR duration savingthrow
            // "duration" at line 92 (0-indexed: 91) is a param name in a LAF call
            const pos = findIdentifierPosition(f.text, "duration", 2);
            expect(pos).not.toBeNull();

            const hover = getFunctionParamHover(f.text, "duration", pos!);
            expect(hover).not.toBeNull();
            const value = (hover!.contents as { value: string }).value;
            expect(value).toContain("int duration = 0");
        });

        it("returns null for a non-parameter symbol", () => {
            const f = loadFixture(TNT_BASE, "tnt/lib/functions.tph");

            // "spells" is a variable, not a function parameter
            const pos = findIdentifierPosition(f.text, "spells", 1);
            expect(pos).not.toBeNull();

            const hover = getFunctionParamHover(f.text, "spells", pos!);
            expect(hover).toBeNull();
        });
    });

    // =========================================================================
    // Local Symbols
    // =========================================================================

    describe("local symbols", () => {
        it("extracts function definitions as local symbols", () => {
            const f = loadFixture(TNT_BASE, "tnt/lib/functions.tph");

            const symbols = getLocalSymbols(f.text, f.uri);
            expect(symbols).toHaveLength(5);
            expect(symbols.map((s) => s.name)).toEqual([
                "LIST_WEB_SPELLS",
                "unstack_armor_bonus",
                "CREATE_SHELL_SPELL",
                "CREATE_SHELL_BLINDNESS",
                "CREATE_SHELL_CONFUSION",
            ]);
        });

        it("includes hover content in local symbols", () => {
            const f = loadFixture(TNT_BASE, "tnt/lib/functions.tph");

            const symbols = getLocalSymbols(f.text, f.uri);
            const unstack = symbols.find((s) => s.name === "unstack_armor_bonus");
            expect(unstack).toBeDefined();

            // Local symbols should have pre-computed hover
            expect(unstack!.hover).toBeDefined();
            expect(unstack!.hover.contents).toBeDefined();
        });

        it("includes completion items in local symbols", () => {
            const f = loadFixture(TNT_BASE, "tnt/lib/functions.tph");

            const symbols = getLocalSymbols(f.text, f.uri);
            const listWeb = symbols.find((s) => s.name === "LIST_WEB_SPELLS");
            expect(listWeb).toBeDefined();

            // Local symbols should have pre-computed completion
            expect(listWeb!.completion).toBeDefined();
            expect(listWeb!.completion.label).toBe("LIST_WEB_SPELLS");
        });
    });
});
