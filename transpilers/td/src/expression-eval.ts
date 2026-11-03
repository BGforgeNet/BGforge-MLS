/**
 * TD triggers and dialog text, from the compile-time evaluator's folded conditions and values.
 *
 * A D trigger is a list of trigger calls, each optionally negated, that all must hold, among which `OR(n)` makes
 * the next n calls alternatives. `&&` joins with a space, `||` becomes `OR(n)`, and `!` reaches the calls, since
 * the evaluator pushes it down.
 */

import type { Expression, Node } from "ts-morph";
import { evaluate, evaluateCondition, type Condition, type Scope } from "../../common/compile-time-eval";
import { describeKind, type StrRef, type Value } from "../../common/compile-time-value";
import { TranspileError } from "../../common/transpile-error";
import { TDTextType, type TDText } from "./types";
import { formatCall } from "./parse-helpers";

/** Where a trigger that must not be a constant sits, and what a false one would mean there. */
interface TriggerSite {
    /** The trigger, in a refusal's words: "the state's entry trigger". */
    readonly what: string;
    /** What a compile-time false trigger would do there: "the state is never entered". */
    readonly ifFalse: string;
}

const STATE_ENTRY: TriggerSite = { what: "the state's entry trigger", ifFalse: "the state is never entered" };
const CHAIN_ENTRY: TriggerSite = { what: "the chain's entry trigger", ifFalse: "the chain never starts" };
const ENTRY: TriggerSite = { what: "the entry trigger", ifFalse: "the lines are never spoken" };

function patchTrigger(keyword: string): TriggerSite {
    return { what: `the ${keyword} trigger`, ifFalse: "what it patches is never available" };
}

/**
 * A transition's trigger as D text, or the compile-time constant it folds to: true for a transition with no
 * trigger, false for one that is never available.
 */
function transitionTriggerOf(expr: Expression, scope: Scope): string | boolean {
    const condition = evaluateCondition(expr, scope);
    return condition.kind === "constant" ? condition.value : formatTrigger(condition, expr);
}

/**
 * A trigger that decides whether something exists at all, refused when it is a compile-time constant: false
 * would remove what it guards, and true would decide nothing.
 */
function requiredTriggerOf(expr: Expression, scope: Scope, site: TriggerSite): string {
    const condition = evaluateCondition(expr, scope);
    if (condition.kind === "constant") {
        throw TranspileError.fromNode(
            expr,
            condition.value
                ? `${site.what} is true at compile time, so it decides nothing; remove the condition`
                : `${site.what} is false at compile time, so ${site.ifFalse}; remove it, or test a trigger call`,
        );
    }
    return formatTrigger(condition, expr);
}

function formatTrigger(condition: Condition, node: Node): string {
    switch (condition.kind) {
        case "constant":
            // conjunction() and disjunction() fold constants out of every group, so only a whole condition is
            // one, and each caller decides that case before formatting.
            throw new Error("a constant condition has no D trigger text");
        case "atom":
            return formatAtom(condition);
        case "and":
            return condition.items.map((item) => formatTrigger(item, node)).join(" ");
        case "or": {
            const atoms = condition.items.map((item) => {
                if (item.kind !== "atom") {
                    throw TranspileError.fromNode(
                        node,
                        "an || with an && group inside has no D trigger: OR(n) groups trigger calls only; " +
                            "distribute the && over the ||",
                    );
                }
                return formatAtom(item);
            });
            return `OR(${atoms.length}) ${atoms.join(" ")}`;
        }
    }
}

function formatAtom(atom: Extract<Condition, { kind: "atom" }>): string {
    return `${atom.negated ? "!" : ""}${formatCall(atom.name, atom.args, atom.node)}`;
}

/** Dialog text: say, reply and journal text. */
function textOf(expr: Expression, scope: Scope): TDText {
    const value = evaluate(expr, scope);
    if (value.kind === "record") return genderedText(value.fields, expr);
    return plainText(value, expr);
}

function plainText(value: Value, node: Node): TDText {
    if (value.kind === "string") return { type: TDTextType.Literal, value: value.value };
    if (value.kind === "strref") return strrefText(value.ref);
    throw TranspileError.fromNode(
        node,
        `dialog text is tra(), tlk(), tlkForced() or a string, not ${describeKind(value)}`,
    );
}

function strrefText(ref: StrRef): TDText {
    switch (ref.form) {
        case "tra":
            return { type: TDTextType.Tra, value: ref.id, sound: ref.sound };
        case "tlk":
            return { type: TDTextType.Tlk, value: ref.id, sound: ref.sound };
        case "tlkForced":
            return { type: TDTextType.Forced, value: ref.id, text: ref.text };
    }
}

const GENDERED_FIELDS: readonly string[] = ["male", "female", "maleSound", "femaleSound"];

/** `{ male, female, maleSound?, femaleSound? }`: the text a male and a female PC see. */
function genderedText(fields: ReadonlyMap<string, Value>, node: Node): TDText {
    for (const key of fields.keys()) {
        if (!GENDERED_FIELDS.includes(key)) {
            throw TranspileError.fromNode(
                node,
                `gendered text has no field '${key}'; it takes ${GENDERED_FIELDS.join(", ")}`,
            );
        }
    }
    const male = fields.get("male");
    const female = fields.get("female");
    if (male === undefined || female === undefined) {
        throw TranspileError.fromNode(node, "gendered text needs both a male and a female text");
    }
    return {
        type: TDTextType.Tra, // Placeholder: emitted from male and female
        value: 0,
        male: withSound(plainText(male, node), fields.get("maleSound"), node),
        female: withSound(plainText(female, node), fields.get("femaleSound"), node),
    };
}

function withSound(text: TDText, sound: Value | undefined, node: Node): TDText {
    if (sound === undefined) return text;
    if (sound.kind !== "string")
        throw TranspileError.fromNode(node, `a sound is a resource name string, not ${describeKind(sound)}`);
    return { ...text, sound: sound.value };
}

export {
    CHAIN_ENTRY,
    ENTRY,
    STATE_ENTRY,
    patchTrigger,
    requiredTriggerOf,
    textOf,
    transitionTriggerOf,
    type TriggerSite,
};
