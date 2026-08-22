/**
 * Compiler-diagnostic dispatch: types, conversion to LSP diagnostics, and the
 * fallback / interactive-report helpers used by every external compiler bridge
 * (Fallout SSL via sslc, WeiDU via weidu-compile).
 *
 * Distinct from `core/parse-result.ts`, which holds the symbol/reference shape
 * produced by tree-sitter parses. The name `DiagnosticParseResult` here was
 * chosen specifically to avoid the prior collision with that file's `ParseResult`.
 */

import type { ExecFileException } from "child_process";
import { type Diagnostic, DiagnosticSeverity } from "vscode-languageserver/node";
import { setDiagnostics } from "./diagnostic-store";
import { showError, showInfo } from "./user-messages";

interface ParseItem {
    uri: string;
    line: number;
    columnStart: number;
    columnEnd: number;
    message: string;
}

export interface ParseItemList extends Array<ParseItem> {}

export interface DiagnosticParseResult {
    errors: ParseItemList;
    warnings: ParseItemList;
}

/**
 * Convert a DiagnosticParseResult to LSP diagnostics and send them.
 * Compilers may output results for different files. If we use a tmp file for
 * processing, then tmp-file uri is replaced with main-file uri so the editor
 * shows diagnostics on the user's source rather than the throwaway copy.
 *
 * @param parseResult DiagnosticParseResult
 * @param mainUri uri of the file we're parsing
 * @param tmpUri uri of tmpFile used to dump unsaved changes to for parsing
 */
export function sendParseResult(parseResult: DiagnosticParseResult, mainUri: string, tmpUri: string) {
    const diagSource = "BGforge MLS";
    const diagnostics = new Map<string, Diagnostic[]>();

    function addDiagnostic(item: ParseItem, severity: DiagnosticSeverity) {
        const diagnostic: Diagnostic = {
            severity,
            range: {
                start: { line: item.line - 1, character: item.columnStart },
                end: { line: item.line - 1, character: item.columnEnd },
            },
            message: `${item.message}`,
            source: diagSource,
        };
        const uri = item.uri === tmpUri ? mainUri : item.uri;
        // Mutating push avoids O(n²) re-allocation when a single file produces
        // many diagnostics. The map's array values are owned by this function;
        // they are only read by the sendDiagnostics loop below.
        let bucket = diagnostics.get(uri);
        if (!bucket) {
            bucket = [];
            diagnostics.set(uri, bucket);
        }
        bucket.push(diagnostic);
    }

    for (const e of parseResult.errors) {
        addDiagnostic(e, DiagnosticSeverity.Error);
    }
    for (const w of parseResult.warnings) {
        addDiagnostic(w, DiagnosticSeverity.Warning);
    }

    // Publish under the "compiler" source so the tree-sitter source's diagnostics
    // on the same file are preserved. A clean compile produces an empty map here;
    // the compiler bucket was already cleared before the compile ran.
    for (const [uri, diags] of diagnostics) {
        setDiagnostics(uri, "compiler", diags);
    }
}

/** Extract a human-readable message from an unknown caught value. */
export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Read Node's `errno` code (e.g. `"ENOENT"`, `"EACCES"`) from an unknown caught
 * value. Returns `undefined` for non-error values or errors lacking a code.
 * Centralised here so callers do not need their own `as NodeJS.ErrnoException`
 * cast every time they want to branch on a filesystem-errno.
 */
export function getErrnoCode(error: unknown): string | undefined {
    if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof (error as { code: unknown }).code === "string"
    ) {
        return (error as { code: string }).code;
    }
    return undefined;
}

/** Create a new DiagnosticParseResult with a fallback diagnostic appended. Used when a compiler fails but its output wasn't parseable. */
export function addFallbackDiagnostic(
    parseResult: DiagnosticParseResult,
    err: ExecFileException,
    uri: string,
    stdout: string,
): DiagnosticParseResult {
    return {
        errors: [
            ...parseResult.errors,
            {
                uri,
                line: 1,
                columnStart: 0,
                columnEnd: 0,
                message: stdout || err.message,
            },
        ],
        warnings: parseResult.warnings,
    };
}

/** Show interactive success/failure message based on parse results. */
export function reportCompileResult(
    parseResult: DiagnosticParseResult,
    interactive: boolean,
    successMsg: string,
    failMsg: string,
) {
    if (!interactive) return;
    // Warnings do not make it a failure: the compiler produced its output, and saying otherwise
    // contradicts the file that was just written. They are not lost by this - every one of them is a
    // diagnostic in its own right, which is where a warning belongs.
    if (parseResult.errors.length > 0) {
        showError(failMsg);
    } else {
        showInfo(successMsg);
    }
}
