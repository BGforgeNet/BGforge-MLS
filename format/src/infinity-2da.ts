/**
 * Formatter for Infinity Engine 2DA table files.
 *
 * Aligns all columns to uniform widths, with at least 4 spaces between each column.
 * Trims trailing spaces and tabs from every line.
 *
 * The column-names row (which starts with whitespace) is treated as having an empty
 * first column: it is indented by (max_row_label_width + MIN_GAP) spaces so the column
 * names align with the corresponding data values beneath them. A data row that starts
 * with whitespace keeps an empty row label, as GemRB reads it.
 *
 * The signature ("2DA V1.0") and default-value lines are preserved exactly, only
 * trimming trailing whitespace.
 *
 * Apart from the trimmed trailing whitespace, GemRB and WeiDU read the output as they read
 * the input: cells split on spaces and tabs only, lines up to GemRB's column-names line keep
 * their positions, and a row's text past GemRB's last column is kept as written.
 */

import { stripBom, TRAILING_BLANKS, type FormatOutput } from "./format-utils";

const MIN_GAP = 4;
// GemRB and WeiDU split cells on spaces and tabs only, and end a line at `\r\n`, `\r` or `\n`.
const CELL_RE = /[^ \t]+/g;
const LINE_BREAK_RE = /\r\n|\r|\n/;
// An encrypted 2DA starts with two 0xFF bytes: Latin-1 reads them as U+00FF, UTF-8 as two replacement characters.
const ENCRYPTED_LEADS = [String.fromCodePoint(0xff, 0xff), String.fromCodePoint(0xfffd, 0xfffd)];

interface Cell {
    readonly text: string;
    readonly start: number;
}

function cellsOf(line: string): Cell[] {
    return Array.from(line.matchAll(CELL_RE), (match) => ({ text: match[0], start: match.index }));
}

function trimBlankEnd(line: string): string {
    return line.replace(TRAILING_BLANKS, "");
}

function isIndented(line: string): boolean {
    return line[0] === " " || line[0] === "\t";
}

function splitLines(text: string): string[] {
    const lines = text.split(LINE_BREAK_RE).map((line) => trimBlankEnd(line));
    // A final line break ends the last line; it does not start an empty one.
    if (lines.at(-1) === "") lines.pop();
    return lines;
}

/**
 * GemRB reads the third line, past any `#` lines, as the column names, and every line up to it by position.
 * It splits a row into at most as many cells as there are columns (two for one column, any number for none);
 * the last cell takes the rest of the line, inner spacing included.
 */
function gemrbLayout(lines: readonly string[]): { readonly namesLine: number; readonly cellLimit: number } {
    let namesLine = 2;
    while (namesLine < lines.length && (lines[namesLine] ?? "").startsWith("#")) namesLine++;
    const columns = cellsOf(lines[namesLine] ?? "").length;
    return { namesLine, cellLimit: columns === 0 ? Infinity : Math.max(2, columns) };
}

interface DataRow {
    readonly label: string;
    readonly values: readonly string[];
    /** The row's text from GemRB's last cell on, kept as written; null when the row fits the columns. */
    readonly rest: string | null;
}

function parseRow(line: string, cellLimit: number): DataRow {
    const cells = cellsOf(line);
    const label = isIndented(line) ? "" : (cells.shift()?.text ?? "");
    const last = cells[cellLimit - 1];
    if (cells.length <= cellLimit || last === undefined) {
        return { label, values: cells.map((cell) => cell.text), rest: null };
    }
    return { label, values: cells.slice(0, cellLimit - 1).map((cell) => cell.text), rest: line.slice(last.start) };
}

interface Parsed {
    readonly signature: string | null;
    readonly defaultValue: string | null;
    /** Blank lines above the column-names row that GemRB reads by position. */
    readonly blanksBeforeColumns: number;
    readonly columnNames: readonly string[];
    /** Data rows in order; null is a blank line GemRB reads by position. */
    readonly body: readonly (DataRow | null)[];
}

function parse(text: string): Parsed {
    const lines = splitLines(text);
    const { namesLine, cellLimit } = gemrbLayout(lines);

    let cursor = 0;
    let signature: string | null = null;
    let defaultValue: string | null = null;

    // Detect optional "2DA V..." signature on line 0
    const firstLine = lines[0] ?? "";
    if (/^2DA[ \t]/i.test(firstLine)) {
        // Normalize to single space between tokens (e.g. "2DA    V1.0" -> "2DA V1.0").
        signature = cellsOf(firstLine)
            .map((cell) => cell.text)
            .join(" ");
        cursor++;
        // The line immediately after the signature is the default value
        if (cursor < lines.length) {
            defaultValue = lines[cursor] ?? null;
            cursor++;
        }
    }

    // Column-names row: first line starting with whitespace after any header lines
    let blanksBeforeColumns = 0;
    let columnNames: readonly string[] = [];
    while (cursor < lines.length) {
        const line = lines[cursor] ?? "";
        if (line.length === 0) {
            if (cursor <= namesLine) blanksBeforeColumns++;
            cursor++;
            continue;
        }
        if (isIndented(line)) {
            columnNames = cellsOf(line).map((cell) => cell.text);
            cursor++;
        }
        break;
    }

    // Data rows: remaining lines. Only the column-names row is indented to the data columns.
    const body: (DataRow | null)[] = [];
    for (; cursor < lines.length; cursor++) {
        const line = lines[cursor] ?? "";
        if (line.length > 0) body.push(parseRow(line, cellLimit));
        else if (cursor <= namesLine) body.push(null);
    }

    return { signature, defaultValue, blanksBeforeColumns, columnNames, body };
}

function tokensOf(text: string): string[] {
    return text.split(LINE_BREAK_RE).flatMap((line) => cellsOf(line).map((cell) => cell.text));
}

/**
 * Formats a 2DA document.
 * Returns the original text unchanged if the file has no column or data content,
 * or if a content-safety validation fails after formatting.
 */
export function format2da(rawText: string): FormatOutput {
    // Strip BOM before any processing; the original is kept only for the document-edit range.
    const text = stripBom(rawText);
    if (ENCRYPTED_LEADS.some((lead) => text.startsWith(lead))) {
        return { text: rawText, warning: "2DA formatter: encrypted file, skipping" };
    }
    const { signature, defaultValue, blanksBeforeColumns, columnNames, body } = parse(text);
    const dataRows = body.filter((row) => row !== null);

    // Bail out only when there is truly nothing to format (no header, no columns, no data).
    // Header-only files (signature + default value, no data) still go through formatting so
    // that the signature line is normalized (e.g. tabs/multiple spaces collapsed to one space).
    if (signature === null && columnNames.length === 0 && dataRows.length === 0) {
        return { text: rawText };
    }

    // Max width of the row-label column (the implicit first column in data rows)
    const maxLabelWidth = dataRows.reduce((max, row) => Math.max(max, row.label.length), 0);

    // Number of data columns (max across column-names row and all data rows)
    const numCols = Math.max(columnNames.length, ...dataRows.map((row) => row.values.length));

    // Width of each data column = max of its header name and all its cell values
    const colWidths: number[] = [];
    for (let c = 0; c < numCols; c++) {
        const nameWidth = (columnNames[c] ?? "").length;
        const dataWidth = dataRows.reduce((max, row) => Math.max(max, (row.values[c] ?? "").length), 0);
        colWidths.push(Math.max(nameWidth, dataWidth));
    }

    const outputLines: string[] = [];

    if (signature !== null) {
        outputLines.push(signature);
    }
    if (defaultValue !== null) {
        outputLines.push(defaultValue);
    }
    for (let i = 0; i < blanksBeforeColumns; i++) {
        outputLines.push("");
    }

    // Column-names row: indent by (maxLabelWidth + MIN_GAP) to align with data columns
    if (columnNames.length > 0) {
        const indent = " ".repeat(maxLabelWidth + MIN_GAP);
        const parts = columnNames.map((name, i) => name.padEnd((colWidths[i] ?? name.length) + MIN_GAP));
        outputLines.push(trimBlankEnd(indent + parts.join("")));
    }

    // Data rows
    for (const row of body) {
        if (row === null) {
            outputLines.push("");
            continue;
        }
        const parts = row.values.map((val, i) => val.padEnd((colWidths[i] ?? val.length) + MIN_GAP));
        outputLines.push(trimBlankEnd(row.label.padEnd(maxLabelWidth + MIN_GAP) + parts.join("") + (row.rest ?? "")));
    }

    const formatted = outputLines.join("\n") + "\n";

    // Identity check against rawText so BOM-only differences still produce a change.
    if (formatted === rawText) {
        return { text: rawText };
    }

    // Safety check: cell tokens must be identical and in the same order.
    // text is already BOM-free so no special handling needed here.
    if (tokensOf(text).join("\0") !== tokensOf(formatted).join("\0")) {
        return { text: rawText, warning: "2DA formatter: token mismatch after formatting, skipping" };
    }

    return { text: formatted };
}
