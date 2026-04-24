/**
 * Unit tests for fallout-ssl/utils.ts - utility functions for local symbol extraction.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import { Position } from "vscode-languageserver/node";

// Mock the server module to avoid LSP connection issues
vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import {
    makeRange,
    findPrecedingDocComment,
    extractProcedures,
    findProcedure,
    findIdentifierAtPosition,
    findDefinitionNode,
    isLocalDefinition,
    extractMacros,
    extractParams,
} from "../../src/fallout-ssl/utils";
import { initParser, parseWithCache } from "../../src/fallout-ssl/parser";

beforeAll(async () => {
    await initParser();
});

describe("fallout-ssl/utils", () => {
    describe("makeRange()", () => {
        it("creates a range from tree-sitter node positions", () => {
            const text = "procedure foo begin end";
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            const nameNode = tree!.rootNode.childForFieldName("name");
            if (nameNode) {
                const range = makeRange(nameNode);
                expect(range.start.line).toBe(0);
                expect(range.start.character).toBeGreaterThanOrEqual(0);
                expect(range.end.line).toBe(0);
                expect(range.end.character).toBeGreaterThan(range.start.character);
            }
        });
    });

    describe("extractProcedures()", () => {
        it("extracts a single procedure", () => {
            const text = "procedure foo begin end";
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            const procedures = extractProcedures(tree!.rootNode);
            expect(procedures.size).toBe(1);
            expect(procedures.has("foo")).toBe(true);
            expect(procedures.get("foo")?.isForward).toBe(false);
        });

        it("extracts multiple procedures", () => {
            const text = `
procedure foo begin end
procedure bar begin end
procedure baz begin end
`;
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            const procedures = extractProcedures(tree!.rootNode);
            expect(procedures.size).toBe(3);
            expect(procedures.has("foo")).toBe(true);
            expect(procedures.has("bar")).toBe(true);
            expect(procedures.has("baz")).toBe(true);
        });

        it("extracts forward declarations", () => {
            const text = "procedure foo;";
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            const procedures = extractProcedures(tree!.rootNode);
            expect(procedures.size).toBe(1);
            expect(procedures.has("foo")).toBe(true);
            expect(procedures.get("foo")?.isForward).toBe(true);
        });

        it("prefers definition over forward declaration", () => {
            const text = `
procedure foo;
procedure foo begin end
`;
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            const procedures = extractProcedures(tree!.rootNode);
            expect(procedures.size).toBe(1);
            expect(procedures.has("foo")).toBe(true);
            expect(procedures.get("foo")?.isForward).toBe(false);
        });

        it("returns empty map for empty file", () => {
            const text = "";
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            const procedures = extractProcedures(tree!.rootNode);
            expect(procedures.size).toBe(0);
        });
    });

    describe("findProcedure()", () => {
        it("finds a procedure by name", () => {
            const text = `
procedure foo begin end
procedure bar begin end
`;
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            const proc = findProcedure(tree!.rootNode, "bar");
            expect(proc).not.toBeNull();
            expect(proc?.type).toBe("procedure");
        });

        it("returns null for non-existent procedure", () => {
            const text = "procedure foo begin end";
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            const proc = findProcedure(tree!.rootNode, "nonexistent");
            expect(proc).toBeNull();
        });

        it("finds forward declaration when no definition exists", () => {
            const text = "procedure foo;";
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            const proc = findProcedure(tree!.rootNode, "foo");
            expect(proc).not.toBeNull();
            expect(proc?.type).toBe("procedure_forward");
        });
    });

    describe("findIdentifierAtPosition()", () => {
        it("finds identifier at cursor position", () => {
            const text = "procedure foo begin end";
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            // Position on "foo"
            const position: Position = { line: 0, character: 10 };
            const symbol = findIdentifierAtPosition(tree!.rootNode, position);
            expect(symbol).toBe("foo");
        });

        it("returns null for position outside identifiers", () => {
            const text = "procedure foo begin end";
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            // Position on whitespace
            const position: Position = { line: 0, character: 9 };
            const symbol = findIdentifierAtPosition(tree!.rootNode, position);
            expect(symbol).toBeNull();
        });

        it("returns null for position beyond text", () => {
            const text = "procedure foo begin end";
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            const position: Position = { line: 10, character: 0 };
            const symbol = findIdentifierAtPosition(tree!.rootNode, position);
            expect(symbol).toBeNull();
        });
    });

    describe("findDefinitionNode()", () => {
        it("finds procedure definition", () => {
            const text = "procedure foo begin end";
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            const def = findDefinitionNode(tree!.rootNode, "foo");
            expect(def).not.toBeNull();
            expect(def?.type).toBe("procedure");
        });

        it("finds variable declaration in procedure", () => {
            const text = `
procedure foo begin
    variable x;
end
`;
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            const def = findDefinitionNode(tree!.rootNode, "x");
            expect(def).not.toBeNull();
        });

        it("returns null for undefined symbol", () => {
            const text = "procedure foo begin end";
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            const def = findDefinitionNode(tree!.rootNode, "nonexistent");
            expect(def).toBeNull();
        });

        it("finds foreach loop variable", () => {
            const text = `
procedure foo begin
    foreach (item in mylist) begin end
end
`;
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            const def = findDefinitionNode(tree!.rootNode, "item");
            expect(def).not.toBeNull();
        });

        it("finds export variable declaration", () => {
            const text = `export variable my_export := 0;`;
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            const def = findDefinitionNode(tree!.rootNode, "my_export");
            expect(def).not.toBeNull();
        });
    });

    describe("isLocalDefinition()", () => {
        it("returns true for locally defined procedure", () => {
            const text = "procedure foo begin end";
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            const isLocal = isLocalDefinition(tree!.rootNode, "foo");
            expect(isLocal).toBe(true);
        });

        it("returns false for undefined symbol", () => {
            const text = "procedure foo begin end";
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            const isLocal = isLocalDefinition(tree!.rootNode, "bar");
            expect(isLocal).toBe(false);
        });
    });

    describe("extractMacros()", () => {
        it("extracts constant macro with name and body", () => {
            const text = "#define MY_CONST 123";
            const tree = parseWithCache(text);
            const macros = extractMacros(tree!.rootNode);

            expect(macros).toHaveLength(1);
            expect(macros[0]!.name).toBe("MY_CONST");
            expect(macros[0]!.body).toBe("123");
            expect(macros[0]!.hasParams).toBe(false);
            expect(macros[0]!.params).toBeUndefined();
            expect(macros[0]!.multiline).toBe(false);
        });

        it("extracts function-like macro with params", () => {
            const text = "#define ADD(a, b) ((a) + (b))";
            const tree = parseWithCache(text);
            const macros = extractMacros(tree!.rootNode);

            expect(macros).toHaveLength(1);
            expect(macros[0]!.name).toBe("ADD");
            expect(macros[0]!.hasParams).toBe(true);
            expect(macros[0]!.params).toEqual(["a", "b"]);
            expect(macros[0]!.body).toContain("a");
        });

        it("extracts multiple macros", () => {
            const text = `
#define FOO 1
#define BAR 2
#define BAZ 3
`;
            const tree = parseWithCache(text);
            const macros = extractMacros(tree!.rootNode);

            expect(macros).toHaveLength(3);
            expect(macros.map((m) => m.name)).toEqual(["FOO", "BAR", "BAZ"]);
        });

        it("returns empty array when no macros", () => {
            const text = "procedure foo begin end";
            const tree = parseWithCache(text);
            const macros = extractMacros(tree!.rootNode);

            expect(macros).toEqual([]);
        });

        it("extracts macro with empty body (define guard)", () => {
            const text = "#define GUARD_H";
            const tree = parseWithCache(text);
            const macros = extractMacros(tree!.rootNode);

            expect(macros).toHaveLength(1);
            expect(macros[0]!.name).toBe("GUARD_H");
            expect(macros[0]!.body).toBe("");
        });

        it("extracts macro with SSL keywords in body", () => {
            // SSL keywords (call, begin, etc.) are parsed as statements inside macro_body
            const text = "#define DO_CALL call helper;";
            const tree = parseWithCache(text);
            const macros = extractMacros(tree!.rootNode);

            expect(macros).toHaveLength(1);
            expect(macros[0]!.name).toBe("DO_CALL");
            expect(macros[0]!.body).toContain("call");
            expect(macros[0]!.body).toContain("helper");
        });

        it("recovers macro from ERROR node (call keyword with nested parens)", () => {
            // `call(F(X,Y))` produces an ERROR because `call` is a keyword
            // and the parser expects identifier/call_expr, not `(`
            const text = "#define MACRO(X,Y) call(F(X,Y))";
            const tree = parseWithCache(text);
            const macros = extractMacros(tree!.rootNode);

            expect(macros).toHaveLength(1);
            expect(macros[0]!.name).toBe("MACRO");
            expect(macros[0]!.hasParams).toBe(true);
            expect(macros[0]!.params).toEqual(["X", "Y"]);
            expect(macros[0]!.body).toContain("call");
        });

        it("extracts multiline macro body correctly", () => {
            const text = `#define MULTI(x) \\
    display_msg(x); \\
    debug_msg(x);`;
            const tree = parseWithCache(text);
            const macros = extractMacros(tree!.rootNode);

            expect(macros).toHaveLength(1);
            expect(macros[0]!.name).toBe("MULTI");
            expect(macros[0]!.multiline).toBe(true);
            expect(macros[0]!.hasParams).toBe(true);
            expect(macros[0]!.params).toEqual(["x"]);
        });
    });

    describe("findPrecedingDocComment()", () => {
        it("finds JSDoc comment before procedure", () => {
            const text = `
/** This is foo */
procedure foo begin end
`;
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            // Find the procedure node
            const proc = findProcedure(tree!.rootNode, "foo");
            expect(proc).not.toBeNull();

            const docComment = findPrecedingDocComment(tree!.rootNode, proc!);
            expect(docComment).toBe("/** This is foo */");
        });

        it("returns null when no doc comment", () => {
            const text = "procedure foo begin end";
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            const proc = findProcedure(tree!.rootNode, "foo");
            expect(proc).not.toBeNull();

            const docComment = findPrecedingDocComment(tree!.rootNode, proc!);
            expect(docComment).toBeNull();
        });

        it("ignores regular comments", () => {
            const text = `
// This is a regular comment
procedure foo begin end
`;
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            const proc = findProcedure(tree!.rootNode, "foo");
            expect(proc).not.toBeNull();

            const docComment = findPrecedingDocComment(tree!.rootNode, proc!);
            expect(docComment).toBeNull();
        });
    });

    describe("extractParams()", () => {
        it("extracts parameters without defaults", () => {
            const text = "procedure foo(variable x, variable y) begin end";
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            const proc = findProcedure(tree!.rootNode, "foo");
            expect(proc).not.toBeNull();

            const params = extractParams(proc!);
            expect(params).toEqual([
                { name: "x", defaultValue: undefined },
                { name: "y", defaultValue: undefined },
            ]);
        });

        it("extracts parameters with default values", () => {
            const text = "procedure foo(variable x := 0, variable y = 1) begin end";
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            const proc = findProcedure(tree!.rootNode, "foo");
            expect(proc).not.toBeNull();

            const params = extractParams(proc!);
            expect(params).toEqual([
                { name: "x", defaultValue: "0" },
                { name: "y", defaultValue: "1" },
            ]);
        });

        it("extracts mixed parameters (some with defaults, some without)", () => {
            const text = "procedure foo(variable x, variable y = 5, variable z) begin end";
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            const proc = findProcedure(tree!.rootNode, "foo");
            expect(proc).not.toBeNull();

            const params = extractParams(proc!);
            expect(params).toEqual([
                { name: "x", defaultValue: undefined },
                { name: "y", defaultValue: "5" },
                { name: "z", defaultValue: undefined },
            ]);
        });

        it("returns empty array for procedure without parameters", () => {
            const text = "procedure foo begin end";
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            const proc = findProcedure(tree!.rootNode, "foo");
            expect(proc).not.toBeNull();

            const params = extractParams(proc!);
            expect(params).toEqual([]);
        });

        it("extracts parameters from forward declaration", () => {
            const text = "procedure foo(variable x = 42);";
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            const proc = findProcedure(tree!.rootNode, "foo");
            expect(proc).not.toBeNull();

            const params = extractParams(proc!);
            expect(params).toEqual([{ name: "x", defaultValue: "42" }]);
        });

        it("does not extract invalid expression defaults from procedure params", () => {
            const text = "procedure foo(variable x = (1 + 2)) begin end";
            const tree = parseWithCache(text);
            expect(tree!).not.toBeNull();

            const proc = findProcedure(tree!.rootNode, "foo");
            expect(proc).not.toBeNull();

            const params = extractParams(proc!);
            expect(params).toEqual([{ name: "x", defaultValue: undefined }]);
        });
    });
});
