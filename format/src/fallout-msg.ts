/**
 * Formatter for Fallout .msg message files.
 *
 * The game reads a file as a run of brace groups - every byte from a `{` to the next `}` is one field, newlines
 * and all - and skips whatever lies between them. Three groups make an entry: {number}{audio}{text}. So:
 *   - number group: whitespace is trimmed inside the braces (the game takes no padded number)
 *   - audio and text groups: content is preserved verbatim, spaces and newlines included
 *   - text between the groups (notes, blank lines): trailing whitespace is trimmed and runs of blank lines
 *     collapse to one, but only where a line ends outside a group
 *
 * A group may start anywhere on a line, so an indented entry, or one after a note, is handled like any other.
 */

import { stripBom, type FormatOutput } from "./format-utils";

/** Every group is read as the engine reads it; the first of each three is a number. */
const GROUPS_PER_ENTRY = 3;

/**
 * Split the text into lines that end outside a brace group. A newline inside a group is part of that
 * group's text, so the line carries on past it.
 */
function splitLogicalLines(text: string): string[] {
    const lines: string[] = [];
    let current = "";
    let groupStart = -1;
    let groupIndex = 0;
    for (const char of text) {
        if (groupStart !== -1) {
            current += char;
            if (char === "}") {
                if (groupIndex % GROUPS_PER_ENTRY === 0) {
                    const number = current.slice(groupStart + 1, -1).trim();
                    current = `${current.slice(0, groupStart)}{${number}}`;
                }
                groupIndex++;
                groupStart = -1;
            }
        } else if (char === "{") {
            groupStart = current.length;
            current += char;
        } else if (char === "\n") {
            lines.push(current.trimEnd());
            current = "";
        } else {
            current += char;
        }
    }
    // A group still open at the end of the file is kept as written; anything else loses its trailing whitespace.
    if (groupStart !== -1) {
        lines.push(current);
    } else if (current !== "") {
        lines.push(current.trimEnd());
    }
    return lines;
}

/**
 * Formats a Fallout .msg message file.
 * Returns the original text unchanged if the file is empty or already formatted.
 */
export function formatMsg(rawText: string): FormatOutput {
    const text = stripBom(rawText);

    if (text.length === 0) {
        return { text: rawText };
    }

    const outputLines = splitLogicalLines(text);

    // Collapse consecutive blank lines into one.
    const collapsed = outputLines.filter((line, i) => !(line === "" && outputLines[i - 1] === ""));

    // Lines are re-joined with the file's own line ending (its first one), so a CRLF file stays CRLF.
    const firstNewline = text.indexOf("\n");
    const eol = firstNewline > 0 && text[firstNewline - 1] === "\r" ? "\r\n" : "\n";
    const formatted = collapsed.join(eol) + eol;

    // Identity check
    if (formatted === rawText) {
        return { text: rawText };
    }

    // Safety check: entry numbers must be identical and in the same order.
    const extractNumbers = (t: string): string[] => {
        const nums: string[] = [];
        // Match {digits} at the start of an entry (not inside another group)
        const re = /^\{(\s*\d+\s*)\}/gm;
        let m: RegExpExecArray | null;
        while ((m = re.exec(t)) !== null) {
            nums.push((m[1] ?? "").trim());
        }
        return nums;
    };
    const origNums = extractNumbers(text);
    const fmtNums = extractNumbers(formatted);
    if (origNums.join("\0") !== fmtNums.join("\0")) {
        return { text: rawText, warning: "MSG formatter: entry number mismatch after formatting, skipping" };
    }

    return { text: formatted };
}
