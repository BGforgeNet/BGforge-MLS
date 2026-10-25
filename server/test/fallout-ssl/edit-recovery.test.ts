/**
 * Outline and index for code still being typed. A half-typed statement is the normal state of a file in the editor,
 * so the damage error recovery does must stay local: the procedures after the edit keep their place in the outline,
 * and the file never becomes one ERROR.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import { SymbolKind } from "vscode-languageserver/node";

vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { getDocumentSymbols } from "../../src/fallout-ssl/symbol";
import { initParser, parseWithCache } from "@bgforge/shared/parsers/fallout-ssl";
import { SyntaxType } from "../../src/fallout-ssl/syntax-type";

beforeAll(async () => {
    await initParser();
});

const BEFORE = "procedure a begin end\n";
const AFTER = "\nend\nprocedure c begin\n  variable z;\nend\nprocedure d begin end\n";

/**
 * Procedure `b` in a typing state, between a finished `a` and finished `c` and `d`.
 *
 * Not here, because recovery still drops `c` (and sometimes `d`): an unclosed array or map literal, a ternary with
 * no `else`, a `for` header with no close paren, a parameter list with no close paren, and a header with neither
 * `begin` nor a body. Each needs two or more tokens inserted before the `end` fits, and recovery inserts one.
 */
const STATES: [string, string][] = [
    ["a call with only its open paren", "procedure b begin\n  foo("],
    ["a call with an argument and no close paren", "procedure b begin\n  foo(1"],
    ["a variable keyword with no name", "procedure b begin\n  variable"],
    ["a variable list ending in a comma", "procedure b begin\n  variable x,"],
    ["an assignment with no value and no semicolon", "procedure b begin\n  x :="],
    ["an assignment with no value", "procedure b begin\n  x := ;"],
    ["an if with no then", 'procedure b begin\n  if (x)\n    display_msg("y");'],
    ["a while with no do", 'procedure b begin\n  while (x)\n    display_msg("y");'],
    ["an if condition with no close paren", "procedure b begin\n  if (x then\n    y := 1;"],
    ["a foreach with no iterable", "procedure b begin\n  foreach x in"],
    ["an unclosed string", 'procedure b begin\n  display_msg("abc'],
    ["an unclosed character constant", "procedure b begin\n  x := 'a"],
    ["an unclosed block comment", "procedure b begin\n  /* note"],
    ["a procedure header with a body but no begin", "procedure b\n  x := 1;"],
    ["an extra end", "procedure b begin\n  x := 1;\nend"],
    ["a begin block with no end", "procedure b begin\n  if x then begin\n    y := 1;"],
    ["a switch with no end", "procedure b begin\n  switch x begin\n    case 1: y := 1;"],
    ["a macro with an unclosed parameter list", "#define M(x (x)\nprocedure b begin"],
];

/** The procedure names the outline lists. */
function outlineProcedures(text: string): string[] {
    return getDocumentSymbols(text)
        .filter((symbol) => symbol.kind === SymbolKind.Function)
        .map((symbol) => symbol.name)
        .sort();
}

describe("a statement still being typed", () => {
    it.each(STATES)("%s keeps every procedure in the outline", (_name, body) => {
        expect(outlineProcedures(BEFORE + body + AFTER)).toEqual(["a", "b", "c", "d"]);
    });

    it.each(STATES)("%s does not turn the file into one ERROR", (_name, body) => {
        const root = parseWithCache(BEFORE + body + AFTER)!.rootNode;
        expect(root.type).toBe(SyntaxType.SourceFile);
        expect(root.children.map((node) => node.type)).toContain(SyntaxType.Procedure);
    });
});

describe("a block still missing its end", () => {
    it("keeps the next procedure: recovery inserts the end", () => {
        expect(outlineProcedures("procedure a begin\n  x := 1;\nprocedure b begin\n  y := 2;\nend\n")).toEqual([
            "a",
            "b",
        ]);
    });

    it("lists the finished procedures when an if-chain open at the end of the file makes it one ERROR", () => {
        // Two `end`s are missing and recovery inserts one, so the root itself is the ERROR; `a` is its child.
        const text =
            "procedure a begin\nend\nprocedure b begin\n  if (x) then begin\n  end else if (y) then begin\n" +
            "  end else if (z) then begin\n";
        expect(parseWithCache(text)!.rootNode.type).toBe(SyntaxType.ERROR);
        expect(outlineProcedures(text)).toEqual(["a"]);
    });
});

describe("an unclosed string", () => {
    it("ends at the end of its line, so the procedure holding it keeps its node", () => {
        const root = parseWithCache('procedure a begin\n  display_msg("hi);\nend\nprocedure b begin end\n')!.rootNode;
        const procedures = root.children.filter((node) => node.type === SyntaxType.Procedure);
        expect(procedures.map((node) => node.childForFieldName("name")?.text)).toEqual(["a", "b"]);
    });
});
