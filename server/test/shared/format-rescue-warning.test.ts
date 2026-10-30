/**
 * The notice a formatter reports when `restoreLostComments` had to write a comment back: one per format call, naming
 * where each moved comment was. The file is formatted, so it is a `notice`, not a `warning` (a refusal). The
 * formatters keep every comment in place or in source order, so a real input reaches the net only through a formatter
 * defect (the comment-insertion fuzz finds none); these tests drive it with a rebuilt text that lacks, or reorders,
 * the comments.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { initParser, getParser } from "@bgforge/shared/parsers/fallout-ssl";
import { initParser as initTp2, getParser as getTp2Parser } from "@bgforge/shared/parsers/weidu-tp2";
import { reportRescuedComments, restoreLostComments } from "../../../format/src/format-utils";

beforeAll(async () => {
    await initParser();
});

const SOURCE = "procedure p begin\n    x := a /* c */ + b;\n    y := (c // d\n        + e);\nend\n";
const REBUILT = "procedure p begin\n    x := a + b;\n    y := (c + e);\nend\n";

/** Runs the net over the SSL `source` as if a formatter had written `rebuilt` for it. */
function rescue(source: string, rebuilt: string): { text: string; notice?: string; warning?: string } {
    const root = getParser().parse(source)!.rootNode;
    return reportRescuedComments(() => ({ text: restoreLostComments(root, rebuilt, false, "", false) }));
}

describe("reportRescuedComments", () => {
    it("reports nothing when no comment was lost", () => {
        const result = rescue(SOURCE, SOURCE);
        expect(result.notice).toBeUndefined();
        expect(result.warning).toBeUndefined();
        expect(result.text).toBe(SOURCE);
    });

    it("names the position and the node of a comment it wrote back", () => {
        const result = rescue(
            "procedure p begin\n    x := a /* c */ + b;\nend\n",
            "procedure p begin\n    x := a + b;\nend\n",
        );
        expect(result.notice).toBe(
            "a comment was moved because the formatter would have dropped it: line 2, column 12 (comment in binary_expr, rebuilt source_file)",
        );
        expect(result.text).toContain("/* c */");
        // The file is formatted, not refused: `warning` stays for a refusal.
        expect(result.warning).toBeUndefined();
    });

    it("reports several comments in one notice", () => {
        const result = rescue(SOURCE, REBUILT);
        expect(result.notice).toBe(
            "2 comments were moved because the formatter would have dropped them: " +
                "line 2, column 12 (comment in binary_expr, rebuilt source_file); " +
                "line 3, column 13 (comment in binary_expr, rebuilt source_file)",
        );
    });

    it("lists the first five comments and counts the rest", () => {
        const comments = Array.from({ length: 7 }, (_, i) => `    x${i} := a /* c${i} */ + b;`);
        const source = `procedure p begin\n${comments.join("\n")}\nend\n`;
        const rebuilt = `procedure p begin\n${comments.map((_, i) => `    x${i} := a + b;`).join("\n")}\nend\n`;
        const notice = rescue(source, rebuilt).notice ?? "";
        expect(notice.startsWith("7 comments were moved because the formatter would have dropped them: line 2, ")).toBe(
            true,
        );
        expect(notice.endsWith(", and 2 more")).toBe(true);
        expect(notice.split("; ")).toHaveLength(5);
    });

    it("does not read comments written in another order as lost", () => {
        const source = "procedure p begin\n    x := a /* c */ + b; // d\nend\n";
        const reordered = "procedure p begin\n    // d\n    x := a /* c */ + b;\nend\n";
        const result = rescue(source, reordered);
        expect(result.notice).toBeUndefined();
        expect(result.text).toBe(reordered);
    });

    it("writes a lost comment once even when it is also written in another order", () => {
        const source = "procedure p begin\n    x := a /* c */ + b; // d\n    y := 1; /* e */\nend\n";
        const rebuilt = "procedure p begin\n    // d\n    x := a + b;\n    y := 1; /* e */\nend\n";
        const result = rescue(source, rebuilt);
        expect(result.text.match(/\/\* c \*\//g)).toHaveLength(1);
        expect(result.text.match(/\/\/ d/g)).toHaveLength(1);
        expect(result.notice).toMatch(/^a comment was moved/);
    });

    // The comment after the string goes above the line it is on, which starts inside the string: that line is not a
    // place for a comment, so it goes above the line the string starts on.
    it("does not write a lost comment inside a multi-line string", async () => {
        await initTp2();
        const source = "BEGIN ~c~\nOUTER_SET x = 1 /* a */\nOUTER_SET y = ~p\nq~ /* b */\n";
        const rebuilt = "BEGIN ~c~\nOUTER_SET x = 1\nOUTER_SET y = ~p\nq~ /* b */\n";
        const root = getTp2Parser().parse(source)!.rootNode;
        const result = reportRescuedComments(() => ({ text: restoreLostComments(root, rebuilt, true, "", false) }));
        expect(result.text).toBe("BEGIN ~c~\nOUTER_SET x = 1\n/* a */\nOUTER_SET y = ~p\nq~ /* b */\n");
    });

    it("starts a new count for each call", () => {
        rescue(SOURCE, REBUILT);
        expect(rescue(SOURCE, SOURCE).notice).toBeUndefined();
    });
});
