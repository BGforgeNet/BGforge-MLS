/**
 * Compile-time values for TBAF and TD, and how each one is written as a WeiDU argument.
 *
 * Every value a TBAF or TD source computes before the output exists - a constant, a loop variable, a function
 * argument - is one of these, produced by `compile-time-eval.ts` from the syntax tree. The output is formatted
 * from them and never edited afterwards, so what the source means is what reaches the mod file, or the
 * transpile refuses.
 */

import type { FunctionDeclaration, Node } from "ts-morph";
import type { Scope } from "./compile-time-eval";
import { TranspileError } from "./transpile-error";

/** A translation or TLK reference, as `tra(n)`, `tlk(n)` or `tlkForced(n, text)` wrote it. */
export type StrRef =
    | { readonly form: "tra" | "tlk"; readonly id: number; readonly sound?: string }
    | { readonly form: "tlkForced"; readonly id: number; readonly text: string };

export type Value =
    /** A signed 32-bit integer. `text` keeps a literal's own spelling (`0x10`) while nothing has changed it. */
    | { readonly kind: "int"; readonly value: number; readonly text?: string }
    | { readonly kind: "string"; readonly value: string }
    /** Compile-time only: it decides a condition or a ternary, and has no WeiDU spelling. */
    | { readonly kind: "bool"; readonly value: boolean }
    /** Compile-time only, apart from a pair of integers in argument position, which is a BAF point. */
    | { readonly kind: "array"; readonly items: readonly Value[] }
    | { readonly kind: "record"; readonly fields: ReadonlyMap<string, Value> }
    | { readonly kind: "strref"; readonly ref: StrRef }
    /** `obj("[PC]")` and kin: an object specifier, bracketed or a script name. */
    | { readonly kind: "object"; readonly spec: string }
    /** A function the source declares: a TD state, or a helper to inline in the scope it closes over. */
    | {
          readonly kind: "function";
          readonly name: string;
          readonly declaration: FunctionDeclaration;
          readonly closure: Scope;
      }
    /** A name the source does not bind, which the engine defines: `Myself`, an IDS symbol. */
    | { readonly kind: "symbol"; readonly name: string }
    /** A call the engine evaluates, such as an object function in argument position. */
    | { readonly kind: "call"; readonly name: string; readonly args: readonly Value[] };

export type FunctionValue = Extract<Value, { kind: "function" }>;

export const INT32_MIN = -2147483648;
export const INT32_MAX = 2147483647;

/** How a `Value` is spelled where WeiDU reads an argument: the BAF parameter list, or a D action or trigger. */
export interface ArgumentStyle {
    /** Between the arguments of a nested call: TBAF writes `", "`, TD's compact form `","`. */
    readonly separator: string;
}

/**
 * The value as a WeiDU argument. A value WeiDU has no spelling for is refused at `node`, the expression that
 * produced it, rather than written in some form the engine would read differently.
 */
export function formatArgument(value: Value, style: ArgumentStyle, node: Node): string {
    switch (value.kind) {
        case "int":
            return value.text ?? String(value.value);
        case "string":
            return quoteString(value.value, node);
        case "symbol":
            return value.name;
        case "object":
            return value.spec.startsWith("[") ? value.spec : quoteString(value.spec, node);
        case "call":
            return `${value.name}(${value.args.map((arg) => formatArgument(arg, style, node)).join(style.separator)})`;
        case "strref":
            if (value.ref.form === "tra") return `@${value.ref.id}`;
            if (value.ref.form === "tlk") return String(value.ref.id);
            throw TranspileError.fromNode(
                node,
                "tlkForced() is dialog text; an action or trigger argument takes tlk()",
            );
        case "array": {
            const [x, y] = value.items;
            if (value.items.length === 2 && x?.kind === "int" && y?.kind === "int") {
                return `[${formatArgument(x, style, node)}.${formatArgument(y, style, node)}]`;
            }
            throw TranspileError.fromNode(
                node,
                "an array exists only at compile time; an argument takes one of its elements, or a pair of " +
                    "integers as a point",
            );
        }
        case "bool":
            throw TranspileError.fromNode(node, "a boolean has no WeiDU spelling; pass 1 or 0");
        case "record":
            throw TranspileError.fromNode(node, "an object exists only at compile time; pass one of its fields");
        case "function":
            throw TranspileError.fromNode(node, `'${value.name}' is a function, not a value an argument can take`);
    }
}

/**
 * A string in the delimiter WeiDU reads it in: double quotes, or tildes for one that holds a double quote.
 * Neither form has an escape, so a string holding both cannot be written.
 */
function quoteString(text: string, node: Node): string {
    if (!text.includes('"')) return `"${text}"`;
    if (!text.includes("~")) return `~${text}~`;
    throw TranspileError.fromNode(node, "a string holding both '\"' and '~' has no WeiDU spelling");
}

/** What a value is, in a refusal's words. */
export function describeKind(value: Value): string {
    switch (value.kind) {
        case "int":
            return "an integer";
        case "string":
            return "a string";
        case "bool":
            return "a boolean";
        case "array":
            return "an array";
        case "record":
            return "an object";
        case "strref":
            return `a ${value.ref.form}() reference`;
        case "object":
            return "an object specifier";
        case "function":
            return "a function";
        case "symbol":
            return `the engine name '${value.name}', known only in game`;
        case "call":
            return `the engine call '${value.name}(...)', known only in game`;
    }
}
