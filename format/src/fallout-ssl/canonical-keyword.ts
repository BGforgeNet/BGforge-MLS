/**
 * Canonical spelling of Fallout SSL keywords.
 *
 * The grammar matches keywords case-insensitively (`kw()` builds a case-insensitive matcher and aliases
 * it back to the lowercase word), so the source may spell any keyword any way. The formatter emits the
 * project's canonical spelling rather than the source's.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import { stripCommentsFalloutSsl } from "../format-utils";

/**
 * Keywords whose canonical spelling is not plain lowercase. Both are short-circuit operators borrowed
 * from sfall and are written camelCase throughout the real corpus - the lowercase form the grammar uses
 * internally appears in no real script.
 */
const CANONICAL_EXCEPTIONS = new Map([
    ["orelse", "orElse"],
    ["andalso", "andAlso"],
]);

/**
 * The canonical spelling of a keyword or operator token. Symbolic operators (`+`, `:=`) are unaffected
 * by case folding and pass through unchanged, so operator sites can call this without discriminating.
 *
 * Only ever call this on a token the grammar produced as a keyword or operator. An identifier lowercased
 * here would be a content change, not a re-spelling.
 *
 * Keywords inside a `#define` body keep the source's spelling: the formatter emits node types it does not
 * explicitly handle verbatim, and macro bodies are preprocessor text rather than statements. Reaching into
 * them would be a change of scope, not of casing.
 */
export function canonicalKeyword(text: string): string {
    const lower = text.toLowerCase();
    return CANONICAL_EXCEPTIONS.get(lower) ?? lower;
}

/**
 * Every keyword the grammar declares, as its canonical lowercase name.
 *
 * Transcribed from the grammar's generated `node-types.json` - the anonymous alphabetic tokens are exactly
 * its keywords - and pinned back to that file by a test, so a grammar change that adds or removes one
 * fails rather than silently leaving this list behind.
 */
const KEYWORDS = new Set([
    "and",
    "andalso",
    "begin",
    "break",
    "bwand",
    "bwnot",
    "bwor",
    "bwxor",
    "call",
    "callstart",
    "cancel",
    "cancelall",
    "case",
    "continue",
    "critical",
    "default",
    "detach",
    "div",
    "do",
    "else",
    "end",
    "endcritical",
    "exec",
    "exit",
    "export",
    "false",
    "floor",
    "for",
    "foreach",
    "fork",
    "if",
    "import",
    "in",
    "inline",
    "noop",
    "not",
    "or",
    "orelse",
    "procedure",
    "pure",
    "return",
    "spawn",
    "startcritical",
    "switch",
    "then",
    "true",
    "variable",
    "wait",
    "when",
    "while",
]);

/** Test seam: lets the drift test compare this set against the grammar's generated node types. */
export const KEYWORDS_FOR_TEST: ReadonlySet<string> = KEYWORDS;

/**
 * The canonical spelling of a node's keyword-or-operator field, or `""` when the field is absent.
 * Shared by the unary and binary expression formatters, which both read the grammar's `op` field.
 */
export function canonicalOp(node: SyntaxNode): string {
    const op = node.childForFieldName("op")?.text;
    return op === undefined ? "" : canonicalKeyword(op);
}

/**
 * Rewrite every keyword outside a quoted run to its canonical spelling, leaving everything else alone.
 *
 * Only words in {@link KEYWORDS} move, so identifiers keep their case and the guard still catches a
 * formatter that re-cased one. A macro named after a keyword is the one blind spot: it folds with the
 * keywords, because nothing in the text alone distinguishes it.
 */
function canonicaliseKeywordsOutsideStrings(text: string): string {
    let out = "";
    let i = 0;
    while (i < text.length) {
        const quote = text.indexOf('"', i);
        const chunk = quote === -1 ? text.slice(i) : text.slice(i, quote);
        // Same shape as the grammar's `identifier` rule, so a word here is what the parser would tokenise.
        out += chunk.replaceAll(/[A-Za-z_][A-Za-z0-9_]*/g, (word) =>
            KEYWORDS.has(word.toLowerCase()) ? canonicalKeyword(word) : word,
        );
        if (quote === -1) return out;
        let end = quote + 1;
        while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
        out += text.slice(quote, Math.min(end + 1, text.length));
        i = end + 1;
    }
    return out;
}

/**
 * Comment stripper for comparing a formatted Fallout SSL file against its source.
 *
 * The formatter emits the canonical spelling of every keyword rather than the source's, so an exact
 * comparison would read a re-spelled keyword as lost content and refuse the file. Canonicalising both
 * sides lets that change through while every other content change - identifier casing and string
 * literal casing included - is still caught.
 */
export function stripCommentsForCompareFalloutSsl(text: string): string {
    return canonicaliseKeywordsOutsideStrings(stripCommentsFalloutSsl(text));
}
