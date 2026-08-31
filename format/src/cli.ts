#!/usr/bin/env node
/**
 * CLI tool to format Fallout SSL, WeiDU BAF, WeiDU D, WeiDU TP2, WeiDU TRA,
 * Fallout MSG, Infinity Engine 2DA, and Fallout scripts.lst files.
 * Usage: fgfmt <file|dir> [--save] [-r] [-q] [--check]
 * Supported extensions: .ssl, .baf, .d, .tp2 (/.tph/.tpa/.tpp), .tra, .msg, .2da, scripts.lst
 */

import * as fs from "fs";
import * as path from "path";
import {
    formatFalloutSsl as formatSslDocument,
    formatWeiduBaf as formatBafDocument,
    formatWeiduD as formatDDocument,
    formatWeiduTp2 as formatTp2Document,
    formatTra,
    formatMsg,
    format2da,
    formatScriptsLst,
    getEditorconfigSettings,
    validateFormatting,
    stripCommentsWeidu,
    stripCommentsForCompareFalloutSsl,
    stripCommentsTra,
    stripCommentsFalloutMsg,
    stripComments2da,
    stripCommentsFalloutScriptsLst,
} from "./index";
import { initParser as initSslParser, getParser as getSslParser } from "../../shared/parsers/fallout-ssl";
import { initParser as initBafParser, getParser as getBafParser } from "../../shared/parsers/weidu-baf";
import { initParser as initDParser, getParser as getDParser } from "../../shared/parsers/weidu-d";
import { initParser as initTp2Parser, getParser as getTp2Parser } from "../../shared/parsers/weidu-tp2";
import {
    EXT_FALLOUT_SSL,
    EXT_WEIDU_BAF,
    EXT_WEIDU_D,
    EXT_WEIDU_TP2,
    EXT_WEIDU_TRA,
    EXT_FALLOUT_MSG,
    EXT_INFINITY_2DA,
    FILENAME_FALLOUT_SCRIPTS_LST,
} from "../../shared/languages";
import {
    type FileResult,
    type OutputMode,
    checkFileSize,
    parseCliArgs,
    runCli,
    safeProcess,
    reportDiff,
} from "../../shared/cli/cli-utils";

// Per-extension input-size cap. Real-world source files stay well below
// these (the largest checked-in TP2s in the WeiDU corpus are ~100 KB; SSL
// scripts are sub-50 KB; .2da tables and .tra/.msg translation banks
// occasionally cross 1 MB). The cap is a defense against an oversized or
// truncated input triggering a multi-GB Buffer allocation before the
// parser sees it, not a usability limit. Mirrors fgbin's MAX_FILE_SIZES.
const MAX_FILE_SIZES: Record<string, number> = {
    ssl: 8 * 1024 * 1024,
    baf: 8 * 1024 * 1024,
    d: 16 * 1024 * 1024,
    tp2: 8 * 1024 * 1024,
    tph: 8 * 1024 * 1024,
    tpa: 8 * 1024 * 1024,
    tpp: 8 * 1024 * 1024,
    tra: 16 * 1024 * 1024,
    msg: 16 * 1024 * 1024,
    "2da": 16 * 1024 * 1024,
    lst: 4 * 1024 * 1024,
};

const DEFAULT_INDENT = 4;
const EXTENSIONS = [
    EXT_FALLOUT_SSL,
    EXT_WEIDU_BAF,
    EXT_WEIDU_D,
    ...EXT_WEIDU_TP2,
    EXT_WEIDU_TRA,
    EXT_FALLOUT_MSG,
    EXT_INFINITY_2DA,
    // Matched by exact filename; endsWith("scripts.lst") is safe in practice
    FILENAME_FALLOUT_SCRIPTS_LST,
];

type FileType = "ssl" | "baf" | "d" | "tp2" | "tra" | "msg" | "2da" | "scripts-lst";

function getFileType(filePath: string): FileType | null {
    // Check exact filename before extension to avoid false-positives on .lst
    if (path.basename(filePath).toLowerCase() === FILENAME_FALLOUT_SCRIPTS_LST) return "scripts-lst";
    const ext = path.extname(filePath).toLowerCase();
    if (ext === EXT_FALLOUT_SSL) return "ssl";
    if (ext === EXT_WEIDU_BAF) return "baf";
    if (ext === EXT_WEIDU_D) return "d";
    if ((EXT_WEIDU_TP2 as readonly string[]).includes(ext)) return "tp2";
    if (ext === EXT_WEIDU_TRA) return "tra";
    if (ext === EXT_FALLOUT_MSG) return "msg";
    if (ext === EXT_INFINITY_2DA) return "2da";
    return null;
}

function getFormatOptions(filePath: string): { indentSize: number; lineLimit: number } {
    const config = getEditorconfigSettings(filePath);
    return {
        indentSize: config.indentSize ?? DEFAULT_INDENT,
        lineLimit: config.maxLineLength ?? 120,
    };
}

type FormatResult = { text: string };

/**
 * Extract the formatted text from a FormatOutput returned by the pure-string formatters.
 * A warning means the formatter detected a safety-check failure and declined to format.
 */
function extractFormatResultText(_original: string, result: { text: string; warning?: string }): string {
    if (result.warning) {
        throw new Error(result.warning);
    }
    return result.text;
}

function parseAndFormat(
    text: string,
    fileType: FileType,
    opts: { indentSize: number; lineLimit: number },
): FormatResult {
    if (fileType === "ssl") {
        const tree = getSslParser().parse(text);
        if (!tree) throw new Error("Failed to parse");
        return formatSslDocument(tree.rootNode, {
            indentSize: opts.indentSize,
            lineLimit: opts.lineLimit,
        });
    } else if (fileType === "baf") {
        const tree = getBafParser().parse(text);
        if (!tree) throw new Error("Failed to parse");
        return formatBafDocument(tree.rootNode, { indentSize: opts.indentSize });
    } else if (fileType === "d") {
        const tree = getDParser().parse(text);
        if (!tree) throw new Error("Failed to parse");
        return formatDDocument(tree.rootNode, {
            indentSize: opts.indentSize,
            lineLimit: opts.lineLimit,
        });
    } else if (fileType === "tp2") {
        const tree = getTp2Parser().parse(text);
        if (!tree) throw new Error("Failed to parse");
        return formatTp2Document(tree.rootNode, {
            indentSize: opts.indentSize,
            lineLimit: opts.lineLimit,
        });
    } else if (fileType === "tra") {
        // Pure string processing - no parser init required
        return { text: extractFormatResultText(text, formatTra(text)) };
    } else if (fileType === "msg") {
        // Pure string processing - no parser init required
        return { text: extractFormatResultText(text, formatMsg(text)) };
    } else if (fileType === "scripts-lst") {
        // Pure string processing - no parser init required
        return { text: extractFormatResultText(text, formatScriptsLst(text)) };
    } else {
        // 2da - pure string processing, no parser init required
        return { text: extractFormatResultText(text, format2da(text)) };
    }
}

async function processFile(filePath: string, mode: OutputMode): Promise<FileResult> {
    return safeProcess(filePath, () => {
        const fileType = getFileType(filePath);
        if (!fileType) {
            console.error(`Error: Unsupported file type: ${filePath}`);
            return "error";
        }

        if (!checkFileSize(filePath, MAX_FILE_SIZES)) return "error";

        const text = fs.readFileSync(filePath, "utf-8");
        const opts = getFormatOptions(path.resolve(filePath));

        let result: FormatResult;
        try {
            result = parseAndFormat(text, fileType, opts);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(`Error: ${filePath}: ${msg}`);
            return "error";
        }

        let normalizeForCompare;
        switch (fileType) {
            case "ssl":
                normalizeForCompare = stripCommentsForCompareFalloutSsl;
                break;
            case "tra":
                normalizeForCompare = stripCommentsTra;
                break;
            case "msg":
                normalizeForCompare = stripCommentsFalloutMsg;
                break;
            case "2da":
                normalizeForCompare = stripComments2da;
                break;
            case "scripts-lst":
                normalizeForCompare = stripCommentsFalloutScriptsLst;
                break;
            default:
                normalizeForCompare = stripCommentsWeidu;
                break;
        }
        const validationError = validateFormatting(text, result.text, normalizeForCompare);
        if (validationError) {
            // The formatter is only allowed to move whitespace, so a content change is our defect, not
            // the file's. Say the file was left alone: that is the part the reader needs.
            console.error(`${filePath}: left unchanged - formatter bug: ${validationError}`);
            return "error";
        }

        const changed = result.text !== text;
        if (mode === "save" || mode === "save-and-check") {
            if (changed) {
                fs.writeFileSync(filePath, result.text);
                console.log(`Formatted: ${filePath}`);
            }
        }
        // Idempotency check: re-format the result and verify it's stable. It re-formats the in-memory
        // output rather than reading the file back, which is what lets check-idempotency reach the same
        // verdict without writing - the corpus sweep wants the verdict, not the formatted tree, and not
        // writing keeps it from racing the suites that read the same corpus.
        if (mode === "save-and-check" || mode === "check-idempotency") {
            let reResult: FormatResult;
            try {
                reResult = parseAndFormat(result.text, fileType, opts);
            } catch {
                console.error(`Error: Failed to re-parse ${filePath}`);
                return "error";
            }
            if (reResult.text !== result.text) {
                reportDiff(filePath, result.text, reResult.text);
                console.error(`${filePath}: Formatter not idempotent`);
                return "error";
            }
        } else if (mode === "stdout") {
            process.stdout.write(result.text);
        } else if (mode === "check" && changed) {
            reportDiff(filePath, text, result.text);
            return "changed";
        }
        return changed ? "changed" : "unchanged";
    });
}

const HELP = `Usage: fgfmt <file|dir> [--save] [--check] [--save-and-check] [-r] [-q] [--jobs <n>]
  Supported: .ssl, .baf, .d, .tp2 (/.tph/.tpa/.tpp), .tra, .msg, .2da, scripts.lst
  --save               Write formatted output back to file(s)
  --check              Check if files are formatted (exit 1 if not)
  --save-and-check     Save formatted output and verify idempotency in one pass
  --check-idempotency  Verify idempotency without writing anything
  -r                   Recursively format all supported files in directory
  -q                   Quiet mode: suppress summary, only print changed files
  --jobs <n>           Process directory files with N parallel workers
  --exclude-from <p>   Skip the files listed in <p> (# comments and blanks ignored)
  --exclude-base <d>   Resolve --exclude-from entries against <d> (default: the target)
  Without --save or --check: single file prints to stdout, directory shows what would change`;

async function main() {
    const args = parseCliArgs(HELP);
    if (!args) return;

    const stat = fs.statSync(args.target);
    const isDir = stat.isDirectory();
    const fileType = isDir ? null : getFileType(args.target);

    await runCli({
        args,
        extensions: EXTENSIONS,
        description: ".ssl, .baf, .d, .tp2, .tra, .msg, .2da, and scripts.lst",
        async init() {
            // tra/msg/2da are pure string formatters - no parser init required
            if (isDir || fileType === "ssl") await initSslParser();
            if (isDir || fileType === "baf") await initBafParser();
            if (isDir || fileType === "d") await initDParser();
            if (isDir || fileType === "tp2") await initTp2Parser();
        },
        processFile,
    });
}

main().catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
});
