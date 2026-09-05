import { describe, expect, it } from "vitest";
import type { Facing } from "@bgforge/image";
import { declaredStride, type FileBands, schemeForStride, stancesOfMembers } from "../src/animation-schemes/bands";

/** One band of `count` slots; the facings themselves do not matter to the naming. */
function band(count: number): { seqIndex: number; facing: Facing }[] {
    return Array.from({ length: count }, (_, i) => ({ seqIndex: i, facing: "S" as Facing }));
}

function bands(count: number, slots = 5, scheme: FileBands["scheme"] = "ie8"): FileBands {
    return { bands: Array.from({ length: count }, () => band(slots)), scheme, confidence: "declared" };
}

describe("declaredStride", () => {
    it("settles the two sections whose files band at sixteen", () => {
        expect(declaredStride("monster_quadrant")).toBe(16);
        expect(declaredStride("monster_large16")).toBe(16);
    });

    /**
     * The paired section, whose members merge a base file with the `*E` companion holding real eastern art.
     * Inference reads a LONE base file right - dummy east slots are the fingerprint it looks for - but the
     * merged pair has no dummies, so it falls through to an unnamed cycle list and the eastern art stops
     * being eastern. A converter reading that would discard hand-drawn facings and report no loss.
     */
    it("settles the paired section, whose merged members have no dummy slots to recognise", () => {
        expect(declaredStride("character_old")).toBe(8);
    });

    it("leaves every other section to structural inference", () => {
        // Overriding where inference is already right would replace a measured answer with a guess.
        expect(declaredStride("monster")).toBeUndefined();
        expect(declaredStride("character")).toBeUndefined();
        expect(declaredStride("monster_old")).toBeUndefined();
        expect(declaredStride(undefined)).toBeUndefined();
    });
});

describe("schemeForStride", () => {
    /** Keeping the scheme is what keeps the block table's stance names on a declared-stride band. */
    it("reads an eight-cycle band as the eight-slot scheme", () => {
        expect(schemeForStride(8)).toBe("ie8");
    });

    it("leaves a wider band without a scheme, since the block table names none", () => {
        expect(schemeForStride(16)).toBeUndefined();
    });
});

describe("stancesOfMembers", () => {
    it("keeps a single-band file on the member's own name", () => {
        const stances = stancesOfMembers([{ label: "WK - walk", resref: "METNWK", parts: ["METNWK"] }], () => bands(1));
        expect(stances).toEqual([
            {
                label: "WK - walk",
                resref: "METNWK",
                parts: ["METNWK"],
                band: 0,
                slots: band(5),
                confidence: "declared",
            },
        ]);
    });

    it("names each band of a file that packs several stances", () => {
        // MOGHG1's real shape: six 8-slot bands, five stored facings each.
        const stances = stancesOfMembers([{ label: "G1", resref: "MOGHG1", parts: ["MOGHG1"] }], () => bands(6));
        expect(stances.map((s) => s.label)).toEqual([
            "WK - walk",
            "SC - combat stance",
            "SD - stand",
            "GH - get hit",
            "DE - die",
            "TW - twitch",
        ]);
        expect(stances.map((s) => s.band)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(stances.every((s) => s.resref === "MOGHG1")).toBe(true);
    });

    it("numbers the bands of a layout nothing documents, keeping the file's name", () => {
        // A wrong stance name is worse than an honest number - the same posture the block table takes.
        const stances = stancesOfMembers([{ label: "G2", resref: "MWYVG2", parts: ["MWYVG2"] }], () =>
            bands(5, 10, undefined),
        );
        expect(stances.map((s) => s.label)).toEqual([
            "G2 - group 1",
            "G2 - group 2",
            "G2 - group 3",
            "G2 - group 4",
            "G2 - group 5",
        ]);
        expect(stances[0]?.slots).toHaveLength(10);
    });

    it("carries every member's bands, in member order", () => {
        const stances = stancesOfMembers(
            [
                { label: "G1", resref: "MOGHG1", parts: ["MOGHG1"] },
                { label: "G2", resref: "MOGHG2", parts: ["MOGHG2"] },
            ],
            (member) => (member.resref === "MOGHG1" ? bands(6) : bands(2)),
        );
        expect(stances).toHaveLength(8);
        expect(stances.at(-1)?.resref).toBe("MOGHG2");
    });

    it("drops a member the archive cannot band rather than offering a dead row", () => {
        const stances = stancesOfMembers(
            [
                { label: "G1", resref: "MOGHG1", parts: ["MOGHG1"] },
                { label: "G9", resref: "MISSING", parts: ["MISSING"] },
            ],
            (member) => (member.resref === "MOGHG1" ? bands(1) : undefined),
        );
        expect(stances.map((s) => s.resref)).toEqual(["MOGHG1"]);
    });

    it("drops a band with no drawable facings", () => {
        const empty: FileBands = { bands: [band(5), [], band(5)], scheme: "ie8", confidence: "declared" };
        expect(stancesOfMembers([{ label: "G1", resref: "X", parts: ["X"] }], () => empty).map((s) => s.band)).toEqual([
            0, 2,
        ]);
    });
});
