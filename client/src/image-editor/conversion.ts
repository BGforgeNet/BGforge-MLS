/**
 * Converting the open animation set into another game's own files.
 *
 * The whole conversion is decided here and nothing is written: the caller gets an outcome, the losses by
 * name, and the bytes to put where it chooses. That split is what lets the editor show the plan before the
 * reader commits to it - a conversion is many files at once, so "run it and see" is not an option.
 *
 * Pure of `vscode` on purpose, like `set-document.ts` beside it: the pickers, the folder prompt and the
 * writes are the provider's, and everything below is testable without a host.
 */
import {
    type ActionScheme,
    type AnimationSet,
    type ConversionTarget,
    type MemberWrite,
    type StanceIo,
    FALLOUT_FRM,
    IE_16_POINT_FULL,
    IE_16_POINT_MIRRORED,
    IE_8_POINT_MIRRORED,
    IE_8_POINT_PAIRED,
    allocateAnimationId,
    convertSet,
    readNeutralSet,
} from "@bgforge/animation";

/**
 * One offered conversion, pairing what the target can hold with what it calls its files.
 *
 * The two are separate facts - a character set and a two-letter monster set both ship eight-point mirrored
 * animations - so the reader picks a destination rather than a direction profile plus a naming table, which
 * is a choice nobody could make without the schemes in front of them.
 */
export interface ConversionProfile {
    /** Stable across relabelling: the webview sends this back, so nothing keys off the display text. */
    id: string;
    label: string;
    target: ConversionTarget;
    scheme: ActionScheme;
}

/**
 * Labels are short because the control is a select in the editor's side column, which is narrow enough
 * that a fuller phrase is clipped rather than read. "IE" against "Fallout" is the distinction that has to
 * survive; the target's own full name is what the notes file states.
 */
export const CONVERSION_PROFILES: readonly ConversionProfile[] = [
    {
        // Nine cycles per band, not eight: measured on a classic and an Enhanced install, every character
        // file bands at nine, which is the sixteen-point scheme's stored western arc. Written in eight-slot
        // blocks the engine would read the next band's art as this one's eastern half.
        id: "ie-character",
        label: "IE character (armour levels)",
        target: IE_16_POINT_MIRRORED,
        scheme: "character",
    },
    {
        id: "ie-monster",
        label: "IE monster (two-letter codes)",
        target: IE_8_POINT_MIRRORED,
        scheme: "action-codes",
    },
    {
        id: "ie-monster-paired",
        label: "IE monster, east in a pair",
        target: IE_8_POINT_PAIRED,
        scheme: "action-codes",
    },
    {
        id: "ie-split-16",
        label: "IE 16 directions (mirrored)",
        target: IE_16_POINT_MIRRORED,
        scheme: "cycle-numbers",
    },
    {
        id: "ie-full-16",
        label: "IE 16 directions (all stored)",
        target: IE_16_POINT_FULL,
        scheme: "cycle-numbers",
    },
    {
        id: "fallout-frm",
        label: "Fallout critter (6 rotations)",
        target: FALLOUT_FRM,
        scheme: "fallout-critter",
    },
];

export function conversionProfile(id: string): ConversionProfile | undefined {
    return CONVERSION_PROFILES.find((profile) => profile.id === id);
}

export interface ConversionRequest {
    profileId: string;
    /** The stem the target's filenames take. Empty asks for the source's own. */
    prefix: string;
    /** The id the result is to be declared under. Stated in the notes; nothing is written to any table. */
    targetId: number;
    notes: boolean;
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
    const profile = conversionProfile(request.profileId);
    if (profile === undefined) {
        return {
            outcome: "refused",
            reason: "No such conversion target.",
            losses: [],
            notes: [],
            writes: [],
            notesFile: undefined,
        };
    }
    const neutral = readNeutralSet(set, io, { flavour });
    const result = convertSet(neutral, profile.target, {
        prefix: request.prefix === "" ? defaultPrefix(set) : request.prefix,
        scheme: profile.scheme,
        targetId: request.targetId,
        notes: request.notes,
    });
    if (result.outcome === "refused") {
        return { outcome: "refused", reason: result.reason, losses: [], notes: [], writes: [], notesFile: undefined };
    }
    const losses = new Set(result.report.losses);
    return {
        outcome: result.outcome,
        losses: [...losses].map((item) => item.detail),
        // Everything the report holds that the losses do not: stated, but never a reason to hesitate.
        notes: result.report.items.filter((item) => !losses.has(item)).map((item) => item.detail),
        writes: result.writes,
        notesFile: result.notes,
    };
}
