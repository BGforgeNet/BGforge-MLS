/**
 * Unit tests for the Fallout SSL formatter's loop headers.
 *
 * `foreach` writes its head four ways over two independent options - parentheses or none, a single loop
 * variable or a `key: value` pair - plus an optional `variable` keyword and an optional `while` guard.
 * The formatter has to reproduce whichever combination the source used: the corpus sweep catches a
 * changed head only when a real script happens to write that form, and most of these it never does.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { initParser, getParser } from "../../../shared/parsers/fallout-ssl";
import { formatFalloutSsl as formatDocument } from "@bgforge/format";

beforeAll(async () => {
    await initParser();
});

function format(input: string): string {
    const parser = getParser();
    const tree = parser.parse(input);
    return formatDocument(tree!.rootNode).text;
}

/** Wraps a statement in the shortest compilable script, so the formatter sees it in statement position. */
function header(statement: string): string {
    const output = format(`procedure start begin\n${statement}\nend\n`);
    return output.split("\n").find((line) => line.trim().startsWith("foreach")) ?? "";
}

describe("fallout-ssl formatter: foreach headers", () => {
    it("leaves a paren-less head unparenthesised", () => {
        expect(header("foreach obj in list_as_array(0) begin end")).toContain("foreach obj in list_as_array(0)");
        expect(header("foreach obj in list_as_array(0) begin end")).not.toContain("foreach (");
    });

    it("keeps the parentheses the source wrote", () => {
        expect(header("foreach (obj in list_as_array(0)) begin end")).toContain("foreach (obj in list_as_array(0))");
    });

    it("keeps a key: value pair in both forms", () => {
        expect(header("foreach k: v in arr begin end")).toContain("foreach k: v in arr");
        expect(header("foreach (k: v in arr) begin end")).toContain("foreach (k: v in arr)");
    });

    it("keeps the `variable` keyword", () => {
        expect(header("foreach variable obj in arr begin end")).toContain("foreach variable obj in arr");
        expect(header("foreach (variable obj in arr) begin end")).toContain("foreach (variable obj in arr)");
    });

    it("keeps the while guard, which changes the loop's bounds test", () => {
        expect(header("foreach v in arr while (i < 3) begin end")).toContain("while (i < 3)");
        expect(header("foreach (v in arr while (i < 3)) begin end")).toContain("while (i < 3)");
    });
});

/**
 * Keywords are case-insensitive in this language, so `PROCEDURE` and `procedure` are the same token and
 * re-spelling one is not the formatter's decision. It is also not a harmless one: the shared content
 * check compares the text exactly, so a rewritten keyword reads as lost content and the whole file is
 * refused rather than formatted.
 */
describe("fallout-ssl formatter: keyword case", () => {
    const UPPERCASE = [
        "IMPORT VARIABLE g_shared;",
        "EXPORT VARIABLE g_owned := 3;",
        "VARIABLE BEGIN\na := 1;\nEND",
        "PROCEDURE fwd(VARIABLE p := 1);",
        "CRITICAL INLINE PROCEDURE helper BEGIN RETURN 7; END",
        "PROCEDURE timed IN 5 BEGIN RETURN; END",
        "PROCEDURE start BEGIN",
        "VARIABLE x := 5, arr[4];",
        "IF (x > 1) THEN BEGIN x := 2; END ELSE IF (x > 0) THEN x := 3; ELSE BEGIN x := 4; END",
        "WHILE (x > 0) DO BEGIN x -= 1; END",
        "FOR (VARIABLE i := 0; i < 3; i += 1) BEGIN x += i; END",
        "FOREACH VARIABLE obj IN arr BEGIN x += 1; END",
        "FOREACH (k: v IN arr WHILE (x > 0)) BEGIN x -= 1; END",
        "SWITCH (x) BEGIN CASE 1: x := 9; DEFAULT: x := 0; END",
        "CALL helper;",
        "IF (x AND NOT g_owned OR x) THEN x := 1;",
        "END",
    ].join("\n");

    it("changes only whitespace, so the file is formatted rather than refused", () => {
        // The exact check the shared content guard makes, and the reason a re-spelled keyword is not a
        // cosmetic difference: this equality is what decides whether the file is written at all.
        const strip = (text: string) => text.replaceAll(/\s+/g, "");
        expect(strip(format(UPPERCASE))).toBe(strip(UPPERCASE));
    });

    it("emits no keyword in its own canonical lowercase", () => {
        const output = format(UPPERCASE);

        // None of these is a substring of any identifier in the fixture, so a hit is a rewritten
        // keyword rather than incidental text.
        for (const rewritten of [
            "procedure",
            "variable",
            "foreach",
            "switch",
            "begin",
            "end",
            "then",
            "else",
            "call",
            "default",
            "import",
            "export",
        ]) {
            expect(output).not.toContain(rewritten);
        }
    });

    it("still reindents an uppercase script", () => {
        expect(format(UPPERCASE)).toContain("\n    VARIABLE x := 5, arr[4];");
    });

    it("keeps `:=` in a for-loop declaration rather than rewriting it to `=`", () => {
        const output = format("PROCEDURE start BEGIN\nfor (variable i := 0; i < 3; i += 1) begin end\nEND");
        expect(output).toContain("variable i := 0");
    });
});
