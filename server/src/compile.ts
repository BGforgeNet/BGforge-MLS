/**
 * Compilation dispatcher.
 * Routes compile requests to language providers and handles TypeScript transpilers.
 */

import * as fs from "fs";
import * as path from "path";
import { conlog, errorMessage, isDirectory, pathToUri, tmpDir } from "./common";
import { EXT_TBAF, EXT_TD, EXT_TSSL, LANG_FALLOUT_SSL } from "./core/languages";
import { getConnection } from "./lsp-connection";
import { showError, showInfo, showWarning } from "./user-messages";
import { registry } from "./provider-registry";
import { getDocumentSettings } from "./settings-service";
import * as tbaf from "../../transpilers/tbaf/src/index";
import * as td from "../../transpilers/td/src/index";
import * as tssl from "../../transpilers/tssl/src/index";
import * as weidu from "./weidu-compile";
import { LSP_COMMAND_COMPILE } from "../../shared/protocol";
import type { TranspilerEvent } from "../../transpilers/common/transpiler-pipeline";

export const COMMAND_compile = LSP_COMMAND_COMPILE;

function findOutputWrittenEvent(events: readonly TranspilerEvent[] | undefined): TranspilerEvent | undefined {
    return events?.find((event) => event.code === "output_written");
}

export function clearDiagnostics(uri: string) {
    // Clear old diagnostics (fire-and-forget notification)
    void getConnection().sendDiagnostics({ uri: uri, diagnostics: [] });
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
    const settings = await getDocumentSettings(uri);
    if (!isDirectory(tmpDir)) {
        fs.mkdirSync(tmpDir);
    }

    // Try provider first (all standard languages have providers now)
    if (registry.has(langId)) {
        clearDiagnostics(uri);
        const handled = await registry.compile(langId, uri, text, interactive);
        if (handled) {
            return;
        }
    }

    // TypeScript-based transpilers (TBAF, TSSL, TD)
    if (langId === "typescript") {
        if (uri.toLowerCase().endsWith(EXT_TD)) {
            clearDiagnostics(uri);
            try {
                const { dPath, warnings, events } = await td.compile(uri, text);
                const dName = path.basename(dPath);
                const outputEvent = findOutputWrittenEvent(events);
                if (interactive) {
                    if (warnings.length > 0) {
                        const orphanNames = warnings.map((w) => w.message.match(/^Function "(.+)" /)?.[1] ?? "?");
                        const baseMessage = outputEvent?.message ?? `Transpiled to ${dName}`;
                        const msg = `${baseMessage}. Orphan states: ${orphanNames.join(", ")}`;
                        showWarning(msg);
                    } else {
                        showInfo(outputEvent?.message ?? `Transpiled to ${dName}`);
                    }
                }
                // Chain D compilation if weidu and game path are configured
                if (settings.weidu.path && settings.weidu.gamePath) {
                    const dUri = pathToUri(dPath);
                    const dText = await fs.promises.readFile(dPath, "utf-8");
                    await weidu.compile(dUri, settings.weidu, interactive, dText);
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
            clearDiagnostics(uri);
            try {
                const { bafPath, events } = await tbaf.compile(uri, text);
                const bafName = path.basename(bafPath);
                const outputEvent = findOutputWrittenEvent(events);
                if (interactive) {
                    showInfo(outputEvent?.message ?? `Transpiled to ${bafName}`);
                }
                // Chain BAF compilation if weidu and game path are configured
                if (settings.weidu.path && settings.weidu.gamePath) {
                    const bafUri = pathToUri(bafPath);
                    const bafText = await fs.promises.readFile(bafPath, "utf-8");
                    await weidu.compile(bafUri, settings.weidu, interactive, bafText);
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
                const { sslPath } = await tssl.compile(uri, text);
                const sslName = path.basename(sslPath);
                if (interactive) {
                    showInfo(`Transpiled to ${sslName}`);
                }
                // Chain SSL compilation via registry
                const sslUri = pathToUri(sslPath);
                const sslText = await fs.promises.readFile(sslPath, "utf-8");
                clearDiagnostics(sslUri);
                await registry.compile(LANG_FALLOUT_SSL, sslUri, sslText, interactive);
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
