/**
 * The tree a BCS file holds.
 *
 * Numbers are kept as lists rather than as named fields, and deliberately: the arity is engine-dependent.
 * Across 4939 real scripts an object carries 12, 13 or 14 numbers - PST adds two, BG1 omits the
 * coordinates - and a trigger or action carries between two and eight. A codec that named them would have
 * to know the engine to read a file at all, which is exactly the thing a round-trip must not need. Naming
 * belongs to the layer that also resolves ids against an install's own ACTION.IDS and TRIGGER.IDS.
 */

/** The target of a trigger or action: `OB` ... `OB`. */
export interface BcsObject {
    ints: number[];
    /** The one quoted field an object carries; empty in most records. */
    string: string;
}

/** `TR` ... `TR`, inside a condition. */
export interface BcsTrigger {
    ints: number[];
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
