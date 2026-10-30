/**
 * Trees for code still being typed. A half-typed statement is the normal state of a file in the editor, so the
 * damage error recovery does must stay local: the enclosing block, the function and the statements around the edit
 * keep their nodes, and the file never becomes one ERROR.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { Node } from "web-tree-sitter";
import * as tp2 from "@bgforge/shared/parsers/weidu-tp2";
import { SyntaxType } from "@bgforge/shared/syntax-types/weidu-tp2";

beforeAll(async () => {
    await tp2.initParser();
});

function parse(text: string): Node {
    const tree = tp2.parseWithCache(text);
    expect(tree, "parser returned no tree").not.toBeNull();
    return tree!.rootNode;
}

/** The MISSING tokens recovery inserted, by type. */
function missing(root: Node): string[] {
    const out: string[] = [];
    const walk = (node: Node): void => {
        if (node.isMissing) out.push(node.type);
        for (const child of node.children) walk(child);
    };
    walk(root);
    return out;
}

describe("a block still missing its END", () => {
    it.each([
        ["ACTION_IF", "ACTION_IF a BEGIN\n  OUTER_SET x = 1\n  OUTER_SET y = 2\n", SyntaxType.ActionIf],
        [
            "a function definition",
            "DEFINE_ACTION_FUNCTION f BEGIN\n  OUTER_SET x = 1\n  OUTER_SET y = 2\n",
            SyntaxType.ActionDefineFunction,
        ],
        ["ACTION_FOR_EACH", "ACTION_FOR_EACH v IN a b BEGIN\n  PRINT ~a~\n  PRINT ~b~\n", SyntaxType.ActionForEach],
    ])("%s keeps its node, with a missing END", (_name, text, blockType) => {
        const root = parse(text);
        expect(root.type).toBe(SyntaxType.SourceFile);
        expect(root.descendantsOfType(blockType)).toHaveLength(1);
        expect(missing(root)).toEqual(["END"]);
    });

    it("keeps the enclosing function when a call inside it is half-typed", () => {
        const root = parse(
            "DEFINE_ACTION_FUNCTION f BEGIN\n  ACTION_IF a BEGIN\n    LAF g\n  END\n  OUTER_SET x = 1\nEND\n" +
                "DEFINE_ACTION_FUNCTION h BEGIN\n  PRINT ~h~\nEND\n",
        );
        expect(root.type).toBe(SyntaxType.SourceFile);
        expect(root.descendantsOfType(SyntaxType.ActionDefineFunction)).toHaveLength(2);
    });
});

describe("an unclosed percent string", () => {
    it("does not run on to the next % lines away", () => {
        // The line after the unclosed string still joins its statement: the keyword there is lexed in an error
        // state. Everything past it keeps its node, where the string used to swallow all of it.
        const root = parse(
            "OUTER_SPRINT a %foo\nOUTER_SET c = 1\nOUTER_SET d = 2\nOUTER_SET e = 3\nOUTER_SPRINT b ~%bar%~\n",
        );
        expect(root.type).toBe(SyntaxType.SourceFile);
        const statements = root.namedChildren.map((node) => `${node!.type}@${node!.startPosition.row}`);
        expect(statements).toEqual(
            expect.arrayContaining([
                `${SyntaxType.ActionOuterSet}@2`,
                `${SyntaxType.ActionOuterSet}@3`,
                `${SyntaxType.ActionOuterSprint}@4`,
            ]),
        );
    });
});

describe("an unclosed block comment", () => {
    const PROLOGUE = "BACKUP ~m/backup~\nAUTHOR ~me~\nBEGIN ~a~\nCOPY ~x~ ~y~\n";
    const LATER = "\nBEGIN ~c~\nCOPY ~x~ ~y~\nBEGIN ~d~\nPRINT ~d~\n";

    it.each([
        ["an action line", "BEGIN ~b~\nCOPY ~x~ ~y~ /* note"],
        ["a line inside a block", "BEGIN ~b~\nACTION_IF x BEGIN\n  PRINT ~x~ /* note\nEND"],
    ])("typed into %s keeps the later components", (_name, body) => {
        const root = parse(PROLOGUE + body + LATER);
        expect(root.hasError).toBe(true);
        const names = root.namedChildren
            .filter((node) => node?.type === SyntaxType.Component)
            .map((node) => node!.childForFieldName("name")?.text);
        expect(names).toEqual(["~a~", "~b~", "~c~", "~d~"]);
    });

    it("typed into a function body keeps the later functions", () => {
        const fn = (name: string, body: string) => `DEFINE_ACTION_FUNCTION ${name} BEGIN\n  ${body}\nEND\n`;
        const root = parse(fn("a", "PRINT ~a~") + fn("b", "PRINT ~x~ /* note") + fn("c", "PRINT ~c~") + fn("d", ""));
        expect(root.hasError).toBe(true);
        const names = root
            .descendantsOfType(SyntaxType.ActionDefineFunction)
            .map((node) => node!.childForFieldName("name")?.text);
        expect(names).toEqual(["a", "b", "c", "d"]);
    });
});

describe("components", () => {
    it("own the actions that follow their flags", () => {
        const root = parse(
            "BEGIN @1\nREQUIRE_PREDICATE GAME_IS ~bg2ee~ @2\nINCLUDE ~a.tpa~\nLAF a END\n\n// next\n" +
                "BEGIN @3\nREQUIRE_PREDICATE GAME_IS ~bg2ee~ @4\nINCLUDE ~b.tpa~\nLAF b END\n",
        );
        const components = root.namedChildren.filter((node) => node?.type === SyntaxType.Component);
        expect(components).toHaveLength(2);
        for (const component of components) {
            expect(component!.namedChildren.map((node) => node?.type)).toContain(SyntaxType.ActionLaunchFunction);
        }
    });
});
