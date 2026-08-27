/**
 * What an IDS signature says, and what an engine calls an object's fields.
 *
 * Shared by the two directions rather than owned by either: `decompile.ts` reads a stored record against a
 * signature and `compile.ts` fills one from source, so a disagreement about what `I:Spell*Spell` means, or
 * about which table names an object's third number, would be a round trip that quietly loses a field.
 */

/**
 * Which game's script conventions to read a record by.
 *
 * The codec needs none of this - a file reads and writes byte-identically without it - but naming does: the
 * same stored number is a different field, and looks up in a different table, depending on the engine. `bg`
 * covers the Baldur's Gate family including the Enhanced Editions, whose scripts share one object layout.
 */
export type BcsEngine = "bg" | "iwd" | "iwd2" | "pst";

/** One parameter of an IDS signature: `I:Value*Table` is type `I` tagged `Value` naming `Table`. */
export interface Parameter {
    type: string;
    tag: string;
    table: string | undefined;
}

/** An `Area` is stored in front of its `Name` inside one string, and is always exactly this long. */
export const AREA_LENGTH = 6;

/**
 * Whether a string parameter is the `Area` half of a packed pair.
 *
 * Prefix rather than equality: a call taking two global variables numbers its tags, and
 * `IncrementGlobalOnce(S:Name1*,S:Area1*,S:Name2*,S:Area2*,I:Val*)` packs BOTH pairs into its two slots.
 */
export function isAreaTag(tag: string | undefined): boolean {
    return tag !== undefined && tag.toLowerCase().startsWith("area");
}

/** What an unconstrained object is called. Not an IDS entry - see `renderObject`. */
export const ANYONE = "ANYONE";

/** How many identifier slots an object carries, whatever an engine stores ahead of them. */
export const IDENTIFIER_SLOTS = 5;

/**
 * The object's enumerated fields, in stored order, with the table that names each - the one thing about an
 * object that a record cannot tell you and only the engine can. The five identifier slots follow the fields
 * and are always resolved against OBJECT.IDS.
 *
 * Torment inserts FACTION and TEAM straight after EA, so the same two stored numbers BG reads as GENERAL and
 * RACE name entirely different tables there; Icewind Dale II appends SUBRACE, and then AVCLASS and CLASSMSK,
 * which it stores AFTER the object's name while printing them in list position like any other field.
 */
export const OBJECT_TARGETS = {
    bg: ["EA", "GENERAL", "RACE", "CLASS", "SPECIFIC", "GENDER", "ALIGN"],
    iwd: ["EA", "GENERAL", "RACE", "CLASS", "SPECIFIC", "GENDER", "ALIGN"],
    pst: ["EA", "FACTION", "TEAM", "GENERAL", "RACE", "CLASS", "SPECIFIC", "GENDER", "ALIGN"],
    iwd2: ["EA", "GENERAL", "RACE", "CLASS", "SPECIFIC", "GENDER", "ALIGNMNT", "SUBRACE", "AVCLASS", "CLASSMSK"],
} as const satisfies Record<BcsEngine, readonly string[]>;

/**
 * How many of an engine's enumerated fields are stored AFTER the object's name rather than before it.
 *
 * IWD2 alone does this, with the last two of its ten. They still print in list position, so the split is a
 * storage detail the two directions have to agree on and nothing else reads.
 */
export const TRAILING_FIELDS: Record<BcsEngine, number> = { bg: 0, iwd: 0, pst: 0, iwd2: 2 };

/** Whether this engine gives an object a rectangle between its numbers and its name. */
export function hasRegion(engine: BcsEngine): boolean {
    return engine !== "bg";
}

const SIGNATURE = /^([^(]+)\((.*)\)$/s;

export function parseSignature(text: string): { name: string; parameters: Parameter[] } | undefined {
    const match = SIGNATURE.exec(text.trim());
    if (match === null) return undefined;
    const body = match[2]!.trim();
    const parameters = body === "" ? [] : body.split(",").map((part) => parseParameter(part));
    return { name: match[1]!.trim(), parameters };
}

function parseParameter(text: string): Parameter {
    const trimmed = text.trim();
    // The tag between `:` and `*` carries spaces in real tables ("Hit Points"), and the trailing `*` is not
    // always written - ACTION.IDS spells one parameter `O:Target` with no asterisk at all.
    const star = trimmed.indexOf("*");
    const colon = trimmed.indexOf(":");
    const tagEnd = star === -1 ? trimmed.length : star;
    const table = star === -1 ? "" : trimmed.slice(star + 1).trim();
    return {
        type: trimmed.slice(0, 1),
        tag: colon === -1 ? "" : trimmed.slice(colon + 1, tagEnd).trim(),
        table: table === "" ? undefined : table,
    };
}
