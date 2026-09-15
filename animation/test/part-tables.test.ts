/**
 * Merging a member's files into one cycle table.
 *
 * The unmirrored layouts are the reason this exists: the base file stores the western facings and pads the
 * eastern slots, its twin does the reverse, and a reader that took either alone would report half the
 * picture as unstored.
 */
import { describe, expect, it } from "vitest";
import { type PartTables, mergeParts } from "../src/animation-schemes/part-tables";

/**
 * `lengths` gives each cycle's frame count; a cycle's refs are distinct unless it is one frame long.
 *
 * `from` offsets the refs so two parts of the same shape are still tellable apart - without it a merge
 * that took the wrong part would produce the same numbers and every assertion here would hold either way.
 */
function part(lengths: readonly number[], from = 0, area = 40): PartTables {
    let next = from;
    const sequences = lengths.map((length) => ({
        frameRefs: Array.from({ length }, () => next++),
        facing: "none" as const,
    }));
    return { sequences, frameCount: next, frameAreas: Array.from({ length: next }, () => area) };
}

/** A padded slot: one frame repeated, which is what a file carries where it stores no facing. */
function padded(lengths: readonly number[], padAt: readonly number[], from = 0): PartTables {
    const table = part(lengths, from);
    for (const cycle of padAt) {
        const sequence = table.sequences[cycle];
        if (sequence !== undefined) sequence.frameRefs = sequence.frameRefs.map(() => from);
    }
    return table;
}

describe("mergeParts", () => {
    it("has nothing to merge for no parts", () => {
        expect(mergeParts([])).toBeUndefined();
    });

    it("takes each cycle from the part that draws it", () => {
        const base = padded([4, 4, 4, 4], [2, 3]);
        const east = padded([4, 4, 4, 4], [0, 1], 100);

        const merged = mergeParts([base, east]);

        expect(merged?.sequences[0]?.frameRefs).toEqual(base.sequences[0]?.frameRefs);
        expect(merged?.sequences[3]?.frameRefs).toEqual(east.sequences[3]?.frameRefs);
        expect(merged?.holdsArt).toEqual([true, true, true, true]);
    });

    it("follows the longest part's table, so a twin's later cycles are reachable", () => {
        const merged = mergeParts([part([4, 4]), part([4, 4, 4, 4], 100)]);

        expect(merged?.sequences).toHaveLength(4);
    });

    /**
     * A one-frame cycle repeats its only ref, which is exactly what a padded slot looks like - so a member
     * whose files are ALL stills has no drawing part anywhere, and taking the spine's own entry would leave
     * the twin's facings out of the picture. The pixel composer falls back to every part here; this falls
     * back to the part that holds pixels, which is the same choice narrowed to one sequence.
     */
    it("takes a still from the part that holds pixels for it, where no part draws", () => {
        const base: PartTables = { ...part([1, 1]), frameAreas: [40, 1] };
        const east: PartTables = { ...part([1, 1], 100), frameAreas: [] };
        east.frameAreas[100] = 1;
        east.frameAreas[101] = 40;

        const merged = mergeParts([base, east]);

        expect(merged?.sequences[0]?.frameRefs).toEqual(base.sequences[0]?.frameRefs);
        expect(merged?.sequences[1]?.frameRefs).toEqual(east.sequences[1]?.frameRefs);
        expect(merged?.holdsArt).toEqual([true, true]);
    });

    /**
     * Which parts supplied a cycle is what says the files divide a picture between them - the shape only
     * the unmirrored schemes take. A spatial split hands every cycle to the same part, since its quarters
     * all draw the same moments, so it must not read as one.
     */
    it("counts the parts that supplied a cycle", () => {
        const paired = mergeParts([padded([4, 4], [1]), padded([4, 4], [0], 100)]);
        const quarters = mergeParts([part([4, 4]), part([4, 4], 100), part([4, 4], 200)]);

        expect(paired?.contributors).toBe(2);
        expect(quarters?.contributors).toBe(1);
        expect(mergeParts([part([4, 4])])?.contributors).toBe(1);
    });

    it("reports a cycle no part holds pixels for as drawing nothing", () => {
        const blank: PartTables = { ...part([1, 1]), frameAreas: [1, 1] };

        expect(mergeParts([blank])?.holdsArt).toEqual([false, false]);
    });
});
