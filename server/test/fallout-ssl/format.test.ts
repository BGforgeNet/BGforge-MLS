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
