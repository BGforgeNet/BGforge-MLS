/**
 * The shared layout and scanning helpers of format-utils: the comment-weaving pieces, the row layout of lists, the
 * line-comment finders, whitespace normalisation, and the parse-error guard. They are called by the tree formatters,
 * which are measured elsewhere, so the package pins each through its own surface with exact outputs.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { Node as SyntaxNode } from "web-tree-sitter";
import { initParser, getParser } from "@bgforge/shared/parsers/fallout-ssl";
import {
    WeiduTokenType,
    commentItem,
    containsComment,
    falloutSslLineCommentStart,
    hasWeiduLineComment,
    itemsOf,
    layoutRowParts,
    normalizeWhitespaceWeidu,
    terminate,
    throwOnParseError,
    tokenizeFalloutSsl,
    weave,
    type Piece,
    type RowPart,
    type WovenItem,
} from "../src/format-utils";

const piece = (text: string, sep = " ", indent?: string): Piece =>
    indent === undefined ? { text, sep } : { text, sep, indent };
const block = (comment: string): WovenItem => ({ comment, endsLine: false });
const line = (comment: string): WovenItem => ({ comment, endsLine: true });

describe("weave", () => {
    it("joins pieces by their separators and ignores the first one's", () => {
        expect(weave([piece("a", " "), piece("+"), piece("b")], "")).toBe("a + b");
        expect(weave([piece("a", ""), piece("[", ""), piece("1", ""), piece("]", "")], "")).toBe("a[1]");
        expect(weave([], "  ")).toBe("");
    });

    it("keeps a block comment inline with a blank on each side", () => {
        expect(weave([piece("a"), block("/* c */"), piece("+"), piece("b")], "")).toBe("a /* c */ + b");
        expect(weave([block("/*c*/"), piece("a")], "")).toBe("/* c */ a");
    });

    it("writes a comment tight after an opener and before a closer", () => {
        expect(weave([piece("(", ""), block("/* c */"), piece("x", "")], "")).toBe("(/* c */ x");
        expect(weave([piece("a", ""), piece(".", ""), block("/* c */"), piece("b", "")], "")).toBe("a./* c */ b");
        expect(weave([piece("x"), block("/* c */"), piece(")", "")], "")).toBe("x /* c */)");
        expect(weave([piece("x"), block("/* c */"), piece(",", "")], "")).toBe("x /* c */,");
    });

    it("ends the line at a line comment and starts the next piece at the indent", () => {
        expect(weave([piece("a"), line("//c"), piece("b")], "    ")).toBe("a // c\n    b");
        expect(weave([piece("a"), line("// c"), piece("b", " ", "  ")], "    ")).toBe("a // c\n  b");
        expect(weave([piece("a"), line("// c"), line("// d"), piece("b")], "  ")).toBe("a // c\n  // d\n  b");
        expect(weave([line("// c"), piece("a")], "  ")).toBe("// c\n  a");
    });

    it("keeps a line break in a separator after a block comment", () => {
        expect(weave([piece("a"), block("/* c */"), piece("b", "\n  ")], "")).toBe("a /* c */\n  b");
    });
});

describe("terminate", () => {
    it("adds the terminator after the last piece, before any comment after it", () => {
        expect(weave(terminate([piece("a")], ";"), "")).toBe("a;");
        expect(weave(terminate([piece("a"), block("/* c */")], ";"), "")).toBe("a; /* c */");
    });

    it("leaves a list whose last piece is the terminator, and fills an empty one", () => {
        const done: WovenItem[] = [piece("a"), piece(";", "")];
        expect(terminate(done, ";")).toEqual(done);
        expect(terminate(done, ";")).not.toBe(done);
        expect(terminate([], ")")).toEqual([{ text: ")", sep: "" }]);
        expect(terminate([block("/* c */")], ")")).toEqual([{ text: ")", sep: "" }, block("/* c */")]);
    });
});

describe("layoutRowParts", () => {
    const item = (text: string, row: number): RowPart => ({
        text,
        isItem: true,
        isLineComment: false,
        startRow: row,
        endRow: row,
    });
    const comment = (text: string, row: number, isLineComment: boolean): RowPart => ({
        text,
        isItem: false,
        isLineComment,
        startRow: row,
        endRow: row,
    });

    it("puts the first item on the head's line when asked, then one item to a line", () => {
        const parts = [item("1,", 0), item("2", 1)];
        expect(layoutRowParts("foo(", 0, parts, { firstItemInline: true, spaceAfterHead: false })).toEqual([
            "foo(1,",
            "2",
        ]);
        expect(layoutRowParts("X IN", 0, parts, { firstItemInline: false, spaceAfterHead: true })).toEqual([
            "X IN",
            "1,",
            "2",
        ]);
    });

    it("keeps a comment on the line of the part before it when it started on that row", () => {
        const parts = [item("a,", 0), comment("// c", 0, true), item("b", 1)];
        expect(layoutRowParts("f(", 0, parts, { firstItemInline: true, spaceAfterHead: false })).toEqual([
            "f(a, // c",
            "b",
        ]);
    });

    it("gives a comment on another row a line of its own, and keeps a block comment before the item after it", () => {
        const parts = [item("a,", 0), comment("/* c */", 1, false), item("b", 1)];
        expect(layoutRowParts("f(", 0, parts, { firstItemInline: true, spaceAfterHead: false })).toEqual([
            "f(a,",
            "/* c */ b",
        ]);
    });

    it("spaces a comment after the head only when asked", () => {
        const parts = [comment("/* c */", 0, false)];
        expect(layoutRowParts("H", 0, parts, { firstItemInline: false, spaceAfterHead: true })).toEqual(["H /* c */"]);
        expect(layoutRowParts("H", 0, parts, { firstItemInline: false, spaceAfterHead: false })).toEqual(["H/* c */"]);
        expect(layoutRowParts("H", 0, [], { firstItemInline: false, spaceAfterHead: true })).toEqual(["H"]);
    });
});

describe("line comment finders", () => {
    it("hasWeiduLineComment finds a `//` outside strings and block comments only", () => {
        expect(hasWeiduLineComment("PRINT ~x~ // note")).toBe(true);
        expect(hasWeiduLineComment("PRINT ~http://x~")).toBe(false);
        expect(hasWeiduLineComment("PRINT /* // */ ~x~")).toBe(false);
        expect(hasWeiduLineComment("PRINT ~x~")).toBe(false);
    });

    it("falloutSslLineCommentStart gives the index of the `//`, skipping strings and character constants", () => {
        expect(falloutSslLineCommentStart('x := "//"; // c')).toBe(11);
        expect(falloutSslLineCommentStart("x := '\"'; // c")).toBe(10);
        expect(falloutSslLineCommentStart("x := 1; /* // */")).toBe(-1);
        expect(falloutSslLineCommentStart("x := 1;")).toBe(-1);
    });
});

describe("tokenizeFalloutSsl", () => {
    it("splits code, strings, character constants and comments, keeping every character", () => {
        const text = 'a "s" \'"\' /* b */ c // d';
        const tokens = tokenizeFalloutSsl(text);
        expect(tokens.map((token) => token.text).join("")).toBe(text);
        expect(tokens.map((token) => [token.type, token.text])).toEqual([
            [WeiduTokenType.Code, "a "],
            [WeiduTokenType.String, '"s"'],
            [WeiduTokenType.Code, " "],
            [WeiduTokenType.String, "'\"'"],
            [WeiduTokenType.Code, " "],
            [WeiduTokenType.Comment, "/* b */"],
            [WeiduTokenType.Code, " c "],
            [WeiduTokenType.Comment, "// d"],
        ]);
    });

    it("ends a line comment at the line break", () => {
        expect(tokenizeFalloutSsl("a // b\nc").map((token) => token.text)).toEqual(["a ", "// b", "\nc"]);
    });
});

describe("normalizeWhitespaceWeidu", () => {
    it("collapses blanks in code and trims, and leaves strings and comments as written", () => {
        expect(normalizeWhitespaceWeidu("  a   b  ")).toBe("a b");
        expect(normalizeWhitespaceWeidu("a   ~b   c~   d")).toBe("a ~b   c~ d");
        expect(normalizeWhitespaceWeidu("a  /*  x   y */  b")).toBe("a /*  x   y */ b");
        expect(normalizeWhitespaceWeidu("a\n\n  b")).toBe("a b");
        expect(normalizeWhitespaceWeidu("")).toBe("");
    });
});

describe("helpers over a parsed tree", () => {
    beforeAll(async () => {
        await initParser();
    });

    const parse = (text: string): SyntaxNode => getParser().parse(text)!.rootNode;
    const binary = (text: string): SyntaxNode => parse(text).descendantsOfType("binary_expr")[0]!;

    it("commentItem says whether the comment ends its line", () => {
        const root = parse("procedure p begin\n  x := a /* c */ + b; // d\nend\n");
        const [blockNode, lineNode] = root.descendantsOfType(["comment", "line_comment"]);
        expect(commentItem(blockNode!)).toEqual({ comment: "/* c */", endsLine: false });
        expect(commentItem(lineNode!)).toEqual({ comment: "// d", endsLine: true });
    });

    it("containsComment looks through the whole subtree", () => {
        expect(containsComment(binary("procedure p begin\n  x := a /* c */ + b;\nend\n"))).toBe(true);
        expect(containsComment(binary("procedure p begin\n  x := a + b;\nend\n"))).toBe(false);
        expect(containsComment(parse("procedure p begin\n  x := a + b; // c\nend\n"))).toBe(true);
    });

    it("itemsOf keeps the comments, maps the children it wants and drops the rest", () => {
        const node = binary("procedure p begin\n  x := a /* c */ + b;\nend\n");
        const items = itemsOf(node.children, (child) => (child.type === "identifier" ? piece(child.text) : null));
        expect(items).toEqual([piece("a"), block("/* c */"), piece("b")]);
        expect(weave(items, "")).toBe("a /* c */ b");
    });

    it("throwOnParseError accepts a clean tree and names the position of a broken one", () => {
        expect(() => throwOnParseError(parse("procedure p begin\n  x := 1;\nend\n"))).not.toThrow();
        expect(() => throwOnParseError(parse("procedure p begin\n  x := ;\nend\n"))).toThrow(
            /^\d+:\d+: Parse (ERROR|MISSING)$/,
        );
    });
});
