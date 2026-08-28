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
import { LineIndex } from "../common/line-index";
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
