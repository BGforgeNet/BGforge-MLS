/**
 * WeiDU compilation: spawn WeiDU processes, parse output, send diagnostics.
 * Used by BAF, D, and TP2 providers for parse-checking.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import {
    addFallbackDiagnostic,
    conlog,
    parseCommandPath,
    pathToUri,
    removeTmpFile,
    reportCompileResult,
    runProcess,
    sendParseResult,
    tmpDir,
    uriToPath,
} from "./common";
import type { ParseItemList, ParseResult } from "./common";
import { showError, showInfo, showWarning } from "./user-messages";
import type { WeiDUsettings } from "./settings";
import type { NormalizedUri } from "./core/normalized-uri";

/** Track in-flight compilations per URI so we can cancel stale ones. */
const activeCompiles = new Map<NormalizedUri, AbortController>();

const valid_extensions = new Map([
    [".tp2", "tp2"],
    [".tph", "tpa"],
    [".tpa", "tpa"],
    [".tpp", "tpp"],
    [".d", "d"],
    [".baf", "baf"],
]);

/** `text` looks like this
 *
 * `[ua.tp2]  ERROR at line 30 column 1-63` */
function parseWeiduOutput(text: string) {
    const errorsRegex = /\[(\S+)\]\s+(?:(?:PARSE|LEXER)\s+)?ERROR at line (\d+) column (\d+)-(\d+)/g;
    const errors: ParseItemList = [];
    const warnings: ParseItemList = [];
    const seen = new Set<string>();

    try {
        let match = errorsRegex.exec(text);
        while (match !== null) {
            // This is necessary to avoid infinite loops with zero-width matches
            if (match.index === errorsRegex.lastIndex) {
                errorsRegex.lastIndex++;
            }
            const matchUri = match[1];
            const matchLine = match[2];
            const matchColStart = match[3];
            const matchColEnd = match[4];
            if (!matchUri || !matchLine || !matchColStart || !matchColEnd) {
                match = errorsRegex.exec(text);
                continue;
            }

            // WeiDU may emit both "PARSE ERROR" and "ERROR" for the same location
            const key = `${matchUri}:${matchLine}:${matchColStart}-${matchColEnd}`;
            if (!seen.has(key)) {
                seen.add(key);

                // Extract up to 4 non-empty detail lines after the error header.
                // WeiDU always stops at the first error, so there's no risk of bleeding
                // into a second error block — but we still limit to 4 lines for readability.
                const afterMatch = text.slice(match.index + match[0].length);
                const detailLines = afterMatch.split(/\r?\n/).slice(1).filter((l) => l.length > 0);
                const maxDetailLines = 4;
                const truncatedDetails = detailLines.length > maxDetailLines
                    ? [...detailLines.slice(0, maxDetailLines), "..."]
                    : detailLines;
                const message = truncatedDetails.join("\n");

                errors.push({
                    uri: pathToUri(matchUri),
                    line: parseInt(matchLine),
                    // WeiDU usually emits 1-based start columns (column 1-10), but sometimes
                    // 0-based (column 0-5) for tokens at the start of a line. Clamp to
                    // 0 so we never produce an invalid negative LSP character offset.
                    // End column is kept as-is: WeiDU's end already aligns with LSP's
                    // exclusive end (e.g. "column 1-10" → LSP start=0, end=10).
                    columnStart: Math.max(0, parseInt(matchColStart) - 1),
                    columnEnd: parseInt(matchColEnd),
                    message,
                });
            }

            match = errorsRegex.exec(text);
        }
    } catch (err) {
        conlog(err);
    }
    const result: ParseResult = { errors: errors, warnings: warnings };
    return result;
}

export async function compile(uri: NormalizedUri, settings: WeiDUsettings, interactive = false, text: string) {
    const gamePath = settings.gamePath;
    const { executable: weiduPath, prefixArgs: weiduPrefixArgs } = parseCommandPath(settings.path);
    const filePath = uriToPath(uri);
    const cwdTo = tmpDir;
    const baseName = path.parse(filePath).base;
    const ext = path.parse(filePath).ext.toLowerCase();

    /**
     * Preprocessed file with unique name per URI to prevent concurrent compilations
     * of same-extension files from overwriting each other.
     * Weidu used to have issues with non-baf extensions, ref https://github.com/WeiDUorg/weidu/issues/237
     */
    const uriHash = crypto.createHash("md5").update(uri).digest("hex").slice(0, 8);
    const tmpFile = path.join(tmpDir, `tmp-${uriHash}${ext}`);
    const tmpUri = pathToUri(tmpFile);

    const weiduArgs = ["--no-exit-pause", "--noautoupdate", "--debug-assign", "--parse-check"];
    if (gamePath === "") {
        // d and baf need game files
        weiduArgs.unshift("--nogame");
    } else {
        weiduArgs.unshift("--game", gamePath);
    }

    const weiduType = valid_extensions.get(ext);
    if (!weiduType) {
        // vscode loses open file if clicked on console or elsewhere
        conlog("Not a WeiDU file (tp2, tph, tpa, tpp, d, baf)! Focus a WeiDU file to parse.");
        if (interactive) {
            showInfo("Focus a WeiDU file to parse!");
        }

        return;
    }

    if ((weiduType === "d" || weiduType === "baf") && gamePath === "") {
        conlog("Path to IE game is not specified in settings, can't parse D or BAF!");
        if (interactive) {
            showWarning(
                "Path to IE game is not specified in settings, can't parse D or BAF!"
            );
        }
        return;
    }

    // parse
    conlog(`parsing ${baseName}...`);

    // Cancel any in-flight compilation for this URI before starting a new one
    activeCompiles.get(uri)?.abort();
    const controller = new AbortController();
    activeCompiles.set(uri, controller);

    try {
        await fs.promises.writeFile(tmpFile, text);
        const allArgs = [...weiduPrefixArgs, ...weiduArgs, weiduType, tmpFile];
        const { err, stdout } = await runProcess(weiduPath, allArgs, cwdTo, controller.signal);

        // Skip stale results if this compile was cancelled by a newer one
        if (controller.signal.aborted) {
            return;
        }

        let parseResult = parseWeiduOutput(stdout);

        // Replace tmp file path with the original basename in diagnostic messages
        parseResult = {
            ...parseResult,
            errors: parseResult.errors.map((e) => ({ ...e, message: e.message.replaceAll(tmpFile, baseName) })),
            warnings: parseResult.warnings.map((w) => ({ ...w, message: w.message.replaceAll(tmpFile, baseName) })),
        };

        let showedSpecificError = false;
        if (err && parseResult.errors.length === 0) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
                showError(`WeiDU not found at '${weiduPath}'. Check bgforge.mls.weidu.path setting.`);
                showedSpecificError = true;
            }
            parseResult = addFallbackDiagnostic(parseResult, err, pathToUri(filePath), stdout.replaceAll(tmpFile, baseName));
        }

        // Skip generic message when we already showed a specific one (e.g. ENOENT)
        if (!showedSpecificError) {
            reportCompileResult(parseResult, interactive, `Successfully parsed ${baseName}.`, `Failed to parse ${baseName}!`);
        }

        // Always send diagnostics: clears stale errors on success, reports new ones on failure
        sendParseResult(parseResult, uri, tmpUri);
    } finally {
        activeCompiles.delete(uri);
        await removeTmpFile(tmpFile);
    }
}
