/**
 * Integration tests for WeiDU D language features using real fixture files.
 *
 * Tests: document symbols, definition, references, rename, folding ranges.
 * Uses files from external/infinity-engine/ repos (BGT-WeiDU, rr, Ascension).
 */

import { join } from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { initParser, isInitialized, parseWithCache } from "../../src/weidu-d/parser";
import { getDocumentSymbols } from "../../src/weidu-d/symbol";
import { getDefinition } from "../../src/weidu-d/definition";
import { findReferences } from "../../src/weidu-d/references";
import { renameSymbol, prepareRenameSymbol } from "../../src/weidu-d/rename";
import { getStateLabelHover } from "../../src/weidu-d/hover";
import { formatDocument } from "../../src/weidu-d/format/core";
import { createFoldingRangesProvider } from "../../src/shared/folding-ranges";
import { SyntaxType } from "../../src/weidu-d/tree-sitter.d";
import { FileIndex } from "../../src/core/file-index";
import { parseFile } from "../../src/weidu-d/file-parser";
import { loadFixture, findIdentifierPosition, IE_FIXTURES } from "./test-helpers";

const BGT_BASE = join(IE_FIXTURES, "BGT-WeiDU");

beforeAll(async () => {
    await initParser();
});

describe("weidu-d integration", () => {
    // =========================================================================
    // Document Symbols
    // =========================================================================

    describe("document symbols", () => {
        it("extracts state labels from a dialog file", () => {
            const f = loadFixture(BGT_BASE, "bgt/base/d_bg1/durlyle1.d");
            const symbols = getDocumentSymbols(f.text);

            expect(symbols).toHaveLength(66);

            // State labels are numeric in this file (0..65)
            const names = symbols.map((s) => s.name);
            expect(names).toContain("0");
            expect(names).toContain("1");
            expect(names).toContain("65");
        });

        it("extracts named state labels from Ascension balth.d", () => {
            const f = loadFixture(IE_FIXTURES, "Ascension/ascension/balthazar/d/balth.d");
            const symbols = getDocumentSymbols(f.text);

            // balth.d has named states: 24, a31..a100
            expect(symbols).toHaveLength(66);
            const names = symbols.map((s) => s.name);
            expect(names).toContain("a31");
            expect(names).toContain("a32");
        });
    });

    // =========================================================================
    // Go to Definition
    // =========================================================================

    describe("go to definition", () => {
        it("navigates from GOTO reference to state definition", () => {
            const f = loadFixture(BGT_BASE, "bgt/base/d_bg1/durlyle1.d");

            // "GOTO 1" in state 0 — cursor on "1"
            // The first GOTO target in the file
            const pos = findIdentifierPosition(f.text, "GOTO 1");
            expect(pos).not.toBeNull();
            // Move cursor to the "1" after GOTO
            const targetPos = { line: pos!.line, character: pos!.character + 5 };

            const location = getDefinition(f.text, f.uri, targetPos);
            expect(location).not.toBeNull();
            expect(location!.uri).toBe(f.uri);
            expect(location!.range.start.line).toBe(11);
        });

        it("navigates from GOTO to a named state label", () => {
            const f = loadFixture(IE_FIXTURES, "Ascension/ascension/balthazar/d/balth.d");

            // Find "GOTO a39" — this label is used in transitions and defined later
            const pos = findIdentifierPosition(f.text, "a39", 1);
            expect(pos).not.toBeNull();

            const location = getDefinition(f.text, f.uri, pos!);
            expect(location).not.toBeNull();
            expect(location!.uri).toBe(f.uri);
            expect(location!.range.start.line).toBe(113);
        });
    });

    // =========================================================================
    // Find References
    // =========================================================================

    describe("find references", () => {
        it("finds all references to a state label", () => {
            const f = loadFixture(BGT_BASE, "bgt/base/d_bg1/durlyle1.d");

            // State "3" is referenced multiple times (GOTO 3 in various states)
            // Find the definition of state 3
            const pos = findIdentifierPosition(f.text, "BEGIN 3");
            expect(pos).not.toBeNull();
            // Move cursor to "3"
            const targetPos = { line: pos!.line, character: pos!.character + 6 };

            const refs = findReferences(f.text, targetPos, f.uri, true);
            expect(refs).toHaveLength(10);
            for (const ref of refs) {
                expect(ref.uri).toBe(f.uri);
            }
        });

        it("excludes declaration when includeDeclaration is false", () => {
            const f = loadFixture(BGT_BASE, "bgt/base/d_bg1/durlyle1.d");

            const pos = findIdentifierPosition(f.text, "BEGIN 3");
            expect(pos).not.toBeNull();
            const targetPos = { line: pos!.line, character: pos!.character + 6 };

            const refsInclude = findReferences(f.text, targetPos, f.uri, true);
            const refsExclude = findReferences(f.text, targetPos, f.uri, false);

            expect(refsInclude).toHaveLength(10);
            expect(refsExclude).toHaveLength(9);
        });
    });

    // =========================================================================
    // Rename
    // =========================================================================

    describe("rename", () => {
        it("renames a named state label and all its references", () => {
            const f = loadFixture(IE_FIXTURES, "Ascension/ascension/balthazar/d/balth.d");

            // Find state "a39" at its definition (BEGIN a39) — 5th occurrence
            // a39 has 4 GOTO refs + 1 definition, all within APPEND BALTH
            const pos = findIdentifierPosition(f.text, "a39", 5);
            expect(pos).not.toBeNull();

            const result = renameSymbol(f.text, pos!, "round2_entry", f.uri);
            expect(result).not.toBeNull();

            const edits = result!.changes?.[f.uri];
            expect(edits).toBeDefined();
            // definition + 4 GOTO references = 5
            expect(edits!.length).toBe(5);
            for (const edit of edits!) {
                expect(edit.newText).toBe("round2_entry");
            }
        });

        it("prepareRename returns range and placeholder", () => {
            const f = loadFixture(IE_FIXTURES, "Ascension/ascension/balthazar/d/balth.d");

            // Use the definition occurrence (BEGIN a31)
            const pos = findIdentifierPosition(f.text, "a31", 2);
            expect(pos).not.toBeNull();

            const prep = prepareRenameSymbol(f.text, pos!);
            expect(prep).not.toBeNull();
            expect(prep!.placeholder).toBe("a31");
        });
    });

    // =========================================================================
    // Workspace Symbols
    // =========================================================================

    describe("workspace symbols", () => {
        it("indexes D state labels for workspace search", () => {
            const f = loadFixture(IE_FIXTURES, "Ascension/ascension/balthazar/d/balth.d");

            const fileIndex = new FileIndex();
            fileIndex.updateFile(f.uri, parseFile(f.uri, f.text, IE_FIXTURES));

            const results = fileIndex.symbols.searchWorkspaceSymbols("a39");
            expect(results.length).toBeGreaterThan(0);
            expect(results.some((result) => result.name === "balth:a39")).toBe(true);
        });

        it("includes D symbols from multiple files", () => {
            const first = loadFixture(BGT_BASE, "bgt/base/d_bg1/durlyle1.d");
            const second = loadFixture(IE_FIXTURES, "Ascension/ascension/balthazar/d/balth.d");

            const fileIndex = new FileIndex();
            fileIndex.updateFile(first.uri, parseFile(first.uri, first.text, IE_FIXTURES));
            fileIndex.updateFile(second.uri, parseFile(second.uri, second.text, IE_FIXTURES));

            const results = fileIndex.symbols.searchWorkspaceSymbols("");
            expect(results.length).toBeGreaterThan(100);
        });

        it("keeps duplicate numeric labels distinguishable by dialog", () => {
            const text = `
BEGIN ~A~
IF ~~ THEN BEGIN 0
  SAY ~A~
END

BEGIN ~B~
IF ~~ THEN BEGIN 0
  SAY ~B~
END
`;
            const uri = "file:///test/multi-dialog.d";

            const fileIndex = new FileIndex();
            fileIndex.updateFile(uri, parseFile(uri, text, "/test"));

            const results = fileIndex.symbols.searchWorkspaceSymbols("0");
            expect(results).toHaveLength(2);
            expect(results.map((result) => result.name)).toEqual(["a:0", "b:0"]);
        });
    });

    // =========================================================================
    // Folding Ranges
    // =========================================================================

    describe("folding ranges", () => {
        const D_FOLDABLE_TYPES = new Set([
            SyntaxType.BeginAction,
            SyntaxType.AppendAction,
            SyntaxType.ChainAction,
            SyntaxType.ExtendAction,
            SyntaxType.InterjectAction,
            SyntaxType.InterjectCopyTrans,
            SyntaxType.ReplaceAction,
            SyntaxType.State,
            SyntaxType.Transition,
        ]);
        const getFoldingRanges = createFoldingRangesProvider(isInitialized, parseWithCache, D_FOLDABLE_TYPES);

        it("produces folding ranges for dialog states", () => {
            const f = loadFixture(BGT_BASE, "bgt/base/d_bg1/durlyle1.d");

            const ranges = getFoldingRanges(f.text);
            expect(ranges).toHaveLength(88);
        });

        it("produces folding ranges for APPEND blocks", () => {
            const f = loadFixture(IE_FIXTURES, "Ascension/ascension/balthazar/d/balth.d");

            const ranges = getFoldingRanges(f.text);
            expect(ranges).toHaveLength(100);
        });
    });

    // =========================================================================
    // Formatting
    // =========================================================================

    describe("formatting", () => {
        it("formats a D dialog file without errors", () => {
            const f = loadFixture(BGT_BASE, "bgt/base/d_bg1/durlyle1.d");

            const tree = parseWithCache(f.text);
            expect(tree).not.toBeNull();

            const result = formatDocument(tree!.rootNode);
            expect(result.text).toBeTruthy();
            expect(result.text).toContain("BEGIN");
        });

        it("produces idempotent output", () => {
            const f = loadFixture(BGT_BASE, "bgt/base/d_bg1/durlyle1.d");

            const tree1 = parseWithCache(f.text);
            const result1 = formatDocument(tree1!.rootNode);

            const tree2 = parseWithCache(result1.text);
            const result2 = formatDocument(tree2!.rootNode);

            expect(result2.text).toBe(result1.text);
        });

        it("formats a file with APPEND blocks", () => {
            const f = loadFixture(IE_FIXTURES, "Ascension/ascension/balthazar/d/balth.d");

            const tree = parseWithCache(f.text);
            expect(tree).not.toBeNull();

            const result = formatDocument(tree!.rootNode);
            expect(result.text).toBeTruthy();
        });
    });

    // =========================================================================
    // Hover (JSDoc on state labels)
    // =========================================================================

    describe("hover", () => {
        it("returns notHandled for state labels without JSDoc", () => {
            const f = loadFixture(BGT_BASE, "bgt/base/d_bg1/durlyle1.d");

            // State "0" in durlyle1.d has no JSDoc comment
            const pos = findIdentifierPosition(f.text, "BEGIN 0");
            expect(pos).not.toBeNull();
            const targetPos = { line: pos!.line, character: pos!.character + 6 };

            const result = getStateLabelHover(f.text, "0", f.uri, targetPos);
            expect(result.handled).toBe(false);
        });

        it("returns notHandled for positions outside state labels", () => {
            const f = loadFixture(BGT_BASE, "bgt/base/d_bg1/durlyle1.d");

            // Position on a SAY keyword, not a state label
            const result = getStateLabelHover(f.text, "SAY", f.uri, { line: 0, character: 0 });
            expect(result.handled).toBe(false);
        });
    });
});
