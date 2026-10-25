/**
 * The `.tra` entry index (`shared/translation-entry-readers.ts`) restates the TRA grammar's rules in a
 * single-pass scanner, because the index is built before any parser is available. This pins the two together:
 * for every entry the grammar reads without error, the index holds the same entry with the same text, and the
 * index holds nothing the grammar does not read as an entry.
 *
 * It runs over a set of probes covering every form the grammar reads, and over every real `.tra` file when the
 * corpus is checked out (`pnpm test:external`).
 */

import { readFileSync } from "node:fs";
import * as fg from "fast-glob";
import type { Node as SyntaxNode } from "web-tree-sitter";
import { beforeAll, describe, expect, it } from "vitest";
import * as weiduTra from "@bgforge/shared/parsers/weidu-tra";
import { readTraEntries } from "@bgforge/shared/translation-entry-readers";
import { IE_FIXTURES } from "./test-helpers";

// The TRA grammar generates no node-type enum (no provider keys on its nodes), so the names are spelled here.
const REFERENCE_NODES = new Set(["string_ref", "trans_ref", "at_ref"]);

interface Reading {
    key: string;
    source: string;
}

/** The text a string node holds, delimiters off. */
function stringText(node: SyntaxNode): string {
    switch (node.type) {
        case "tilde_string":
            return node.text.startsWith("~~~~~") && node.text.length >= 10
                ? node.text.slice(5, -5)
                : node.text.slice(1, -1);
        case "double_string":
        case "percent_string":
            return node.text.slice(1, -1);
        case "concat_string":
            return node.namedChildren.map((child) => stringText(child)).join("");
        default:
            return node.text;
    }
}

/** The entries the grammar reads without error and with a string value, by start offset. */
function treeReadings(text: string): Map<number, Reading> {
    const tree = weiduTra.getParser().parse(text)!;
    const readings = new Map<number, Reading>();
    for (const entry of tree.rootNode.namedChildren) {
        if (entry.type !== "entry" || entry.hasError) continue;
        const value = entry.childForFieldName("text");
        if (value === null) continue;
        if (REFERENCE_NODES.has(value.type)) continue;
        readings.set(entry.startIndex, {
            key: entry.childForFieldName("number")!.text,
            source: stringText(value),
        });
    }
    tree.delete();
    return readings;
}

/** Compare one text; returns the differences, empty when the two agree. */
function differences(text: string): string[] {
    const fromTree = treeReadings(text);
    const fromIndex = new Map(readTraEntries(text).map((entry) => [entry.start, entry]));
    const problems: string[] = [];
    for (const [start, reading] of fromTree) {
        const indexed = fromIndex.get(start);
        if (indexed === undefined)
            problems.push(`@${reading.key} at ${start}: the grammar reads it, the index does not`);
        else if (indexed.key !== reading.key || indexed.source !== reading.source) {
            problems.push(
                `@${reading.key} at ${start}: the index reads ${JSON.stringify(indexed.source)}, the grammar ${JSON.stringify(reading.source)}`,
            );
        }
    }
    for (const [start, indexed] of fromIndex) {
        const isReference = indexed.refersTo !== undefined || /^(#|\(AT|@)/.test(indexed.source);
        if (!fromTree.has(start) && !isReference) {
            problems.push(`@${indexed.key} at ${start}: the index reads it, the grammar does not`);
        }
    }
    return problems;
}

const PROBES: ReadonlyArray<readonly [string, string]> = [
    ["tilde, double and percent strings", '@1 = ~a~\n@2 = "b"\n@3 = %c%\n'],
    ["a five-tilde string with tildes", "@1 = ~~~~~a ~ b ~~ c~~~~~\n@2 = ~x~\n"],
    ["empty strings", '@1 = ~~\n@2 = ~~~~~~~~~~\n@3 = ""\n'],
    ["negative number", "@-5 = ~x~\n"],
    ["concatenation", '@1 = ~a~ ^ "b" ^ bare ^ %c%\n@2 = ~x~\n'],
    ["a bare word", "@1 = bare\n@2 = ~x~ [S]ND\n"],
    ["sounds and a female string", "@1 = ~m~ [S1] ~f~ [S2]\n@2 = ~x~\n"],
    ["multi-line strings", '@1 = ~a\nb~\n@2 = "c\nd"\n@3 = %e\nf%\n'],
    ["an entry inside a string", '@1 = "has\n@9 = ~x~ inside"\n@2 = ~y~\n'],
    ["an entry inside a line comment", "// @1 = ~old~\n@2 = ~live~\n"],
    ["an entry inside nested block comments", "/* a /* @1 = ~x~ */ @2 = ~y~ */\n@3 = ~live~\n"],
    ["comments inside an entry", "@1 /* c */ = /* d */ ~a~ /* e */ [S] // f\n@2 = ~x~\n"],
    ["comment markers inside strings", '@1 = ~a // b /* c~\n@2 = "x /* y"\n@3 = %p // q%\n'],
    ["references as values", "@1 = ~one~\n@2 = @1\n@3 = #5\n@4 = (AT ~sym~)\n@5 = ~five~\n"],
    ["an entry still being typed", "@1 =\n@2 = ~two~\n"],
    ["an entry with a reference then the next entry", "@1 = @2\n@2 = ~x~\n"],
    ["an unclosed double quote", '@1 = ~one~\n@2 = "oops\n@3 = ~three~\n@4 = %four%\n'],
    ["an unclosed percent string", "@1 = %oops\n@2 = ~two~\n"],
    ["an unclosed tilde string before entries", "@1 = ~oops\n@2 = ~two~\n"],
    ["an unclosed block comment", "@1 = ~one~\n/* oops\n@2 = ~two~\n@3 = ~three~\n"],
    ["an unclosed block comment holding a closer later", "@1 = ~one~\n/* a\n@2 = ~two~\n*/\n@3 = ~three~\n"],
    ["an unclosed double quote holding a pairing quote below", '@1 = "a\n@2 = "b"\n'],
    ["a space after @", "@ 1 = ~x~\n"],
    ["CRLF line ends", "@1 = ~a~\r\n// c\r\n@2 = ~b~\r\n"],
];

describe("translation index against the TRA grammar", () => {
    beforeAll(async () => {
        await weiduTra.initParser();
    });

    it.each(PROBES)("agrees on %s", (_name, text) => {
        expect(differences(text)).toEqual([]);
    });

    const files = fg.sync("**/*.tra", { cwd: IE_FIXTURES, absolute: true, caseSensitiveMatch: false }).sort();

    it.skipIf(files.length === 0)(`agrees on every real file (${files.length} files)`, () => {
        const disagreeing: string[] = [];
        let compared = 0;
        for (const file of files) {
            const text = readFileSync(file, "utf8");
            compared += treeReadings(text).size;
            const problems = differences(text);
            if (problems.length > 0) disagreeing.push(`${file.slice(IE_FIXTURES.length + 1)}: ${problems[0]}`);
        }
        expect(disagreeing).toEqual([]);
        // A sweep that compared nothing agrees with everything.
        expect(compared).toBeGreaterThan(files.length);
    });
});
