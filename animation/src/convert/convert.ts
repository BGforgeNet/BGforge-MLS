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
    type LossKind,
    type LossReport,
    type UnevenRotations,
    composeParts,
    isRgbaAnimation,
    splitIeBamBlocks,
} from "@bgforge/image";
import {
    type ActionScheme,
    encodeActionCodes,
    nameMember,
    namesArmour,
    namesOneFilePerAction,
} from "../animation-schemes/actions";
import { characterFileLayout } from "../animation-schemes/character";
import { type NeutralAction, type NeutralSet, type NeutralVariant } from "../neutral/model";
import { type BamContainer, type MemberWrite, serializeAsFrm, serializeMember } from "../neutral/write";
import { type BandLayout, buildTargetFile, seatInBandLayout, targetSlots } from "./build-file";
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
    /**
     * The BAM container every written member takes, or absent to keep each member's own.
     *
     * A conversion writes a whole set at once, so "the source's own" is per FILE and a set read out of an
     * install can genuinely mix the two. Naming one makes the output uniform; naming none is the older
     * behaviour and still the default. Nothing for a target that writes FRMs, which have no BAM container.
     */
    container?: BamContainer;
    /**
     * How rotations of differing length are made equal, for a Fallout target.
     *
     * Only that target asks: an FRM's six rotations share one frame count and an Infinity Engine source
     * routinely differs by a frame or two between facings, so every directional conversion resolves it.
     * See `UnevenRotations` for the three answers.
     */
    unevenRotations?: UnevenRotations;
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
 * One file is itself; a member drawn from several - a sprite cut into quarters or tiles - is the picture
 * they draw TOGETHER, so it is assembled here. Every target this offers writes a member as one file, so
 * writing one quarter as the whole would be a wrong animation rather than a lossy one.
 *
 * Splitting a composed picture back into a target's OWN tiles is deliberately not built: no target offered
 * writes tiles, so it would be a writer with nothing to write for.
 *
 * Undefined where the parts cannot be assembled - their cycle tables disagree, or a true-colour member's
 * frames live in PVRZ pages the reader never had. The caller refuses rather than writing part of a picture.
 */
function composedSource(
    variant: NeutralVariant,
    resrefs: readonly string[],
    report: LossReport,
): IndexedAnimation | undefined {
    const parts: IndexedAnimation[] = [];
    for (const resref of resrefs) {
        const animation = variant.files.get(resref);
        if (animation === undefined || isRgbaAnimation(animation)) return undefined;
        parts.push(animation);
    }
    const [first] = parts;
    if (parts.length === 1) return first;
    const composed = composeParts(parts);
    if (composed !== undefined) {
        report.add("parts-composed", `${resrefs.join(" + ")} are assembled into one file`);
    }
    return composed;
}

/**
 * The code this action takes in the target, and what that did to the detail its own name carried.
 *
 * `taken` is what the set has already used: a scheme that names three attacks gives each source attack one
 * of them, rather than three files landing on the same name and two of them disappearing.
 */
/**
 * Whether two actions are the same animation: the same frames, played the same way.
 *
 * Same drawing files and same band is not enough on its own - a get-up shares the dying band and runs it
 * backwards, which is a different animation and takes a file of its own.
 */
function sameAnimation(one: NeutralAction, other: NeutralAction): boolean {
    return (
        one.band === other.band &&
        one.reversed === other.reversed &&
        one.resrefs.length === other.resrefs.length &&
        one.resrefs.every((resref, at) => resref === other.resrefs[at])
    );
}

/**
 * The already-written action this one is drawn from the same frames as.
 *
 * A source names more sequences than it has clips: an IE creature holds one pose to stand, to square up
 * and while conjuring, and many families draw dying and sleeping from one band. Each is its own action -
 * the source engine plays it for each - but there is one animation between them, so writing them
 * separately puts identical art in several of the target's files under names it picks off a list. What
 * that costs is not disk: the second name is the target's OTHER member of a pair, so a sleep lands on the
 * fall the engine plays for half its deaths. Sharing the file states what the source actually had.
 *
 * Keyed on the animation rather than on the codes, because the two engines disagree about which
 * distinctions exist at all - the target may have no name for the second action, and that is not a loss
 * when its frames are already written.
 */
function sharesFileWith(action: NeutralAction, written: Iterable<NeutralAction>): NeutralAction | undefined {
    for (const already of written) {
        if (sameAnimation(already, action)) return already;
    }
    return undefined;
}

/**
 * Every target code an action with art of its own could take.
 *
 * Two of a source's names can want ONE of the target's while only one of them has a clip behind it: a
 * creature holds its standing pose while conjuring and casts from a file of its own, so both are spells
 * where the target names a single spell-shaped animation. Taken in file order the standing pose claims it
 * and the cast is dropped - the worst of the three outcomes, since the target then gets a critter that
 * stands still to use things AND loses the animation it should have used. So a duplicate yields any code
 * in this set; its own frames reach the output either way, through the file it shares.
 *
 * Deliberately over-inclusive: an original that ends up taking an earlier candidate still reserves its
 * later ones here. That costs a duplicate a name it could have had, which writes one file fewer and loses
 * nothing, where guessing the assignment ahead of itself could lose a clip.
 */
function codesWantedByOriginals(actions: readonly NeutralAction[], scheme: ActionScheme): ReadonlySet<string> {
    const originals: NeutralAction[] = [];
    const wanted = new Set<string>();
    for (const action of actions) {
        if (originals.some((other) => sameAnimation(other, action))) continue;
        originals.push(action);
        for (const candidate of encodeActionCodes(scheme, action.action)) wanted.add(candidate.code);
    }
    return wanted;
}

function codeFor(
    action: NeutralAction,
    scheme: ActionScheme,
    taken: ReadonlyMap<string, NeutralAction>,
): { code: string; detail: string } | undefined {
    for (const candidate of encodeActionCodes(scheme, action.action)) {
        if (!taken.has(candidate.code)) return { code: candidate.code, detail: candidate.detail };
    }
    return undefined;
}

/**
 * The band skeleton the target's naming family gives one file.
 *
 * Only the character family has one: its files all carry the same eleven bands (eight for a cast file) and
 * draw the one their own code names. Everywhere else a file is the band it holds.
 */
function fileLayout(scheme: ActionScheme, code: string): BandLayout {
    return scheme === "character" ? characterFileLayout(code) : { bands: 1, at: 0 };
}

export function convertSet(set: NeutralSet, target: ConversionTarget, options: ConversionOptions): ConversionResult {
    const plan = planConversion(set, target);
    if (plan.outcome === "refused") return plan;
    // Asked once, for the set: every file below is laid out in the same blocks, so a target whose file
    // layout this does not model refuses the conversion rather than a file at a time.
    const slots = targetSlots(target);
    if (slots.length === 0) {
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
    /** Actions the target has no name for - kept apart from the report so a refusal can name them once. */
    const unmapped: NeutralAction[] = [];
    /**
     * Facts already stated, so a set with armour levels states each once.
     *
     * Every level draws the same actions, so reporting per level repeats the whole list as many times as
     * the set has levels - a four-level character set produced a hundred and forty lines carrying about
     * thirty facts, which is a report nobody reads to the end. The fact is about the SET either way: the
     * levels differ in their art, never in which actions the target can name or what its palette holds.
     */
    const stated = new Set<string>();
    const stateOnce = (kind: LossKind, key: string, detail: string) => {
        if (stated.has(`${kind}|${key}`)) return;
        stated.add(`${kind}|${key}`);
        report.add(kind, detail);
    };
    for (const variant of set.variants) {
        // Per armour level, because the level is part of the name wherever a scheme has levels at all: a
        // set-wide tally would find level 2's walk code taken by level 1 and report it as unmappable.
        // Keyed to the action that claimed each code, so a later one drawing the same animation can share
        // its file rather than take the target's other name for the same thing (`sharesFileWith`).
        const taken = new Map<string, NeutralAction>();
        const wanted = codesWantedByOriginals(variant.actions, options.scheme);
        for (const [resref, packed] of filesOf(variant)) {
            // Assembled once for the whole group: every band of a file draws the same parts, so composing
            // per band would report the same assembly once per band of it.
            const [first] = packed;
            /* v8 ignore next -- a group exists because an action put it there */
            if (first === undefined) continue;
            const source = composedSource(variant, first.resrefs, report);
            if (source === undefined) {
                return {
                    outcome: "refused",
                    reason: `${resref} is drawn from files this cannot assemble into one picture.`,
                };
            }
            // What ONE target file holds. A scheme that names a file per action takes a source file's
            // bands apart - a packed monster `G1` is the walk, the stances and the death, and the target
            // has a name for each; a scheme that packs takes the file as it stands.
            //
            // Unless the group already IS one of the target's files: a cast file holds four conjure and
            // release pairs under one name, so filing its bands separately would report seven eighths of it
            // lost to a file that had room for all of it.
            const whole = codeFor(first, options.scheme, taken);
            const fills = whole !== undefined && fileLayout(options.scheme, whole.code).bands === packed.length;
            const units = namesOneFilePerAction(options.scheme) && !fills ? packed.map((action) => [action]) : [packed];
            for (const actions of units) {
                const [member] = actions;
                /* v8 ignore next -- a unit exists because an action put it there */
                if (member === undefined) continue;
                const shared = sharesFileWith(member, taken.values());
                const named = codeFor(member, options.scheme, taken);
                // A duplicate shares when the target has no name left for it, and yields when the name it
                // would take is one an action with art of its own could use. It writes its own file only
                // where the name costs nobody anything: a target naming a file per action wants both names
                // written from one clip, because its engine finds a file by name and the second lookup
                // would otherwise come back empty.
                if (shared !== undefined && (named === undefined || wanted.has(named.code))) {
                    stateOnce(
                        "action-shares-target-file",
                        member.label,
                        `${member.label} is drawn from the same frames as ${shared.label}, so it shares that file`,
                    );
                    continue;
                }
                if (named === undefined) {
                    unmapped.push(member);
                    stateOnce("action-unmapped", member.label, `${member.label} has no counterpart in the target`);
                    continue;
                }
                taken.set(named.code, member);
                if (named.detail !== "kept") {
                    stateOnce(
                        "action-code-detail",
                        named.code,
                        `${member.label} becomes ${named.code}, which ${named.detail === "assumed" ? "names a weapon or grip the source did not" : "carries no grip or weapon of its own"}`,
                    );
                }
                const laid = buildTargetFile(source, actions, target);
                /* v8 ignore next -- the target's file layout was checked before the loop */
                if (laid === undefined) return { outcome: "refused", reason: `${target.label} has no layout here.` };
                const built = seatInBandLayout(laid, fileLayout(options.scheme, named.code), slots.length);
                if (built === undefined) {
                    return {
                        outcome: "refused",
                        reason:
                            `${member.label} (${resref}) is not the one direction band ` +
                            `the target's ${named.code} file seats.`,
                    };
                }
                const name = nameMember(options.scheme, options.prefix, variant.armour, named.code);
                if (target.files === "frm-rotations") {
                    const frm = serializeAsFrm(built, name, options.unevenRotations);
                    for (const item of frm.report.items) stateOnce(item.kind, item.detail, item.detail);
                    if (frm.quantized) {
                        stateOnce(
                            "colours-quantized",
                            "palette",
                            "colours the game's own palette does not hold were moved to their nearest match",
                        );
                    }
                    writes.push({ resref: name, extension: "FRM", bytes: frm.bytes });
                    continue;
                }
                if (!target.pairEast) {
                    writes.push({
                        resref: name,
                        extension: "BAM",
                        bytes: serializeMember(built, name, options.container),
                    });
                    continue;
                }
                // Split on the blocks this just laid out, not on a re-reading of them: a file with real art
                // in every slot is not the base-file shape a reader detects, so a detecting split would
                // refuse the very file it was handed to cut.
                const split = splitIeBamBlocks(built);
                if (split === undefined) {
                    return {
                        outcome: "refused",
                        reason: `${resref} does not fit the eight-slot blocks the target's paired files take.`,
                    };
                }
                writes.push(
                    { resref: name, extension: "BAM", bytes: serializeMember(split.base, name, options.container) },
                    {
                        resref: `${name}E`,
                        extension: "BAM",
                        bytes: serializeMember(split.east, `${name}E`, options.container),
                    },
                );
            }
        }
    }

    // Nothing named is nothing converted. Reported as a lossy conversion the caller gets a list of what
    // was lost and an empty output, with nothing to say which of the two it is looking at - and a source
    // whose actions carry no meaning (a cycle-numbered set) lands here for every meaning-carrying target.
    //
    // The actions are named ONCE, and only the naming failures: built from the report's own lines it
    // repeated a clause per action and carried in whatever else the plan had recorded, so a set of a dozen
    // bands produced a paragraph with one fact in it. Which sentence depends on WHY there is no name -
    // "nobody has said what this is" is a different problem for the reader than "the target has no such
    // file", and only the first is unfixable from here.
    if (writes.length === 0) {
        if (unmapped.length === 0) return { outcome: "refused", reason: "This set has no member to convert." };
        const names = unmapped.map((action) => action.label).join(", ");
        const unstated = unmapped.every((action) => action.action.id === "unpinned");
        return {
            outcome: "refused",
            reason: unstated
                ? `Nothing states what this set's actions depict, so the target can name none of them: ${names}.`
                : `The target has no counterpart for any of this set's actions: ${names}.`,
        };
    }

    // Recomputed rather than taken from the plan: the naming step above adds losses of its own, and a
    // conversion that lost an action is not the lossless one the plan described before it ran.
    const outcome = report.lossless ? "lossless" : "lossy";
    const notes = options.notes === false ? undefined : conversionNotes(set, target, { outcome, report }, options);
    return { outcome, report, writes, notes };
}
