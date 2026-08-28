/**
 * Line-provenance arithmetic (transpilers/common/line-map.ts).
 *
 * Pure array and string work - the passes that produce these maps are covered in bundle-output.test.ts
 * and enum-transform.test.ts, and their composition through a real bundling run is not asserted here
 * because the map only names a line of the bundler's own output until its source map is read.
 */
import { describe, expect, it } from "vitest";
import { composeLineMaps, lineCount } from "../common/line-map";

describe("lineCount", () => {
    it("counts no lines in an empty string", () => {
        expect(lineCount("")).toBe(0);
    });

    it("treats a trailing newline as ending the last line, not starting another", () => {
        expect(lineCount("a\nb\n")).toBe(2);
    });

    it("counts a final line that runs to the end without a newline", () => {
        expect(lineCount("a\nb")).toBe(2);
    });

    it("counts a blank line between two others", () => {
        expect(lineCount("a\n\nb\n")).toBe(3);
    });
});

describe("composeLineMaps", () => {
    it("resolves the second pass's lines through the first", () => {
        // First pass kept input lines 2 and 3; second kept only its own line 1, i.e. input line 3.
        expect(composeLineMaps([2, 3], [1])).toEqual([3]);
    });

    it("carries a repeated origin through, which is how one statement becomes several lines", () => {
        expect(composeLineMaps([5, 6], [0, 0, 1])).toEqual([5, 5, 6]);
    });

    it("keeps a line the first pass never reported rather than losing its origin", () => {
        // A second pass that grew the text past what the first described still yields a usable number.
        expect(composeLineMaps([4], [0, 1])).toEqual([4, 1]);
    });

    it("composes to nothing when the second pass kept nothing", () => {
        expect(composeLineMaps([0, 1, 2], [])).toEqual([]);
    });
});
