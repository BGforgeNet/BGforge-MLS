/**
 * Formatter for Fallout .msg message files.
 *
 * Each entry has the form: {number}{audio}{text}
 *   - number field: whitespace is trimmed inside the braces
 *   - audio field: whitespace is trimmed inside the braces
 *   - text field: content is preserved verbatim (including internal spaces/newlines)
 *
 * Lines that do not start with `{` are comment lines — trailing whitespace is
 * trimmed but the content is otherwise unchanged. Blank lines are preserved.
 *
 * Multiline text fields (closing `}` on a later line) are supported.
 */

import { stripBom, type FormatOutput } from "@bgforge/format";

interface ParsedEntry {
    /** Trimmed number string (e.g. "100"). */
    readonly number: string;
    /** Trimmed audio string (may be empty). */
    readonly audio: string;
    /** Text content verbatim (may be multiline). */
    readonly text: string;
    /** Position in original text immediately after the closing `}` of the text group. */
    readonly nextPos: number;
}

/**
 * Parse one .msg entry starting at `pos` (which must point at the first `{`).
 * Returns null if the text at pos does not look like a valid entry.
 */
function parseEntry(text: string, pos: number): ParsedEntry | null {
    if (text[pos] !== "{") return null;

    let cur = pos + 1; // skip opening {

    // --- Group 1: number ---
    const numStart = cur;
    while (cur < text.length && text[cur] !== "}") cur++;
    if (cur >= text.length) return null; // unclosed
    const number = text.slice(numStart, cur).trim();
    cur++; // skip }

    // --- Group 2: audio ---
    if (cur >= text.length || text[cur] !== "{") return null;
    cur++; // skip opening {
    const audioStart = cur;
    while (cur < text.length && text[cur] !== "}") cur++;
    if (cur >= text.length) return null;
    const audio = text.slice(audioStart, cur).trim();
    cur++; // skip }

    // --- Group 3: text (verbatim, may be multiline) ---
    if (cur >= text.length || text[cur] !== "{") return null;
    cur++; // skip opening {
    const textStart = cur;
    while (cur < text.length && text[cur] !== "}") cur++;
    if (cur >= text.length) return null;
    const textContent = text.slice(textStart, cur);
    cur++; // skip }

    return { number, audio, text: textContent, nextPos: cur };
}

interface ProcessedLine {
    /** The formatted content (may include internal newlines for multiline entries). */
    readonly text: string;
    /** Position in original text immediately after this item. */
    readonly nextPos: number;
}

/**
 * Process one logical item starting at `pos`.
 * An item is either a blank line, a comment line, or an entry (possibly multiline).
 */
function processItem(text: string, pos: number): ProcessedLine {
    // Blank line
    if (text[pos] === "\n") {
        return { text: "", nextPos: pos + 1 };
    }

    // Entry line: starts with `{`
    if (text[pos] === "{") {
        const entry = parseEntry(text, pos);
        if (entry !== null) {
            const formatted = `{${entry.number}}{${entry.audio}}{${entry.text}}`;
            // Advance past any trailing content on the same line up to newline
            let cur = entry.nextPos;
            while (cur < text.length && text[cur] !== "\n") cur++;
            const nextPos = cur < text.length ? cur + 1 : cur;
            return { text: formatted, nextPos };
        }
    }

    // Comment or unrecognized line — trim trailing whitespace
    const nlPos = text.indexOf("\n", pos);
    const end = nlPos === -1 ? text.length : nlPos;
    const line = text.slice(pos, end).trimEnd();
    return { text: line, nextPos: end + (nlPos === -1 ? 0 : 1) };
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

    const outputLines: string[] = [];

    let pos = 0;
    while (pos < text.length) {
        const { text: item, nextPos } = processItem(text, pos);
        outputLines.push(item);
        pos = nextPos;
    }

    // Collapse consecutive blank lines into one.
    const collapsed = outputLines.filter((line, i) => !(line === "" && outputLines[i - 1] === ""));

    const formatted = collapsed.join("\n") + "\n";

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
