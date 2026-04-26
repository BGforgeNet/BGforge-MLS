/**
 * Common utilities shared across the language server.
 * Includes logging, file path manipulation, glob helpers, diagnostic creation,
 * and shared compilation infrastructure (process runner, fallback diagnostics, result reporting).
 */

import type { ExecFileException } from "child_process";
import * as fg from "fast-glob";
import * as fs from "fs";
import { pathToFileURL } from "node:url";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import { Diagnostic, DiagnosticSeverity, Position } from "vscode-languageserver/node";
import type { NormalizedUri } from "./core/normalized-uri";
import { REGEX_MSG_INLAY, REGEX_MSG_INLAY_FLOATER_RAND } from "./core/patterns";
import { getConnection } from "./lsp-connection";
import { showError, showInfo } from "./user-messages";

export const tmpDir = path.join(os.tmpdir(), "bgforge-mls");

type LogLevel = "debug" | "info" | "warn" | "error";

let debugEnabled = false;

/** Toggle debug-level logging. Called from server-context when settings.debug changes. */
export function setDebugLogging(enabled: boolean): void {
    debugEnabled = enabled;
}

/**
 * Log a message through the LSP connection's console at the given level.
 * Debug-level messages are dropped unless {@link setDebugLogging} was called with true.
 *
 * Logs target the VSCode "BGforge MLS" output channel, read by humans. They are
 * not consumed programmatically (no metrics sink, no log-shipping integration),
 * so structured-field / JSON / per-request correlation-ID emission is not
 * pursued — it would add ceremony without a downstream consumer to benefit. The
 * slow-request wrapper in shared/time-handler.ts already encodes the latency
 * timing that an operator would care about, in a human-readable line.
 */
export function conlog(message: string, level: LogLevel = "info"): void {
    if (level === "debug" && !debugEnabled) return;
    const console = getConnection().console;
    switch (level) {
        case "debug":
            console.log(`[debug] ${message}`);
            break;
        case "info":
            console.log(message);
            break;
        case "warn":
            console.warn(message);
            break;
        case "error":
            console.error(message);
            break;
    }
}

interface ParseItem {
    uri: string;
    line: number;
    columnStart: number;
    columnEnd: number;
    message: string;
}
export interface ParseItemList extends Array<ParseItem> {}

export interface ParseResult {
    errors: ParseItemList;
    warnings: ParseItemList;
}

/**
 * Compilers may output results for different files.
 * If we use tmp file for processing, then tmp file uri should be replaced with main file uri
 * @param parseResult ParseResult
 * @param mainUri uri of the file we're parsing
 * @param tmpUri uri of tmpFile used to dump unsaved changed to for parsing
 */
export function sendParseResult(parseResult: ParseResult, mainUri: string, tmpUri: string) {
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

    for (const [uri, diags] of diagnostics) {
        void getConnection().sendDiagnostics({ uri, diagnostics: diags });
    }
}

/**
 * Check if 1st dir contains the 2nd. Resolves `outerPath` via realpathSync on
 * every call. Use this only when the outer is short-lived or rarely the same
 * twice — for hot paths where the outer is stable (workspace root, translation
 * directory), use `isSubpathResolved` with a cached resolved value instead.
 * Current callers all run on debounced reload paths, not LSP-request hot paths.
 */
export function isSubpath(outerPath: string | undefined, innerPath: string): boolean {
    if (outerPath === undefined) {
        return false;
    }
    try {
        const outerReal = fs.realpathSync(outerPath);
        return isSubpathResolved(outerReal, innerPath);
    } catch {
        return false;
    }
}

/**
 * Like `isSubpath`, but accepts a pre-resolved outer path (already passed through
 * `fs.realpathSync`). Lets callers on hot paths resolve the outer once and avoid
 * the syscall on every check.
 */
export function isSubpathResolved(resolvedOuter: string, innerPath: string): boolean {
    try {
        const innerReal = fs.realpathSync(innerPath);
        const rel = path.relative(resolvedOuter, innerReal);
        return !rel.startsWith("..") && !path.isAbsolute(rel);
    } catch {
        return false;
    }
}

/**
 * Like `isSubpathResolved`, but assumes BOTH paths have already been resolved
 * via `fs.realpathSync` (or are otherwise canonical). Pure string check — no
 * syscall — suitable for the LSP-request hot path. Callers must resolve the
 * inner once at request entry (via `tryRealpathSync`) before calling.
 */
export function isSubpathFullyResolved(resolvedOuter: string, resolvedInner: string): boolean {
    const rel = path.relative(resolvedOuter, resolvedInner);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Resolve a path via `fs.realpathSync` once, returning `undefined` if the
 * path does not exist or is otherwise unreadable. Centralises per-request
 * inner-path resolution so callers can do it at handler entry and pass the
 * resolved value through to sibling helpers.
 */
export function tryRealpathSync(p: string): string | undefined {
    try {
        return fs.realpathSync(p);
    } catch {
        return undefined;
    }
}

export function isDirectory(fsPath: string): boolean {
    if (fs.existsSync(fsPath)) {
        return fs.lstatSync(fsPath).isDirectory();
    }
    return false;
}

/** find files in directory by extension */
export function findFiles(dirName: string, extension: string) {
    const entries = fg.sync(`**/*.${extension}`, { cwd: dirName, caseSensitiveMatch: false });
    return entries;
}

/** Get the relative path from `root` to `other_dir`. */
export function getRelPath(root: string, other_dir: string) {
    return path.relative(root, other_dir);
}

export function uriToPath(uri_string: string) {
    return fileURLToPath(uri_string);
}

/**
 * Convert a file path to a canonical file:// URI.
 * Returns NormalizedUri since pathToFileURL produces the same canonical
 * encoding as normalizeUri's round-trip (they both use Node's pathToFileURL).
 */
export function pathToUri(filePath: string): NormalizedUri {
    const uri = pathToFileURL(filePath);
    return uri.toString() as NormalizedUri;
}

/** Extract the text from the start of the line up to the cursor position. */
export function getLinePrefix(text: string, position: Position): string {
    return text.split("\n")[position.line]?.substring(0, position.character) ?? "";
}

/**
 * Get word under cursor, for which we want to find a hover
 * This a preliminary non-whitespace symbol, could look like `NOption(154,Node003,004`
 * or `NOption(154` or `NOption`
 * From that hover will extract the actual symbol or tra reference to search for.
 */
export function symbolAtPosition(text: string, position: Position) {
    const lines = text.split(/\r?\n/g);
    const str = lines[position.line];
    if (!str) {
        return "";
    }
    const pos = position.character;

    // Check if cursor is within a tra(123) pattern (TBAF/TD translation reference)
    const traMatch = findTraArgumentAtPosition(str, pos);
    if (traMatch) {
        return traMatch;
    }

    const msgMatch = findMsgArgumentAtPosition(str, pos);
    if (msgMatch) {
        return msgMatch;
    }

    // Search for the word's beginning and end.
    let left = str.slice(0, pos + 1).search(/\w+$/),
        right = str.slice(pos).search(/\W/);

    let result: string;
    // The last word in the string is a special case.
    if (right < 0) {
        result = str.slice(left);
    } else {
        // Return the word, using the located bounds to extract it from the string.
        result = str.slice(left, right + pos);
    }

    // if a proper symbol, return
    if (!onlyDigits(result)) {
        return result;
    }

    // and if pure numeric, check if it's a tra reference
    // Use [^\s(] instead of \S to treat ( as a boundary — prevents matching
    // through nested calls like display_msg(mstr(101)) where \S+ would grab
    // the entire "display_msg(mstr(101" and fail to match REGEX_MSG_HOVER.
    if (onlyDigits(result)) {
        left = str.slice(0, pos + 1).search(/[^\s(]+\(?\d+$/);
        right = str.slice(pos).search(/\W/);
        if (right < 0) {
            result = str.slice(left);
        } else {
            result = str.slice(left, right + pos);
        }
    }

    return result;
}

/**
 * Find if cursor is within a transpiler tra(123) translation reference.
 * Used by both TBAF and TD files (same syntax).
 * Word boundary prevents matching inside words like "extra(100)".
 * Matches when cursor is anywhere within the tra(digits) span.
 */
function findTraArgumentAtPosition(line: string, pos: number): string | null {
    const pattern = /\btra\((\d+)\)/g;
    for (const match of line.matchAll(pattern)) {
        if (!match[1]) continue;
        const matchEnd = match.index + match[0].length;
        if (pos >= match.index && pos < matchEnd) {
            return match[0];
        }
    }
    return null;
}

/**
 * Find if cursor is within a Fallout MSG reference.
 * Returns the normalized hover token form, e.g. "mstr(100" or "floater_rand(307".
 */
function findMsgArgumentAtPosition(line: string, pos: number): string | null {
    for (const match of line.matchAll(new RegExp(REGEX_MSG_INLAY.source, "g"))) {
        const functionName = match[1];
        const lineKey = match[2];
        if (!functionName || !lineKey) {
            continue;
        }
        const start = match.index + match[0].lastIndexOf(lineKey);
        const end = start + lineKey.length;
        if (pos >= start && pos < end) {
            return `${functionName}(${lineKey}`;
        }
    }

    for (const match of line.matchAll(new RegExp(REGEX_MSG_INLAY_FLOATER_RAND.source, "g"))) {
        const firstKey = match[1];
        const secondKey = match[2];
        if (!firstKey || !secondKey) {
            continue;
        }
        const firstStart = match.index + match[0].indexOf(firstKey);
        const firstEnd = firstStart + firstKey.length;
        if (pos >= firstStart && pos < firstEnd) {
            return `floater_rand(${firstKey}`;
        }

        const secondStart = match.index + match[0].lastIndexOf(secondKey);
        const secondEnd = secondStart + secondKey.length;
        if (pos >= secondStart && pos < secondEnd) {
            return `floater_rand(${secondKey}`;
        }
    }

    return null;
}

function onlyDigits(value: string) {
    return /^\d+$/.test(value);
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

/** Create a new ParseResult with a fallback diagnostic appended. Used when a compiler fails but its output wasn't parseable. */
export function addFallbackDiagnostic(
    parseResult: ParseResult,
    err: ExecFileException,
    uri: string,
    stdout: string,
): ParseResult {
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
    parseResult: ParseResult,
    interactive: boolean,
    successMsg: string,
    failMsg: string,
) {
    if (!interactive) return;
    // Intentional: warnings (e.g. from sslc) indicate real issues that should be surfaced
    // as failures in interactive mode, so users don't miss them.
    if (parseResult.errors.length > 0 || parseResult.warnings.length > 0) {
        showError(failMsg);
    } else {
        showInfo(successMsg);
    }
}
