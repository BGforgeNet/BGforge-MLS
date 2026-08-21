/**
 * Shared type definitions for the TSSL transpiler.
 * Interfaces and constants used across multiple TSSL modules.
 */

// Re-export SyntaxKind for convenience (avoids redundant imports in each file).
// Direct `export ... from` form so the bundler doesn't flag an unused local import.
export { SyntaxKind } from "ts-morph";

/** Inline function metadata: maps function name to its expansion */
export interface InlineFunc {
    targetFunc: string; // Function being called, e.g., "sfall_func2" or "reg_anim_func"
    args: InlineArg[]; // Arguments in order, either param references or constants
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

/** Variable names that conflict with the folib list()/map() helper functions. */
export const RESERVED_VAR_NAMES = new Set(["list", "map"]);

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

// Route diagnostics to stderr so CLI stdout mode (`fgtp file.tssl`) stays a clean
// pipe. `setConlog()` lets a host swap this sink (the test suite installs a
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
