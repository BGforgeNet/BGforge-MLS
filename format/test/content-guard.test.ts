/**
 * The content guard (validateFormatting with a per-language normalizer) refuses a formatting result whose content
 * changed. Comments are content: a formatter that loses, adds or rewords one must be refused, while the blanks a
 * formatter legitimately adjusts around and inside a comment must pass.
 */

import { describe, expect, it } from "vitest";
import {
    validateFormatting,
    stripCommentsWeidu,
    stripCommentsWeiduD,
    stripCommentsFalloutSsl,
    stripCommentsForCompareFalloutSsl,
    stripCommentsTra,
    stripCommentsFalloutMsg,
    type CompareNormalizer,
} from "@bgforge/format";

interface Sample {
    name: string;
    normalize: CompareNormalizer;
    /** Source with a line comment and a block comment. */
    source: string;
    lineComment: string;
    blockComment: string;
}

const SAMPLES: Sample[] = [
    {
        name: "WeiDU",
        normalize: stripCommentsWeidu,
        source: "PRINT ~a~ // line note\nPRINT ~b~ /* block note */\n",
        lineComment: "// line note",
        blockComment: "/* block note */",
    },
    {
        name: "WeiDU D",
        normalize: stripCommentsWeiduD,
        source: "BEGIN ~d~ // line note\nEND /* block note */\n",
        lineComment: "// line note",
        blockComment: "/* block note */",
    },
    {
        name: "Fallout SSL",
        normalize: stripCommentsFalloutSsl,
        source: "x := 1; // line note\ny := 2; /* block note */\n",
        lineComment: "// line note",
        blockComment: "/* block note */",
    },
    {
        name: "Fallout SSL (keyword folding)",
        normalize: stripCommentsForCompareFalloutSsl,
        source: "x := 1; // line note\ny := 2; /* block note */\n",
        lineComment: "// line note",
        blockComment: "/* block note */",
    },
    {
        name: "TRA",
        normalize: stripCommentsTra,
        source: "@1 = ~a~ // line note\n@2 = ~b~ /* block note */\n",
        lineComment: "// line note",
        blockComment: "/* block note */",
    },
];

describe.each(SAMPLES)("content guard comments: $name", ({ normalize, source, lineComment, blockComment }) => {
    it("accepts an unchanged text", () => {
        expect(validateFormatting(source, source, normalize)).toBeNull();
    });

    it("refuses a result that lost a line comment", () => {
        expect(validateFormatting(source, source.replace(lineComment, ""), normalize)).not.toBeNull();
    });

    it("refuses a result that lost a block comment", () => {
        expect(validateFormatting(source, source.replace(blockComment, ""), normalize)).not.toBeNull();
    });

    it("refuses a result that gained a comment", () => {
        expect(validateFormatting(source, `${source}// extra\n`, normalize)).not.toBeNull();
    });

    it("refuses a result that reworded a comment", () => {
        expect(validateFormatting(source, source.replace("line note", "line notes"), normalize)).not.toBeNull();
        expect(validateFormatting(source, source.replace("block note", "block nope"), normalize)).not.toBeNull();
    });

    it("refuses a result that swapped two comments", () => {
        const swapped = source
            .replace(lineComment, "@@")
            .replace(blockComment, lineComment)
            .replace("@@", blockComment);
        expect(validateFormatting(source, swapped, normalize)).not.toBeNull();
    });

    it("accepts the blanks a formatter adjusts around and inside a comment", () => {
        const reflowed = source
            .replace(lineComment, `//   ${lineComment.slice(3)}   `)
            .replace(blockComment, `/*${blockComment.slice(2, -2).trim()}*/`);
        expect(validateFormatting(source, reflowed, normalize)).toBeNull();
    });

    it("accepts a multi-line block comment whose edge blanks moved", () => {
        const before = `${source}/*   first\n  second   */\n`;
        const after = `${source}/* first\n  second */\n`;
        expect(validateFormatting(before, after, normalize)).toBeNull();
    });

    it("accepts a comment moved to another line", () => {
        const moved = source.replace(` ${lineComment}\n`, `\n${lineComment}\n`);
        expect(validateFormatting(source, moved, normalize)).toBeNull();
    });
});

describe("content guard comments: text that only looks like a comment", () => {
    it("does not read a // inside a string as a comment", () => {
        expect(validateFormatting("PRINT ~http://x~", "PRINT ~http://x~", stripCommentsWeidu)).toBeNull();
        expect(validateFormatting("PRINT ~http://x~", "PRINT ~http:/x~", stripCommentsWeidu)).not.toBeNull();
    });
});

describe("content guard: Fallout MSG", () => {
    it("refuses a result that lost a note between entries", () => {
        expect(
            validateFormatting("{1}{}{a}\nnote\n{2}{}{b}\n", "{1}{}{a}\n{2}{}{b}\n", stripCommentsFalloutMsg),
        ).not.toBeNull();
    });

    it("refuses a result that reworded a note", () => {
        expect(validateFormatting("{1}{}{a}\nnote\n", "{1}{}{a}\nnotes\n", stripCommentsFalloutMsg)).not.toBeNull();
    });

    it("accepts a note whose trailing blanks were trimmed", () => {
        expect(validateFormatting("{1}{}{a}\nnote   \n", "{1}{}{a}\nnote\n", stripCommentsFalloutMsg)).toBeNull();
    });

    it("refuses an audio name changed beyond trimming", () => {
        expect(validateFormatting("{1}{a.acm}{x}\n", "{1}{b.acm}{x}\n", stripCommentsFalloutMsg)).not.toBeNull();
        expect(validateFormatting("{1}{a.acm}{x}\n", "{1}{}{x}\n", stripCommentsFalloutMsg)).not.toBeNull();
    });

    it("accepts an audio name trimmed of its padding", () => {
        expect(validateFormatting("{1}{ a.acm  }{x}\n", "{1}{a.acm}{x}\n", stripCommentsFalloutMsg)).toBeNull();
    });

    it("refuses a changed entry that is indented", () => {
        expect(validateFormatting("  {1}{}{a}\n", "  {1}{}{b}\n", stripCommentsFalloutMsg)).not.toBeNull();
    });

    it("refuses a changed entry that follows a note on its line", () => {
        expect(validateFormatting("note {1}{}{a}\n", "note {1}{}{b}\n", stripCommentsFalloutMsg)).not.toBeNull();
    });

    it("refuses a changed entry that follows another group on its line", () => {
        expect(
            validateFormatting("{1}{}{a} {2}{}{b}\n", "{1}{}{a} {2}{}{c}\n", stripCommentsFalloutMsg),
        ).not.toBeNull();
    });
});

describe("content guard: TRA scanning matches the grammar", () => {
    it("ends a block comment at its own closer, as the grammar nests them", () => {
        const source = "/* a /* b */ ~p  q~ */\n@1 = ~x~\n";
        // The blanks are inside the comment, so a formatter may change them.
        expect(validateFormatting(source, source.replace("p  q", "p q"), stripCommentsTra)).toBeNull();
    });

    it("refuses a nested comment lost whole", () => {
        const source = "/* a /* b */ c */\n@1 = ~x~\n";
        expect(validateFormatting(source, "@1 = ~x~\n", stripCommentsTra)).not.toBeNull();
    });

    it("reads a backslash in a double-quoted string as an ordinary character", () => {
        // The string ends at the second quote, so what follows is code and a comment, not string content.
        const source = '@1 = "a\\" // note\n@2=~b~\n';
        expect(validateFormatting(source, '@1 = "a\\" // note\n@2 = ~b~\n', stripCommentsTra)).toBeNull();
        expect(validateFormatting(source, '@1 = "a\\"\n@2=~b~\n', stripCommentsTra)).not.toBeNull();
    });
});

describe("content guard: Fallout SSL character constants", () => {
    it("keeps the string after a '\"' constant a string", () => {
        const source = 'x := \'"\'; y := "BEGIN";\n';
        const recased = 'x := \'"\'; y := "begin";\n';
        expect(validateFormatting(source, recased, stripCommentsForCompareFalloutSsl)).not.toBeNull();
    });

    it("still folds the case of a keyword after a '\"' constant", () => {
        const source = "x := '\"'; BEGIN\n";
        expect(validateFormatting(source, "x := '\"'; begin\n", stripCommentsForCompareFalloutSsl)).toBeNull();
    });
});
