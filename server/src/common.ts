/**
 * Common utilities shared across the language server.
 * Includes logging, file path manipulation, glob helpers, diagnostic creation,
 * and shared compilation infrastructure (process runner, fallback diagnostics, result reporting).
 */

import * as cp from "child_process";
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

/** Expand leading ~ to the user's home directory. execFile doesn't use a shell, so ~ is not expanded. */
export function expandHome(filePath: string): string {
    if (filePath.startsWith("~/") || filePath === "~") {
        return path.join(os.homedir(), filePath.slice(1));
    }
    return filePath;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- logging accepts any value
export function conlog(item: any): void {
    const log = getConnection().console.log.bind(getConnection().console);
    if (item === undefined) {
        log("undefined");
        return;
    }
    if (typeof item === "string") {
        log(item);
        return;
    }
    if (typeof item === "number" || typeof item === "boolean") {
        log(item.toString());
        return;
    }
    if (item instanceof Map) {
        log(JSON.stringify([...item]));
        return;
    }
    try {
        log(JSON.stringify(item));
    } catch {
        log(String(item));
    }
}

interface ParseItem {
    uri: string;
    line: number;
    columnStart: number;
    columnEnd: number;
    message: string;
}
export interface ParseItemList extends Array<ParseItem> { }

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
        const existing = diagnostics.get(uri) ?? [];
        diagnostics.set(uri, [...existing, diagnostic]);
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

/** Check if 1st dir contains the 2nd */
export function isSubpath(outerPath: string | undefined, innerPath: string): boolean {
    if (outerPath === undefined) {
        return false;
    }
    try {
        const innerReal = fs.realpathSync(innerPath);
        const outerReal = fs.realpathSync(outerPath);
        const rel = path.relative(outerReal, innerReal);
        return !rel.startsWith("..") && !path.isAbsolute(rel);
    } catch {
        return false;
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

/** Known wrapper commands that may prefix executable paths in user settings. */
const KNOWN_WRAPPERS = new Set(["wine", "wine64", "mono", "dotnet", "flatpak"]);

/** Windows .cmd/.bat files require shell: true for cp.execFile to work. */
export function needsShell(executablePath: string): boolean {
    const ext = path.extname(executablePath).toLowerCase();
    return ext === ".cmd" || ext === ".bat";
}

/**
 * Split a command-line setting into executable and prefix arguments.
 * Only splits when the first token is a known wrapper (e.g., "wine ~/bin/compile").
 * Plain paths (even with spaces) pass through as-is with tilde expansion.
 * This avoids breaking paths that contain spaces like "/opt/my tools/compile".
 */
export function parseCommandPath(commandPath: string): { executable: string; prefixArgs: string[] } {
    const trimmed = commandPath.trim();
    if (trimmed === "") {
        return { executable: commandPath, prefixArgs: [] };
    }

    const spaceIndex = trimmed.indexOf(" ");
    if (spaceIndex === -1) {
        // Single token, no splitting needed
        return { executable: expandHome(trimmed), prefixArgs: [] };
    }

    const firstToken = trimmed.slice(0, spaceIndex);
    if (KNOWN_WRAPPERS.has(firstToken.toLowerCase())) {
        const rest = trimmed.slice(spaceIndex + 1).trim();
        return {
            executable: firstToken,
            prefixArgs: rest ? [expandHome(rest)] : [],
        };
    }

    // Not a known wrapper - treat entire string as the executable path
    return { executable: expandHome(trimmed), prefixArgs: [] };
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

/** Remove a tmp file, logging errors instead of throwing (cleanup must not mask compiler results). */
export async function removeTmpFile(tmpPath: string) {
    try {
        await fs.promises.unlink(tmpPath);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            conlog(`Failed to clean up ${tmpPath}: ${err}`);
        }
    }
}

/** Run an external process and return a promise that resolves when it finishes.
 *  timeoutMs defaults to 60 000 ms — long enough for real sslc/weidu compiles on
 *  slow machines, short enough to surface hangs. Node kills the child on timeout
 *  and calls back with err.killed === true + err.signal === "SIGTERM". */
export function runProcess(
    executable: string,
    args: readonly string[],
    cwd: string,
    signal?: AbortSignal,
    timeoutMs = 60_000,
): Promise<{ err: cp.ExecFileException | null; stdout: string }> {
    const shell = needsShell(executable);
    conlog(`${executable} ${args.join(" ")}`);

    return new Promise((resolve) => {
        cp.execFile(executable, [...args], { cwd, shell, signal, timeout: timeoutMs }, (err, stdout: string, stderr: string) => {
            conlog("stdout: " + stdout);
            if (stderr) {
                conlog("stderr: " + stderr);
            }
            if (err) {
                conlog("error: " + err.message);
            }
            resolve({ err, stdout });
        });
    });
}

/** Create a new ParseResult with a fallback diagnostic appended. Used when a compiler fails but its output wasn't parseable. */
export function addFallbackDiagnostic(
    parseResult: ParseResult,
    err: cp.ExecFileException,
    uri: string,
    stdout: string,
): ParseResult {
    return {
        errors: [...parseResult.errors, {
            uri,
            line: 1,
            columnStart: 0,
            columnEnd: 0,
            message: stdout || err.message,
        }],
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
