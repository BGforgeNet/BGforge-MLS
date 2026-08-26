/**
 * The extension's own BAF compiler, as an alternative to spawning WeiDU.
 *
 * Unlike the external bridge it is a library call: it reads the document from memory rather than through a
 * temp copy on disk, and returns every problem the compile found rather than the first one. What it cannot
 * do is anything whose value a tp2 assigns during installation - see `refusals` below.
 */

import { BcsCompileError, compileBaf, type BcsCompileSymbols, type BcsEngine } from "../../../compilers/bcs/src/index";
import type { Parser, Point } from "web-tree-sitter";
import type { DiagnosticParseResult, ParseItemList } from "../diagnostics";
import { SyntaxType } from "./syntax-type";

/**
 * Constructs this compiler refuses rather than resolves, keyed by the message fragment that names them.
 *
 * Both are install-time values: a `%variable%` is assigned by a tp2, and a `@123` names a translation line
 * whose number WeiDU works out from the tp2 that installs it. Compiling either as a plausible literal
 * produces a script that assembles cleanly and behaves wrongly in game, which no later check would catch.
 */
const REFUSALS: readonly { readonly pattern: RegExp; readonly explain: (found: string) => string }[] = [
    {
        pattern: /%[A-Za-z_][A-Za-z0-9_]*%/g,
        explain: (found) =>
            `${found} is assigned during installation, so this compiler cannot resolve it. ` +
            `Set bgforge.weidu.compiler to "weidu" to compile this file.`,
    },
    {
        pattern: /@\d+/g,
        explain: (found) =>
            `${found} names a translation line whose number is assigned during installation, ` +
            `so this compiler cannot resolve it. Set bgforge.weidu.compiler to "weidu" to compile this file.`,
    },
];

/** A refusal found in the text, before comments are ruled out. Rows and columns count from 0, as the parser does. */
interface Candidate {
    row: number;
    column: number;
    message: string;
}

/** Every match of a refusal pattern in `text`, comments included - `refusals` is what rules those out. */
function candidates(text: string): Candidate[] {
    const found: Candidate[] = [];
    text.split("\n").forEach((lineText, row) => {
        for (const { pattern, explain } of REFUSALS) {
            // Reset the index as a guard: the patterns are module-level and reused across documents.
            pattern.lastIndex = 0;
            let match = pattern.exec(lineText);
            while (match !== null) {
                found.push({ row, column: match.index, message: explain(match[0]) });
                match = pattern.exec(lineText);
            }
        }
    });
    return found;
}

/** Where every comment in `text` starts and ends, with the end exclusive as tree-sitter reports it. */
function commentSpans(parser: Parser, text: string): { start: Point; end: Point }[] {
    const tree = parser.parse(text);
    // No tree means no compile either, and the codec reports that for itself; scanning everything here
    // only risks a refusal on a document that is about to fail anyway.
    if (tree === null) return [];
    try {
        return tree.rootNode
            .descendantsOfType([SyntaxType.Comment, SyntaxType.LineComment])
            .map((node) => ({ start: node.startPosition, end: node.endPosition }));
    } finally {
        tree.delete();
    }
}

/** Whether `row`/`column` falls within one of `spans`. */
function within(spans: readonly { start: Point; end: Point }[], row: number, column: number): boolean {
    return spans.some(({ start, end }) => {
        if (row < start.row || row > end.row) return false;
        if (row === start.row && column < start.column) return false;
        if (row === end.row && column >= end.column) return false;
        return true;
    });
}

/**
 * Every refusal in `text`, located as the codec locates its own diagnostics: 1-based line and column.
 *
 * A construct written inside a comment is correct input and is not refused, while one inside a string is,
 * since a tp2 substitutes into string arguments and that is the case the refusal exists for. Parsing is
 * deferred until a candidate exists, so a document containing neither construct pays nothing for it.
 */
function refusals(text: string, parser: Parser): { line: number; column: number; message: string }[] {
    const found = candidates(text);
    if (found.length === 0) return [];
    const comments = commentSpans(parser, text);
    return found
        .filter((candidate) => !within(comments, candidate.row, candidate.column))
        .map(({ row, column, message }) => ({ line: row + 1, column: column + 1, message }))
        .sort((a, b) => a.line - b.line || a.column - b.column);
}

/**
 * Compiles `text` and reports what it found.
 *
 * Refusals are collected before the compile so the codec's symptom messages can be suppressed where a
 * refusal already names the cause; this prevents "cannot resolve %px%" from duplicating "%px% is assigned
 * during installation" on the same span.
 */
export function compileBafText(options: {
    text: string;
    uri: string;
    parser: Parser;
    symbols: BcsCompileSymbols;
    engine: BcsEngine;
}): DiagnosticParseResult {
    const { text, uri, parser, symbols, engine } = options;
    const errors: ParseItemList = [];
    // The codec counts a column from 1, as an editor prints it; a diagnostic's columns are 0-based.
    const add = (item: { line: number; column: number; message: string }): void => {
        errors.push({
            uri,
            line: item.line,
            columnStart: item.column - 1,
            columnEnd: item.column - 1,
            message: item.message,
        });
    };

    const refused = refusals(text, parser);
    refused.forEach((item) => add(item));

    try {
        compileBaf(parser, text, symbols, engine);
    } catch (error) {
        if (error instanceof BcsCompileError) {
            const refusalSpans = new Set(refused.map((r) => `${r.line}:${r.column}`));
            error.diagnostics.forEach((diagnostic) => {
                // Suppress compile diagnostics where a refusal already covers the same span.
                if (!refusalSpans.has(`${diagnostic.line}:${diagnostic.column}`)) {
                    add(diagnostic);
                }
            });
        } else {
            // Not a fault in the script - report it at the top of the file rather than pinned to a line.
            add({ line: 1, column: 1, message: error instanceof Error ? error.message : String(error) });
        }
    }
    return { errors, warnings: [] };
}
