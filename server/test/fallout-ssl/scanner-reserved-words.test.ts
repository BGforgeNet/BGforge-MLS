/**
 * The SSL external scanner keeps its own copy of the grammar's reserved words: it decides which macro parameters
 * it reads (a parameter spelled like a reserved word) and C cannot read grammar.js. A word missing from the copy
 * leaves a macro using that parameter in error; a word only in the copy turns an ordinary parameter into a scanner
 * token. Both lists are read as source text, so this needs no build.
 */

import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const GRAMMAR_DIR = path.resolve(__dirname, "../../../grammars/fallout-ssl");

/** The quoted words between `marker`, which opens a list, and the first `close` after it. */
function quotedList(file: string, marker: string, close: string): string[] {
    const text = readFileSync(path.join(GRAMMAR_DIR, file), "utf8");
    const start = text.indexOf(marker);
    expect(start, `${marker} not found in ${file}`).toBeGreaterThanOrEqual(0);
    const body = text.slice(start + marker.length, text.indexOf(close, start + marker.length));
    return [...body.matchAll(/"(\w+)"/g)].map((match) => match[1]!);
}

describe("SSL scanner reserved words", () => {
    it("match RESERVED_WORDS in grammar.js", () => {
        const grammar = quotedList("grammar.js", "const RESERVED_WORDS = [", "]");
        const scanner = quotedList("src/scanner.c", "RESERVED_WORDS[] = {", "}");

        expect(grammar.length).toBeGreaterThan(0);
        expect([...scanner].sort()).toEqual([...grammar].sort());
    });
});
