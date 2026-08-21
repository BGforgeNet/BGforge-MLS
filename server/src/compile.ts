/**
 * Compilation dispatcher.
 * Routes compile requests to language providers and handles TypeScript transpilers.
 */

import * as fs from "fs";
import * as path from "path";
import { errorMessage, sendParseResult } from "./diagnostics";
import { clearCompilerDiagnostics } from "./diagnostic-store";
import { conlog } from "./logger";
import { isDirectory, tmpDir } from "./path-utils";
import { pathToUri, uriToPath } from "./uri-utils";
import { EXT_TBAF, EXT_TD, EXT_TSSL } from "./core/languages";
import { showError, showInfo, showWarning } from "./user-messages";
import { registry } from "./provider-registry";
import { getDocumentSettings } from "./settings-service";
// Consume the public @bgforge/transpile barrel (the transpile functions + the
// output-path mapping), not the internal per-language/compile modules. This
// handler owns the file write and the user-facing message, keeping the library a
// pure source->string transformation. Imported by relative path so esbuild
// bundles it into the server rather than treating it as an external npm dependency.
import { tbafWithSourceMap, td, outputPathFor, TranspileError } from "../../transpilers/src/index";
// TSSL is a compiler rather than one of the transpilers above, so it does not come from that barrel and
// does not chain through a generated file: `compileTsslToInt` produces the bytecode itself.
import { compileTsslToInt } from "./tssl/compile-int";
import { relocateGeneratedDiagnostics } from "./core/generated-diagnostics";
import * as weidu from "./weidu-compile";
export { LSP_COMMAND_COMPILE as COMMAND_compile } from "../../shared/protocol";

/**
 * Reports a failed transpile as a diagnostic on the source being edited; the popup stays for the compile
 * the user asked for, since this path also runs on save and on keystroke where only a diagnostic belongs.
 *
 * A transpiler bundles the file's imports, so a failure can belong to a file the author never opened. Its
 * line means nothing against the one on screen, so that case says where in the message and falls back to
 * line 1 - the diagnostic stays on the file this compile was asked for, which is the only one a later
 * clean compile clears. String equality is enough to tell the two apart: a transpiler reports the entry
 * under the path it was handed, which is the one derived from this URI.
 */
function reportTranspileFailure(error: unknown, uri: string, language: string, interactive: boolean): void {
    const located = error instanceof TranspileError ? error.location : {};
    const elsewhere = located.file !== undefined && located.file !== uriToPath(uri);
    const message = elsewhere ? `${located.file}:${located.line ?? 1}: ${errorMessage(error)}` : errorMessage(error);
    const line = elsewhere ? 1 : (located.line ?? 1);
    const column = elsewhere ? 0 : (located.column ?? 0);
    sendParseResult(
        { errors: [{ uri, line, columnStart: column, columnEnd: column, message }], warnings: [] },
        uri,
        uri,
    );
    if (interactive) showError(`${language}: ${message}`);
}

/**
 * Copies files to tmpdir and parses it there, then send diagnostic to the real file.
 * Because weidu and compile.exe require file on disk to parse.
 * @param uri
 * @param langId
 * @param interactive - set if it's run manually by command
 * @param text - current full text (which could be different from on-disk version)
 * @returns void
 */
export async function compile(uri: string, langId: string, interactive = false, text: string) {
    // Every compiler here works through a file on disk, and a URI outside `file:` names none - so there
    // is nowhere to read includes from or write output to. A decompiled script is the case that reaches
    // this: the language client attaches to its own scheme for completion and hover, which puts it on
    // the same save/keystroke validation path as any source file. Silent because that path runs
    // constantly and the editor compiles these back through its own save instead.
    if (!uri.startsWith("file://")) {
        conlog(`Not compiling ${uri}: not a file on disk`, "debug");
        return;
    }
    const settings = await getDocumentSettings(uri);
    if (!isDirectory(tmpDir)) {
        fs.mkdirSync(tmpDir);
    }

    // Try provider first (all standard languages have providers now)
    if (registry.has(langId)) {
        clearCompilerDiagnostics(uri);
        const handled = await registry.compile(langId, uri, text, interactive);
        if (handled) {
            return;
        }
    }

    // TypeScript-based transpilers (TBAF, TSSL, TD)
    if (langId === "typescript") {
        if (uri.toLowerCase().endsWith(EXT_TD)) {
            clearCompilerDiagnostics(uri);
            try {
                const filePath = uriToPath(uri);
                const { output, warnings, sourceMap } = await td(filePath, text);
                const dPath = outputPathFor(filePath);
                await fs.promises.writeFile(dPath, output, "utf-8");
                const dName = path.basename(dPath);
                if (interactive) {
                    if (warnings.length > 0) {
                        const orphanNames = warnings.map((w) => w.message.match(/^Function "(.+)" /)?.[1] ?? "?");
                        showWarning(`Transpiled to ${dName}. Orphan states: ${orphanNames.join(", ")}`);
                    } else {
                        showInfo(`Transpiled to ${dName}`);
                    }
                }
                // Chain D compilation if weidu and game path are configured.
                // Reuse the in-memory output; it was just written to dPath.
                if (settings.weidu.path && settings.weidu.gamePath) {
                    const dUri = pathToUri(dPath);
                    await weidu.compile(dUri, settings.weidu, interactive, output);
                    relocateGeneratedDiagnostics(dUri, sourceMap);
                }
            } catch (error) {
                reportTranspileFailure(error, uri, "TD", interactive);
            }
            return;
        }
        if (uri.toLowerCase().endsWith(EXT_TBAF)) {
            clearCompilerDiagnostics(uri);
            try {
                const filePath = uriToPath(uri);
                const { output, sourceMap } = await tbafWithSourceMap(filePath, text);
                const bafPath = outputPathFor(filePath);
                await fs.promises.writeFile(bafPath, output, "utf-8");
                const bafName = path.basename(bafPath);
                if (interactive) {
                    showInfo(`Transpiled to ${bafName}`);
                }
                // Chain BAF compilation if weidu and game path are configured.
                if (settings.weidu.path && settings.weidu.gamePath) {
                    const bafUri = pathToUri(bafPath);
                    await weidu.compile(bafUri, settings.weidu, interactive, output);
                    relocateGeneratedDiagnostics(bafUri, sourceMap);
                }
            } catch (error) {
                reportTranspileFailure(error, uri, "TBAF", interactive);
            }
            return;
        }
        if (uri.toLowerCase().endsWith(EXT_TSSL)) {
            clearCompilerDiagnostics(uri);
            try {
                const filePath = uriToPath(uri);
                const { intPath, sslPath } = await compileTsslToInt(uri, filePath, text, settings, interactive);
                if (interactive) {
                    // An interactive compile always keeps its output, so `intPath` names a real file
                    // here whatever `compileOnValidate` says.
                    const also = sslPath ? ` and ${path.basename(sslPath)}` : "";
                    showInfo(`Compiled ${path.basename(intPath)}${also}`);
                }
            } catch (error) {
                reportTranspileFailure(error, uri, "TSSL", interactive);
            }
        }
        return;
    }

    conlog(`Don't know how to compile ${langId} - ${uri}`);
    if (interactive) {
        showInfo(`Don't know how to compile ${langId} - ${uri}`);
    }
}
