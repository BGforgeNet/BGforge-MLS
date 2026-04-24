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

import type { FormatResult } from "../core/capabilities";
import { createFullDocumentEdit, stripBom } from "../shared/format-utils";

const MIN_GAP = 4;

/**
 * Matches a scripts.lst data line.
 * Groups: 1=filename (including .int), 2=comment (starting with ; ), 3=metadata (starting with #)
 * Comment and metadata are optional.
 */
const LINE_RE = /^(\S+\.int)([ \t]+;[^#]*)?([ \t]+#.*)?$/i;

interface ParsedLine {
    readonly filename: string;
    /** Normalized comment: "; text" with trimmed text, or empty string if absent. */
    readonly comment: string;
    /** Normalized metadata: "# local_vars=N" with trimmed text, or empty string if absent. */
    readonly metadata: string;
}

function parseLine(line: string): ParsedLine | null {
    const match = LINE_RE.exec(line);
    if (!match) return null;

    const filename = match[1] ?? "";

    // Trim the captured groups to remove leading/trailing whitespace from the column content
    const rawComment = match[2]?.trim() ?? "";
    const rawMetadata = match[3]?.trim() ?? "";

    // Normalize internal whitespace: "; text" should have a single space after ;
    const comment = rawComment.length > 0 ? "; " + rawComment.slice(1).trimStart() : "";

    const metadata = rawMetadata.length > 0 ? "# " + rawMetadata.slice(1).trimStart() : "";

    return { filename, comment, metadata };
}

/**
 * Formats a Fallout scripts.lst file.
 * Returns an empty edits array if the file is already formatted.
 */
export function formatScriptsLst(rawText: string): FormatResult {
    // Normalize CRLF to LF before processing; $ in the LINE_RE does not match before \r.
    const text = stripBom(rawText).replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    if (text.length === 0) {
        return { edits: [] };
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
            // Comment only — no metadata to align
            out += entry.comment;
        }

        outputLines.push(out.trimEnd());
    }

    // Always output CRLF — Fallout engine convention for scripts.lst.
    const formatted = outputLines.join("\r\n") + "\r\n";

    if (formatted === rawText) {
        return { edits: [] };
    }

    // Safety check: all non-whitespace tokens must be identical and in the same order.
    const tokenize = (t: string): string[] => t.split(/\s+/).filter((s) => s.length > 0);
    const origTokens = tokenize(text);
    const fmtTokens = tokenize(formatted);
    if (origTokens.join("\0") !== fmtTokens.join("\0")) {
        return { edits: [], warning: "scripts.lst formatter: token mismatch after formatting, skipping" };
    }

    return { edits: createFullDocumentEdit(rawText, formatted) };
}
