/**
 * Formatter for WeiDU translation (.tra) files.
 *
 * Normalizes whitespace in entry prefixes: ensures `@<number> = ` with no
 * space between `@` and the number, and exactly one space on each side of `=`.
 * Trims trailing whitespace from non-string content (comments, structural code).
 * Preserves all string content verbatim, including internal newlines.
 *
 * Strings may be:
 *   - Tilde-delimited: ~text~ or ~~~~~text~~~~~ (five tildes = multi-tilde mode)
 *   - Double-quoted: "text"
 *   - Percent-delimited: %text%
 *
 * Comments (`// ...` and `/* ... *\/`) are passed through with trailing
 * whitespace trimmed only.
 */

import {
    stripBom,
    scanNestedBlockComment,
    scanPercentString,
    scanTildeDelimiter,
    TRAILING_BLANKS,
    type FormatOutput,
} from "./format-utils";

/** Matches the entry prefix: @<optional_whitespace><number><optional_whitespace>=<optional_whitespace> */
const ENTRY_PREFIX_RE = /^(@)[ \t\r\n]*(-?\d+)[ \t\r\n]*=[ \t\r\n]*/;

/**
 * Scan forward from `pos` past a tilde-delimited string.
 * Returns the index immediately after the closing delimiter.
 * If the closing delimiter is not found, returns `text.length` so the rest of
 * the entry is preserved verbatim as string content.
 */
function scanTildeString(text: string, pos: number): number {
    const { delimLen, closerStart } = scanTildeDelimiter(text, pos);
    return closerStart === -1 ? text.length : closerStart + delimLen;
}

/**
 * Scan forward from `pos` past a double-quoted string.
 * A backslash is an ordinary character: the string ends at the next `"`.
 * Returns the index immediately after the closing `"`.
 */
function scanQuotedString(text: string, pos: number): number {
    const close = text.indexOf('"', pos + 1);
    // An unclosed string runs to the end of the text, so the rest of it is preserved verbatim.
    return close === -1 ? text.length : close + 1;
}

interface ProcessedLine {
    /** The formatted line text (without trailing newline). */
    readonly text: string;
    /** Position in the original text immediately after this line's newline (or end of text). */
    readonly nextPos: number;
}

/**
 * Scan the rest of an entry line after the `=` prefix, preserving string
 * content verbatim (including any internal newlines) and trimming trailing
 * whitespace only outside strings and at the very end of the entry.
 */
function scanEntryRest(text: string, pos: number): { rest: string; nextPos: number } {
    const parts: string[] = [];
    let lastFlush = pos;

    while (pos < text.length) {
        if (text[pos] === "/" && text[pos + 1] === "/") {
            // A line comment: delimiters inside it are text. It runs to the end of the line.
            const nlPos = text.indexOf("\n", pos);
            pos = nlPos === -1 ? text.length : nlPos;
        } else if (text[pos] === "/" && text[pos + 1] === "*") {
            pos = scanNestedBlockComment(text, pos);
        } else if (text[pos] === "~") {
            // Flush the code segment verbatim (spaces between strings must be kept)
            parts.push(text.slice(lastFlush, pos));
            const strEnd = scanTildeString(text, pos);
            parts.push(text.slice(pos, strEnd));
            pos = strEnd;
            lastFlush = pos;
        } else if (text[pos] === '"') {
            parts.push(text.slice(lastFlush, pos));
            const strEnd = scanQuotedString(text, pos);
            parts.push(text.slice(pos, strEnd));
            pos = strEnd;
            lastFlush = pos;
        } else if (text[pos] === "%") {
            parts.push(text.slice(lastFlush, pos));
            const strEnd = scanPercentString(text, pos);
            parts.push(text.slice(pos, strEnd));
            pos = strEnd;
            lastFlush = pos;
        } else if (text[pos] === "\n") {
            // End of entry (not inside a string - strings handle their own newlines)
            break;
        } else {
            pos++;
        }
    }

    // Flush trailing code segment, trimming trailing whitespace
    parts.push(text.slice(lastFlush, pos).replace(TRAILING_BLANKS, ""));

    const nextPos = pos < text.length && text[pos] === "\n" ? pos + 1 : pos;
    return { rest: parts.join(""), nextPos };
}

/**
 * Process one logical line starting at `pos` in `text`.
 * A "logical line" may span multiple physical lines when it contains a
 * multiline string. Returns the formatted line and the next position.
 */
function processLine(text: string, pos: number): ProcessedLine {
    // Blank line
    if (text[pos] === "\n" || pos >= text.length) {
        const nextPos = pos < text.length ? pos + 1 : pos;
        return { text: "", nextPos };
    }

    // Comment line (// or /*) - trim trailing whitespace only. A block comment runs over the lines it spans, which
    // stay as written: a blank line or an `@N =` inside it is comment text, not a blank line or an entry.
    if ((text[pos] === "/" && text[pos + 1] === "/") || (text[pos] === "/" && text[pos + 1] === "*")) {
        const commentEnd = text[pos + 1] === "*" ? scanNestedBlockComment(text, pos) : pos;
        const nlPos = text.indexOf("\n", commentEnd);
        const end = nlPos === -1 ? text.length : nlPos;
        let line = text
            .slice(pos, end)
            .split("\n")
            .map((physical) => physical.replace(TRAILING_BLANKS, ""))
            .join("\n");
        // A comment that never closes runs to the end of the text, final line break included; the caller ends the
        // output with one, so keeping it here would add a blank line on every pass.
        if (nlPos === -1) line = line.replace(TRAILING_BLANKS, "");
        return { text: line, nextPos: end + (nlPos === -1 ? 0 : 1) };
    }

    // Entry line: starts with `@`
    if (text[pos] === "@") {
        // Peek at the current physical line for prefix matching
        const nlPos = text.indexOf("\n", pos);
        const lineEnd = nlPos === -1 ? text.length : nlPos;
        const lineText = text.slice(pos, lineEnd);
        const prefixMatch = ENTRY_PREFIX_RE.exec(lineText);
        if (prefixMatch) {
            const num = prefixMatch[2] ?? "";
            const normalizedPrefix = `@${num} = `;
            const afterPrefix = pos + prefixMatch[0].length;
            const { rest, nextPos } = scanEntryRest(text, afterPrefix);
            return { text: (normalizedPrefix + rest).replace(TRAILING_BLANKS, ""), nextPos };
        }
    }

    // Unknown / unrecognized line - pass through trimming trailing whitespace
    const nlPos = text.indexOf("\n", pos);
    const end = nlPos === -1 ? text.length : nlPos;
    const line = text.slice(pos, end).replace(TRAILING_BLANKS, "");
    return { text: line, nextPos: end + (nlPos === -1 ? 0 : 1) };
}

/**
 * Formats a WeiDU .tra translation file.
 * Returns the original text unchanged if the file is empty or already formatted.
 */
export function formatTra(rawText: string): FormatOutput {
    const text = stripBom(rawText);

    if (text.length === 0) {
        return { text: rawText };
    }

    const outputLines: string[] = [];

    let pos = 0;
    while (pos < text.length) {
        const { text: line, nextPos } = processLine(text, pos);
        outputLines.push(line);
        pos = nextPos;
    }

    // Collapse consecutive blank lines into one.
    const collapsed = outputLines.filter((line, i) => !(line === "" && outputLines[i - 1] === ""));

    const formatted = collapsed.join("\n") + "\n";

    // Identity check: if nothing changed, return no-op.
    if (formatted === rawText) {
        return { text: rawText };
    }

    // Safety check: entry numbers must be identical and in the same order.
    const extractNumbers = (t: string): string[] => {
        const nums: string[] = [];
        const re = /^@[ \t\r\n]*(-?\d+)[ \t\r\n]*=/gm;
        let m: RegExpExecArray | null;
        while ((m = re.exec(t)) !== null) {
            nums.push(m[1] ?? "");
        }
        return nums;
    };
    const origNums = extractNumbers(text);
    const fmtNums = extractNumbers(formatted);
    if (origNums.join("\0") !== fmtNums.join("\0")) {
        return { text: rawText, warning: "TRA formatter: entry number mismatch after formatting, skipping" };
    }

    return { text: formatted };
}
