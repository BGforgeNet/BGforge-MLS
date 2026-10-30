/**
 * A comment opener inside a string, or inside a line comment, is text. WeiDU and the SSL compiler lex each string
 * form as one token holding everything up to its closer, and `//` runs to the end of the line. A tree that lets a
 * comment extra in there loses that text: the formatter moves the comment out and changes the string.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { Node } from "web-tree-sitter";
import * as ssl from "@bgforge/shared/parsers/fallout-ssl";
import * as baf from "@bgforge/shared/parsers/weidu-baf";
import * as d from "@bgforge/shared/parsers/weidu-d";
import * as tp2 from "@bgforge/shared/parsers/weidu-tp2";
import * as tra from "@bgforge/shared/parsers/weidu-tra";

interface ParserModule {
    initParser: () => Promise<void>;
    parseWithCache: (text: string) => { rootNode: Node } | null;
}

interface Case {
    readonly name: string;
    readonly text: string;
    /** The node type holding the text, and the texts of those nodes in source order. */
    readonly holder: string;
    readonly held: readonly string[];
    /** The line comments the text holds, in source order. */
    readonly lineComments?: readonly string[];
}

/** Every node of `type` under `node`, in source order. */
function nodesOfType(node: Node, type: string): Node[] {
    const out: Node[] = [];
    const walk = (n: Node): void => {
        if (n.type === type) out.push(n);
        for (const child of n.children) if (child) walk(child);
    };
    walk(node);
    return out;
}

const tp2Sprint = (value: string) => `OUTER_SPRINT x ${value}\nOUTER_SET y = 1\n`;
const dState = (say: string, reply: string) =>
    `BEGIN ~d~\nIF ~~ THEN BEGIN s SAY ${say}\n  IF ~~ THEN REPLY ${reply} EXIT\nEND\n`;

const GRAMMARS: readonly { grammar: string; mod: ParserModule; cases: readonly Case[] }[] = [
    {
        grammar: "weidu-tp2",
        mod: tp2,
        cases: [
            {
                name: "a block comment in %...%",
                text: tp2Sprint("%a/* b */c%"),
                holder: "percent_content",
                held: ["a/* b */c"],
            },
            {
                name: "a line comment in %...%",
                text: tp2Sprint("%a // b%"),
                holder: "percent_content",
                held: ["a // b"],
            },
            {
                name: "a block comment after a space in %...%",
                text: tp2Sprint("%a /* b */%"),
                holder: "percent_content",
                held: ["a /* b */"],
            },
            {
                name: "a block comment first in %...%",
                text: tp2Sprint("% /* b */a%"),
                holder: "percent_content",
                held: [" /* b */a"],
            },
            {
                name: "a block comment in ~...~",
                text: tp2Sprint("~a /* b */ c~"),
                holder: "tilde_content",
                held: ["a /* b */ c"],
            },
            { name: "a line comment in ~...~", text: tp2Sprint("~a // b~"), holder: "tilde_content", held: ["a // b"] },
            {
                name: 'a block comment in "..."',
                text: tp2Sprint('"a /* b */ c"'),
                holder: "double_content",
                held: ["a /* b */ c"],
            },
            {
                name: "a block comment in ~~~~~...~~~~~",
                text: tp2Sprint("~~~~~a /* b */ c~~~~~"),
                holder: "five_tilde_content",
                held: ["a /* b */ c"],
            },
            {
                name: "a closed block comment in a line comment",
                text: "OUTER_SET x = 1 // /* b */ c\nOUTER_SET y = 2\n",
                holder: "identifier",
                held: ["x", "y"],
                lineComments: ["// /* b */ c"],
            },
            {
                name: "an unclosed block comment in a line comment",
                text: "OUTER_SET x = 1 // /* b\nOUTER_SET y = 2\n",
                holder: "identifier",
                held: ["x", "y"],
                lineComments: ["// /* b"],
            },
        ],
    },
    {
        grammar: "weidu-d",
        mod: d,
        cases: [
            {
                name: 'block comments in ~...~ and "..."',
                text: dState("~a /* b */ c~", '"a // b"'),
                holder: "tilde_content",
                held: ["d", "a /* b */ c"],
            },
            {
                name: "a block comment in ~~~~~...~~~~~",
                text: dState("~~~~~a /* b */ c~~~~~", "~r~"),
                holder: "five_tilde_content",
                held: ["a /* b */ c"],
            },
            {
                name: "an unclosed block comment in a line comment",
                text: "BEGIN ~d~ // /* b\nIF ~~ THEN BEGIN s SAY ~x~ IF ~~ THEN EXIT END\n",
                holder: "tilde_content",
                held: ["d", "x"],
                lineComments: ["// /* b"],
            },
            {
                name: "a closed block comment in a line comment",
                text: "BEGIN ~d~ // /* b */ c\nIF ~~ THEN BEGIN s SAY ~x~ IF ~~ THEN EXIT END\n",
                holder: "tilde_content",
                held: ["d", "x"],
                lineComments: ["// /* b */ c"],
            },
        ],
    },
    {
        grammar: "weidu-baf",
        mod: baf,
        cases: [
            {
                name: "comment openers in every string form",
                text:
                    'IF\n  Global("a /* b */ c","GLOBAL",0)\nTHEN\n  RESPONSE #100\n' +
                    '    DisplayString(Myself,~a // b~)\n    SetGlobal(%a/*b*/%,"GLOBAL",1)\nEND\n',
                holder: "string",
                held: ['"a /* b */ c"', '"GLOBAL"', "~a // b~", "%a/*b*/%", '"GLOBAL"'],
            },
        ],
    },
    {
        grammar: "weidu-tra",
        mod: tra,
        cases: [
            {
                name: "comment openers in ~...~ and ~~~~~...~~~~~",
                text: "@1 = ~a /* b */ c~\n@2 = ~~~~~a // b~~~~~\n",
                holder: "tilde_string",
                held: ["~a /* b */ c~", "~~~~~a // b~~~~~"],
            },
            { name: 'a comment opener in "..."', text: '@1 = "a // b"\n', holder: "double_string", held: ['"a // b"'] },
            {
                name: "a comment opener in %...%",
                text: "@1 = %a /* b */%\n",
                holder: "percent_string",
                held: ["%a /* b */%"],
            },
        ],
    },
    {
        grammar: "fallout-ssl",
        mod: ssl,
        cases: [
            {
                name: "comment openers in strings",
                text: 'procedure start begin\n  x := "a /* b */ c";\n  y := "a // b";\nend\n',
                holder: "string",
                held: ['"a /* b */ c"', '"a // b"'],
            },
        ],
    },
];

describe("weidu-tp2: a %name% reference", () => {
    beforeAll(async () => {
        await tp2.initParser();
    });

    // `%name%` is a percent string, which the grammar once also read as a variable_ref of separate tokens.
    it("holds no comment when closed on its line", () => {
        const root = tp2.parseWithCache("OUTER_SET y = % /* c */ x% + 1\n")!.rootNode;
        const holders = [...nodesOfType(root, "variable_ref"), ...nodesOfType(root, "percent_string")];
        const held = holders.flatMap((node) => [...nodesOfType(node, "comment"), ...nodesOfType(node, "line_comment")]);
        expect(root.hasError).toBe(false);
        expect(held.map((node) => node.text)).toEqual([]);
    });

    // One left open at a line end is reported, so no consumer reads the next line's comment as part of it: the
    // formatters refuse a tree with an error.
    it.each([
        ["opened at a line end", "OUTER_SET y = %\n/* c */x% + 1\n"],
        ["opened before a line comment", "OUTER_SET y = % // c\nx% + 1\n"],
    ])("is an error when %s", (_name, text) => {
        expect(tp2.parseWithCache(text)!.rootNode.hasError).toBe(true);
    });
});

for (const { grammar, mod, cases } of GRAMMARS) {
    describe(`${grammar}: a comment opener in a string or a line comment`, () => {
        beforeAll(async () => {
            await mod.initParser();
        });

        it.each(cases)("$name is text", ({ text, holder, held, lineComments = [] }) => {
            const root = mod.parseWithCache(text)!.rootNode;
            expect(root.hasError).toBe(false);
            expect(nodesOfType(root, "comment").map((node) => node.text)).toEqual([]);
            expect(nodesOfType(root, "line_comment").map((node) => node.text)).toEqual(lineComments);
            expect(nodesOfType(root, holder).map((node) => node.text)).toEqual(held);
        });
    });
}
