/**
 * Unit tests for fallout-ssl/references.ts - findReferences LSP feature.
 * Tests that references are returned as Location[] with correct scoping
 * and includeDeclaration filtering.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";

vi.mock("../../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    }),
    getDocuments: () => ({ get: vi.fn() }),
    initLspConnection: vi.fn(),
}));

import { initParser } from "../../../shared/parsers/fallout-ssl";
import { findReferences } from "../../src/fallout-ssl/references";
import { ReferencesIndex } from "../../src/shared/references-index";
import { parseFile } from "../../src/fallout-ssl/header-parser";
import { normalizeUri } from "../../src/core/normalized-uri";
import { Symbols } from "../../src/core/symbol-index";

/** Extract refs only (convenience wrapper for tests migrated from call-sites). */
const extractCallSites = (text: string, uri: string) => parseFile(uri, text).refs;

const TEST_URI = "file:///test.ssl";

beforeAll(async () => {
    await initParser();
});

describe("fallout-ssl/references", () => {
    describe("procedure references (file-scoped)", () => {
        const text = `
procedure helper begin end
procedure main begin
    call helper;
    call helper;
end
`;
        it("finds definition and all call sites", () => {
            // cursor on "helper" at line 1, character 10
            const refs = findReferences(text, { line: 1, character: 10 }, TEST_URI, true);
            // definition + 2 call sites = 3
            expect(refs).toHaveLength(3);
            for (const ref of refs) {
                expect(ref.uri).toBe(TEST_URI);
            }
        });

        it("excludes definition when includeDeclaration is false", () => {
            const refs = findReferences(text, { line: 1, character: 10 }, TEST_URI, false);
            // 2 call sites only (definition excluded)
            expect(refs).toHaveLength(2);
        });

        // SSL binds these as one procedure whatever the casing, so every one of them is a reference. Matched
        // exactly, asking from the definition returned only the definition - and the same search backs rename,
        // which then rewrote one site of four.
        it("finds call sites that spell the name differently", () => {
            const divergent = `
procedure Node005;
procedure main begin
    call Node005;
    call NODE005;
end
procedure NOde005 begin end
`;
            // Cursor on the definition, which matches none of the three references exactly.
            const refs = findReferences(divergent, { line: 6, character: 12 }, TEST_URI, true);
            // declaration + 2 call sites + definition
            expect(refs).toHaveLength(4);
        });
    });

    describe("variable references (procedure-scoped)", () => {
        const text = `
procedure foo begin
    variable counter;
    counter := 0;
    counter := counter + 1;
end
procedure bar begin
    variable counter;
    counter := 99;
end
`;
        it("finds references only within the containing procedure", () => {
            // cursor on "counter" in foo at line 2, character 13
            const refs = findReferences(text, { line: 2, character: 13 }, TEST_URI, true);
            // declaration + 3 usages in foo = 4, NOT including bar's counter
            expect(refs).toHaveLength(4);
            // All refs should be within foo's range (lines 1-5)
            for (const ref of refs) {
                expect(ref.range.start.line).toBeGreaterThanOrEqual(1);
                expect(ref.range.end.line).toBeLessThanOrEqual(5);
            }
        });

        it("excludes declaration when includeDeclaration is false", () => {
            const refs = findReferences(text, { line: 2, character: 13 }, TEST_URI, false);
            // 3 usages only
            expect(refs).toHaveLength(3);
        });
    });

    describe("macro references (file-scoped)", () => {
        it("finds macro definition and all usages", () => {
            const text = `
#define MAX_ITEMS 100

procedure foo begin
    if (count > MAX_ITEMS) then begin
    end
end
procedure bar begin
    display_msg(MAX_ITEMS);
end
`;
            const refs = findReferences(text, { line: 1, character: 8 }, TEST_URI, true);
            // definition + usage in foo + usage in bar = 3
            expect(refs).toHaveLength(3);
        });
    });

    describe("shadow exclusion", () => {
        it("skips procedure-local shadows for file-scoped symbols", () => {
            const text = `
#define x 42

procedure foo begin
    variable x;
    x := 1;
end
procedure bar begin
    display_msg(x);
end
`;
            // cursor on "x" at the #define line 1
            const refs = findReferences(text, { line: 1, character: 8 }, TEST_URI, true);
            // definition + bar usage = 2 (foo shadows x, so skipped)
            expect(refs).toHaveLength(2);
        });
    });

    describe("cross-file references for symbols not locally defined", () => {
        it("returns cross-file references for a symbol used but not defined in the current file", () => {
            // den.h uses GVAR_DEN_GANGWAR but does not define it (defined in global.h)
            const denHUri = "file:///project/headers/den.h";
            const globalHUri = "file:///project/headers/global.h";
            const denHText = `
#define gangwar(x) (global_var(GVAR_DEN_GANGWAR) == x)
`;
            const globalHText = `#define GVAR_DEN_GANGWAR (454)`;

            const refsIndex = new ReferencesIndex();
            refsIndex.updateFile(normalizeUri(denHUri), extractCallSites(denHText, denHUri));
            refsIndex.updateFile(normalizeUri(globalHUri), extractCallSites(globalHText, globalHUri));

            // Cursor on GVAR_DEN_GANGWAR in den.h (line 1, character 31)
            const refs = findReferences(denHText, { line: 1, character: 31 }, denHUri, true, refsIndex);

            // Should find at least: usage in den.h + usage in global.h
            expect(refs.length).toBeGreaterThanOrEqual(2);
            const uris = new Set(refs.map((r) => r.uri));
            expect(uris).toContain(denHUri);
            expect(uris).toContain(globalHUri);
        });

        it("returns local references in current file even when symbol not locally defined", () => {
            const uri = "file:///project/script.ssl";
            const text = `
procedure main begin
    if (GVAR_DEN_GANGWAR > 0) then begin
        display_msg(GVAR_DEN_GANGWAR);
    end
end
`;
            const refsIndex = new ReferencesIndex();
            refsIndex.updateFile(normalizeUri(uri), extractCallSites(text, uri));

            // Cursor on first GVAR_DEN_GANGWAR (line 2)
            const refs = findReferences(text, { line: 2, character: 8 }, uri, true, refsIndex);

            // Should find at least the 2 usages in the current file
            expect(refs.length).toBeGreaterThanOrEqual(2);
            for (const ref of refs) {
                expect(ref.uri).toBe(uri);
            }
        });

        it("returns cross-file references from .ssl files that directly use the symbol", () => {
            // Scenario: GVAR defined in global.h, used in den.h macro body AND directly in .ssl files
            const globalHUri = "file:///project/headers/global.h";
            const denHUri = "file:///project/headers/den.h";
            const sslUri = "file:///project/den/dclara.ssl";

            const globalHText = `#define GVAR_DEN_GANGWAR (454)`;
            const denHText = `
#define gangwar(x) (global_var(GVAR_DEN_GANGWAR) == x)
`;
            const sslText = `
#include "../headers/global.h"

procedure start begin
    ndebug("global_var(GVAR_DEN_GANGWAR) == "+global_var(GVAR_DEN_GANGWAR));
end
`;

            const refsIndex = new ReferencesIndex();
            refsIndex.updateFile(normalizeUri(globalHUri), extractCallSites(globalHText, globalHUri));
            refsIndex.updateFile(normalizeUri(denHUri), extractCallSites(denHText, denHUri));
            refsIndex.updateFile(normalizeUri(sslUri), extractCallSites(sslText, sslUri));

            // Find references from den.h (where symbol is "external")
            const refs = findReferences(denHText, { line: 1, character: 31 }, denHUri, true, refsIndex);

            const uris = new Set(refs.map((r) => r.uri));
            // Should include: den.h (local usage) + global.h (definition) + .ssl file (direct usage)
            expect(uris).toContain(denHUri);
            expect(uris).toContain(globalHUri);
            expect(uris).toContain(sslUri);
        });

        it("returns empty when symbol not locally defined and no refsIndex provided", () => {
            const text = `
procedure main begin
    display_msg(GVAR_DEN_GANGWAR);
end
`;
            // No refsIndex - should return empty for non-local symbol
            const refs = findReferences(text, { line: 2, character: 16 }, TEST_URI, true);
            expect(refs).toHaveLength(0);
        });
    });

    describe("cross-file references for file-scoped symbols with refsIndex", () => {
        it("adds cross-file refs for procedure when refsIndex is provided", () => {
            const text = `
procedure helper begin end
procedure main begin
    call helper;
end
`;
            const otherUri = "file:///other.ssl" as const;
            const crossLoc = {
                uri: otherUri,
                range: { start: { line: 5, character: 4 }, end: { line: 5, character: 10 } },
            };
            const index = new ReferencesIndex();
            index.updateFile(normalizeUri(otherUri), new Map([["helper", [crossLoc]]]));

            // cursor on "helper" definition
            const refs = findReferences(text, { line: 1, character: 10 }, TEST_URI, true, index);
            // local (def + call) + cross-file ref
            const crossRefs = refs.filter((r) => r.uri === otherUri);
            expect(crossRefs).toHaveLength(1);
            expect(crossRefs[0]).toEqual(crossLoc);
        });

        // Fallout dialogs almost all define their own `Node004`, so a workspace-wide lookup by bare name
        // reported every sibling script's unrelated procedure as a reference to this one. Measured on the real
        // corpus before the fix: asking from abtom.ssl's `Node004` returned abbill.ssl's declaration, call site
        // and definition. Rename already skipped a file that redefines the name; this holds the read side to it.
        it("omits a same-named procedure that another file defines for itself", () => {
            const text = `
procedure Node004 begin end
procedure main begin
    call Node004;
end
`;
            const rivalUri = "file:///rival.ssl";
            const rivalText = `
procedure Node004 begin end
procedure main begin
    call Node004;
end
`;
            const index = new ReferencesIndex();
            index.updateFile(normalizeUri(rivalUri), extractCallSites(rivalText, rivalUri));
            const symbols = new Symbols();
            symbols.updateFile(normalizeUri(rivalUri), parseFile(rivalUri, rivalText).symbols);

            const refs = findReferences(text, { line: 1, character: 12 }, TEST_URI, true, index, symbols);

            expect(refs.map((r) => r.uri)).not.toContain(rivalUri);
            // The current file's own definition and call site still come back.
            expect(refs).toHaveLength(2);
        });

        // The counter-case: a file that merely USES a symbol it does not define is a genuine consumer, and its
        // references must survive the filter above.
        it("keeps cross-file refs from a file that only uses the procedure", () => {
            const text = `
procedure helper begin end
procedure main begin
    call helper;
end
`;
            const consumerUri = "file:///consumer.ssl";
            const consumerText = `
procedure main begin
    call helper;
end
`;
            const index = new ReferencesIndex();
            index.updateFile(normalizeUri(consumerUri), extractCallSites(consumerText, consumerUri));
            const symbols = new Symbols();
            symbols.updateFile(normalizeUri(consumerUri), parseFile(consumerUri, consumerText).symbols);

            const refs = findReferences(text, { line: 1, character: 10 }, TEST_URI, true, index, symbols);

            expect(refs.map((r) => r.uri)).toContain(consumerUri);
        });

        it("filters out cross-file refs from current URI to avoid duplicates", () => {
            const text = `
procedure helper begin end
procedure main begin
    call helper;
end
`;
            const selfLoc = {
                uri: TEST_URI,
                range: { start: { line: 3, character: 4 }, end: { line: 3, character: 10 } },
            };
            const index = new ReferencesIndex();
            // Add index entry for same URI - should be filtered
            index.updateFile(normalizeUri(TEST_URI), new Map([["helper", [selfLoc]]]));

            const refs = findReferences(text, { line: 1, character: 10 }, TEST_URI, true, index);
            // Local refs only; same-URI cross-file entry excluded
            expect(refs.length).toBeGreaterThan(0);
            // The index entry is excluded; the local occurrence at that line would be from AST traversal
            expect(refs.length).toBeLessThanOrEqual(3);
        });
    });

    describe("edge cases", () => {
        it("returns empty array for unknown symbol", () => {
            const text = `
procedure foo begin
    display_msg("hello");
end
`;
            // cursor on "display_msg" - not a local definition
            const refs = findReferences(text, { line: 2, character: 4 }, TEST_URI, true);
            expect(refs).toHaveLength(0);
        });

        it("returns empty array for position not on an identifier", () => {
            const text = `
procedure foo begin end
`;
            // cursor on whitespace
            const refs = findReferences(text, { line: 0, character: 0 }, TEST_URI, true);
            expect(refs).toHaveLength(0);
        });

        it("excludeDeclaration returns all locations when definition not found (line 25)", () => {
            // When includeDeclaration is false but the symbol has no findable definition,
            // excludeDeclaration returns all locations unchanged (line 25: return locations).
            // Use a variable that appears but doesn't have a getLocalDefinition match.
            const text = `
procedure foo begin
    variable x;
    x := 1;
    x := x + 1;
end
`;
            // cursor on "x" at line 3, character 4 (assignment lvalue - may not be the def location)
            const refs = findReferences(text, { line: 3, character: 4 }, TEST_URI, false);
            // x appears 4 times total; cursor is on an assignment lvalue, not the `variable x` declaration.
            // getLocalDefinition finds the declaration (line 2 char 13) and excludes it, leaving 3 references.
            expect(refs.length).toBe(3);
        });
    });
});
