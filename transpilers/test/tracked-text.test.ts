/**
 * Building emitted text while remembering which input line each output line came from.
 *
 * The emitters assemble their output from chunks that do not line up with lines: one chunk can be several
 * lines, and several chunks can land on one line. This is the bookkeeping that turns those chunks into a
 * per-line answer, so a diagnostic against the generated file can be traced back.
 */
import { describe, it, expect } from "vitest";
import { TrackedText } from "../common/tracked-text";

describe("TrackedText", () => {
    it("gives back exactly the text that was added", () => {
        const out = new TrackedText();
        out.add("procedure start begin\n", 4);
        out.add("end\n", 6);
        expect(out.text).toBe("procedure start begin\nend\n");
    });

    it("reports the origin of each line", () => {
        const out = new TrackedText();
        out.add("procedure start begin\n", 4);
        out.add("end\n", 6);
        expect(out.origins).toEqual([4, 6]);
    });

    it("gives every line of a multi-line chunk the same origin", () => {
        const out = new TrackedText();
        out.add("IF\nTHEN\nEND\n", 11);
        expect(out.origins).toEqual([11, 11, 11]);
    });

    it("credits a line to the chunk that started it, not the one that finished it", () => {
        // Emitters build a line piecewise - a keyword, then its arguments. The line belongs where it
        // began; taking the last chunk instead would name whatever happened to close it.
        const out = new TrackedText();
        out.add("variable x", 7);
        out.add(" := 1;\n", 9);
        expect(out.text).toBe("variable x := 1;\n");
        expect(out.origins).toEqual([7]);
    });

    it("counts a trailing line that was never terminated", () => {
        const out = new TrackedText();
        out.add("end", 3);
        expect(out.origins).toEqual([3]);
        expect(out.text).toBe("end");
    });

    it("records no origin where a chunk had none to give", () => {
        const out = new TrackedText();
        out.add("/* generated */\n");
        out.add("procedure start begin end\n", 2);
        expect(out.origins).toEqual([undefined, 2]);
    });

    it("keeps a blank line as its own line", () => {
        const out = new TrackedText();
        out.add("a\n\nb\n", 1);
        expect(out.text).toBe("a\n\nb\n");
        expect(out.origins).toEqual([1, 1, 1]);
    });

    it("ignores an empty chunk rather than opening a line for it", () => {
        const out = new TrackedText();
        out.add("", 5);
        out.add("a\n", 8);
        expect(out.origins).toEqual([8]);
    });

    it("reports one origin per line of the text it produced", () => {
        const out = new TrackedText();
        out.add("#define A 1\n#define B 2\n", 1);
        out.add("\n");
        out.add("procedure start begin\n    x := 1;\nend\n", 10);
        const lineCount = out.text.split("\n").length - 1;
        expect(out.origins).toHaveLength(lineCount);
    });
});
