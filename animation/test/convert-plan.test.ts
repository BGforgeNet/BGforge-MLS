import { describe, expect, it } from "vitest";
import { type Facing, type LossReport } from "@bgforge/image";
import { type NeutralAction, type NeutralSet } from "../src/neutral/model";
import { readNeutralSet } from "../src/neutral/read";
import { type AnimationSet } from "../src/animation-index";
import { type StanceIo } from "../src/set-stances";
import {
    FALLOUT_FRM,
    IE_16_POINT_FULL,
    IE_16_POINT_MIRRORED,
    IE_8_POINT_MIRRORED,
    IE_8_POINT_PAIRED,
} from "../src/convert/target";
import { type ConversionPlan, planConversion } from "../src/convert/plan";
import { bandedPair } from "../../image/test/bam-fixtures.ts";

/**
 * A real parsed member, so a planned set holds the animation a reader would have given it.
 *
 * The planner reads the interpretation rather than the pixels, so the tests below vary the actions while
 * keeping one genuinely parsed file underneath - a set whose files map was empty would not be a set.
 */
function setWithActions(actions: NeutralAction[]): NeutralSet {
    const set: AnimationSet = {
        id: 0x6004,
        code: "CGMC",
        name: "CLERIC_MALE_GNOME",
        prefixByArmour: new Map([[1, "CDMB"]]),
        paperdollPrefix: undefined,
        scheme: { kind: "character" },
        section: "character",
    };
    const files: Record<string, Uint8Array> = { CDMB1G1: bandedPair(4, [0, 1, 2, 3, 4]) };
    const io: StanceIo = { exists: (resref) => resref in files, read: (resref) => files[resref] };
    const read = readNeutralSet(set, io, { flavour: "tob" });
    return { ...read, variants: [{ ...read.variants[0]!, actions }] };
}

/** One directional action storing exactly the facings named. */
function directional(label: string, facings: Facing[]): NeutralAction {
    return {
        label,
        resrefs: ["CDMB1G1"],
        band: 0,
        cycles: {
            kind: "directional",
            directions: facings.map((facing, at) => ({ facing, sequenceIndex: at })),
        },
    };
}

/** The report of a plan that went ahead, failing loudly rather than silently skipping if it was refused. */
function reportOf(plan: ConversionPlan): LossReport {
    if (plan.outcome === "refused") throw new Error(`expected a plan, got a refusal: ${plan.reason}`);
    return plan.report;
}

/** The refusal reason, failing loudly if the planner went ahead instead. */
function reasonOf(plan: ConversionPlan): string {
    if (plan.outcome !== "refused") throw new Error(`expected a refusal, got "${plan.outcome}"`);
    return plan.reason;
}

const WEST_ARC_8: Facing[] = ["S", "SW", "W", "NW", "N"];
const ALL_8: Facing[] = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];
const WEST_ARC_16: Facing[] = ["S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW", "N"];

describe("planning a conversion", () => {
    it("passes a mirrored west arc into a target that mirrors the east", () => {
        const plan = planConversion(setWithActions([directional("WK - walk", WEST_ARC_8)]), IE_8_POINT_MIRRORED);

        expect(plan.outcome).toBe("lossless");
    });

    /** The target stores the eastern facings, so mirroring them out of the source ADDS engine-faithful art. */
    it("generates mirrors into a target that stores every facing, losing nothing", () => {
        const plan = planConversion(setWithActions([directional("WK - walk", WEST_ARC_8)]), IE_8_POINT_PAIRED);

        expect(plan.outcome).toBe("lossless");
    });

    /**
     * Section 4.2's fourth row, and the one loss that is otherwise invisible: the result still animates in
     * all eight directions, so nothing looks broken while hand-drawn eastern art has been thrown away.
     */
    it("names the action whose drawn eastern art a mirroring target would discard", () => {
        const plan = planConversion(setWithActions([directional("WK - walk", ALL_8)]), IE_8_POINT_MIRRORED);

        expect(plan.outcome).toBe("lossy");
        expect(reportOf(plan).losses).toEqual([
            { kind: "drawn-facings-mirrored", detail: "WK - walk: NE, E, SE are drawn and the target mirrors them" },
        ]);
    });

    /**
     * Section 7.1: the eight-point wheel has no half-step slot at all, so this is structural. Reporting it
     * per action would fire on every sixteen-point source and train the reader to dismiss the report.
     */
    it("states a half-step source's dropped facings once, as structural rather than as a loss", () => {
        const plan = planConversion(
            setWithActions([directional("WK - walk", WEST_ARC_16), directional("SD - stand", WEST_ARC_16)]),
            IE_8_POINT_MIRRORED,
        );

        expect(plan.outcome).toBe("lossless");
        expect(reportOf(plan).items).toEqual([
            { kind: "directions-unrepresentable", detail: "the target has no slot for SSW, WSW, WNW, NNW" },
        ]);
    });

    /** A finer target holds every facing a coarser source stored, so nothing is dropped or mirrored away. */
    it("passes an eight-point source into a sixteen-point target", () => {
        const plan = planConversion(setWithActions([directional("WK - walk", WEST_ARC_8)]), IE_16_POINT_MIRRORED);

        expect(plan.outcome).toBe("lossless");
    });

    /**
     * The wide-band sections store all sixteen, so a nine-stored source converting into one gains its
     * eastern half as generated mirrors - the same addition the eight-point pair makes, one wheel finer.
     */
    it("generates the eastern half into a target that stores all sixteen", () => {
        const plan = planConversion(setWithActions([directional("WK - walk", WEST_ARC_16)]), IE_16_POINT_FULL);

        expect(plan.outcome).toBe("lossless");
        expect(reportOf(plan).items).toEqual([]);
    });

    /** A non-directional member's cycles are not facings, so no direction rule applies to it. */
    it("passes a non-directional member through untouched", () => {
        const ordered: NeutralAction = {
            label: "G1",
            resrefs: ["CDMB1G1"],
            band: 0,
            cycles: { kind: "ordered", sequenceIndices: [0, 1, 2] },
        };

        expect(planConversion(setWithActions([ordered]), FALLOUT_FRM).outcome).toBe("lossless");
    });

    /**
     * A fixed-palette target remaps by construction rather than degrading this particular source, so it is
     * stated once and does not make the conversion lossy - the classification the loss report already makes.
     */
    it("treats a fixed target palette as informational, not as a loss", () => {
        const plan = planConversion(setWithActions([directional("WK - walk", WEST_ARC_8)]), FALLOUT_FRM);

        expect(reportOf(plan).has("palette-remapped-to-default")).toBe(true);
        expect(plan.outcome).toBe("lossless");
    });

    /**
     * The third outcome. No source in either engine reaches it today, which is the point: two outcomes
     * would force a future mismatch into "lossy" and write a plausible-looking file that is wrong.
     */
    it("refuses a set whose action the target can store no facing of", () => {
        const plan = planConversion(setWithActions([directional("WK - walk", ["N", "S"])]), FALLOUT_FRM);

        expect(plan.outcome).toBe("refused");
        expect(reasonOf(plan)).toMatch(/WK - walk/);
    });
});
