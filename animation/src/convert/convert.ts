/**
 * Convert a whole set into a target's own scheme: plan, rebuild, name, serialize, and say what it cost.
 *
 * Nothing here decides anything the layers below have not already decided. The planner says whether the
 * conversion goes ahead and what it loses, the file builder lays a source file out in the target's blocks,
 * and the naming tables say what the target calls each action. This is the order they run in, plus the two
 * decisions that only exist for a whole set: which target code each action takes when several want the same
 * one, and whether a member's eastern half goes into a companion file.
 *
 * Refusals are for what CANNOT be represented, and nothing is written for one - a half-written set in a
 * game's override folder is worse than no set, because the engine will happily draw it.
 */
import {
    type IndexedAnimation,
    type LossReport,
    ieFacingsForStride,
    isRgbaAnimation,
    splitIeBamBlocks,
} from "@bgforge/image";
import { type ActionScheme, encodeActionCodes, nameMember, namesArmour } from "../animation-schemes/actions";
import { type NeutralAction, type NeutralSet, type NeutralVariant } from "../neutral/model";
import { type MemberWrite, serializeMember } from "../neutral/write";
import { buildTargetFile } from "./build-file";
import { conversionNotes } from "./notes";
import { planConversion } from "./plan";
import { type ConversionTarget } from "./target";

export interface ConversionOptions {
    /** The stem the target's filenames take - the caller's choice, like the id. */
    prefix: string;
    /** Which naming family the output is written in. Independent of the target's direction profile: both
     *  the character and the two-letter families ship eight-point mirrored animations. */
    scheme: ActionScheme;
    /** The animation id the converted set is to be declared under - stated in the notes, not written. */
    targetId: number;
    /** Whether to write the companion notes file. On unless asked otherwise. */
    notes?: boolean;
}

export type ConversionResult =
    | { outcome: "refused"; reason: string }
    | {
          outcome: "lossless" | "lossy";
          report: LossReport;
          writes: MemberWrite[];
          /** The companion notes, or undefined where the caller asked for none. */
          notes: string | undefined;
      };

/** The bands of one source file, in the order the file stores them, keyed by the file they live in. */
function filesOf(variant: NeutralVariant): Map<string, NeutralAction[]> {
    const groups = new Map<string, NeutralAction[]>();
    for (const action of variant.actions) {
        const [resref] = action.resrefs;
        /* v8 ignore next -- an action exists because a file it draws was read */
        if (resref === undefined) continue;
        groups.set(resref, [...(groups.get(resref) ?? []), action]);
    }
    return groups;
}

/**
 * The source animation a file group draws.
 *
 * One file is itself; anything drawn from several is a composition - a base and its eastern companion, or a
 * sprite cut into quarters or tiles - and putting those back together for a target means cutting them up
 * again, which this does not do yet. Undefined says so; the caller refuses rather than writing one part of
 * the picture over the whole.
 */
function composedSource(variant: NeutralVariant, resref: string, parts: number): IndexedAnimation | undefined {
    if (parts !== 1) return undefined;
    const animation = variant.files.get(resref);
    // A true-colour member's frames live in PVRZ pages the reader never had, so it cannot be rebuilt here.
    return animation === undefined || isRgbaAnimation(animation) ? undefined : animation;
}

/**
 * The code this action takes in the target, and what that did to the detail its own name carried.
 *
 * `taken` is what the set has already used: a scheme that names three attacks gives each source attack one
 * of them, rather than three files landing on the same name and two of them disappearing.
 */
function codeFor(
    action: NeutralAction,
    scheme: ActionScheme,
    taken: ReadonlySet<string>,
): { code: string; detail: string } | undefined {
    for (const candidate of encodeActionCodes(scheme, action.action)) {
        if (!taken.has(candidate.code)) return { code: candidate.code, detail: candidate.detail };
    }
    return undefined;
}

export function convertSet(set: NeutralSet, target: ConversionTarget, options: ConversionOptions): ConversionResult {
    const plan = planConversion(set, target);
    if (plan.outcome === "refused") return plan;
    // Asked once, for the set: every file below is laid out in the same blocks, so a target whose file
    // layout this does not model refuses the conversion rather than a file at a time.
    if (target.stride === undefined || ieFacingsForStride(target.stride).length === 0) {
        return { outcome: "refused", reason: `This does not know how ${target.label} lays its files out.` };
    }
    if (set.variants.length > 1 && !namesArmour(options.scheme)) {
        return {
            outcome: "refused",
            reason:
                `This set has ${set.variants.length} armour levels and the target's names carry none, ` +
                `so every level would write the same files over the one before it.`,
        };
    }

    const report = plan.report;
    const writes: MemberWrite[] = [];
    for (const variant of set.variants) {
        // Per armour level, because the level is part of the name wherever a scheme has levels at all: a
        // set-wide tally would find level 2's walk code taken by level 1 and report it as unmappable.
        const taken = new Set<string>();
        for (const [resref, actions] of filesOf(variant)) {
            const [member] = actions;
            /* v8 ignore next -- a group exists because an action put it there */
            if (member === undefined) continue;
            const source = composedSource(variant, resref, member.resrefs.length);
            if (source === undefined) {
                return {
                    outcome: "refused",
                    reason: `${resref} is drawn from files this cannot compose back into a target's own.`,
                };
            }
            // The file is named for the member, as the source named it: the bands inside it have no names
            // of their own in any of these schemes.
            const named = codeFor(member, options.scheme, taken);
            if (named === undefined) {
                report.add("action-unmapped", `${member.label} (${resref}) has no counterpart in the target`);
                continue;
            }
            taken.add(named.code);
            if (named.detail !== "kept") {
                report.add(
                    "action-code-detail",
                    `${resref} becomes ${named.code}, which ${named.detail === "assumed" ? "names a weapon or grip the source did not" : "carries no grip or weapon of its own"}`,
                );
            }
            const built = buildTargetFile(source, actions, target);
            /* v8 ignore next -- the target's file layout was checked before the loop */
            if (built === undefined) return { outcome: "refused", reason: `${target.label} has no file layout here.` };
            const name = nameMember(options.scheme, options.prefix, variant.armour, named.code);
            if (!target.pairEast) {
                writes.push({ resref: name, bytes: serializeMember(built, name) });
                continue;
            }
            // Split on the blocks this just laid out, not on a re-reading of them: a file with real art in
            // every slot is not the base-file shape a reader detects, so a detecting split would refuse the
            // very file it was handed to cut.
            const split = splitIeBamBlocks(built);
            if (split === undefined) {
                return {
                    outcome: "refused",
                    reason: `${resref} does not fit the eight-slot blocks the target's paired files take.`,
                };
            }
            writes.push(
                { resref: name, bytes: serializeMember(split.base, name) },
                { resref: `${name}E`, bytes: serializeMember(split.east, `${name}E`) },
            );
        }
    }

    // Nothing named is nothing converted. Reported as a lossy conversion the caller gets a list of what
    // was lost and an empty output, with nothing to say which of the two it is looking at - and a source
    // whose actions carry no meaning (a cycle-numbered set) lands here for every meaning-carrying target.
    if (writes.length === 0) {
        return {
            outcome: "refused",
            reason: `This set has no file the target can name: ${report.losses.map((loss) => loss.detail).join("; ")}.`,
        };
    }

    // Recomputed rather than taken from the plan: the naming step above adds losses of its own, and a
    // conversion that lost an action is not the lossless one the plan described before it ran.
    const outcome = report.lossless ? "lossless" : "lossy";
    const notes = options.notes === false ? undefined : conversionNotes(set, target, { outcome, report }, options);
    return { outcome, report, writes, notes };
}
