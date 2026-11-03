/**
 * Shared type definitions for the TSSL transpiler.
 * Interfaces and constants used across multiple TSSL modules.
 */

// Re-export SyntaxKind for convenience (avoids redundant imports in each file).
// Direct `export ... from` form so the bundler doesn't flag an unused local import.
export { SyntaxKind } from "ts-morph";

/** One call in an inline function's body. */
export interface InlineCall {
    targetFunc: string; // Function being called, e.g., "sfall_func2" or "reg_anim_func"
    args: InlineArg[]; // Arguments in order, either param references or constants
}

/**
 * What an `@inline` function expands to.
 *
 * `calls` holds more than one only where the body is a sequence of calls and nothing else - a
 * value-returning body cannot be a sequence, SSL having no expression form for one.
 *
 * `expression` is a returned value that is not itself a call, and it is spliced PARENTHESISED: an
 * argument re-associates across a bare splice, and so does a body. `a := m + 1` against a bare
 * `metarule(46, 0) != 0` compiles to different bytes than against the wrapped form, because SSL reads
 * the bare one as a comparison against `0 + 1`. A call is atomic and needs no such wrapping. For the
 * same reason, each parameter the expression uses as an operator's operand is parenthesised in both
 * spellings, and so is one a call passes on inside an operator.
 */
export type InlineBody =
    | { kind: "calls"; calls: InlineCall[] }
    | {
          kind: "expression";
          /** The expression in SSL spelling, for the emitted `#define`. */
          value: string;
          /** The same expression as TypeScript, for the consumer that re-parses rather than splices. */
          source: string;
      };

/** Inline function metadata: maps function name to its expansion. */
export interface InlineFunc {
    body: InlineBody;
    params: string[]; // Ordered parameter names from function signature
}

export interface InlineArg {
    type: "param" | "constant";
    /** Param name, or the constant already converted to SSL spelling (`|` rendered as `bwor`). */
    value: string;
    /**
     * The same constant as the author WROTE it, in TypeScript. `value` is SSL text, which a TypeScript
     * parser cannot read back once an operator has been converted - so a consumer that re-parses the
     * operand rather than splicing it into SSL reads this instead.
     */
    source?: string;
}

/**
 * Context object passed through transpilation functions.
 * Replaces module-level globals for cleaner data flow.
 */
export interface TsslContext {
    inlineFunctions: Map<string, InlineFunc>;
    definedFunctions: Set<string>;
    functionJsDocs: Map<string, string>;
    doStatementCounter: number;
    /** Enums declared in project code: `Enum.Member` prints as the flat define `Enum_Member`. */
    localEnumNames: ReadonlySet<string>;
    /** `declare enum`s from .d.ts files: `Enum.Member` prints as the bare `Member` the headers define. */
    externEnumNames: ReadonlySet<string>;
    /**
     * The CURRENT module's import renames (local name -> declaration name); the emitter swaps this as it
     * moves between modules. Scoped by name, not by binding: a function-local variable shadowing an
     * imported alias would be renamed too, the same limit the bundler's rename repair always had.
     */
    importRenames: ReadonlyMap<string, string>;
}

/**
 * JavaScript built-ins that are not available in SSL runtime.
 * Usage of these will cause transpilation to fail.
 */
export const FORBIDDEN_GLOBALS = new Set([
    "Object",
    "Array",
    "JSON",
    "Math",
    "Date",
    "Promise",
    "Map",
    "Set",
    "WeakMap",
    "WeakSet",
    "Symbol",
    "Reflect",
    "Proxy",
]);

/**
 * folib's `list()`/`map()` helpers: array and map literal syntax, which both routes expand at the call site and
 * never emit as procedures, and so names no variable may take.
 */
export const RESERVED_VAR_NAMES: ReadonlySet<string> = new Set(["list", "map"]);

/**
 * The name SSL knows a TSSL identifier by. `typeof` is a keyword in both languages, so folib declares
 * the engine function as `sfall_typeof` and the output carries the SSL spelling.
 *
 * Applied wherever a name is rendered - never over finished text, which cannot tell an identifier from
 * the same letters inside a string literal.
 */
export function sslName(name: string): string {
    return name === "sfall_typeof" ? "typeof" : name;
}

/**
 * A numeric literal as SSL spells it. SSL reads decimal and hex integers and floats with a point, and nothing else:
 * TypeScript's `_` separators are dropped, a binary or octal integer is written in hex (a bit pattern stays one),
 * and an exponent form such as `1e3` is written out as the float it is, `1000.0`. A decimal or hex spelling with
 * a point or not keeps its radix and type as written. Both routes read the literal through this one spelling.
 */
export function sslNumber(text: string): string {
    const plain = text.replaceAll("_", "");
    if (/^0[bo]/i.test(plain)) return `0x${Number(plain).toString(16).toUpperCase()}`;
    // In a hex spelling such as `0xFE` an `e` is a digit.
    if (!/^0x/i.test(plain) && /e/i.test(plain)) return plainFloat(Number(plain));
    return plain;
}

/** A float written in digits with a point, which is the one float spelling SSL reads. */
function plainFloat(value: number): string {
    const text = String(value);
    if (!/e/i.test(text)) return text.includes(".") ? text : `${text}.0`;
    // String() falls back to an exponent past 1e21 and below 1e-6.
    if (Number.isInteger(value)) return `${BigInt(value)}.0`;
    const fixed = value.toFixed(20);
    let end = fixed.length;
    while (fixed[end - 1] === "0") end--;
    return fixed.slice(0, end);
}

// Route diagnostics to stderr, apart from the per-file progress lines the CLI prints on
// stdout. `setConlog()` lets a host swap this sink (the test suite installs a
// capturing logger); with no override the sink stays `console.error`, preserving
// the CLI's stderr/stdout separation.
type Conlog = (message: string) => void;

let conlogSink: Conlog = console.error;

/** Redirect tssl diagnostic output. Pair with `setConlog(console.error)` to reset. */
export function setConlog(next: Conlog): void {
    conlogSink = next;
}

export const conlog: Conlog = (message) => {
    conlogSink(message);
};
