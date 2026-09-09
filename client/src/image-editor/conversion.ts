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
    type BamContainer,
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
    unfillableSlots,
} from "@bgforge/animation";
import { type Facing, type UnevenRotations } from "@bgforge/image";

/**
 * How many compass directions a written set covers.
 *
 * Two values, not a free number: the engine's own schemes are the eight-point wheel and the sixteen-point
 * one, and nothing in between is a thing an install declares.
 */
export type DirectionCount = 8 | 16;

/**
 * The geometry of a written set - the two axes the dialog asks as radios.
 *
 * Independent, and their product IS the four Infinity Engine targets, which is why neither axis needs a
 * target of its own: a target list would have been the cross product spelled out, and it made the
 * character family read as a different direction count from the cycle-numbered sixteen-point one when the
 * two are the same geometry.
 */
export interface SaveGeometry {
    directions: DirectionCount;
    /**
     * Whether the eastern facings are written into the files, or left for the engine to mirror.
     *
     * NOT a free choice: the engine never looks to see whether an east file exists, it builds the name
     * from the animation's declared type. Under a mirrored declaration it reads a western cycle and flips
     * it, so stored eastern art is never addressed; under a split declaration it reads `<base>E`, so an
     * existing one keeps playing against newly written west. The declaration has to match, which is what
     * the notes are for.
     */
    storeEast: boolean;
}

/** The Infinity Engine target one pairing of the two axes names. */
export function ieTargetFor(directions: DirectionCount, storeEast: boolean): ConversionTarget {
    if (directions === 8) return storeEast ? IE_8_POINT_PAIRED : IE_8_POINT_MIRRORED;
    return storeEast ? IE_16_POINT_FULL : IE_16_POINT_MIRRORED;
}

/** Every pairing, in the order the radios read: coarser wheel first, mirrored before stored. */
const ALL_GEOMETRIES: readonly SaveGeometry[] = [
    { directions: 8, storeEast: false },
    { directions: 8, storeEast: true },
    { directions: 16, storeEast: false },
    { directions: 16, storeEast: true },
];

/**
 * The geometries a source holding `held` can actually be written into.
 *
 * A target whose stored slots the source cannot fill is not a lossy conversion, it is a file with declared
 * facings and no art in them - so the radio is disabled rather than offered and refused. The same
 * `unfillableSlots` the planner refuses on answers here, so the dialog and the plan cannot disagree.
 *
 * An empty `held` reaches none of them, which is the right answer and not an edge case: not every
 * animation is a creature, and an ambient or an effect has no facings a creature layout is built from.
 */
export function reachableGeometries(held: readonly Facing[]): SaveGeometry[] {
    if (held.length === 0) return [];
    return ALL_GEOMETRIES.filter((geometry) => {
        return unfillableSlots(ieTargetFor(geometry.directions, geometry.storeEast), held).length === 0;
    });
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
    /** Ignored for the Fallout engine, which has only its own geometry. */
    geometry: SaveGeometry;
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
    // The Fallout engine has one geometry of its own, so the direction radios say nothing about it and
    // are not consulted; the Infinity Engine target is exactly the pairing they name.
    const target =
        request.engine === "fallout"
            ? FALLOUT_FRM
            : ieTargetFor(request.geometry.directions, request.geometry.storeEast);
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
        // Read off the report rather than re-derived from the source: which rotations differ, and whether
        // this target equalised any, is what the conversion has just finished working out.
        unevenRotations: result.report.items.some(
            (item) => item.kind === "padded-sequence" || item.kind === "clipped-sequence",
        ),
    };
}
