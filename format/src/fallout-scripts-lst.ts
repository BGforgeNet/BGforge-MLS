/**
 * Formatter for Fallout scripts.lst files.
 *
 * Each entry has the form:
 *   filename.int    ; Comment text                                   # local_vars=N
 *
 * Columns are separated by spaces and aligned to uniform widths with at least
 * MIN_GAP spaces between them. Trailing whitespace is trimmed from every line.
 * Lines that do not match the expected pattern are preserved verbatim.
 * Output always uses CRLF line endings, matching the Fallout engine's convention.
 */

import { stripBom, type FormatOutput } from "./format-utils";

const MIN_GAP = 4;

/** The filename (including .int) that opens a scripts.lst data line: the whole first run of non-blanks. */
const FILENAME_RE = /^(\S+\.int)(?!\S)/i;

/**
 * Splits what follows the filename into the comment column (starting with `;`) and the metadata column (starting
 * with `#`), each optional; null when the text is neither. The comment runs up to the first `#`, so the blanks
 * before that `#` belong to both columns; one regex for the pair retries them quadratically, hence the split here.
 */
function splitColumns(rest: string): { comment: string; metadata: string } | null {
    if (rest === "") return { comment: "", metadata: "" };

    const hash = rest.indexOf("#");
    const before = hash === -1 ? rest : rest.slice(0, hash);
    const metadata = hash === -1 ? "" : rest.slice(hash);

    const hasComment = /^[ \t]+;/.test(before);
    if (hasComment) {
        if (hash === -1) return { comment: rest, metadata: "" };
        if (!before.endsWith(" ") && !before.endsWith("\t")) return null;
    } else if (hash === -1 || !/^[ \t]+$/.test(before)) {
        return null;
    }
    // The metadata column ends the line, and `.` of the original pattern stops at a line terminator.
    if (/[\n\r\u2028\u2029]/.test(metadata)) return null;

    return { comment: hasComment ? before : "", metadata };
}

interface ParsedLine {
    readonly filename: string;
    /** Normalized comment: "; text" with trimmed text, or empty string if absent. */
    readonly comment: string;
    /** Normalized metadata: "# local_vars=N" with trimmed text, or empty string if absent. */
    readonly metadata: string;
}

function parseLine(line: string): ParsedLine | null {
    const filename = FILENAME_RE.exec(line)?.[1];
    if (filename === undefined) return null;
    const columns = splitColumns(line.slice(filename.length));
    if (columns === null) return null;

    // Trim the columns to remove leading/trailing whitespace from the column content
    const rawComment = columns.comment.trim();
    const rawMetadata = columns.metadata.trim();

    // Normalize internal whitespace: "; text" should have a single space after ;
    const comment = rawComment.length > 0 ? "; " + rawComment.slice(1).trimStart() : "";

    const metadata = rawMetadata.length > 0 ? "# " + rawMetadata.slice(1).trimStart() : "";

    return { filename, comment, metadata };
}

/**
 * Formats a Fallout scripts.lst file.
 * Returns the original text unchanged if the file is already formatted.
 */
export function formatScriptsLst(rawText: string): FormatOutput {
    // Normalize CRLF to LF before processing; $ in the LINE_RE does not match before \r.
    const text = stripBom(rawText).replaceAll("\r\n", "\n").replaceAll("\r", "\n");

    if (text.length === 0) {
        return { text: rawText };
    }

    const rawLines = text.split("\n");

    // Remove a trailing empty string caused by a final newline
    const lines = rawLines[rawLines.length - 1] === "" ? rawLines.slice(0, -1) : rawLines;

    // Parse lines; track which can be formatted and collect column widths
    const parsed: Array<ParsedLine | null> = lines.map((line) => parseLine(line));

    let maxFilenameWidth = 0;
    let maxCommentWidth = 0;

    for (const entry of parsed) {
        if (entry === null) continue;
        if (entry.filename.length > maxFilenameWidth) maxFilenameWidth = entry.filename.length;
        if (entry.comment.length > maxCommentWidth) maxCommentWidth = entry.comment.length;
    }

    const outputLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const entry = parsed[i] ?? null;
        const raw = lines[i] ?? "";

        if (entry === null) {
            // Non-data line: trim trailing whitespace only
            outputLines.push(raw.trimEnd());
            continue;
        }

        if (entry.comment === "" && entry.metadata === "") {
            // Filename-only line: just trim trailing whitespace
            outputLines.push(entry.filename);
            continue;
        }

        let out = entry.filename.padEnd(maxFilenameWidth + MIN_GAP);

        if (entry.metadata !== "") {
            // Both comment and metadata columns present
            out += entry.comment.padEnd(maxCommentWidth + MIN_GAP);
            out += entry.metadata;
        } else {
            // Comment only - no metadata to align
            out += entry.comment;
        }

        outputLines.push(out.trimEnd());
    }

    // Always output CRLF - Fallout engine convention for scripts.lst.
    const formatted = outputLines.join("\r\n") + "\r\n";

    if (formatted === rawText) {
        return { text: rawText };
    }

    // Safety check: all non-whitespace tokens must be identical and in the same order.
    const tokenize = (t: string): string[] => t.split(/\s+/).filter((s) => s.length > 0);
    const origTokens = tokenize(text);
    const fmtTokens = tokenize(formatted);
    if (origTokens.join("\0") !== fmtTokens.join("\0")) {
        return { text: rawText, warning: "scripts.lst formatter: token mismatch after formatting, skipping" };
    }

    return { text: formatted };
}
