/**
 * Shared type definitions for the TSSL transpiler.
 * Interfaces and constants used across multiple TSSL modules.
 */

import { SyntaxKind } from "ts-morph";

// Re-export SyntaxKind for convenience (avoids redundant imports in each file)
export { SyntaxKind };

/** Inline function metadata: maps function name to its expansion */
export interface InlineFunc {
    targetFunc: string; // Function being called, e.g., "sfall_func2" or "reg_anim_func"
    args: InlineArg[]; // Arguments in order, either param references or constants
    params: string[]; // Ordered parameter names from function signature
}

export interface InlineArg {
    type: "param" | "constant";
    value: string; // param name or constant value
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
    /** Known enum names for expanding property accesses in inline function args */
    enumNames: ReadonlySet<string>;
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

/** Variable names that conflict with folib exports and cause esbuild renaming issues */
export const RESERVED_VAR_NAMES = new Set(["list", "map"]);

/**
 * Data extracted from the main source file before bundling.
 * Grouped to reduce parameter count in function signatures.
 */
export interface MainFileData {
    constants: Map<string, string>;
    letVars: Set<string>;
    includes: string[];
}

export interface SourceSection {
    source: string;
    defines: string[];
    variables: string[];
    declarations: string[];
    procedures: string[];
}

// Route diagnostics to stderr so CLI stdout mode (`fgtp file.tssl`) stays a clean
// pipe. conlog depends on the LSP connection and isn't usable from the CLI.
export const conlog = console.error;

/**
 * How many lines to look backwards when searching for esbuild source comments.
 * esbuild inserts comments like "// node_modules/folib/sfall.ts" before bundled code.
 */
export const SOURCE_COMMENT_LOOKBACK = 10;
