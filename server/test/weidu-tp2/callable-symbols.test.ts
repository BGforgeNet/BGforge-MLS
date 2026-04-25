import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { initParser, parseWithCache } from "../../../shared/parsers/weidu-tp2";
import { ScopeKind } from "../../src/weidu-tp2/scope-kinds";
import { getCallableSymbolAtPosition } from "../../src/weidu-tp2/callable-symbols";
import { findLocalCallableDefinition } from "../../src/weidu-tp2/callable-definitions";

beforeAll(async () => {
    await initParser();
});

describe("weidu-tp2/callable-symbols", () => {
    it("resolves a patch function call to its local definition", () => {
        const text = `
DEFINE_PATCH_FUNCTION DoSomething
BEGIN
END

COPY_EXISTING ~file.itm~ ~override~
    LPF DoSomething END
`;

        const tree = parseWithCache(text);
        expect(tree!).not.toBeNull();

        const symbolInfo = getCallableSymbolAtPosition(tree!.rootNode, { line: 6, character: 8 });
        expect(symbolInfo).not.toBeNull();
        expect(symbolInfo).toMatchObject({
            name: "DoSomething",
            kind: "function",
            scope: ScopeKind.File,
        });

        const definition = findLocalCallableDefinition(text, "file:///test.tp2", symbolInfo!.name);
        expect(definition).not.toBeNull();
        expect(definition?.name).toBe("DoSomething");
        expect(definition?.location.range.start.line).toBe(1);
        expect(definition?.location.range.start.character).toBe(22);
    });

    it("resolves a patch macro call to its local definition", () => {
        const text = `
DEFINE_PATCH_MACRO ~my_macro~ BEGIN
END

COPY_EXISTING ~file.itm~ ~override~
    LPM ~my_macro~
`;

        const tree = parseWithCache(text);
        expect(tree!).not.toBeNull();

        const symbolInfo = getCallableSymbolAtPosition(tree!.rootNode, { line: 5, character: 10 });
        expect(symbolInfo).not.toBeNull();
        expect(symbolInfo).toMatchObject({
            name: "my_macro",
            kind: "function",
            scope: ScopeKind.File,
        });

        const definition = findLocalCallableDefinition(text, "file:///test.tp2", symbolInfo!.name);
        expect(definition).not.toBeNull();
        expect(definition?.name).toBe("my_macro");
        expect(definition?.location.range.start.line).toBe(1);
        expect(definition?.location.range.start.character).toBe(19);
    });
});
