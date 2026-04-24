#!/usr/bin/env node
/**
 * CLI tool to format Fallout SSL, WeiDU BAF, WeiDU D, WeiDU TP2, WeiDU TRA,
 * Fallout MSG, Infinity Engine 2DA, and Fallout scripts.lst files.
 * Usage: node format-cli.js <file|dir> [--save] [-r] [-q] [--check]
 * Supported extensions: .ssl, .baf, .d, .tp2 (/.tph/.tpa/.tpp), .tra, .msg, .2da, scripts.lst
 */

import * as fs from "fs";
import * as path from "path";
import { formatDocument as formatSslDocument } from "../../../server/src/fallout-ssl/format/core";
import { initParser as initSslParser, getParser as getSslParser } from "../../../server/src/fallout-ssl/parser";
import { formatDocument as formatBafDocument } from "../../../server/src/weidu-baf/format/core";
import { initParser as initBafParser, getParser as getBafParser } from "../../../server/src/weidu-baf/parser";
import { formatDocument as formatDDocument } from "../../../server/src/weidu-d/format/core";
import { initParser as initDParser, getParser as getDParser } from "../../../server/src/weidu-d/parser";
import { formatDocument as formatTp2Document } from "../../../server/src/weidu-tp2/format/core";
import { initParser as initTp2Parser, getParser as getTp2Parser } from "../../../server/src/weidu-tp2/parser";
import { formatTra } from "../../../server/src/weidu-tra/format";
import { formatMsg } from "../../../server/src/fallout-msg/format";
import { format2da } from "../../../server/src/infinity-2da/format";
import { formatScriptsLst } from "../../../server/src/fallout-scripts-lst/format";
import { getEditorconfigSettings } from "../../../server/src/shared/editorconfig";
import {
    validateFormatting,
    stripCommentsWeidu,
    stripCommentsFalloutSsl,
    stripCommentsTra,
    stripCommentsFalloutMsg,
    stripComments2da,
    stripCommentsFalloutScriptsLst,
} from "../../../server/src/shared/format-utils";
import {
    EXT_FALLOUT_SSL,
    EXT_WEIDU_BAF,
    EXT_WEIDU_D,
    EXT_WEIDU_TP2,
    EXT_WEIDU_TRA,
    EXT_FALLOUT_MSG,
    EXT_INFINITY_2DA,
    FILENAME_FALLOUT_SCRIPTS_LST,
} from "../../../server/src/core/languages";
import { type FileResult, type OutputMode, parseCliArgs, runCli, safeProcess, reportDiff } from "../../cli-utils";

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
 * Extract the formatted text from a FormatResult returned by tra/msg/2da formatters.
 * These formatters return `{ edits: TextEdit[]; warning?: string }` rather than `{ text }`.
 * A warning means the formatter detected a safety-check failure and declined to format.
 */
function extractFormatResultText(original: string, result: { edits: { newText: string }[]; warning?: string }): string {
    if (result.warning) {
        throw new Error(result.warning);
    }
    if (result.edits.length === 0) {
        return original;
    }
    if (result.edits.length === 1 && result.edits[0] !== undefined) {
        return result.edits[0].newText;
    }
    throw new Error("Unexpected edit count from formatter");
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
        // Pure string processing — no parser init required
        return { text: extractFormatResultText(text, formatTra(text)) };
    } else if (fileType === "msg") {
        // Pure string processing — no parser init required
        return { text: extractFormatResultText(text, formatMsg(text)) };
    } else if (fileType === "scripts-lst") {
        // Pure string processing — no parser init required
        return { text: extractFormatResultText(text, formatScriptsLst(text)) };
    } else {
        // 2da — pure string processing, no parser init required
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

        const text = fs.readFileSync(filePath, "utf-8");
        const opts = getFormatOptions(path.resolve(filePath));

        let result: FormatResult;
        try {
            result = parseAndFormat(text, fileType, opts);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`Error: ${filePath}: ${msg}`);
            return "error";
        }

        let stripComments;
        switch (fileType) {
            case "ssl":
                stripComments = stripCommentsFalloutSsl;
                break;
            case "tra":
                stripComments = stripCommentsTra;
                break;
            case "msg":
                stripComments = stripCommentsFalloutMsg;
                break;
            case "2da":
                stripComments = stripComments2da;
                break;
            case "scripts-lst":
                stripComments = stripCommentsFalloutScriptsLst;
                break;
            default:
                stripComments = stripCommentsWeidu;
                break;
        }
        const validationError = validateFormatting(text, result.text, stripComments);
        if (validationError) {
            console.error(`${filePath}: Formatter bug: ${validationError}`);
            return "error";
        }

        const changed = result.text !== text;
        if (mode === "save") {
            if (changed) {
                fs.writeFileSync(filePath, result.text);
                console.log(`Formatted: ${filePath}`);
            }
        } else if (mode === "save-and-check") {
            if (changed) {
                fs.writeFileSync(filePath, result.text);
                console.log(`Formatted: ${filePath}`);
            }
            // Idempotency check: re-format the result and verify it's stable
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
        } else if (changed) {
            reportDiff(filePath, text, result.text);
            return "changed";
        }
        return changed ? "changed" : "unchanged";
    });
}

const HELP = `Usage: format-cli <file|dir> [--save] [--check] [--save-and-check] [-r] [-q]
  Supported: .ssl, .baf, .d, .tp2 (/.tph/.tpa/.tpp), .tra, .msg, .2da, scripts.lst
  --save            Write formatted output back to file(s)
  --check           Check if files are formatted (exit 1 if not)
  --save-and-check  Save formatted output and verify idempotency in one pass
  -r                Recursively format all supported files in directory
  -q                Quiet mode: suppress summary, only print changed files
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
            // tra/msg/2da are pure string formatters — no parser init required
            if (isDir || fileType === "ssl") await initSslParser();
            if (isDir || fileType === "baf") await initBafParser();
            if (isDir || fileType === "d") await initDParser();
            if (isDir || fileType === "tp2") await initTp2Parser();
        },
        processFile,
    });
}

main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
});
