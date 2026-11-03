/**
 * Small helpers the TypeScript-based transpilers (TSSL, TBAF, TD) share: statement lists, quoting, import and
 * `@tra` detection, and the generated-file header. Compile-time values are the evaluator's
 * (`compile-time-eval.ts`).
 */

import { type Statement, SyntaxKind } from "ts-morph";

/**
 * Get statements from a statement, handling both blocks and single statements.
 * If the statement is a block, returns all statements in the block.
 * Otherwise, returns a single-element array with the statement.
 *
 * @param stmt A statement (could be a block or single statement)
 * @returns Array of statements
 *
 * @example
 * // if (x) doSomething(); => [ExpressionStatement]
 * // if (x) { a(); b(); } => [ExpressionStatement, ExpressionStatement]
 */
export function getBlockStatements(stmt: Statement): Statement[] {
    if (stmt.isKind(SyntaxKind.Block)) {
        return stmt.getStatements();
    }
    return [stmt];
}

/**
 * Strip quotes from a string literal.
 * Removes leading and trailing quotes (single, double, or backtick).
 *
 * @param text String potentially wrapped in quotes
 * @returns String without leading/trailing quotes
 *
 * @example
 * stripQuotes('"hello"')  // => "hello"
 * stripQuotes("'world'")  // => "world"
 * stripQuotes('`test`')   // => "test"
 * stripQuotes('plain')    // => "plain"
 */
export function stripQuotes(text: string): string {
    return text.replaceAll(/^["'`]|["'`]$/g, "");
}

/**
 * Check whether source text contains import/re-export statements.
 * Used by TBAF and TD to skip esbuild bundling for files without imports,
 * because esbuild tree-shakes block-scoped functions, which breaks transpiler output.
 */
export function hasImports(text: string): boolean {
    // Leading blanks stop at the line's own start: `^\s*` would also run across the line breaks that follow, and
    // every line start inside a long run of blank lines would rescan the rest of it. Zl and Zp are the line and
    // paragraph separators, which `m` treats as line breaks too.
    return /^[^\S\n\r\p{Zl}\p{Zp}]*(import|export\s+\*\s+from)\s+/mu.test(text);
}

/**
 * Extract `@tra filename.ext` from source text.
 *
 * The @tra tag tells the Translation service which .tra/.msg file provides
 * translation strings for inlay hints, hover, and go-to-definition.
 * It can appear as a one-line JSDoc comment holding `@tra file.tra`, or inside
 * a multi-line JSDoc block. We extract it before esbuild bundling (which
 * strips comments) and re-emit it in the transpiled output so the
 * Translation service works on both source and output files.
 *
 * @returns The filename (e.g. "smarter_familiars.tra"), or undefined if absent
 */
export function extractTraTag(text: string): string | undefined {
    const match = text.match(/@tra\s+([\w-]+\.(?:tra|msg))/);
    return match?.[1];
}

/** Maximum loop iterations to prevent infinite loops during compile-time unrolling */
export const MAX_LOOP_ITERATIONS = 1000;

/**
 * WeiDU's variable scopes. A bare one the source does not bind reaches the output quoted, as the scope argument
 * of a variable action or trigger (`SetGlobal("x", "GLOBAL", 1)`).
 */
export const SCOPE_CONSTANTS: ReadonlySet<string> = new Set([
    // Complete set of Infinity Engine variable scopes.
    // These are the only 3 scopes in the engine (per IESDP/WeiDU documentation).
    "GLOBAL",
    "LOCALS",
    "MYAREA",
]);

/**
 * Build the standard generated-file header shared by all transpilers: an
 * optional `@tra <tag>` doc-comment line followed by a "do not edit" block
 * and a trailing blank line.
 *
 * @param sourceName Source file name referenced in the comment.
 * @param traTag Optional `@tra` filename to preserve in the output header.
 * @param terse TD uses a terser one-line wording; TSSL/TBAF use the verbose form.
 */
export function makeGeneratedHeader(sourceName: string, traTag: string | undefined, terse = false): string {
    const traLine = traTag ? `/** @tra ${traTag} */\n` : "";
    const message = terse
        ? `Generated from ${sourceName} - do not edit`
        : `Do not edit. This file is generated from ${sourceName}. Make your changes there and regenerate this file.`;
    return `${traLine}/* ${message} */\n\n`;
}
