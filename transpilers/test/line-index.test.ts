/**
 * Position-to-line lookup (transpilers/common/line-index.ts).
 *
 * The transpilers record a line for every emitted condition, action and statement, and read it from
 * ts-morph's `Node.getStartLineNumber()`. That counts newlines from character 0 on EVERY call, with no
 * cache (`@ts-morph/common` `StringUtils.getLineNumberAtPos`), so annotating a file costs time
 * quadratic in its size. This index pays one scan per file and answers each lookup by binary search.
 *
 * The oracle here is a naive newline count - deliberately the same algorithm the index replaces. For a
 * change whose whole point is "same answers, cheaper", the linear scan IS the specification, and the
 * property test is what covers the position classes hand-written cases miss. Agreement with ts-morph's
 * own numbering is pinned end-to-end by tbaf-source-map, td-source-map and error-positions, which
 * assert real line numbers through the transpile.
 */
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import * as fs from "fs";
import * as path from "path";
import { LineIndex, lineIndexFor, lineNumberOfNode } from "../common/line-index";
import { REPO_ROOT } from "./repo-root";

/** The behaviour being preserved: 1-based, counting newlines strictly before `pos`. */
function referenceLineNumberAt(text: string, pos: number): number {
    let count = 0;
    for (let i = 0; i < pos; i++) {
        if (text.codePointAt(i) === 10) count++;
    }
    return count + 1;
}

describe("LineIndex", () => {
    it("answers 1 for the first character", () => {
        expect(new LineIndex("alpha\nbeta\n").lineNumberAt(0)).toBe(1);
    });

    it("answers 1 for position 0 of an empty text", () => {
        expect(new LineIndex("").lineNumberAt(0)).toBe(1);
    });

    it("counts a newline as ending its own line, so a position at one stays on that line", () => {
        // In "a\nb", position 1 IS the newline. Newlines strictly before it number zero, so this is
        // still line 1 - the off-by-one a boundary-inclusive binary search gets wrong in exactly here.
        const index = new LineIndex("a\nb");
        expect(index.lineNumberAt(1)).toBe(1);
        expect(index.lineNumberAt(2)).toBe(2);
    });

    it("advances a line across a blank line", () => {
        const text = "a\n\nb";
        expect(new LineIndex(text).lineNumberAt(text.indexOf("b"))).toBe(3);
    });

    it("treats CRLF as the one line break its newline makes", () => {
        const text = "a\r\nb\r\nc";
        const index = new LineIndex(text);
        expect(index.lineNumberAt(text.indexOf("b"))).toBe(2);
        expect(index.lineNumberAt(text.indexOf("c"))).toBe(3);
    });

    it("answers for a position at the very end of the text", () => {
        const text = "a\nb\n";
        expect(new LineIndex(text).lineNumberAt(text.length)).toBe(3);
    });

    it("reports a 1-based column measured from the start of the line", () => {
        // ts-morph's shape: column = pos - lineStart + 1. The call sites subtract 1 for a 0-based
        // column, so this has to be 1-based for the same reason lineNumberAt is.
        const index = new LineIndex("ab\ncdef");
        expect(index.lineAndColumnAt(0)).toEqual({ line: 1, column: 1 });
        expect(index.lineAndColumnAt(1)).toEqual({ line: 1, column: 2 });
        expect(index.lineAndColumnAt(3)).toEqual({ line: 2, column: 1 });
        expect(index.lineAndColumnAt(6)).toEqual({ line: 2, column: 4 });
    });

    it("reports column 1 on an empty line", () => {
        const text = "a\n\nb";
        expect(new LineIndex(text).lineAndColumnAt(2)).toEqual({ line: 2, column: 1 });
    });

    it("rejects a position outside the text rather than answering a wrong line", () => {
        const index = new LineIndex("a\nb");
        expect(() => index.lineNumberAt(-1)).toThrow(/range/i);
        expect(() => index.lineNumberAt(4)).toThrow(/range/i);
    });

    it("matches a newline count at every position of a real source file", () => {
        // A committed fixture rather than the external/ corpus, so this stays a hermetic unit test.
        const text = fs.readFileSync(path.join(REPO_ROOT, "transpilers/test/fixtures/iets-shape/main.tbaf"), "utf-8");
        expect(text.length).toBeGreaterThan(200);
        const index = new LineIndex(text);
        for (let pos = 0; pos <= text.length; pos++) {
            expect(index.lineNumberAt(pos)).toBe(referenceLineNumberAt(text, pos));
        }
    });

    it("matches a newline count for any text and any position in it", () => {
        fc.assert(
            fc.property(
                // Drawn from a newline-heavy alphabet: uniform random text is almost all
                // single-line, which never exercises the search.
                fc.string({ unit: fc.constantFrom("a", "b", "\n", "\r\n", "\n\n"), maxLength: 60 }),
                fc.nat(),
                (text: string, offset: number) => {
                    const pos = text.length === 0 ? 0 : offset % (text.length + 1);
                    expect(new LineIndex(text).lineNumberAt(pos)).toBe(referenceLineNumberAt(text, pos));
                },
            ),
        );
    });
});

/**
 * The accessor is driven here through a stub rather than a real SourceFile: this package's tests do not
 * depend on ts-morph, and the behaviour under test is the invalidation, which is defined purely in terms
 * of what getFullText() returns. Real ts-morph nodes reach it through the td and tbaf source-map suites.
 */
describe("lineIndexFor", () => {
    it("answers from the file's own text", () => {
        const file = { getFullText: () => "a\nb\nc" };
        expect(lineIndexFor(file).lineNumberAt(4)).toBe(3);
    });

    it("reuses one index while the text is unchanged", () => {
        const file = { getFullText: () => "a\nb\nc" };
        expect(lineIndexFor(file)).toBe(lineIndexFor(file));
    });

    it("rebuilds after the file's text changes", () => {
        // ts-morph hands back a new string once a manipulation reparses the file, and an index kept from
        // before would answer against text that no longer exists. This is the case that makes the cache
        // safe to use next to code that mutates a source file.
        let text = "a\nb\nc";
        const file = { getFullText: () => text };
        const first = lineIndexFor(file);
        expect(first.lineNumberAt(4)).toBe(3);

        text = "\n\n\n\na\nb\nc";
        const second = lineIndexFor(file);
        expect(second).not.toBe(first);
        expect(second.lineNumberAt(4)).toBe(5);
    });

    it("keeps separate indexes for separate files", () => {
        const one = { getFullText: () => "a\nb" };
        const two = { getFullText: () => "\n\n\na\nb" };
        expect(lineIndexFor(one).lineNumberAt(2)).toBe(2);
        expect(lineIndexFor(two).lineNumberAt(2)).toBe(3);
    });
});

describe("lineNumberOfNode", () => {
    it("answers the 1-based line a node starts on", () => {
        const sourceFile = { getFullText: () => "a\nb\ntarget" };
        expect(lineNumberOfNode({ getStart: () => 4, getSourceFile: () => sourceFile })).toBe(3);
    });

    it("counts from 1, so the callers' existing minus-one arithmetic still lands on a 0-based line", () => {
        // Every call site subtracts 1 from what ts-morph returned. A helper counting from 0 would
        // shift every diagnostic and source-map entry by a line, silently and everywhere at once.
        const sourceFile = { getFullText: () => "first\nsecond" };
        expect(lineNumberOfNode({ getStart: () => 0, getSourceFile: () => sourceFile })).toBe(1);
    });
});
