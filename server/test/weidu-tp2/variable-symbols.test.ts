import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { initParser, parseWithCache } from "../../src/weidu-tp2/parser";
import { ScopeKind } from "../../src/weidu-tp2/scope-kinds";
import { findVariableDefinitionNode, getVariableSymbolAtPosition } from "../../src/weidu-tp2/variable-symbols";

beforeAll(async () => {
    await initParser();
});

describe("weidu-tp2/variable-symbols", () => {
    it("resolves a function parameter reference to the parameter declaration", () => {
        const text = `
DEFINE_PATCH_FUNCTION MyFunc
    INT_VAR count = 1
BEGIN
    SET total = count * 2
END
`;
        const tree = parseWithCache(text);
        expect(tree).not.toBeNull();

        const symbolInfo = getVariableSymbolAtPosition(tree!.rootNode, { line: 4, character: 16 });
        expect(symbolInfo).not.toBeNull();
        expect(symbolInfo).toMatchObject({
            name: "count",
            kind: "variable",
            scope: ScopeKind.Function,
        });

        const definitionNode = findVariableDefinitionNode(tree!.rootNode, symbolInfo!);
        expect(definitionNode).not.toBeNull();
        expect(definitionNode?.text).toBe("count");
        expect(definitionNode?.startPosition.row).toBe(2);
        expect(definitionNode?.startPosition.column).toBe(12);
    });

    it("resolves a file variable in percent-string usage to its declaration", () => {
        const text = `
OUTER_SET my_var = 5
OUTER_SET result = %my_var% + 1
`;
        const tree = parseWithCache(text);
        expect(tree).not.toBeNull();

        const symbolInfo = getVariableSymbolAtPosition(tree!.rootNode, { line: 2, character: 20 });
        expect(symbolInfo).not.toBeNull();
        expect(symbolInfo).toMatchObject({
            name: "my_var",
            kind: "variable",
            scope: ScopeKind.File,
        });

        const definitionNode = findVariableDefinitionNode(tree!.rootNode, symbolInfo!);
        expect(definitionNode).not.toBeNull();
        expect(definitionNode?.text).toBe("my_var");
        expect(definitionNode?.startPosition.row).toBe(1);
        expect(definitionNode?.startPosition.column).toBe(10);
    });
});
