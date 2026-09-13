/**
 * Converting the open animation set into another game's own files.
 *
 * The whole conversion is decided here and nothing is written: the caller gets an outcome, the losses by
 * name, and the bytes to put where it chooses. That split is what lets the editor show the plan before the
 * reader commits to it - a conversion is many files at once, so "run it and see" is not an option.
 *
 * Pure of `vscode` on purpose, like `set-document.ts` beside it: the pickers, the folder prompt and the
 * writes live in `save-flow.ts`, and everything below is testable without a host.
 */
import {
    type ActionScheme,
    type AnimationSet,
    type BamContainer,
    type ConversionTarget,
    type MemberWrite,
    type StanceIo,
    FALLOUT_FRM,
    allocateAnimationId,
    convertSet,
    readNeutralSet,
    targetForSection,
    unfillableSlots,
} from "@bgforge/animation";
import { type Facing, type UnevenRotations } from "@bgforge/image";

/**
 * Whether a source holding `held` can be written under `section`.
 *
 * The section fixes the geometry, so this is the same question the planner refuses on, asked before the
 * reader picks: a section whose stored slots the source cannot fill is not a lossy conversion but a file
 * with declared facings and no art in them. A section this project cannot state a shape for is unreachable
 * too - there is no target to check against - which is what keeps an unwritable family out of the picker
 * rather than offering it and refusing.
 */
export function sectionIsReachable(section: string, held: readonly Facing[]): boolean {
    const target = targetForSection(section);
    if (target === undefined || held.length === 0) return false;
    return unfillableSlots(target, held).length === 0;
}

/** How each naming family spells the files it writes - the second radio's labels. */
export const NAMING_LABELS = {
    character: "Character, by armour level and action",
    "action-codes": "Two-letter action codes",
    "cycle-numbers": "Numbered cycles",
    "fallout-critter": "Fallout critter codes",
} as const satisfies Record<ActionScheme, string>;

/** The three an Infinity Engine set can be written under; the fourth belongs to the Fallout target. */
export const IE_NAMINGS = ["character", "action-codes", "cycle-numbers"] as const satisfies readonly ActionScheme[];

export interface ConversionRequest {
    /**
     * Which engine's files to write. The Infinity Engine target is then the `geometry` below; Fallout has
     * one shape - six rotations, every one stored - so nothing further is asked of it.
     */
    engine: "infinity" | "fallout";
    /**
     * The section the result is declared under, which FIXES the Infinity Engine geometry.
     *
     * Not a second axis beside the shape: the engine reads a declared animation through its type, and the
     * type decides how many facings are stored and whether the eastern ones sit in a companion. Offering
     * the shape separately let a reader ask for one the declared section's engine would never look for.
     * Ignored for the Fallout engine, which has one geometry of its own.
     */
    section: string;
    /** What the written files are called. `fallout-critter` belongs to the Fallout engine alone. */
    naming: ActionScheme;
    /** The stem the target's filenames take. Empty asks for the source's own. */
    prefix: string;
    /** The id the result is to be declared under. Stated in the notes; nothing is written to any table. */
    targetId: number;
    notes: boolean;
    /** The BAM container every member takes, or absent to keep each member's own - see `ConversionOptions`. */
    container?: BamContainer;
    /** Fallout only: how rotations of differing length are made equal - see `UnevenRotations`. */
    unevenRotations?: UnevenRotations;
}

/** What the editor draws for a planned conversion, and what a run of it would write. */
export interface ConversionOutcome {
    outcome: "refused" | "lossless" | "lossy";
    /** Present only on a refusal - the one thing the reader gets instead of files. */
    reason?: string;
    /** Real losses, named. Empty on a lossless conversion. */
    losses: string[];
    /** Representation changes worth stating that cost no source data. */
    notes: string[];
    writes: MemberWrite[];
    /** The companion notes file, or undefined where the reader asked for none. */
    notesFile: string | undefined;
    /**
     * The target these files were written for, absent on a refusal.
     *
     * Carried rather than re-derived: the declaration beside the art describes this same shape, and a
     * second resolution of it from the same section is how the two come to disagree.
     */
    target?: ConversionTarget;
    /**
     * Whether this conversion had rotations of differing length to make equal.
     *
     * Only a Fallout target ever does, and only for a source whose facings actually differ - which is why
     * it is answered here rather than assumed from the target: it is the question the dialog draws its
     * uneven-rotation control for, and drawing it otherwise offers a choice that changes no file.
     */
    unevenRotations: boolean;
}

/**
 * The prefix a converted set takes when the reader has not chosen one.
 *
 * The source's own stem, which keeps a converted file recognisable beside its original. It is only a
 * default: two sets from different installs can share a stem, and the reader is the one who knows.
 */
export function defaultPrefix(set: AnimationSet): string {
    return set.prefixByArmour.values().next().value ?? "";
}

/**
 * The id to offer, free among those the install already declares.
 *
 * Offered from the SOURCE install's table because that is the one open. A conversion aimed at a different
 * install may land on an id taken there, which is exactly why the notes file states the id rather than the
 * tool writing it into any table.
 */
export function suggestTargetId(set: AnimationSet, declared: readonly AnimationSet[]): number {
    return allocateAnimationId(
        declared.map((entry) => entry.id),
        set.id,
    );
}

export function convertOpenSet(
    set: AnimationSet,
    io: StanceIo,
    flavour: string,
    request: ConversionRequest,
): ConversionOutcome {
    // The Fallout engine has one geometry of its own; the Infinity Engine one is the declared section's.
    const target = request.engine === "fallout" ? FALLOUT_FRM : targetForSection(request.section);
    if (target === undefined) {
        return {
            outcome: "refused",
            reason:
                `Nothing here can say what shape a ${request.section} animation stores its facings in, ` +
                "so a set written under that section would declare a layout its engine does not read.",
            losses: [],
            notes: [],
            writes: [],
            notesFile: undefined,
            unevenRotations: false,
        };
    }
    const neutral = readNeutralSet(set, io, { flavour });
    const result = convertSet(neutral, target, {
        prefix: request.prefix === "" ? defaultPrefix(set) : request.prefix,
        scheme: request.naming,
        targetId: request.targetId,
        notes: request.notes,
        ...(request.container === undefined ? {} : { container: request.container }),
        ...(request.unevenRotations === undefined ? {} : { unevenRotations: request.unevenRotations }),
    });
    if (result.outcome === "refused") {
        return {
            outcome: "refused",
            reason: result.reason,
            losses: [],
            notes: [],
            writes: [],
            notesFile: undefined,
            unevenRotations: false,
        };
    }
    const losses = new Set(result.report.losses);
    return {
        outcome: result.outcome,
        losses: [...losses].map((item) => item.detail),
        // Everything the report holds that the losses do not: stated, but never a reason to hesitate.
        notes: result.report.items.filter((item) => !losses.has(item)).map((item) => item.detail),
        writes: result.writes,
        notesFile: result.notes,
        target,
        // Read off the report rather than re-derived from the source: which rotations differ, and whether
        // this target equalised any, is what the conversion has just finished working out.
        unevenRotations: result.report.items.some(
            (item) => item.kind === "padded-sequence" || item.kind === "clipped-sequence",
        ),
    };
}
