import { describe, expect, test } from "vitest";
import {
    analyzeCycleGrid,
    cycleGridHint,
    ieGroupOptionText,
    offeredGroups,
} from "../../src/image-editor/webview/render/cycle-grouping";

test("a single directional set (<=8 cycles) is not flagged as multi-sequence", () => {
    for (const n of [1, 4, 6, 8]) {
        expect(analyzeCycleGrid(n)).toEqual({ multiSequence: false, suggestedColumns: 0, resolved: false });
    }
});

test("more than 8 cycles is flagged as multi-sequence with a suggested column count", () => {
    // usar1ca's 64 cycles (8 sequences x 8 directions) - the reported case: suggest 8 columns.
    expect(analyzeCycleGrid(64)).toEqual({ multiSequence: true, suggestedColumns: 8, resolved: false });
});

// The interpretation knows the block size; without it, 9 cycles reads as "more than one set" purely
// because 9 > 8, which is exactly wrong for the commonest creature file there is.
test("a known scheme sets the block size, so one block is never called multi-sequence", () => {
    expect(analyzeCycleGrid(9, "ie9")).toEqual({ multiSequence: false, suggestedColumns: 0, resolved: true });
    expect(analyzeCycleGrid(8, "ie8")).toEqual({ multiSequence: false, suggestedColumns: 0, resolved: true });
});

test("a known scheme suggests its own block size as the column count", () => {
    expect(analyzeCycleGrid(99, "ie9")).toEqual({ multiSequence: true, suggestedColumns: 9, resolved: true });
    expect(analyzeCycleGrid(72, "ie9")).toEqual({ multiSequence: true, suggestedColumns: 9, resolved: true });
    expect(analyzeCycleGrid(72, "ie8")).toEqual({ multiSequence: true, suggestedColumns: 8, resolved: true });
});

test("a count divisible by 6 but not 8 suggests 6 columns", () => {
    expect(analyzeCycleGrid(18)).toEqual({ multiSequence: true, suggestedColumns: 6, resolved: false });
});

/**
 * The hint above the columns box used to say a BAM stores no direction info and the blocks must be laid
 * out by hand - true only where nothing resolved the structure. Where the interpretation DID resolve it
 * the columns are already the file's own stride, and telling the reader to work it out themselves
 * contradicts the block list the same panel is showing.
 */
describe("cycleGridHint", () => {
    test("reports the resolved block structure as a reading, not a guess", () => {
        const hint = cycleGridHint(72, analyzeCycleGrid(72, "ie9"));

        expect(hint).toContain("8 blocks of 9");
        expect(hint).not.toContain("no direction");
    });

    test("says the column count is a guess when nothing resolved the structure", () => {
        const hint = cycleGridHint(64, analyzeCycleGrid(64));

        expect(hint).toContain("64 cycles");
        expect(hint).toContain("guess");
    });
});

// Detection itself (interpretIeDirections) is library code, tested in image/test/ie-direction.test.ts.

// The block NAMES moved to @bgforge/animation with the set browser that also needs them; they are
// covered by animation/test/group-labels.test.ts.

describe("ieGroupOptionText", () => {
    test("combines the scheme name with the group's cycle range", () => {
        const blocks = [{ label: "WK - walk" }, { label: "SC - combat stance" }];
        expect(ieGroupOptionText(blocks, 1)).toBe("SC - combat stance (cycles 8-15)");
    });

    test("falls back to a numbered group without labels", () => {
        expect(ieGroupOptionText(undefined, 0)).toBe("Group 1 (cycles 0-7)");
    });

    // The range is what the user picks a block by, so it has to count in the file's own block size.
    test("counts the range in the scheme's block size", () => {
        expect(ieGroupOptionText(undefined, 1, "ie9")).toBe("Group 2 (cycles 9-17)");
        expect(ieGroupOptionText(undefined, 1, "ie8")).toBe("Group 2 (cycles 8-15)");
    });
});

describe("offeredGroups", () => {
    /**
     * A block the scheme addresses no sequence to is padding the format forces on the file. It still
     * holds a frame per facing, so nothing structural rules it out - only the declaration does, and the
     * stance reader in `@bgforge/animation` drops it on exactly that. Offering it here handed the reader
     * a sequence nothing can play, which the burrowing family opens on.
     */
    test("leaves out a block the scheme addresses no sequence to", () => {
        const blocks = [{ label: "(unused)", unused: true as const }, { label: "DE - die" }, { label: "TW - twitch" }];

        expect(offeredGroups(3, blocks)).toEqual([1, 2]);
    });

    // The index addresses the block in the FILE, so dropping one must not renumber the rest.
    test("keeps each block's own index", () => {
        const blocks = [{ label: "A" }, { label: "(unused)", unused: true as const }, { label: "B" }];

        expect(offeredGroups(3, blocks)).toEqual([0, 2]);
    });

    test("offers every block where the scheme matched none, and where none is unused", () => {
        expect(offeredGroups(3, undefined)).toEqual([0, 1, 2]);
        expect(offeredGroups(2, [{ label: "A" }, { label: "B" }])).toEqual([0, 1]);
    });

    /** The block table can be shorter than the file: a shorter file carries a prefix of the layout. */
    test("offers a block the table says nothing about", () => {
        expect(offeredGroups(3, [{ label: "A" }])).toEqual([0, 1, 2]);
    });
});
