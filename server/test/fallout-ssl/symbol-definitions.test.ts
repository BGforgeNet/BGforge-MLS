import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    }),
    getDocuments: () => ({ get: vi.fn() }),
    initLspConnection: vi.fn(),
}));

import { initParser, parseWithCache } from "../../src/fallout-ssl/parser";
import { resolveIdentifierDefinitionNode, isParameterDefinitionNode } from "../../src/fallout-ssl/symbol-definitions";

beforeAll(async () => {
    await initParser();
});

describe("fallout-ssl/symbol-definitions", () => {
    it("resolves a procedure parameter reference to its parameter definition", () => {
        const text = `
procedure foo(variable amount) begin
    display_msg(amount);
end
`;
        const tree = parseWithCache(text)!;
        const amountRef = findIdentifierNodeByText(tree.rootNode, "amount", 1);
        expect(amountRef).not.toBeNull();

        const definitionNode = resolveIdentifierDefinitionNode(tree.rootNode, amountRef!);
        expect(definitionNode).not.toBeNull();
        expect(definitionNode?.text).toBe("amount");
        expect(isParameterDefinitionNode(definitionNode!)).toBe(true);
        expect(definitionNode?.startPosition.row).toBe(1);
    });
});

function findIdentifierNodeByText(
    node: import("web-tree-sitter").Node,
    text: string,
    occurrenceIndex: number,
): import("web-tree-sitter").Node | null {
    let seen = -1;

    function visit(current: import("web-tree-sitter").Node): import("web-tree-sitter").Node | null {
        if (current.type === "identifier" && current.text === text) {
            seen += 1;
            if (seen === occurrenceIndex) {
                return current;
            }
        }

        for (const child of current.children) {
            const match = visit(child);
            if (match) {
                return match;
            }
        }

        return null;
    }

    return visit(node);
}
