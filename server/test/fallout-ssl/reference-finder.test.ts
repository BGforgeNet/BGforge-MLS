/**
 * Unit tests for fallout-ssl/reference-finder.ts - scope-restricted reference finding.
 * Tests that references are collected only within the correct scope,
 * and that file-scoped symbols skip procedure-local shadows.
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

import { initParser, parseWithCache } from "../../src/fallout-ssl/parser";
import { findScopedReferences } from "../../src/fallout-ssl/reference-finder";
import type { SslSymbolScope } from "../../src/fallout-ssl/symbol-scope";

beforeAll(async () => {
    await initParser();
});

describe("fallout-ssl/reference-finder", () => {
    describe("procedure-scoped references", () => {
        it("finds references only within the containing procedure", () => {
            const text = `
procedure foo begin
    variable i;
    i := 0;
    i := i + 1;
end
procedure bar begin
    variable i;
    i := 10;
end
`;
            const tree = parseWithCache(text)!;
            const fooProcNode = tree!.rootNode.children.find((c) => c.type === "procedure")!;

            const symbolInfo: SslSymbolScope = {
                name: "i",
                scope: "procedure",
                procedureNode: fooProcNode,
            };

            const refs = findScopedReferences(tree!.rootNode, symbolInfo);
            // Should find refs only in foo: declaration + 3 usages = 4
            // Should NOT include the 2 refs from bar
            expect(refs.length).toBe(4);

            // All refs should be within foo's range
            for (const ref of refs) {
                expect(ref.startPosition.row).toBeGreaterThanOrEqual(fooProcNode.startPosition.row);
                expect(ref.endPosition.row).toBeLessThanOrEqual(fooProcNode.endPosition.row);
            }
        });

        it("finds parameter references only within the procedure", () => {
            const text = `
procedure process(variable value) begin
    display_msg(value);
    if (value > 0) then begin
        display_msg(value);
    end
end
procedure other(variable value) begin
    value := 1;
end
`;
            const tree = parseWithCache(text)!;
            const processProcNode = tree!.rootNode.children.find((c) => c.type === "procedure")!;

            const symbolInfo: SslSymbolScope = {
                name: "value",
                scope: "procedure",
                procedureNode: processProcNode,
            };

            const refs = findScopedReferences(tree!.rootNode, symbolInfo);
            // param definition + 3 usages in process = 4
            // Should NOT include refs from other
            expect(refs.length).toBe(4);
        });

        it("finds for variable references only within the procedure", () => {
            const text = `
procedure foo begin
    for (i := 0; i < 10; i++) begin
        display_msg(i);
    end
end
procedure bar begin
    for (i := 0; i < 5; i++) begin
    end
end
`;
            const tree = parseWithCache(text)!;
            const fooProcNode = tree!.rootNode.children.find((c) => c.type === "procedure")!;

            const symbolInfo: SslSymbolScope = {
                name: "i",
                scope: "procedure",
                procedureNode: fooProcNode,
            };

            const refs = findScopedReferences(tree!.rootNode, symbolInfo);
            // Must find at least the references in foo, and none from bar
            expect(refs.length).toBeGreaterThan(0);
            for (const ref of refs) {
                expect(ref.startPosition.row).toBeGreaterThanOrEqual(fooProcNode.startPosition.row);
                expect(ref.endPosition.row).toBeLessThanOrEqual(fooProcNode.endPosition.row);
            }
        });
    });

    describe("external-scoped references", () => {
        it("returns empty for external scope (symbol not defined in file)", () => {
            const text = `
procedure foo begin
    display_msg(SOME_EXTERNAL);
end
`;
            const tree = parseWithCache(text)!;

            const symbolInfo: SslSymbolScope = {
                name: "SOME_EXTERNAL",
                scope: "external",
            };

            const refs = findScopedReferences(tree!.rootNode, symbolInfo);
            expect(refs.length).toBe(0);
        });
    });

    describe("file-scoped references", () => {
        it("finds references across the entire file for procedure name", () => {
            const text = `
procedure helper begin end
procedure main begin
    call helper;
    call helper;
end
`;
            const tree = parseWithCache(text)!;

            const symbolInfo: SslSymbolScope = {
                name: "helper",
                scope: "file",
            };

            const refs = findScopedReferences(tree!.rootNode, symbolInfo);
            // definition + 2 call sites = 3
            expect(refs.length).toBe(3);
        });

        it("finds macro references across the entire file", () => {
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
            const tree = parseWithCache(text)!;

            const symbolInfo: SslSymbolScope = {
                name: "MAX_ITEMS",
                scope: "file",
            };

            const refs = findScopedReferences(tree!.rootNode, symbolInfo);
            // definition + usage in foo + usage in bar = 3
            expect(refs.length).toBe(3);
        });

        it("skips references inside procedures that shadow with a local variable", () => {
            const text = `
#define x 42

procedure foo begin
    variable x;
    x := 1;
    display_msg(x);
end
procedure bar begin
    display_msg(x);
end
`;
            const tree = parseWithCache(text)!;

            const symbolInfo: SslSymbolScope = {
                name: "x",
                scope: "file",
            };

            const refs = findScopedReferences(tree!.rootNode, symbolInfo);
            // definition in #define + usage in bar = 2
            // foo has local "x" so all refs in foo should be SKIPPED
            expect(refs.length).toBe(2);

            // Verify none of the refs are inside foo (lines 3-7)
            for (const ref of refs) {
                const isInFoo = ref.startPosition.row >= 3 && ref.startPosition.row <= 7;
                expect(isInFoo).toBe(false);
            }
        });

        it("does not skip procedures that do NOT shadow the symbol", () => {
            const text = `
#define MAX 100

procedure foo begin
    variable other_var;
    display_msg(MAX);
end
procedure bar begin
    display_msg(MAX);
end
`;
            const tree = parseWithCache(text)!;

            const symbolInfo: SslSymbolScope = {
                name: "MAX",
                scope: "file",
            };

            const refs = findScopedReferences(tree!.rootNode, symbolInfo);
            // definition + foo usage + bar usage = 3
            expect(refs.length).toBe(3);
        });

        it("handles mixed: some procedures shadow, some don't", () => {
            const text = `
#define val 10

procedure shadower begin
    variable val;
    val := 1;
end
procedure user begin
    display_msg(val);
end
procedure another_shadower begin
    variable val;
    val := 2;
end
`;
            const tree = parseWithCache(text)!;

            const symbolInfo: SslSymbolScope = {
                name: "val",
                scope: "file",
            };

            const refs = findScopedReferences(tree!.rootNode, symbolInfo);
            // definition + usage in "user" = 2
            // shadower and another_shadower both shadow, so their refs are excluded
            expect(refs.length).toBe(2);
        });
    });
});
