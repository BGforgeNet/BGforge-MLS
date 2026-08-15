/**
 * Fallout SSL compilation utilities.
 * Handles compilation via an external sslc, the WebAssembly one, or the extension's own.
 *
 * The WebAssembly and external compilers are programs that take a file name, so the document - which
 * may hold unsaved edits - is written to a temporary file (.tmp.ssl) beside the source, where relative
 * #include paths resolve as they would for the real thing. The tmp file name is exported as
 * TMP_SSL_NAME and must be kept in sync with the files.watcherExclude entry in package.json's
 * configurationDefaults (see "Cross-reference: tmp file watcher exclusion" there).
 *
 * The extension's own compiler is a library, so it takes the text directly and writes nothing beside
 * the user's source - but it runs on a worker thread all the same, because it is the only back end
 * whose work would otherwise land on the server's own thread. See compile-worker.ts.
 */

import * as cp from "child_process";
import * as crypto from "crypto";
import * as os from "os";
import * as path from "path";
import { parseArgs } from "../../../compilers/ssl/src/args";
import {
    addFallbackDiagnostic,
    errorMessage,
    reportCompileResult,
    sendParseResult,
    type ParseItemList,
} from "../diagnostics";
import { conlog } from "../logger";
import { tmpDir } from "../path-utils";
import { pathToUri, uriToPath } from "../uri-utils";
import { needsShell, parseCommandPath, runProcess } from "../process-runner";
import { abortAllCompiles, withCompileLifecycle, writeTmpSource } from "../core/compile-with-tmp-file";
import { compileOnWorker, stopCompileWorker } from "./compile-worker-client";
import type { NormalizedUri } from "../core/normalized-uri";
import { getDocuments } from "../lsp-connection";
import { showError, showErrorWithActions, showInfo } from "../user-messages";
import type { SSLsettings } from "../settings";
import { ssl_compile as ssl_wasm_compiler } from "../sslc/ssl_compiler";

const sslExt = ".ssl";

/**
 * Tmp file name used for compilation. Must be in the same directory as the
 * source file because SSL #include directives can use relative paths.
 *
 * Cross-reference: package.json configurationDefaults has a files.watcherExclude
 * entry for this name to prevent VS Code file watchers from picking it up.
 */
export const TMP_SSL_NAME = ".tmp.ssl";

/**
 * Wine gives network-mapped looking path to compile.exe
 * @param filePath looks like this `Z:/Downloads/1/_mls_test.h`, should be this `/home/user/Downloads/1/_mls_test.h`
 * Imperfect, but works.
 */
function fixWinePath(filePath: string) {
    if (os.platform() === "win32") {
        return filePath;
    }
    if (!filePath.startsWith("Z:/")) {
        return filePath;
    }

    const homeDir = os.homedir();
    const relPath = filePath.replace("Z:/", "");
    const realPath = path.join(homeDir, relPath);
    return realPath;
}

/** Resolve a file path from compiler output, handling Wine paths and relative includes. */
function resolveMatchFilePath(matchFile: string, fileDir: string): string {
    const fixed = fixWinePath(matchFile);
    return path.isAbsolute(fixed) ? fixed : path.join(fileDir, fixed);
}

/** Safely iterate regex matches, protecting against zero-width infinite loops. */
function* execAll(regex: RegExp, text: string): Generator<RegExpExecArray> {
    let match = regex.exec(text);
    while (match !== null) {
        if (match.index === regex.lastIndex) {
            regex.lastIndex++;
        }
        yield match;
        match = regex.exec(text);
    }
}

/**
 * Parse compile.exe output with regex and return found matches.
 * `text` looks like this
 * `[Error] <1.ssl.tmp>:2:8: Expecting top-level statement`
 * or
 * `[Error] <Semantic> <my_script.ssl>:26:25: Unknown identifier qq.`
 * or (wine)
 * `[Error] <Z:/Downloads/1/_mls_test.h>:1: Illegal parameter "1"`
 *
 * Numbers mean line:column, if column is absent, it means first column.
 */
function parseCompileOutput(text: string, uri: string) {
    const textDocument = getDocuments().get(uri);
    if (!textDocument) {
        return { errors: [], warnings: [] };
    }
    const errorsRegex = /\[Error\]( <Semantic>)? <(.+)>:([\d]*):([\d]*):? (.*)/g;
    const warningsRegex = /\[Warning\] <(.+)>:([\d]*):([\d]*):? (.*)/g;
    const errors: ParseItemList = [];
    const warnings: ParseItemList = [];

    // compile.exe may show errors and warnings for included files, not just current one.
    // They could be relative to the original file path.
    const filePath = uriToPath(uri);
    const fileDir = path.dirname(filePath);

    try {
        for (const match of execAll(errorsRegex, text)) {
            const matchFile = match[2];
            const matchLine = match[3];
            const matchCol = match[4];
            const matchMsg = match[5];
            if (!matchFile || !matchLine || !matchMsg) continue;

            errors.push({
                uri: pathToUri(resolveMatchFilePath(matchFile, fileDir)),
                line: parseInt(matchLine, 10),
                columnStart: 0,
                columnEnd: parseInt(matchCol || "1", 10) - 1,
                message: matchMsg,
            });
        }

        for (const match of execAll(warningsRegex, text)) {
            const matchFile = match[1];
            const matchLine = match[2];
            const matchCol = match[3];
            const matchMsg = match[4];
            if (!matchFile || !matchLine || !matchMsg) continue;

            const line = parseInt(matchLine, 10);
            // sslc reports 1-based lines; LSP lines are 0-based, so the warning's
            // line is `line - 1`. Underline from the reported column to the end of
            // that line. offsetAt alone yields a document-wide offset, so convert
            // the end-of-line offset back into a line-relative character via
            // positionAt (offsetAt of the next line's start clamps to the document
            // end for the final line).
            const lspLine = line - 1;
            const lineEndOffset = textDocument.offsetAt({ line: lspLine + 1, character: 0 }) - 1;
            const columnEnd = textDocument.positionAt(lineEndOffset).character;
            warnings.push({
                uri: pathToUri(resolveMatchFilePath(matchFile, fileDir)),
                line,
                columnStart: parseInt(matchCol || "0", 10),
                columnEnd,
                message: matchMsg,
            });
        }
    } catch (error) {
        conlog(`fallout-ssl parse output failed: ${errorMessage(error)}`, "error");
    }
    return { errors, warnings };
}

/**
 * Compiles with the extension's own compiler, on the worker thread that runs it.
 *
 * Unlike both other back ends it is not a separate program, so it needs neither an installed binary
 * nor a child process, and it reads the document from memory rather than through a copy on disk.
 * `filepath` is the buffer's own path: it is never read, but relative `#include` paths resolve against
 * its directory and errors are attributed to it, so both behave as they would on disk.
 */
async function compileWithOwnCompiler(text: string, filepath: string, dstPath: string, sslSettings: SSLsettings) {
    // `compileOptions` is a command line for whichever compiler is selected, so it is read here with the
    // same parser the standalone CLI uses rather than a second, narrower reading of the same string.
    const args = parseArgs(sslSettings.compileOptions.split(/\s+/).filter(Boolean));
    // A switch this compiler cannot honour is refused rather than dropped. `-b` decides which words are
    // keywords, so compiling without it builds the script against a different language than the settings
    // asked for - and it would fail somewhere in the script rather than at the setting that caused it.
    const unsupported = args.notices.filter((notice) => notice.fatal);
    if (unsupported.length > 0) {
        return {
            errors: unsupported.map((notice) => ({
                uri: pathToUri(filepath),
                line: 1,
                columnStart: 0,
                columnEnd: 0,
                // The remedy leads, because the Problems panel truncates a row to its first few words and
                // what to do is the part worth seeing there. The other compiler is the reference itself
                // and takes this setting verbatim, so a switch only this one lacks has somewhere to go; a
                // malformed argument names none and gets no such offer, changing compiler not being a fix.
                message:
                    (notice.unsupported
                        ? `bgforge.falloutSSL.compileOptions: remove ${notice.unsupported}, or set ` +
                          `bgforge.falloutSSL.compiler to "wasm", which supports it. `
                        : "bgforge.falloutSSL.compileOptions: ") + notice.message,
            })),
            warnings: [],
        };
    }
    const headers = sslSettings.headersDirectory ? [sslSettings.headersDirectory] : [];
    try {
        return await compileOnWorker({
            text,
            filepath,
            dstPath,
            includeDirs: [...headers, ...args.includeDirs],
            defines: args.defines,
            level: args.level,
            shortCircuit: args.shortCircuit,
            noWarnings: args.noWarnings,
        });
    } catch (error) {
        // The worker itself failed - it died, or could not be started. That is not a fault in the
        // script, so it is reported at the top of the file rather than pinned to a line in it.
        const message = error instanceof Error ? error.message : String(error);
        return {
            errors: [{ uri: pathToUri(filepath), line: 1, columnStart: 0, columnEnd: 0, message }],
            warnings: [],
        };
    }
}

function sendDiagnostics(uri: string, outputText: string, tmpUri: string) {
    const parseResult = parseCompileOutput(outputText, uri);
    sendParseResult(parseResult, uri, tmpUri);
}

// Mutable-field-of-const: avoids a module-level `let` while still allowing
// the cached value to be updated and reset (for tests via _resetCompilerCache).
const compilerPathCache: { path: string | null } = { path: null };

/**
 * External compiler paths the user has opted out of for the lifetime of the
 * server. Once the user picks "Switch" on the version-check error dialog, we
 * stop re-prompting for that path on subsequent compiles and use one of the
 * compiler directly. The user makes the decision permanent by clearing
 * `bgforge.falloutSSL.compilePath` in their settings.
 */
const disabledExternalPaths = new Set<string>();

/** Track in-flight compilations per URI so we can cancel stale ones. */
const activeCompiles = new Map<NormalizedUri, AbortController>();

/** Abort every in-flight Fallout SSL compilation. Called from server shutdown. */
export function abortInFlightSSLCompiles(): void {
    abortAllCompiles(activeCompiles);
    // The compile worker holds a loaded grammar and would otherwise outlive the transport it reports
    // through. Nothing awaits this: shutdown is not held up for a result no one will read.
    void stopCompileWorker();
}

/**
 * Reset cached compiler state. Exported for testing only - module-level
 * state persists across test cases, so each test must call this in beforeEach
 * to avoid cross-test contamination.
 */
// eslint-disable-next-line no-underscore-dangle -- test-only escape hatch; the underscore signals "do not call from production code"
export function _resetCompilerCache() {
    compilerPathCache.path = null;
    disabledExternalPaths.clear();
}

async function checkExternalCompiler(compilePath: string) {
    if (compilePath === compilerPathCache.path) {
        return true;
    }

    return new Promise<boolean>((resolve) => {
        const { executable, prefixArgs } = parseCommandPath(compilePath);
        const shell = needsShell(executable);
        cp.execFile(executable, [...prefixArgs, "--version"], { shell }, (err) => {
            conlog(`Compiler check '${compilePath} --version' err=${err}`);
            if (err) {
                resolve(false);
            } else {
                compilerPathCache.path = compilePath;
                resolve(true);
            }
        });
    });
}

/** Build args and run the external SSL compiler via shared runProcess. */
function runExternalCompiler(
    compilePath: string,
    compileOptions: readonly string[],
    cwdTo: string,
    dstPath: string,
    signal?: AbortSignal,
) {
    const { executable, prefixArgs } = parseCommandPath(compilePath);
    const allArgs = [...prefixArgs, ...compileOptions, TMP_SSL_NAME, "-o", dstPath];
    return runProcess(executable, allArgs, cwdTo, signal);
}

function getValidationOutputPath(uri: string, base: string) {
    const uriHash = crypto.createHash("md5").update(uri).digest("hex").slice(0, 8);
    return path.join(tmpDir, `tmp-${uriHash}-${base}.int`);
}

export async function compile(
    uri: NormalizedUri,
    sslSettings: SSLsettings,
    interactive = false,
    text: string,
    debug = false,
) {
    const filepath = uriToPath(uri);
    const cwdTo = path.dirname(filepath);
    const tmpPath = path.join(cwdTo, TMP_SSL_NAME);
    const tmpUri = pathToUri(tmpPath);
    const parsed = path.parse(filepath);
    const baseName = parsed.base;
    const base = parsed.name;
    const compileOptions = sslSettings.compileOptions.split(/\s+/).filter(Boolean);
    const shouldWriteOutput = interactive || sslSettings.compileOnValidate;
    const dstPath = shouldWriteOutput
        ? path.join(sslSettings.outputDirectory, base + ".int")
        : getValidationOutputPath(uri, base);

    if (parsed.ext.toLowerCase() !== sslExt) {
        // vscode loses open file if clicked on console or elsewhere
        conlog("Not a Fallout SSL file! Please focus a Fallout SSL file to compile.");
        if (interactive) {
            showInfo("Please focus a Fallout SSL file to compile!");
        }
        return;
    }
    conlog(`compiling ${baseName}...`);

    // Errors from the compiler (e.g. WASM crash) propagate to callers.
    // Fire-and-forget call sites (server.ts onDidSave/onDidChangeContent) use
    // `void compile(...).catch(...)` to log and swallow rejections. Awaited
    // call sites (e.g. TSSL transpile chain) catch and report them explicitly.
    // The lifecycle guarantees cleanup in both cases.
    //
    // Registering the run comes FIRST, before the external-compiler check: that check is a subprocess
    // and may put a dialog in front of the user, so deciding the back end ahead of it would let two
    // compiles of the same document register in the order their checks happened to finish rather than
    // the order they started, and an older one could then abort the newer and report stale diagnostics.
    await withCompileLifecycle({
        uri,
        activeCompiles,
        // The tmp source is only created on the branch below that needs it; removing a path that was
        // never written is a no-op. Throwaway validation output only exists when we didn't write to
        // the real output dir.
        cleanupPaths: shouldWriteOutput ? [tmpPath] : [tmpPath, dstPath],
        run: async (signal) => {
            let useOwnCompiler = !sslSettings.compilePath || disabledExternalPaths.has(sslSettings.compilePath);

            if (!useOwnCompiler && !(await checkExternalCompiler(sslSettings.compilePath))) {
                if (!interactive) {
                    useOwnCompiler = true;
                } else {
                    const response = await showErrorWithActions(
                        `Failed to run '${sslSettings.compilePath}'! Switch to the extension's own compiler?`,
                        { title: "Switch", id: "switch" },
                        { title: "Cancel", id: "cancel" },
                    );
                    if (response?.id === "switch") {
                        useOwnCompiler = true;
                        disabledExternalPaths.add(sslSettings.compilePath);
                        showInfo(
                            "Using the extension's own compiler. To make this permanent, clear the bgforge.falloutSSL.compilePath setting.",
                        );
                    } else {
                        return;
                    }
                }
            }

            // The extension's own compiler is a library: it takes the document's text directly, so
            // nothing is written beside the user's source.
            if (useOwnCompiler && sslSettings.compiler === "built-in") {
                const result = await compileWithOwnCompiler(text, filepath, dstPath, sslSettings);
                if (signal.aborted) {
                    return;
                }
                reportCompileResult(result, interactive, `Compiled ${baseName}.`, `Failed to compile ${baseName}!`);
                // This compiler names the source by its own path rather than a tmp copy's, so that is
                // what maps back to the open document; an error in an included header keeps its file.
                sendParseResult(result, uri, pathToUri(filepath));
                return;
            }

            // Everything below is a program that takes a file name, so the document goes to disk first.
            await writeTmpSource(tmpPath, text);

            if (useOwnCompiler) {
                const { stdout, returnCode } = await ssl_wasm_compiler({
                    interactive,
                    cwd: cwdTo,
                    inputFileName: TMP_SSL_NAME,
                    outputFileName: dstPath,
                    options: sslSettings.compileOptions,
                    headersDir: sslSettings.headersDirectory,
                    signal,
                    debug,
                });
                if (signal.aborted) {
                    return;
                }
                if (returnCode === 0) {
                    if (interactive) {
                        showInfo(`Compiled ${baseName}.`);
                    }
                } else {
                    if (interactive) {
                        showError(`Failed to compile ${baseName}!`);
                    }
                }
                sendDiagnostics(uri, stdout, tmpUri);
                return;
            }

            const { err, stdout } = await runExternalCompiler(
                sslSettings.compilePath,
                compileOptions,
                cwdTo,
                dstPath,
                signal,
            );

            if (signal.aborted) {
                return;
            }

            let parseResult = parseCompileOutput(stdout, uri);

            if (err && parseResult.errors.length === 0) {
                parseResult = addFallbackDiagnostic(parseResult, err, pathToUri(filepath), stdout);
            }

            reportCompileResult(parseResult, interactive, `Compiled ${baseName}.`, `Failed to compile ${baseName}!`);
            sendParseResult(parseResult, uri, tmpUri);
        },
    });
}
