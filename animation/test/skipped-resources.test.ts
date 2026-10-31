import { describe, expect, it } from "vitest";
import { type AnimationSet, buildAnimationIndex, createAnimationIndexResolver } from "../src/animation-index";
import type { GameHandle } from "../src/game-handle";
import { readNeutralSet } from "../src/neutral/read";
import { type SkippedResource, isMalformedResource } from "../src/skipped";
import { setStances, stanceIo, type StanceIo } from "../src/set-stances";
import { multiCycle } from "../../image/test/bam-fixtures.ts";
import { miniGame } from "./ie-game-fixtures";

function characterSet(): AnimationSet {
    return {
        id: 0x6004,
        code: "CGMC",
        name: "CLERIC_MALE_GNOME",
        prefixByArmour: new Map([[1, "CDMB"]]),
        paperdollPrefix: undefined,
        scheme: { kind: "character" },
    };
}

const GARBAGE = new TextEncoder().encode("this is not a BAM file at all");

/** An archive serving `files` by resref; `skipped` is the list its reader records into. */
function archiveOf(files: Record<string, Uint8Array>): StanceIo & { skipped: SkippedResource[] } {
    return {
        exists: (resref) => resref in files,
        read: (resref) => files[resref],
        skipped: [],
    };
}

describe("buildAnimationIndex records what it passed over", () => {
    it("names the one table it could not read, and still indexes every set", () => {
        const game = miniGame();
        const noCodes: GameHandle = {
            ...game,
            read: (resref, type) => {
                if (resref === "ANISND") throw new Error("corrupt archive entry");
                return game.read(resref, type);
            },
        };
        const skipped: SkippedResource[] = [];

        const sets = buildAnimationIndex(noCodes, undefined, skipped);

        expect(skipped).toEqual([{ resource: "ANISND.IDS", reason: "corrupt archive entry" }]);
        expect(sets.find((set) => set.id === 0x6004)?.name).toBe("CLERIC_MALE_GNOME");
    });

    it("records nothing when every resource reads", () => {
        const skipped: SkippedResource[] = [];
        buildAnimationIndex(miniGame(), undefined, skipped);
        expect(skipped).toEqual([]);
    });
});

describe("createAnimationIndexResolver reports what the index passed over", () => {
    it("hands the skipped list and the directory to the reporter, once per build", () => {
        const game = miniGame();
        const noCodes: GameHandle = {
            ...game,
            read: (resref, type) => {
                if (resref === "ANISND") throw new Error("corrupt archive entry");
                return game.read(resref, type);
            },
        };
        const reports: [string, readonly SkippedResource[]][] = [];
        const resolve = createAnimationIndexResolver({ gameAt: () => noCodes }, undefined, (dir, skipped) =>
            reports.push([dir, skipped]),
        );

        resolve("/game");
        resolve("/game");

        expect(reports).toEqual([["/game", [{ resource: "ANISND.IDS", reason: "corrupt archive entry" }]]]);
    });
});

describe("stanceIo records an unreadable member", () => {
    it("names it once however often it is read", () => {
        const io = stanceIo({
            canRead: () => true,
            read: () => {
                throw new Error("corrupt archive entry");
            },
        });

        io.read("TSTBG1");
        io.read("TSTBG1");

        expect(io.skipped).toEqual([{ resource: "TSTBG1.BAM", reason: "corrupt archive entry" }]);
    });
});

describe("setStances records a member whose tables will not parse", () => {
    it("skips the malformed member and still stances the rest of the set", () => {
        const io = archiveOf({ CDMB1G1: multiCycle(4, 8), CDMB1G12: GARBAGE });

        const stances = setStances(characterSet(), 1, io);

        expect(stances).toHaveLength(1);
        expect(io.skipped).toHaveLength(1);
        expect(io.skipped[0]?.resource).toBe("CDMB1G12.BAM");
        expect(io.skipped[0]?.reason).toMatch(/BAM/);
    });
});

describe("readNeutralSet records a member that will not load", () => {
    it("skips it, names it once, and keeps the members that load", () => {
        const good = multiCycle(4, 8);
        // The first read of the bad member feeds the stance layer and parses; the second, from the loader,
        // does not - so the failure belongs to the loader alone.
        let reads = 0;
        const io: StanceIo & { skipped: SkippedResource[] } = {
            exists: (resref) => resref === "CDMB1G1" || resref === "CDMB1G12",
            read: (resref) => (resref === "CDMB1G12" && ++reads > 1 ? GARBAGE : good),
            skipped: [],
        };

        const neutral = readNeutralSet(characterSet(), io, { flavour: "tob" });

        expect(neutral.variants[0]?.actions.flatMap((action) => action.resrefs)).toEqual(["CDMB1G1"]);
        expect(io.skipped.map((entry) => entry.resource)).toEqual(["CDMB1G12.BAM"]);
        expect(io.skipped[0]?.reason).toMatch(/Unrecognized image format/);
    });
});

describe("isMalformedResource", () => {
    it("accepts the errors a malformed resource raises", () => {
        expect(isMalformedResource(new Error("parseBamV1: BAM header truncated"))).toBe(true);
        expect(isMalformedResource(new RangeError("Offset is outside the bounds of the DataView"))).toBe(true);
    });

    it("rejects a programming error, and a thrown non-error", () => {
        expect(isMalformedResource(new TypeError("x is not a function"))).toBe(false);
        expect(isMalformedResource(new ReferenceError("x is not defined"))).toBe(false);
        expect(isMalformedResource("boom")).toBe(false);
    });
});
