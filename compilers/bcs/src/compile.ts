/**
 * BAF source -> BCS.
 *
 * The inverse of `decompile.ts`, and it resolves nothing itself for the same reason: every name in a script
 * is a number the INSTALL's own IDS tables assign, so the caller passes the tables and the codec stays usable
 * with no game present.
 *
 * The source is read with the tree-sitter BAF grammar the language server and formatter already use, handed
 * in by the caller exactly as the SSL compiler takes its parser. A second BAF parser would be a second
 * opinion about what `[10.10]` means - the grammar resolves that ambiguity (a point, not an `EA.GENERAL`
 * specifier) on the evidence of the shipped scripts, and a compiler that disagreed with the editor about it
 * would compile something other than what the editor highlights.
 *
 * Three constructs are source-level spellings with no stored form of their own, so they are resolved here
 * rather than emitted:
 *
 * - `ActionOverride(<object>, <action>)` writes the INNER action's record with the override in its first
 *   object slot. Nothing nested is ever stored, and ACTION.IDS's own `ActionOverride` id never reaches a file.
 * - `TriggerOverride(<object>, <trigger>)` is NOT that mechanism: it writes a real `NextTriggerObject` record
 *   in front of the trigger it retargets, and the pair spends one slot of an enclosing `OR(n)`.
 * - `OR(n)` is itself a stored trigger record, whose first integer is the count.
 */

import { collectParseErrors } from "../../../shared/parse-errors";
import { SyntaxType } from "../../../shared/syntax-types/weidu-baf";
import type { Node as SyntaxNode, Parser } from "web-tree-sitter";
import {
    ANYONE,
    hasRegion,
    IDENTIFIER_SLOTS,
    isAreaTag,
    OBJECT_TARGETS,
    parseSignature,
    TRAILING_FIELDS,
    type BcsEngine,
    type Parameter,
} from "./signature";
import type { BcsAction, BcsBlock, BcsObject, BcsResponse, BcsScript, BcsTrigger } from "./types";

/** One row of an IDS table, as the compiler needs it: a name resolves to an id AND to the shape it takes. */
export interface BcsSignatureRow {
    readonly id: number;
    readonly signature: string;
}

/**
 * The install's own naming tables, read in the direction compiling needs.
 *
 * Named apart from `BcsSymbols`'s id-keyed `trigger`/`action` so one object can satisfy both interfaces - a
 * caller holding a game resolves in both directions from the same tables, and making it hold two objects
 * would invite the two to be built from different reads of one file.
 *
 * `ids` is the SAME accessor the decompiler uses, value-keyed. Inverting it is this module's job: a table
 * naming two values alike is a table property, and the two directions must not disagree about which name
 * won.
 */
export interface BcsCompileSymbols {
    /** Every TRIGGER.IDS row whose call is spelled `name`, case-insensitively. */
    triggerByName(name: string): readonly BcsSignatureRow[];
    /** Every ACTION.IDS row whose call is spelled `name`. */
    actionByName(name: string): readonly BcsSignatureRow[];
    /** An IDS table by name, without the extension, for enumerated arguments and object fields. */
    ids(table: string): ReadonlyMap<number, string> | undefined;
}

/**
 * The two table accessors the inversion reads. Narrower than `Game` so a caller can satisfy it without
 * opening an install, which is what lets this be tested and reused on both sides of the extension.
 */
export interface BcsTableSource {
    idsAll(resref: string): ReadonlyMap<number, readonly string[]> | undefined;
    ids(table: string): ReadonlyMap<number, string> | undefined;
}

/**
 * Builds the compile-direction symbols from an install's tables.
 *
 * The index is built once per call rather than per lookup: compiling asks for a name per call, and rebuilding
 * it each time would re-walk a table of hundreds of rows thousands of times in one compile. A name is keyed
 * lower-case and keeps EVERY row that spells it, because ACTION.IDS names one id twice over and only the call
 * site's argument shape says which row was meant.
 */
export function compileSymbolsFrom(game: BcsTableSource): BcsCompileSymbols {
    const index = (resref: string): Map<string, BcsSignatureRow[]> => {
        const byName = new Map<string, BcsSignatureRow[]>();
        for (const [id, signatures] of game.idsAll(resref) ?? []) {
            for (const signature of signatures) {
                const open = signature.indexOf("(");
                const name = (open === -1 ? signature : signature.slice(0, open)).trim().toLowerCase();
                byName.set(name, [...(byName.get(name) ?? []), { id, signature }]);
            }
        }
        return byName;
    };
    const triggers = index("TRIGGER");
    const actions = index("ACTION");
    return {
        triggerByName: (name) => triggers.get(name.toLowerCase()) ?? [],
        actionByName: (name) => actions.get(name.toLowerCase()) ?? [],
        ids: (table) => game.ids(table),
    };
}

/** One located complaint, so a caller can place it without parsing the message back apart. */
export interface BcsCompileDiagnostic {
    /** 1-based, as an editor counts them. */
    line: number;
    column: number;
    message: string;
}

export class BcsCompileError extends Error {
    /**
     * Every problem this compile found, not just the one the message names. A script with four unresolvable
     * names otherwise costs four compile-and-read cycles to clean up.
     */
    readonly diagnostics: readonly BcsCompileDiagnostic[];

    constructor(diagnostics: BcsCompileDiagnostic[]) {
        const first = diagnostics[0];
        super(first ? `${first.line}:${first.column}: ${first.message}` : "compilation failed");
        this.name = "BcsCompileError";
        this.diagnostics = diagnostics;
    }
}

/** How many quoted fields a stored record has room for. Both are always written, even when empty. */
const STRING_SLOTS = 2;

/**
 * The calls that pack two of their string arguments into one stored slot, an `Area` of six characters in
 * front of its partner.
 *
 * This is the one thing about a call that its signature does not carry, and the only list in the codec. The
 * decompiler needs no such list - it counts the shortfall between a signature's string parameters and the
 * slots the record actually filled - but a compiler has no record to count against, so the decision has to
 * be made from the name.
 *
 * Measured rather than transcribed: every signature taking two or more strings in a stock BG:EE plus BG2:ToB
 * pair (58 and 34 of them) was compiled by the reference implementation with distinguishable arguments, and
 * these are the ones whose output held a pair in one slot. The tags do not predict it -
 * `Global(S:Name*,S:Area*,I:Value*)` packs and `GlobalTimerExpired(S:Name*,S:Area*)` does not, though the two
 * declare the same pair - which is why this is data and not a rule.
 *
 * Keyed by name rather than by id, because an id means different things across editions. Both editions had
 * to be measured even so: BG:EE names six calls ToB has no row for, and spells `MoveToSavedLocation` without
 * the second `n` ToB gives it. A name absent here compiles to two separate slots, which is what the reference
 * does for every call outside its own list.
 */
const PACKED_CALLS: ReadonlySet<string> = new Set(
    [
        "CreateCreatureAtLocation",
        "CreateItemGlobal",
        "Global",
        "GlobalGT",
        "GlobalLT",
        "IncrementGlobal",
        "IncrementGlobalOnce",
        "MoveToSavedLocation",
        "MoveToSavedLocationn",
        "RealSetGlobalTimer",
        "SetGlobal",
        "SetGlobalRandom",
        "SetGlobalRandomPlus",
        "SetGlobalTimer",
        "SetGlobalTimerRandom",
        "SetTokenGlobal",
    ].map((name) => name.toLowerCase()),
);

const UNKNOWN_TRIGGER = /^UnknownTrigger(\d+)$/i;
const UNKNOWN_ACTION = /^UnknownAction(\d+)$/i;

/**
 * Compiles BAF source into the tree `writeBcs` turns into a file.
 *
 * Only the `bg` engine is gated against the reference implementation; the other three write the object
 * layouts `decompileBcs` reads, which are spec-faithful rather than measured - see the README's Engines
 * section.
 */
export function compileBaf(
    parser: Parser,
    text: string,
    symbols: BcsCompileSymbols,
    engine: BcsEngine = "bg",
): BcsScript {
    const tree = parser.parse(text);
    if (tree === null) throw new BcsCompileError([{ line: 1, column: 1, message: "parser returned no tree" }]);
    try {
        // A tree-sitter parse always succeeds, standing in ERROR and MISSING nodes for whatever did not fit
        // the grammar. Walking past those would compile a script built from the fragments that did fit, so
        // the refusal happens before any of it is read.
        const errors = collectParseErrors(tree.rootNode);
        if (errors.length > 0) {
            throw new BcsCompileError(
                errors.map((error) => ({
                    ...at(error),
                    message: error.isMissing ? `missing ${error.type}` : "syntax error",
                })),
            );
        }
        return new Compiler(symbols, engine).script(tree.rootNode);
    } finally {
        tree.delete();
    }
}

function at(node: SyntaxNode): { line: number; column: number } {
    return { line: node.startPosition.row + 1, column: node.startPosition.column + 1 };
}

/**
 * A record stores a signed dword, while a table may write the same bits unsigned - STATE.IDS spells
 * STATE_SILENCED `0x80000000`. Both readings name one value, and this is the one a file holds.
 *
 * Wrapping, not truncation: `0x80000000` has to come back as -2147483648, which rounding would leave alone.
 */
function int32(value: number): number {
    return Int32Array.of(value)[0]!;
}

/** A run of unset numbers, which is what most of a record's fields are. */
const zeros = (count: number): number[] => Array.from({ length: count }, () => 0);

/**
 * The named children that carry meaning; comments are extras the grammar hangs anywhere.
 *
 * Every field this file reads is mandatory in the grammar, so the `!`s at the call sites are not optimism:
 * a source that did not fit was refused as a parse error before any of this ran, and a MISSING node for an
 * absent field is one of the things that refusal catches.
 */
function items(node: SyntaxNode): SyntaxNode[] {
    return node.namedChildren.filter(
        (child): child is SyntaxNode =>
            child !== null && child.type !== SyntaxType.Comment && child.type !== SyntaxType.LineComment,
    );
}

class Compiler {
    private readonly symbols: BcsCompileSymbols;
    private readonly engine: BcsEngine;
    private readonly diagnostics: BcsCompileDiagnostic[] = [];
    /** Each table inverted once. A table is read per argument otherwise, and scripts repeat names heavily. */
    private readonly byName = new Map<string, ReadonlyMap<string, number>>();

    constructor(symbols: BcsCompileSymbols, engine: BcsEngine) {
        this.symbols = symbols;
        this.engine = engine;
    }

    script(root: SyntaxNode): BcsScript {
        const blocks = items(root)
            .filter((node) => node.type === SyntaxType.Block)
            .map((node) => this.block(node));
        // Every problem at once rather than the first: they are already in hand, and a name that resolves
        // nowhere is usually one of several in a script written against another install's tables.
        if (this.diagnostics.length > 0) throw new BcsCompileError(this.diagnostics);
        return { blocks };
    }

    private fail(node: SyntaxNode, message: string): void {
        this.diagnostics.push({ ...at(node), message });
    }

    private block(node: SyntaxNode): BcsBlock {
        const triggers: BcsTrigger[] = [];
        for (const item of items(node.childForFieldName("if")!)) {
            if (item.type === SyntaxType.OrMarker) {
                triggers.push(this.orMarker(item));
                continue;
            }
            const call = item.childForFieldName("call")!;
            // The `!` negation is an anonymous child, so it is looked for among the children rather than at
            // the start of the text - a comment is an extra the grammar hangs anywhere, this one included.
            const negated = item.children.some((child) => child?.type === "!");
            if (this.callName(call).toLowerCase() === "triggeroverride") {
                const args = this.arguments(call);
                if (args.length !== 2 || args[1]!.type !== SyntaxType.CallExpr) {
                    this.fail(call, "TriggerOverride takes an object and the trigger it retargets");
                    continue;
                }
                triggers.push(this.nextTriggerObject(call, args[0]!), this.trigger(args[1]!, negated));
                continue;
            }
            triggers.push(this.trigger(call, negated));
        }

        const responses = items(node.childForFieldName("then")!)
            .filter((item) => item.type === SyntaxType.Response)
            .map((item) => this.response(item));
        return { triggers, responses };
    }

    private response(node: SyntaxNode): BcsResponse {
        const weight = node.childForFieldName("weight");
        return {
            weight: weight === null ? 0 : this.integer(weight),
            actions: items(node)
                .filter((item) => item.type === SyntaxType.Action)
                .map((item) => this.action(item)),
        };
    }

    // ---- calls -------------------------------------------------------------------------------------

    private callName(call: SyntaxNode): string {
        return call.childForFieldName("func")?.text ?? "";
    }

    private arguments(call: SyntaxNode): SyntaxNode[] {
        return call.childrenForFieldName("args").filter((child): child is SyntaxNode => child !== null);
    }

    /**
     * Which of a name's rows the source was written against.
     *
     * A name almost always has one row; where it has several they differ in argument count, so the count
     * settles it. Falling back to the last rather than refusing keeps a script compiling against a table
     * whose row this build does not understand, and the argument binding below reports what it could not fill.
     */
    private select(rows: readonly BcsSignatureRow[], count: number): BcsSignatureRow | undefined {
        if (rows.length <= 1) return rows[0];
        const fitting = rows.filter((row) => parseSignature(row.signature)?.parameters.length === count);
        return (fitting.length > 0 ? fitting : rows).at(-1);
    }

    private trigger(call: SyntaxNode, negated: boolean): BcsTrigger {
        const name = this.callName(call);
        const unknown = UNKNOWN_TRIGGER.exec(name);
        if (unknown !== null) return this.emptyTrigger(Number(unknown[1]), negated);

        const args = this.arguments(call);
        const row = this.select(this.symbols.triggerByName(name), args.length);
        if (row === undefined) {
            this.fail(call, `this game's TRIGGER.IDS has no trigger called ${name}`);
            return this.emptyTrigger(0, negated);
        }
        const bound = this.bind(call, row, args);
        return {
            // The flags word carries the negation in bit 0; nothing else in the corpus sets another bit.
            ints: [row.id, bound.integers[0] ?? 0, negated ? 1 : 0, bound.integers[1] ?? 0, bound.integers[2] ?? 0],
            ...(this.engine === "pst" ? { point: bound.point ?? [0, 0] } : {}),
            strings: bound.strings,
            object: bound.objects[0] ?? this.emptyObject(),
        };
    }

    private emptyTrigger(id: number, negated: boolean): BcsTrigger {
        return {
            ints: [id, 0, negated ? 1 : 0, 0, 0],
            ...(this.engine === "pst" ? { point: [0, 0] } : {}),
            strings: ["", ""],
            object: this.emptyObject(),
        };
    }

    /** The stored half of a `TriggerOverride`: a real record the table has to name for one to be written. */
    private nextTriggerObject(call: SyntaxNode, target: SyntaxNode): BcsTrigger {
        const row = this.select(this.symbols.triggerByName("NextTriggerObject"), 1);
        if (row === undefined) {
            this.fail(call, "this game's TRIGGER.IDS has no NextTriggerObject, so TriggerOverride cannot be written");
            return this.emptyTrigger(0, false);
        }
        return { ...this.emptyTrigger(row.id, false), object: this.object(target) };
    }

    /** `OR(n)` is a stored trigger whose first integer is how many of the following it groups. */
    private orMarker(node: SyntaxNode): BcsTrigger {
        const row = this.select(this.symbols.triggerByName("OR"), 1);
        if (row === undefined) {
            this.fail(node, "this game's TRIGGER.IDS has no OR");
            return this.emptyTrigger(0, false);
        }
        const count = node.childForFieldName("count");
        const trigger = this.emptyTrigger(row.id, false);
        trigger.ints[1] = count === null ? 0 : this.integer(count);
        return trigger;
    }

    private action(node: SyntaxNode): BcsAction {
        let call = node.childForFieldName("call")!;

        // The acting-object override wraps the action it applies to, and only the inner one is stored.
        let acting: BcsObject | undefined;
        if (this.callName(call).toLowerCase() === "actionoverride") {
            const args = this.arguments(call);
            if (args.length !== 2 || args[1]!.type !== SyntaxType.CallExpr) {
                this.fail(call, "ActionOverride takes an object and the action it applies to");
                return this.emptyAction(0);
            }
            acting = this.object(args[0]!);
            call = args[1]!;
        }

        const name = this.callName(call);
        const unknown = UNKNOWN_ACTION.exec(name);
        if (unknown !== null) return { ...this.emptyAction(Number(unknown[1])), objects: this.objects(acting, []) };

        const args = this.arguments(call);
        const row = this.select(this.symbols.actionByName(name), args.length);
        if (row === undefined) {
            this.fail(call, `this game's ACTION.IDS has no action called ${name}`);
            return this.emptyAction(0);
        }
        const bound = this.bind(call, row, args);
        const point = bound.point ?? [0, 0];
        return {
            id: row.id,
            objects: this.objects(acting, bound.objects),
            ints: [
                bound.integers[0] ?? 0,
                point[0] ?? 0,
                point[1] ?? 0,
                bound.integers[1] ?? 0,
                bound.integers[2] ?? 0,
            ],
            strings: bound.strings,
        };
    }

    private emptyAction(id: number): BcsAction {
        return { id, objects: this.objects(undefined, []), ints: [0, 0, 0, 0, 0], strings: ["", ""] };
    }

    /** An action always stores three objects: the acting-object override, then its own two argument slots. */
    private objects(acting: BcsObject | undefined, args: readonly BcsObject[]): BcsObject[] {
        return [acting ?? this.emptyObject(), args[0] ?? this.emptyObject(), args[1] ?? this.emptyObject()];
    }

    // ---- arguments ---------------------------------------------------------------------------------

    /**
     * Draws each argument into the pool its type stores it in, in the order the signature lists them.
     *
     * A record holds its integers, strings and objects in fixed slots rather than in argument order, so this
     * is where a signature stops mattering: what comes out is what a record has room for.
     */
    private bind(
        call: SyntaxNode,
        row: BcsSignatureRow,
        args: readonly SyntaxNode[],
    ): { integers: number[]; strings: string[]; objects: BcsObject[]; point: number[] | undefined } {
        const parsed = parseSignature(row.signature);
        const parameters = parsed?.parameters ?? [];
        if (args.length !== parameters.length) {
            this.fail(
                call,
                `${row.signature} takes ${parameters.length} argument${parameters.length === 1 ? "" : "s"}, ` +
                    `not ${args.length}`,
            );
        }

        const integers: number[] = [];
        const strings: string[] = [];
        const objects: BcsObject[] = [];
        let point: number[] | undefined;
        for (const [index, parameter] of parameters.entries()) {
            const arg = args[index];
            if (arg === undefined) continue;
            switch (parameter.type) {
                case "I":
                    integers.push(this.enumerated(arg, parameter));
                    break;
                case "S":
                    strings.push(this.string(arg));
                    break;
                case "O":
                    objects.push(this.object(arg));
                    break;
                case "P":
                    point = this.point(arg);
                    break;
                default:
                    // `A:` - an action passed to another action. The format reference says outright that it
                    // does not know how one is stored, and no record in the corpus carries one, so refusing
                    // is the only reading that cannot be wrong.
                    this.fail(arg, `${row.signature} takes an argument of a type BCS has no stored form for`);
            }
        }
        return { integers, strings: this.pack(call, parameters, strings), objects, point };
    }

    /**
     * The two stored string slots, from the values the signature's string parameters took.
     *
     * A packed pair concatenates verbatim with the `Area` first, whatever order the signature lists the two
     * in. The reference pads nothing, so an area shorter than six characters is one neither side reads back
     * apart - matched rather than guarded, since the engine's own area names are all six.
     */
    private pack(call: SyntaxNode, parameters: readonly Parameter[], values: readonly string[]): string[] {
        const tags = parameters.filter((parameter) => parameter.type === "S").map((parameter) => parameter.tag);
        const packs = PACKED_CALLS.has(this.callName(call).toLowerCase());

        const slots: string[] = [];
        for (let i = 0; i < tags.length;) {
            // Every such pair, not just the first: one call takes two global variables and packs both.
            const pair = packs && i + 1 < tags.length && (isAreaTag(tags[i]) || isAreaTag(tags[i + 1]));
            if (pair) {
                const area = isAreaTag(tags[i]) ? values[i] : values[i + 1];
                const name = isAreaTag(tags[i]) ? values[i + 1] : values[i];
                slots.push(`${area ?? ""}${name ?? ""}`);
                i += 2;
            } else {
                slots.push(values[i] ?? "");
                i += 1;
            }
        }
        if (slots.length > STRING_SLOTS) {
            this.fail(call, `this call's strings do not fit the ${STRING_SLOTS} a record stores`);
            slots.length = STRING_SLOTS;
        }
        while (slots.length < STRING_SLOTS) slots.push("");
        return slots;
    }

    private string(node: SyntaxNode): string {
        if (node.type !== SyntaxType.String) {
            this.fail(node, `expected a quoted string, not ${node.text}`);
            return "";
        }
        // Both spellings are one delimiter either side: `"text"` and `~text~`.
        return node.text.slice(1, -1);
    }

    private point(node: SyntaxNode): number[] {
        // `[10.20]` reads as a point, and an object specifier of exactly two numbers is the same bytes - the
        // grammar prefers the point, so a P parameter accepts either shape rather than refusing the other.
        const coordinates = items(node).map((child) => this.integer(child));
        if (coordinates.length !== 2) {
            this.fail(node, `expected a point like [640.480], not ${node.text}`);
            return [0, 0];
        }
        return coordinates;
    }

    /** An integer argument: a literal, or a name the parameter's own table gives a value. */
    private enumerated(node: SyntaxNode, parameter: Parameter): number {
        if (node.type === SyntaxType.Number) return this.integer(node);
        if (node.type !== SyntaxType.Identifier) {
            this.fail(node, `expected a number, not ${node.text}`);
            return 0;
        }
        const value = this.value(parameter.table, node.text);
        if (value === undefined) {
            this.fail(
                node,
                parameter.table === undefined
                    ? `${node.text} is a name where a number belongs, and this argument names no table`
                    : // Upper-cased because a signature spells its table however it likes - `I:Spell*Spell`
                      // names SPELL.IDS - and the message should name the file to go and look at.
                      `this game's ${parameter.table.toUpperCase()}.IDS does not name ${node.text}`,
            );
            return 0;
        }
        return value;
    }

    private integer(node: SyntaxNode): number {
        const text = node.text;
        const value = /^-?0x/i.test(text) ? Number.parseInt(text, 16) : Number(text);
        if (!Number.isFinite(value)) {
            this.fail(node, `${text} is not a number`);
            return 0;
        }
        return int32(value);
    }

    /** A table's name-to-value direction, built once per table and case-insensitive as the tables are used. */
    private value(table: string | undefined, name: string): number | undefined {
        if (table === undefined) return undefined;
        const key = table.toUpperCase();
        let inverted = this.byName.get(key);
        if (inverted === undefined) {
            const built = new Map<string, number>();
            // The FIRST name wins where a table spells one twice, which is the row a reader meets first.
            for (const [value, entry] of this.symbols.ids(table) ?? []) {
                const lowered = entry.toLowerCase();
                if (!built.has(lowered)) built.set(lowered, int32(value));
            }
            inverted = built;
            this.byName.set(key, inverted);
        }
        return inverted.get(name.toLowerCase());
    }

    // ---- objects -----------------------------------------------------------------------------------

    private emptyObject(): BcsObject {
        const targets = OBJECT_TARGETS[this.engine];
        const trailing = TRAILING_FIELDS[this.engine];
        return {
            ints: zeros(targets.length - trailing + IDENTIFIER_SLOTS),
            // A rectangle of four -1s is what the engines that have the field store for "unused"; the BG
            // family has no such field at all.
            ...(hasRegion(this.engine) ? { region: [-1, -1, -1, -1] } : {}),
            string: "",
            ...(trailing > 0 ? { trailingInts: zeros(trailing) } : {}),
        };
    }

    /**
     * An object argument, in any of the shapes the decompiler prints: a bracketed field list, a script name
     * in quotes, an identifier, and identifiers wrapping any of those.
     */
    private object(node: SyntaxNode): BcsObject {
        const targets = OBJECT_TARGETS[this.engine];
        const trailing = TRAILING_FIELDS[this.engine];
        const fields = zeros(targets.length);
        const slots: number[] = [];
        let text = "";

        // Each identifier wraps the layer inside it, so this walks from the outside in and stops at whatever
        // the innermost layer turns out to be - a field list, a script name, or nothing at all.
        for (let layer: SyntaxNode | undefined = node; layer !== undefined;) {
            switch (layer.type) {
                case SyntaxType.CallExpr:
                    slots.push(this.identifier(layer, this.callName(layer)));
                    layer = this.arguments(layer)[0];
                    continue;
                case SyntaxType.Identifier:
                    slots.push(this.identifier(layer, layer.text));
                    break;
                case SyntaxType.String:
                    // A script name, which is how most records name one specific creature.
                    text = this.string(layer);
                    break;
                case SyntaxType.ObjectRef:
                case SyntaxType.Point:
                    this.objectFields(layer, fields);
                    break;
                default:
                    this.fail(layer, `${layer.text} is not an object`);
            }
            layer = undefined;
        }

        // Stored innermost first: `NearestEnemyOf(LastSeenBy)` puts LastSeenBy in the first slot and its
        // wrapper in the second, so the chain collected from the outside in is reversed here.
        slots.reverse();
        if (slots.length > IDENTIFIER_SLOTS) {
            this.fail(node, `an object nests at most ${IDENTIFIER_SLOTS} identifiers`);
            slots.length = IDENTIFIER_SLOTS;
        }
        while (slots.length < IDENTIFIER_SLOTS) slots.push(0);

        return {
            ...this.emptyObject(),
            ints: [...fields.slice(0, targets.length - trailing), ...slots],
            string: text,
            ...(trailing > 0 ? { trailingInts: fields.slice(targets.length - trailing) } : {}),
        };
    }

    /** One identifier slot, resolved against OBJECT.IDS as every engine's are. */
    private identifier(node: SyntaxNode, name: string): number {
        const value = this.value("OBJECT", name);
        if (value !== undefined) return value;
        this.fail(node, `this game's OBJECT.IDS does not name ${name}`);
        return 0;
    }

    /** `[EA.GENERAL...]`, one enumerated field per component, in the engine's own order. */
    private objectFields(node: SyntaxNode, fields: number[]): void {
        const components = items(node);
        // An object with nothing set at all. No IDS table has a key for it - EA.IDS starts at 1 - so the
        // name is recognised here, exactly as the decompiler supplies it.
        if (components.length === 1 && components[0]!.text.toUpperCase() === ANYONE) return;

        const targets = OBJECT_TARGETS[this.engine];
        if (components.length > targets.length) {
            this.fail(node, `this game's objects take at most ${targets.length} fields, not ${components.length}`);
            return;
        }
        for (const [index, component] of components.entries()) {
            const table = targets[index]!;
            if (component.type === SyntaxType.Number) {
                fields[index] = this.integer(component);
                continue;
            }
            const value = this.field(table, component.text);
            if (value === undefined) this.fail(component, `this game's ${table}.IDS does not name ${component.text}`);
            else fields[index] = value;
        }
    }

    /**
     * One enumerated field's value, undoing IWD2's SUBRACE keying: that table packs the race a subrace
     * belongs to into the high half of its key, so what the file stores is the low half on its own.
     */
    private field(table: string, name: string): number | undefined {
        const key = this.value(table, name);
        return key === undefined || table !== "SUBRACE" ? key : key & 0xffff;
    }
}
