/**
 * BCS -> BAF source.
 *
 * A stored record holds numbers; BAF holds names, and every name comes from an IDS table the INSTALL ships.
 * So this resolves nothing itself - the caller passes a `BcsSymbols` it built from a game, exactly as a parsed
 * binary record leaves its external references to whoever holds the install. That also keeps the codec's
 * round-trip independent of any game.
 *
 * Two rules here are the reference implementation's rather than the format spec's, because `bcs.htm` does not
 * state them and states one of them wrongly:
 *
 * - An action's stored FIRST object is not an argument. It is an acting-object override, and it prints as an
 *   `ActionOverride(<that object>, <the action>)` wrapper. ACTION.IDS does list an `ActionOverride` id, but no
 *   stored action carries it (0 of 90852 across a stock BG:EE plus BG2:ToB pair) - the id is a source-level
 *   spelling the compiler resolves into this slot.
 * - An action's own object arguments therefore start at the SECOND stored slot.
 *
 * Where a value has no name in the tables the caller supplied, the number is emitted. Omitting it would shift
 * every later field in a bracket list onto the wrong name, and a number is still a true reading of the file.
 */

import type { BcsAction, BcsObject, BcsScript, BcsTrigger } from "./types";

/**
 * Which game's script conventions to name a record by.
 *
 * The codec needs none of this - a file reads and writes byte-identically without it - but naming does: the
 * same stored number is a different field, and looks up in a different table, depending on the engine. `bg`
 * covers the Baldur's Gate family including the Enhanced Editions, whose scripts share one object layout.
 */
export type BcsEngine = "bg" | "iwd" | "iwd2" | "pst";

/**
 * The install's own naming tables. A lookup that finds nothing leaves the value as a number.
 *
 * Signature lookups return EVERY row the table gives an id, because tables really do give one id several, and
 * they are not synonyms: BG2:ToB's ACTION.IDS reads 160 as both `ApplySpell(O:Target,I:Spell*Spell)` and
 * `ApplySpellRES(S:RES*,O:Target)`, one taking the spell as a number and the other as a resref. Only the
 * stored record says which was written, so the choice is made here rather than by whoever read the table.
 */
export interface BcsSymbols {
    /** Every TRIGGER.IDS row for an id, e.g. `Specifics(O:Object*,I:Specifics*Specific)`. */
    trigger(id: number): readonly string[];
    /** Every ACTION.IDS row for an id. */
    action(id: number): readonly string[];
    /** An IDS table by name, without the extension, for enumerated arguments and object fields. */
    ids(table: string): ReadonlyMap<number, string> | undefined;
}

/** One parameter of an IDS signature: `I:Value*Table` is type `I` tagged `Value` naming `Table`. */
interface Parameter {
    type: string;
    tag: string;
    table: string | undefined;
}

/** An `Area` is stored in front of its `Name` inside one string, and is always exactly this long. */
const AREA_LENGTH = 6;

/** What an unconstrained object is called. Not an IDS entry; see `renderObject`. */
const ANYONE = "ANYONE";

/**
 * The object's enumerated fields, in stored order, with the table that names each - the one thing about an
 * object that a record cannot tell you and only the engine can. The five identifier slots follow the fields and
 * are always resolved against OBJECT.IDS.
 *
 * Torment inserts FACTION and TEAM straight after EA, so the same two stored numbers BG reads as GENERAL and
 * RACE name entirely different tables there; Icewind Dale II appends SUBRACE, and then AVCLASS and CLASSMSK,
 * which it stores AFTER the object's name while printing them in list position like any other field.
 */
const OBJECT_TARGETS = {
    bg: ["EA", "GENERAL", "RACE", "CLASS", "SPECIFIC", "GENDER", "ALIGN"],
    iwd: ["EA", "GENERAL", "RACE", "CLASS", "SPECIFIC", "GENDER", "ALIGN"],
    pst: ["EA", "FACTION", "TEAM", "GENERAL", "RACE", "CLASS", "SPECIFIC", "GENDER", "ALIGN"],
    iwd2: ["EA", "GENERAL", "RACE", "CLASS", "SPECIFIC", "GENDER", "ALIGNMNT", "SUBRACE", "AVCLASS", "CLASSMSK"],
} as const satisfies Record<BcsEngine, readonly string[]>;

const IDENTIFIER_SLOTS = 5;

const SIGNATURE = /^([^(]+)\((.*)\)$/s;

/** Marks an argument this cannot render, so the whole call falls back to its id. */
const UNREADABLE = "\u0000unreadable";

function parseSignature(text: string): { name: string; parameters: Parameter[] } | undefined {
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

/**
 * The values for a signature's string parameters, in signature order.
 *
 * An action or trigger has room for two strings but some take four, packing an `Area` in front of a `Name`
 * inside one stored string - the global-variable calls are the usual case. The spec is blunt that there is no
 * derivable rule for which calls do this; the signature's own `Area` tag is the one marker the table carries,
 * so that is what selects the split rather than a list of ids transcribed by hand.
 */
function stringArguments(tags: string[], stored: string[]): string[] {
    const isArea = (tag: string): boolean => tag.toLowerCase() === "area";

    // How many pairs must be packed: every parameter the record has no slot for. The tag alone cannot say -
    // `Global` and `LeaveAreaLUAPanicEntry` both name an `Area` and only the first packs - and neither can "is
    // the partner slot empty", which `CreateCreatureAtLocation(S:GLOBAL*,S:Area*,S:ResRef*)` breaks by fitting
    // three parameters into two filled slots. The shortfall counts exactly the packing that must have happened.
    let packsLeft = Math.max(0, tags.length - stored.filter((value) => value !== "").length);

    const values: string[] = [];
    let slot = 0;
    for (let i = 0; i < tags.length;) {
        const next = tags[i + 1];
        const first = stored[slot] ?? "";
        const packs =
            packsLeft > 0 &&
            next !== undefined &&
            (isArea(tags[i]!) || isArea(next)) &&
            // An area is exactly six bytes, so a string no longer than that has nothing packed behind it.
            first.length > AREA_LENGTH;
        if (packs) {
            packsLeft--;
            const area = first.slice(0, AREA_LENGTH);
            const name = first.slice(AREA_LENGTH);
            values.push(isArea(tags[i]!) ? area : name, isArea(next) ? area : name);
            slot += 1;
            i += 2;
        } else {
            values.push(first);
            slot += 1;
            i += 1;
        }
    }
    return values;
}

/**
 * Which of an id's rows the record was written against.
 *
 * The stored strings decide: `ApplySpell` takes its spell as a number and `ApplySpellRES` as a resref, so a
 * record holding a string was written against the second and reading it as the first drops the resref
 * entirely. Rows that take as many strings as the record filled are the candidates; the last wins, which is
 * also what settles the pure aliases (`Dialogue` and `Dialog` differ in nothing else). Where no row fits, the
 * last is still emitted - a name with the wrong argument shape beats no name at all.
 */
function selectSignature(candidates: readonly string[], strings: readonly string[]): string | undefined {
    if (candidates.length <= 1) return candidates[0];
    const filled = strings.filter((value) => value !== "").length;
    const fitting = candidates.filter((candidate) => {
        const parsed = parseSignature(candidate);
        return parsed !== undefined && parsed.parameters.filter((p) => p.type === "S").length === filled;
    });
    return (fitting.length > 0 ? fitting : candidates).at(-1);
}

function lookup(value: number, table: string | undefined, symbols: BcsSymbols): string | undefined {
    if (table === undefined) return undefined;
    const rows = symbols.ids(table);
    // A record stores a signed dword while a table may write the same bits unsigned - STATE.IDS spells
    // STATE_CONFUSED `0x80000000`, which arrives here as -2147483648. Both readings name one value.
    const unsigned = value < 0 ? value + 0x1_0000_0000 : value;
    return rows?.get(value) ?? rows?.get(unsigned);
}

function named(value: number, table: string | undefined, symbols: BcsSymbols): string {
    return lookup(value, table, symbols) ?? String(value);
}

/** A rectangle of four -1s is the "unused" the engines that have the field store, so it is not a coordinate. */
function isEmptyRegion(region: readonly number[] | undefined): boolean {
    return region === undefined || region.every((side) => side === -1);
}

function isEmptyObject(object: BcsObject): boolean {
    return (
        object.string === "" &&
        object.ints.every((value) => value === 0) &&
        (object.trailingInts ?? []).every((value) => value === 0) &&
        isEmptyRegion(object.region)
    );
}

/**
 * `[EA.GENERAL...]` for the enumerated fields, wrapped by each identifier slot in turn - stored `Myself` then
 * `NearestEnemyOf` prints as `NearestEnemyOf(Myself)`. Trailing zeroes are dropped from the bracket list, so a
 * creature filtered only by allegiance reads `[PC]` rather than seven fields of nothing.
 */
function renderObject(object: BcsObject, symbols: BcsSymbols, engine: BcsEngine): string {
    // The identifier chain is the five numbers immediately before the name, whatever an engine stores ahead of
    // them, so the split is taken from the end rather than from a per-engine field count. Everything else is an
    // enumerated field, including the two IWD2 keeps after the name.
    const split = Math.max(0, object.ints.length - IDENTIFIER_SLOTS);
    const fields = [...object.ints.slice(0, split), ...(object.trailingInts ?? [])];
    let last = fields.length;
    while (last > 0 && fields[last - 1] === 0) last--;

    let text = "";
    if (last > 0) {
        const tables = OBJECT_TARGETS[engine];
        // A zero field is "unconstrained", not a value to look up, even where the table happens to name 0 -
        // GENERAL.IDS calls it GENERAL_ITEM, which would read as a filter the record does not apply.
        text = `[${fields
            .slice(0, last)
            .map((value, index) => (value === 0 ? "0" : namedField(fields, index, tables, symbols)))
            .join(".")}]`;
    } else if (object.string !== "") {
        text = `"${object.string}"`;
    }

    const identifiers = object.ints.slice(split);
    for (const slot of identifiers) {
        if (slot === 0) continue;
        const name = named(slot, "OBJECT", symbols);
        text = text === "" ? name : `${name}(${text})`;
    }

    // The rectangle prints last, outside the identifier wrapping rather than inside the bracket list.
    const rectangle = object.region;
    const region = rectangle === undefined || isEmptyRegion(rectangle) ? "" : `[${rectangle.join(".")}]`;

    // An argument position the record left entirely blank still has to print something, and it means "no
    // constraint". No IDS table names it - EA.IDS starts at 1 - so the name is supplied here, which is the one
    // case a name may be, because it is a key the install's tables structurally cannot reach. A zero in the
    // MIDDLE of a bracket list is a different thing and keeps its number: dropping it would shift every later
    // field onto the wrong name.
    return (text === "" ? `[${ANYONE}]` : text) + region;
}

/**
 * One enumerated field's name. Only IWD2 needs more than the value: its SUBRACE numbers repeat across races and
 * are keyed by the race packed into the high half, so the stored number alone names nothing. A combination the
 * table does not carry falls back to the number the file holds, not to the key that was looked up.
 */
function namedField(fields: readonly number[], index: number, tables: readonly string[], symbols: BcsSymbols): string {
    const value = fields[index]!;
    const subrace = tables.indexOf("SUBRACE");
    const race = subrace === -1 ? 0 : (fields[tables.indexOf("RACE")] ?? 0);
    const key = index === subrace ? value | (race << 16) : value;
    return lookup(key, tables[index], symbols) ?? String(value);
}

/** Draws each argument from the pool its type reads, in the order the signature lists them. */
function renderCall(
    signature: string,
    symbols: BcsSymbols,
    engine: BcsEngine,
    pools: { integers: number[]; strings: string[]; objects: BcsObject[]; point: readonly number[] },
): string | undefined {
    const parsed = parseSignature(signature);
    if (parsed === undefined) return undefined;

    const strings = stringArguments(
        parsed.parameters.filter((parameter) => parameter.type === "S").map((parameter) => parameter.tag),
        pools.strings,
    );

    let integer = 0;
    let string = 0;
    let object = 0;
    const args = parsed.parameters.map((parameter) => {
        switch (parameter.type) {
            case "I":
                return named(pools.integers[integer++] ?? 0, parameter.table, symbols);
            case "S":
                return `"${strings[string++] ?? ""}"`;
            case "O":
                return renderObject(pools.objects[object++] ?? { ints: [], string: "" }, symbols, engine);
            case "P":
                return `[${pools.point[0] ?? 0}.${pools.point[1] ?? 0}]`;
            default:
                // `A:` (an action argument) has no stored instance in the BG family to read a form off, so it
                // is refused by name rather than guessed at - see the README's known gaps.
                return UNREADABLE;
        }
    });
    if (args.includes(UNREADABLE)) return undefined;
    return `${parsed.name}(${args.join(",")})`;
}

/**
 * Stored trigger numbers are `[id, integer, flags, integer, integer]`, so its integer arguments are not
 * adjacent. Bit 0 of the flags negates the condition.
 *
 * The spec calls the last of those "an integer of unknown purpose", and it is a third integer ARGUMENT:
 * `NearLocation(O:Object*,I:PointX*,I:PointY*,I:Range*)` takes three and a stock BG:EE stores its range there.
 */
function renderTrigger(trigger: BcsTrigger, symbols: BcsSymbols, engine: BcsEngine, override?: BcsTrigger): string {
    const id = trigger.ints[0] ?? 0;
    const signature = selectSignature(symbols.trigger(id), trigger.strings);
    const call =
        signature === undefined
            ? undefined
            : renderCall(signature, symbols, engine, {
                  integers: [trigger.ints[1] ?? 0, trigger.ints[3] ?? 0, trigger.ints[4] ?? 0],
                  strings: trigger.strings.length === 0 ? scavengedStrings([trigger.object]) : trigger.strings,
                  objects: [trigger.object],
                  // Only Torment stores a trigger coordinate, and it is the trigger's own point argument.
                  point: trigger.point ?? [],
              });
    const negated = ((trigger.ints[2] ?? 0) & 1) === 1;
    const text = call ?? `UnknownTrigger${id}()`;
    // The negation belongs to the trigger being retargeted, so it prints outside the wrapper.
    const retargeted =
        override === undefined ? text : `TriggerOverride(${renderObject(override.object, symbols, engine)},${text})`;
    return `${negated ? "!" : ""}${retargeted}`;
}

/**
 * Whether this record is the stored half of a `TriggerOverride`.
 *
 * Unlike `ActionOverride`, that construct is built from a REAL trigger: a `NextTriggerObject` record standing
 * in front of the trigger it retargets, which the two fold into one line. Matched on the name the install's
 * table gives the id rather than on the id itself - BG2:ToB's TRIGGER.IDS carries no such row at all, so the
 * fold never fires there, while a stock BG:EE stores 198 of them across 19 scripts.
 */
function isOverrideTrigger(trigger: BcsTrigger, symbols: BcsSymbols): boolean {
    const signature = selectSignature(symbols.trigger(trigger.ints[0] ?? 0), trigger.strings);
    const parsed = signature === undefined ? undefined : parseSignature(signature);
    return parsed?.name === "NextTriggerObject" && parsed.parameters.length === 1 && parsed.parameters[0]?.type === "O";
}

/**
 * Where a record's string arguments live when it stores no string slots at all.
 *
 * The BG1-era writer omits a record's quoted fields rather than writing empty ones, and a string argument it
 * still needs is carried in an object slot's name instead - `PlaySound` reads its sound from there in three of
 * BG2:ToB's 3823 scripts. Reading only the absent slots would silently print an empty argument.
 */
function scavengedStrings(objects: readonly BcsObject[]): string[] {
    return objects.map((object) => object.string).filter((name) => name !== "");
}

/** Stored action numbers are `[integer, pointX, pointY, integer, integer]`. */
function renderAction(action: BcsAction, symbols: BcsSymbols, engine: BcsEngine): string {
    const signature = selectSignature(symbols.action(action.id), action.strings);
    const call =
        signature === undefined
            ? undefined
            : renderCall(signature, symbols, engine, {
                  integers: [action.ints[0] ?? 0, action.ints[3] ?? 0, action.ints[4] ?? 0],
                  strings: action.strings.length === 0 ? scavengedStrings(action.objects.slice(1)) : action.strings,
                  // The first stored object is the acting-object override, not an argument.
                  objects: action.objects.slice(1),
                  point: [action.ints[1] ?? 0, action.ints[2] ?? 0],
              });
    const text = call ?? `UnknownAction${action.id}()`;

    const acting = action.objects[0];
    if (acting === undefined || isEmptyObject(acting)) return text;
    return `ActionOverride(${renderObject(acting, symbols, engine)},${text})`;
}

/**
 * How many following triggers an `OR` groups, or undefined for anything else. Matched on the name the install's
 * table gives the id rather than on the id itself, which differs between tables.
 */
function orCount(trigger: BcsTrigger, symbols: BcsSymbols): number | undefined {
    const signature = selectSignature(symbols.trigger(trigger.ints[0] ?? 0), trigger.strings);
    if (signature === undefined) return undefined;
    const parsed = parseSignature(signature);
    return parsed?.name === "OR" ? (trigger.ints[1] ?? 0) : undefined;
}

/**
 * Emits the whole script. Every block prints, including one whose condition holds no triggers or whose
 * response set is absent - the file says the block is there, and a view that dropped it would misreport what
 * the install actually runs.
 */
export function decompileBcs(script: BcsScript, symbols: BcsSymbols, engine: BcsEngine = "bg"): string {
    const out: string[] = [];
    for (const block of script.blocks) {
        out.push("IF");
        // `OR(n)` turns the next n triggers into alternatives; indenting them is what shows where the group
        // ends, since nothing closes it. A count running past the end of the condition simply stops there. It
        // counts LINES, so a folded override pair spends one slot rather than two.
        let grouped = 0;
        let override: BcsTrigger | undefined;
        for (const trigger of block.triggers) {
            if (override === undefined && isOverrideTrigger(trigger, symbols)) {
                override = trigger;
                continue;
            }
            const indent = grouped > 0 ? "    " : "  ";
            if (grouped > 0) grouped--;
            out.push(`${indent}${renderTrigger(trigger, symbols, engine, override)}`);
            override = undefined;
            const count = orCount(trigger, symbols);
            if (count !== undefined) grouped = count;
        }
        // An override with nothing after it has nothing to fold into, so it prints as the table names it.
        if (override !== undefined)
            out.push(`${grouped > 0 ? "    " : "  "}${renderTrigger(override, symbols, engine)}`);
        out.push("THEN");
        for (const response of block.responses) {
            out.push(`  RESPONSE #${response.weight}`);
            for (const action of response.actions) out.push(`    ${renderAction(action, symbols, engine)}`);
        }
        out.push("END", "");
    }
    return out.join("\n");
}
