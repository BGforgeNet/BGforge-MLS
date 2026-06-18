/**
 * Compilation dispatcher.
 * Routes compile requests to language providers and handles TypeScript transpilers.
 */

import * as fs from "fs";
import * as path from "path";
import { errorMessage } from "./diagnostics";
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
import { tssl, tbaf, td, outputPathFor } from "../../transpilers/src/index";
import * as weidu from "./weidu-compile";
import { LSP_COMMAND_COMPILE } from "../../shared/protocol";

export const COMMAND_compile = LSP_COMMAND_COMPILE;

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
                const msg = errorMessage(error);
                if (interactive) {
                    showError(`TD: ${msg}`);
                }
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
                const msg = errorMessage(error);
                if (interactive) {
                    showError(`TBAF: ${msg}`);
                }
            }
            return;
        }
        if (uri.toLowerCase().endsWith(EXT_TSSL)) {
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
                const msg = errorMessage(error);
                if (interactive) {
                    showError(`TSSL: ${msg}`);
                }
            }
        }
        return;
    }

    conlog(`Don't know how to compile ${langId} - ${uri}`);
    if (interactive) {
        showInfo(`Don't know how to compile ${langId} - ${uri}`);
    }
}
