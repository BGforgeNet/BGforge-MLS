/**
 * The extension's own BAF compiler, as an alternative to spawning WeiDU.
 *
 * Unlike the external bridge it is a library call: it reads the document from memory rather than through a
 * temp copy on disk, and returns every problem the compile found rather than the first one. What it cannot
 * do is anything whose value a tp2 assigns during installation - see `refusals` below.
 */

import { BcsCompileError, compileBaf, type BcsCompileSymbols, type BcsEngine } from "../../../compilers/bcs/src/index";
import type { Parser } from "web-tree-sitter";
import type { DiagnosticParseResult, ParseItemList } from "../diagnostics";

/**
 * Constructs this compiler refuses rather than resolves, keyed by the message fragment that names them.
 *
 * Both are install-time values: a `%variable%` is assigned by a tp2 and an `@strref` is allocated when a
 * translation is appended to the game's string table. Compiling either as a plausible literal produces a
 * script that assembles cleanly and behaves wrongly in game, which no later check would catch.
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
            `${found} is a translation reference this compiler does not resolve yet. ` +
            `Set bgforge.weidu.compiler to "weidu" to compile this file.`,
    },
];

/** Every refusal in `text`, located as the codec locates its own diagnostics: 1-based line and column. */
function refusals(text: string): { line: number; column: number; message: string }[] {
    const found: { line: number; column: number; message: string }[] = [];
    text.split("\n").forEach((lineText, index) => {
        for (const { pattern, explain } of REFUSALS) {
            // Reset because the patterns are module-level and sticky under the `g` flag; without this a
            // second document would start scanning wherever the previous one stopped.
            pattern.lastIndex = 0;
            let match = pattern.exec(lineText);
            while (match !== null) {
                found.push({ line: index + 1, column: match.index + 1, message: explain(match[0]) });
                match = pattern.exec(lineText);
            }
        }
    });
    return found.sort((a, b) => a.line - b.line || a.column - b.column);
}

/**
 * Compiles `text` and reports what it found.
 *
 * Refusals are collected before the compile rather than after: the codec has no reading for a tp2 variable,
 * so it would report a resolution failure whose message describes the symptom rather than the cause.
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

    const refused = refusals(text);
    if (refused.length > 0) {
        refused.forEach((item) => add(item));
        return { errors, warnings: [] };
    }

    try {
        compileBaf(parser, text, symbols, engine);
    } catch (error) {
        if (error instanceof BcsCompileError) {
            error.diagnostics.forEach((diagnostic) => add(diagnostic));
        } else {
            // Not a fault in the script - report it at the top of the file rather than pinned to a line.
            add({ line: 1, column: 1, message: error instanceof Error ? error.message : String(error) });
        }
    }
    return { errors, warnings: [] };
}
