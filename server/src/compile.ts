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
import { EXT_TBAF, EXT_TD, EXT_TSSL, LANG_FALLOUT_SSL } from "./core/languages";
import { showError, showInfo, showWarning } from "./user-messages";
import { registry } from "./provider-registry";
import { getDocumentSettings } from "./settings-service";
// Consume the public @bgforge/transpile barrel (the transpile functions + the
// output-path mapping), not the internal per-language/compile modules. This
// handler owns the file write and the user-facing message, keeping the library a
// pure source->string transformation. Imported by relative path so esbuild
// bundles it into the server rather than treating it as an external npm dependency.
import { tssl, tbaf, td, outputPathFor, TranspileError } from "../../transpilers/src/index";
import * as weidu from "./weidu-compile";
export { LSP_COMMAND_COMPILE as COMMAND_compile } from "../../shared/protocol";

/**
 * Reports a failed transpile as a diagnostic on the source being edited; the popup stays for the compile
 * the user asked for, since this path also runs on save and on keystroke where only a diagnostic belongs.
 *
 * An error's own line is a position in the BUNDLE the transpiler parsed, not in the file on screen, so
 * one is used only where it is carried and line 1 is the floor - a wrong line is worse than no line.
 */
function reportTranspileFailure(error: unknown, uri: string, language: string, interactive: boolean): void {
    const message = errorMessage(error);
    const located = error instanceof TranspileError ? error.location : {};
    const column = located.column ?? 0;
    sendParseResult(
        { errors: [{ uri, line: located.line ?? 1, columnStart: column, columnEnd: column, message }], warnings: [] },
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
                const { output, warnings } = await td(filePath, text);
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
                const output = await tbaf(filePath, text);
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
                }
            } catch (error) {
                reportTranspileFailure(error, uri, "TBAF", interactive);
            }
            return;
        }
        if (uri.toLowerCase().endsWith(EXT_TSSL)) {
            // Two files carry diagnostics on this path - the source here, and the generated .ssl below -
            // so both are cleared, or a fixed error stays on screen until something republishes the file.
            clearCompilerDiagnostics(uri);
            try {
                const filePath = uriToPath(uri);
                const output = await tssl(filePath, text);
                const sslPath = outputPathFor(filePath);
                await fs.promises.writeFile(sslPath, output, "utf-8");
                const sslName = path.basename(sslPath);
                if (interactive) {
                    showInfo(`Transpiled to ${sslName}`);
                }
                // Chain SSL compilation via registry, reusing the in-memory output.
                const sslUri = pathToUri(sslPath);
                clearCompilerDiagnostics(sslUri);
                await registry.compile(LANG_FALLOUT_SSL, sslUri, output, interactive);
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
