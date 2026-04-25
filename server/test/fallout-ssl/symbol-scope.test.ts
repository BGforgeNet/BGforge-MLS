/**
 * Unit tests for fallout-ssl/symbol-scope.ts - scope determination for rename.
 * Tests that symbols are correctly classified as file-scoped or procedure-scoped.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import { Position } from "vscode-languageserver/node";

vi.mock("../../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    }),
    getDocuments: () => ({ get: vi.fn() }),
    initLspConnection: vi.fn(),
}));

import { initParser, parseWithCache } from "../../../shared/parsers/fallout-ssl";
import { ScopeKind, assertNeverScope } from "../../src/fallout-ssl/scope-kinds";
import { findContainingProcedure, isLocalToProc } from "../../src/fallout-ssl/symbol-definitions";
import { getSymbolScope } from "../../src/fallout-ssl/symbol-scope";

beforeAll(async () => {
    await initParser();
});

describe("fallout-ssl/symbol-scope", () => {
    describe("findContainingProcedure()", () => {
        it("returns procedure node when inside a procedure body", () => {
            const text = `
procedure foo begin
    variable x;
end
`;
            const tree = parseWithCache(text)!;
            // Find the "x" identifier node
            const xNode = findNodeByText(tree!.rootNode, "x");
            expect(xNode).not.toBeNull();
            const proc = findContainingProcedure(xNode!);
            expect(proc).not.toBeNull();
            expect(proc!.type).toBe("procedure");
        });

        it("returns procedure node for a name node (parent is the procedure)", () => {
            const text = `
procedure foo begin end
`;
            const tree = parseWithCache(text)!;
            const procNode = tree!.rootNode.children.find((c) => c.type === "procedure")!;
            const nameNode = procNode.childForFieldName("name")!;
            // nameNode's parent IS the procedure node, so findContainingProcedure returns it.
            // The rename logic uses isLocalToProc separately to determine that "foo" is
            // not a procedure-local (it's the procedure's own name, which is file-scoped).
            const result = findContainingProcedure(nameNode);
            expect(result).not.toBeNull();
            expect(result!.type).toBe("procedure");
        });

        it("returns null for macro at file level", () => {
            const text = `
#define MAX 100

procedure foo begin end
`;
            const tree = parseWithCache(text)!;
            const maxNode = findNodeByText(tree!.rootNode, "MAX");
            expect(maxNode).not.toBeNull();
            const proc = findContainingProcedure(maxNode!);
            expect(proc).toBeNull();
        });
    });

    describe("isLocalToProc()", () => {
        it("returns true for procedure parameter", () => {
            const text = `
procedure foo(variable value) begin
    display_msg(value);
end
`;
            const tree = parseWithCache(text)!;
            const procNode = tree!.rootNode.children.find((c) => c.type === "procedure")!;
            expect(isLocalToProc(procNode, "value")).toBe(true);
        });

        it("returns true for variable declared in procedure", () => {
            const text = `
procedure foo begin
    variable counter;
    counter := 0;
end
`;
            const tree = parseWithCache(text)!;
            const procNode = tree!.rootNode.children.find((c) => c.type === "procedure")!;
            expect(isLocalToProc(procNode, "counter")).toBe(true);
        });

        it("returns true for for_var_decl", () => {
            const text = `
procedure foo begin
    for (variable i := 0; i < 10; i++) begin
    end
end
`;
            const tree = parseWithCache(text)!;
            const procNode = tree!.rootNode.children.find((c) => c.type === "procedure")!;
            expect(isLocalToProc(procNode, "i")).toBe(true);
        });

        it("returns true for foreach var", () => {
            const text = `
procedure foo begin
    foreach (item in list) begin
    end
end
`;
            const tree = parseWithCache(text)!;
            const procNode = tree!.rootNode.children.find((c) => c.type === "procedure")!;
            expect(isLocalToProc(procNode, "item")).toBe(true);
        });

        it("returns false for procedure name", () => {
            const text = `
procedure foo begin
    variable x;
end
`;
            const tree = parseWithCache(text)!;
            const procNode = tree!.rootNode.children.find((c) => c.type === "procedure")!;
            expect(isLocalToProc(procNode, "foo")).toBe(false);
        });

        it("returns false for symbol not defined in this procedure", () => {
            const text = `
procedure foo begin
    variable x;
end
procedure bar begin
    variable y;
end
`;
            const tree = parseWithCache(text)!;
            const barNode = tree!.rootNode.children.filter((c) => c.type === "procedure")[1]!;
            expect(isLocalToProc(barNode, "x")).toBe(false);
        });
    });

    describe("getSymbolScope()", () => {
        it("returns procedure scope for variable defined in current procedure", () => {
            const text = `
procedure foo begin
    variable counter;
    counter := 0;
end
`;
            const tree = parseWithCache(text)!;
            // Cursor on "counter" at usage
            const position: Position = { line: 3, character: 4 };
            const result = getSymbolScope(tree!.rootNode, position);

            expect(result).not.toBeNull();
            expect(result!.scope).toBe(ScopeKind.Procedure);
            expect(result!.name).toBe("counter");
            expect(result!.procedureNode).toBeDefined();
        });

        it("returns procedure scope for parameter", () => {
            const text = `
procedure foo(variable value) begin
    display_msg(value);
end
`;
            const tree = parseWithCache(text)!;
            // Cursor on "value" usage
            const position: Position = { line: 2, character: 16 };
            const result = getSymbolScope(tree!.rootNode, position);

            expect(result).not.toBeNull();
            expect(result!.scope).toBe(ScopeKind.Procedure);
            expect(result!.name).toBe("value");
        });

        it("returns file scope for procedure name at definition", () => {
            const text = `
procedure helper begin end
procedure main begin
    call helper;
end
`;
            const tree = parseWithCache(text)!;
            // Cursor on "helper" at definition
            const position: Position = { line: 1, character: 12 };
            const result = getSymbolScope(tree!.rootNode, position);

            expect(result).not.toBeNull();
            expect(result!.scope).toBe(ScopeKind.File);
            expect(result!.name).toBe("helper");
        });

        it("returns file scope for procedure name at call site", () => {
            const text = `
procedure helper begin end
procedure main begin
    call helper;
end
`;
            const tree = parseWithCache(text)!;
            // Cursor on "helper" at call site inside main
            const position: Position = { line: 3, character: 10 };
            const result = getSymbolScope(tree!.rootNode, position);

            expect(result).not.toBeNull();
            expect(result!.scope).toBe(ScopeKind.File);
            expect(result!.name).toBe("helper");
        });

        it("returns file scope for macro name", () => {
            const text = `
#define MAX_ITEMS 100

procedure foo begin
    if (count > MAX_ITEMS) then begin
    end
end
`;
            const tree = parseWithCache(text)!;
            // Cursor on "MAX_ITEMS" at definition
            const position: Position = { line: 1, character: 10 };
            const result = getSymbolScope(tree!.rootNode, position);

            expect(result).not.toBeNull();
            expect(result!.scope).toBe("file");
            expect(result!.name).toBe("MAX_ITEMS");
        });

        it("returns file scope for macro reference inside procedure", () => {
            const text = `
#define MAX_ITEMS 100

procedure foo begin
    if (count > MAX_ITEMS) then begin
    end
end
`;
            const tree = parseWithCache(text)!;
            // Cursor on "MAX_ITEMS" inside procedure
            const position: Position = { line: 4, character: 20 };
            const result = getSymbolScope(tree!.rootNode, position);

            expect(result).not.toBeNull();
            expect(result!.scope).toBe("file");
            expect(result!.name).toBe("MAX_ITEMS");
        });

        it("returns null for unrecognized position", () => {
            const text = `
procedure foo begin end
`;
            const tree = parseWithCache(text)!;
            // Cursor on whitespace
            const position: Position = { line: 0, character: 0 };
            const result = getSymbolScope(tree!.rootNode, position);

            expect(result).toBeNull();
        });

        it("returns external scope for symbol defined only in a different procedure", () => {
            const text = `
procedure foo begin
    variable x;
    x := 1;
end
procedure bar begin
    x := 2;
end
`;
            const tree = parseWithCache(text)!;
            // Cursor on "x" in bar, but "x" is only a local in foo, not bar
            // Since there's no file-scope "x" either, this is an external reference
            const position: Position = { line: 6, character: 4 };
            const result = getSymbolScope(tree!.rootNode, position);

            expect(result).not.toBeNull();
            expect(result!.scope).toBe("external");
            expect(result!.name).toBe("x");
        });

        it("returns file scope for top-level variable declaration", () => {
            const text = `
variable dogmeatPtr;

procedure foo begin
    dogmeatPtr := 1;
end
`;
            const tree = parseWithCache(text)!;
            // Cursor on "dogmeatPtr" at declaration
            const position: Position = { line: 1, character: 12 };
            const result = getSymbolScope(tree!.rootNode, position);

            expect(result).not.toBeNull();
            expect(result!.scope).toBe("file");
            expect(result!.name).toBe("dogmeatPtr");
        });

        it("returns file scope for top-level multi-variable declaration", () => {
            const text = `
variable
   dogmeatPtr,
   dogmeatCheck,
   dogmeatTalk;

procedure foo begin
    dogmeatPtr := 1;
end
`;
            const tree = parseWithCache(text)!;
            // Cursor on "dogmeatCheck" at declaration
            const position: Position = { line: 3, character: 6 };
            const result = getSymbolScope(tree!.rootNode, position);

            expect(result).not.toBeNull();
            expect(result!.scope).toBe("file");
            expect(result!.name).toBe("dogmeatCheck");
        });

        it("returns file scope for top-level variable reference inside procedure", () => {
            const text = `
variable dogmeatPtr;

procedure foo begin
    dogmeatPtr := 1;
end
`;
            const tree = parseWithCache(text)!;
            // Cursor on "dogmeatPtr" usage inside procedure
            const position: Position = { line: 4, character: 8 };
            const result = getSymbolScope(tree!.rootNode, position);

            expect(result).not.toBeNull();
            expect(result!.scope).toBe("file");
            expect(result!.name).toBe("dogmeatPtr");
        });

        it("returns file scope for export_decl", () => {
            const text = `
export variable global_val := 0;

procedure foo begin
    global_val := 1;
end
`;
            const tree = parseWithCache(text)!;
            // Cursor on "global_val" at export definition
            const position: Position = { line: 1, character: 18 };
            const result = getSymbolScope(tree!.rootNode, position);

            expect(result).not.toBeNull();
            expect(result!.scope).toBe("file");
            expect(result!.name).toBe("global_val");
        });
    });
});

describe("fallout-ssl/scope-kinds assertNeverScope()", () => {
    it("throws with the unhandled scope value in the message", () => {
        // assertNeverScope is an exhaustive-check helper; calling it with any value
        // via a type cast exercises the function body (line 23 in scope-kinds.ts).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional type cast to test the runtime guard
        expect(() => assertNeverScope("unknown-scope" as never)).toThrow("Unhandled ScopeKind: unknown-scope");
    });
});

// Helper to find a node with matching text by walking the tree
function findNodeByText(root: import("web-tree-sitter").Node, text: string): import("web-tree-sitter").Node | null {
    if (root.type === "identifier" && root.text === text) {
        return root;
    }
    for (const child of root.children) {
        const found = findNodeByText(child, text);
        if (found) return found;
    }
    return null;
}
