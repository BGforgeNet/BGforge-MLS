/**
 * The SSL formatter canonicalises keyword casing, so it carries a list of the language's keywords. That
 * list is a transcription of the grammar's generated node types; this pins it there, so a grammar change
 * that adds or removes a keyword fails here rather than silently leaving the formatter behind.
 */

import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { KEYWORDS_FOR_TEST, stripCommentsForCompareFalloutSsl } from "../src/fallout-ssl/canonical-keyword";
import { validateFormatting } from "../src/format-utils";
import { REPO_ROOT } from "./repo-root";

/** The grammar's anonymous alphabetic tokens are exactly its keywords. */
function keywordsFromGrammar(): Set<string> {
    const nodeTypes = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, "grammars", "fallout-ssl", "src", "node-types.json"), "utf-8"),
    ) as Array<{ type: string; named?: boolean }>;
    return new Set(nodeTypes.filter((n) => !n.named && /^[a-z_]+$/i.test(n.type)).map((n) => n.type));
}

describe("fallout-ssl keyword set", () => {
    it("matches the keywords the grammar declares", () => {
        expect([...KEYWORDS_FOR_TEST].sort()).toEqual([...keywordsFromGrammar()].sort());
    });
});

describe("stripCommentsForCompareFalloutSsl()", () => {
    const compare = (a: string, b: string) => validateFormatting(a, b, stripCommentsForCompareFalloutSsl);

    it("lets a re-spelled keyword through", () => {
        expect(compare("IF x THEN", "if x then")).toBeNull();
    });

    it("still catches a re-cased identifier", () => {
        // The formatter never re-cases one, and the guard has to keep noticing if that ever changes.
        expect(compare("call Check_Areas;", "call check_areas;")).not.toBeNull();
    });

    it("still catches a re-cased string literal", () => {
        expect(compare('x := "Hello";', 'x := "hello";')).not.toBeNull();
    });

    it("still catches dropped content", () => {
        expect(compare("x := 1; y := 2;", "x := 1;")).not.toBeNull();
    });
});
