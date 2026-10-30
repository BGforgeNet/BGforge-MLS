/**
 * Trees for script still being typed. A half-typed line is the normal state of a file in the editor, so the damage
 * error recovery does must stay local: the blocks after the edit keep their nodes.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { Node } from "web-tree-sitter";
import * as baf from "@bgforge/shared/parsers/weidu-baf";
import { SyntaxType } from "@bgforge/shared/syntax-types/weidu-baf";

beforeAll(async () => {
    await baf.initParser();
});

function parse(text: string): Node {
    const tree = baf.parseWithCache(text);
    expect(tree, "parser returned no tree").not.toBeNull();
    return tree!.rootNode;
}

/** A block whose condition names it, with `condition` and `action` lines replaceable. */
function block(name: string, condition = "", action = ""): string {
    return `IF\n  Global("${name}","GLOBAL",0)${condition}\nTHEN\n  RESPONSE #100\n    NoAction()${action}\nEND\n`;
}

/** The names of the root's blocks, read from their first condition. */
function blockNames(root: Node): (string | undefined)[] {
    return root.namedChildren
        .filter((node) => node?.type === SyntaxType.Block)
        .map((node) => /Global\("(\w+)"/.exec(node!.text)?.[1]);
}

describe("an unclosed block comment", () => {
    it.each([
        ["an action line", block("b", "", " /* note")],
        ["a condition line", block("b", " /* note")],
    ])("typed into %s keeps the later blocks", (_name, edited) => {
        const root = parse(block("a") + edited + block("c") + block("d"));
        expect(root.hasError).toBe(true);
        expect(blockNames(root)).toEqual(["a", "b", "c", "d"]);
    });
});
