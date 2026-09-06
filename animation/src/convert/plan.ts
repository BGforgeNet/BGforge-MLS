/**
 * Decide what converting a set into a target would cost, before anything is written.
 *
 * Three outcomes rather than two. Two would force every mismatch the design did not anticipate into
 * "lossy" and write it anyway, which produces a plausible-looking file that is wrong; a refusal that never
 * fires costs nothing. No source in either engine reaches the refusal today, and that is the intent.
 *
 * The losses themselves are recorded in `LossReport`, which already draws the line this needs: a note that
 * records a REPRESENTATION change is informational and must not make a conversion count as lossy, or a
 * clean conversion warns about nothing. That line is section 7.1's structural-versus-content rule, so this
 * adds no second classification of its own.
 */
import { type Facing, LossReport } from "@bgforge/image";
import { type NeutralAction, type NeutralSet } from "../neutral/model";
import { type ConversionTarget } from "./target";

export type ConversionPlan =
    | { outcome: "lossless"; report: LossReport }
    | { outcome: "lossy"; report: LossReport }
    | { outcome: "refused"; reason: string };

/** The facings an action stores art for; empty where its cycles are not directions at all. */
function storedFacings(action: NeutralAction): Facing[] {
    return action.cycles.kind === "directional" ? action.cycles.directions.map((slot) => slot.facing) : [];
}

/** Every action of every variant, in read order. */
function actionsOf(set: NeutralSet): NeutralAction[] {
    return set.variants.flatMap((variant) => [...variant.actions]);
}

export function planConversion(set: NeutralSet, target: ConversionTarget): ConversionPlan {
    const report = new LossReport();
    const shown = new Set<Facing>(target.shown);
    const stored = new Set<Facing>(target.stored);
    const actions = actionsOf(set);

    // Facings the target's wheel has no slot for at all - structural, so stated once for the whole set
    // rather than per action. Repeating it per action would fire on every finer-than-target source and
    // train the reader to dismiss the report, which is the failure a per-item report of this kind causes.
    const unrepresentable: Facing[] = [];
    for (const action of actions) {
        for (const facing of storedFacings(action)) {
            if (!shown.has(facing) && !unrepresentable.includes(facing)) unrepresentable.push(facing);
        }
    }
    if (unrepresentable.length > 0) {
        report.add("directions-unrepresentable", `the target has no slot for ${unrepresentable.join(", ")}`);
    }

    // Grouped by WHAT is discarded rather than one row per action: a set's every action usually loses the
    // same facings, and twenty near-identical rows is a report nobody reads to the end. Every affected
    // action is still named - grouping shortens the report, it does not drop anything from it.
    const discardedBy = new Map<string, string[]>();
    for (const action of actions) {
        const facings = storedFacings(action);
        if (facings.length === 0) continue;
        if (!facings.some((facing) => stored.has(facing))) {
            return {
                outcome: "refused",
                reason: `${action.label}: the target stores none of the facings this action holds art for.`,
            };
        }
        // The target SHOWS these and the source DREW them, so writing them away is not a structural drop -
        // it discards art a reader would have accepted. The result still animates in every direction, which
        // is exactly why nothing downstream would report it.
        const discarded = facings.filter((facing) => shown.has(facing) && !stored.has(facing));
        if (discarded.length === 0) continue;
        const key = discarded.join(", ");
        discardedBy.set(key, [...(discardedBy.get(key) ?? []), action.label]);
    }
    for (const [facings, labels] of discardedBy) {
        report.add("drawn-facings-mirrored", `${facings} are drawn and the target mirrors them: ${labels.join(", ")}`);
    }

    if (target.fixedPalette) {
        report.add("palette-remapped-to-default", "the target holds its own palette and remaps what it is given");
    }

    if (target.weaponsInArt) {
        // Not a member that failed to convert - there was never one to carry. The source's weapons live in
        // their own files, keyed by the item rather than by this set, and the target has no layer for them.
        report.add(
            "weapon-layer-unrepresentable",
            "the target draws a weapon into the art itself, so the result is unarmed",
        );
    }

    return report.lossless ? { outcome: "lossless", report } : { outcome: "lossy", report };
}
