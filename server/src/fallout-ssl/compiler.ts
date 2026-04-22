/**
 * Fallout SSL compilation utilities.
 * Handles compilation via external compile.exe or built-in WASM compiler.
 *
 * Writes a temporary file (.tmp.ssl) in the same directory as the source file
 * so the compiler can resolve relative #include paths. The tmp file name is
 * exported as TMP_SSL_NAME and must be kept in sync with the files.watcherExclude
 * entry in package.json's configurationDefaults (see "Cross-reference: tmp file
 * watcher exclusion" there).
 */

import * as cp from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    type ParseItemList,
    addFallbackDiagnostic,
    conlog,
    needsShell,
    parseCommandPath,
    pathToUri,
    removeTmpFile,
    reportCompileResult,
    runProcess,
    sendParseResult,
    tmpDir,
    uriToPath,
} from "../common";
import type { NormalizedUri } from "../core/normalized-uri";
import { getConnection, getDocuments } from "../lsp-connection";
import { showError, showErrorWithActions, showInfo } from "../user-messages";
import type { SSLsettings } from "../settings";
import { ssl_compile as ssl_builtin_compiler } from "../sslc/ssl_compiler";
import { REQUEST_SET_BUILT_IN_COMPILER } from "../../../shared/protocol";

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
            warnings.push({
                uri: pathToUri(resolveMatchFilePath(matchFile, fileDir)),
                line,
                columnStart: parseInt(matchCol || "0", 10),
                columnEnd: textDocument.offsetAt({ line, character: 0 }) - 1,
                message: matchMsg,
            });
        }
    } catch (err) {
        conlog(err);
    }
    return { errors, warnings };
}

function sendDiagnostics(uri: string, outputText: string, tmpUri: string) {
    const parseResult = parseCompileOutput(outputText, uri);
    sendParseResult(parseResult, uri, tmpUri);
}

// Mutable-field-of-const: avoids a module-level `let` while still allowing
// the cached value to be updated and reset (for tests via _resetCompilerCache).
const compilerPathCache: { path: string | null } = { path: null };

/** Track in-flight compilations per URI so we can cancel stale ones. */
const activeCompiles = new Map<NormalizedUri, AbortController>();

/**
 * Reset cached compiler path. Exported for testing only — module-level
 * state (successfulCompilerPath) persists across test cases, so each test
 * must call this in beforeEach to avoid cross-test contamination.
 */
export function _resetCompilerCache() {
    compilerPathCache.path = null;
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

    // Cancel any in-flight compilation for this URI before starting a new one
    activeCompiles.get(uri)?.abort();
    const controller = new AbortController();
    activeCompiles.set(uri, controller);

    // Errors from the compiler (e.g. WASM crash) propagate to callers.
    // Fire-and-forget call sites (server.ts onDidSave/onDidChangeContent) use
    // `void compile(...).catch(...)` to log and swallow rejections. Awaited
    // call sites (e.g. TSSL transpile chain) catch and report them explicitly.
    // The finally block guarantees tmp file cleanup in both cases.
    try {
        await fs.promises.writeFile(tmpPath, text);
        let useBuiltInCompiler = !sslSettings.compilePath;

        if (!useBuiltInCompiler && !(await checkExternalCompiler(sslSettings.compilePath))) {
            if (!interactive) {
                useBuiltInCompiler = true;
            } else {
                const response = await showErrorWithActions(
                    `Failed to run '${sslSettings.compilePath}'! Switch to built-in compiler?`,
                    { title: "Switch", id: "switch" },
                    { title: "Cancel", id: "cancel" },
                );
                if (response?.id === "switch") {
                    useBuiltInCompiler = true;
                    try {
                        await getConnection().sendRequest(REQUEST_SET_BUILT_IN_COMPILER, { uri });
                    } catch (err) {
                        conlog(`Failed to persist built-in compiler switch: ${err}`);
                    }
                } else {
                    return;
                }
            }
        }

        if (useBuiltInCompiler) {
            const { stdout, returnCode } = await ssl_builtin_compiler({
                interactive,
                cwd: cwdTo,
                inputFileName: TMP_SSL_NAME,
                outputFileName: dstPath,
                options: sslSettings.compileOptions,
                headersDir: sslSettings.headersDirectory,
                signal: controller.signal,
            });
            if (controller.signal.aborted) {
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
            controller.signal,
        );

        // Skip stale results if this compile was cancelled by a newer one
        if (controller.signal.aborted) {
            return;
        }

        let parseResult = parseCompileOutput(stdout, uri);

        if (err && parseResult.errors.length === 0) {
            parseResult = addFallbackDiagnostic(parseResult, err, pathToUri(filepath), stdout);
        }

        reportCompileResult(parseResult, interactive, `Compiled ${baseName}.`, `Failed to compile ${baseName}!`);
        sendParseResult(parseResult, uri, tmpUri);
    } finally {
        activeCompiles.delete(uri);
        await removeTmpFile(tmpPath);
        if (!shouldWriteOutput) {
            await removeTmpFile(dstPath);
        }
    }
}
