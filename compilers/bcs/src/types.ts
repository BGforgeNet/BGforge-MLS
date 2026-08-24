/**
 * The tree a BCS file holds.
 *
 * The argument lists are FIXED, and IESDP's bcs.htm gives them: a trigger takes 7 arguments (id, integer,
 * flags, integer, an integer of unknown purpose, two strings, one object) and an action takes 10 (id, three
 * objects, integer, a point written as two integers, two integers, two strings). An object is EA plus six
 * enumerated fields plus a five-slot identifier chain, and unused slots are written as zero.
 *
 * Numbers are still kept as lists rather than as named fields, because WHICH field a number is depends on
 * the engine: Torment gives an object a FACTION and a TEAM the others lack and a coordinate of its own to
 * every trigger, Icewind Dale II adds a SUBRACE and two fields it stores past the name, and every engine but
 * the BG family gives an object a rectangle. A codec that named them would need to know the engine to read a
 * file at all, which is the one thing a round-trip must not need. Naming belongs to the layer that also
 * resolves ids against an install's own ACTION.IDS and TRIGGER.IDS.
 */

/** The target of a trigger or action: `OB` ... `OB`. */
export interface BcsObject {
    /** Every plain number stored ahead of the name. Twelve on BG, fourteen on PST, thirteen on IWD2. */
    ints: number[];
    /**
     * The bracketed rectangle stored between the numbers and the name - four dot-separated values, `-1`
     * meaning unused. Absent on BG, which has no such field at all; present on PST, IWD and IWD2.
     */
    region?: number[];
    /** The one quoted field an object carries; empty in most records. */
    string: string;
    /** Numbers stored AFTER the name. IWD2 alone does this, putting two of its extra fields there. */
    trailingInts?: number[];
}

/** `TR` ... `TR`, inside a condition. */
export interface BcsTrigger {
    ints: number[];
    /**
     * A PST trigger's coordinate, stored among the numbers rather than after the strings. Written with a
     * COMMA where an object's rectangle uses dots, so the two bracket forms are not interchangeable.
     */
    point?: number[];
    /** Both quoted fields, or none - the BG1-era writer emits neither rather than a pair of empty ones. */
    strings: string[];
    object: BcsObject;
}

/** `AC` ... `AC`, inside a response. */
export interface BcsAction {
    id: number;
    /** Always three: the acting object, the target, and a third the engine reads per action. */
    objects: BcsObject[];
    ints: number[];
    /** Both quoted fields, or none. */
    strings: string[];
}

/** `RE` ... `RE`, inside a response set. A response with no actions is real and ships in 28 files. */
export interface BcsResponse {
    weight: number;
    actions: BcsAction[];
}

/** `CR` ... `CR`: one condition and one response set, which is the only shape the corpus contains. */
export interface BcsBlock {
    triggers: BcsTrigger[];
    responses: BcsResponse[];
}

/** `SC` ... `SC`, the whole file. */
export interface BcsScript {
    blocks: BcsBlock[];
}
