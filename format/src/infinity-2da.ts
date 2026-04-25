/**
 * Formatter for Infinity Engine 2DA table files.
 *
 * Aligns all columns to uniform widths, with at least 4 spaces between each column.
 * Trims trailing whitespace from every line.
 *
 * The column-names row (which starts with whitespace) is treated as having an empty
 * first column: it is indented by (max_row_label_width + 2) spaces so the column
 * names align with the corresponding data values beneath them.
 *
 * The signature ("2DA V1.0") and default-value lines are preserved exactly, only
 * trimming trailing whitespace.
 */

import { stripBom, type FormatOutput } from "@bgforge/format";

const MIN_GAP = 4;
const TOKEN_RE = /\S+/g;

function tokenize(line: string): string[] {
    const tokens: string[] = [];
    TOKEN_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TOKEN_RE.exec(line)) !== null) {
        tokens.push(match[0]);
    }
    return tokens;
}

interface DataRow {
    readonly label: string;
    readonly values: readonly string[];
}

interface Parsed {
    readonly signature: string | null;
    readonly defaultValue: string | null;
    readonly columnNames: readonly string[];
    readonly dataRows: readonly DataRow[];
}

function parse(text: string): Parsed {
    const lines = text.split("\n").map((l) => l.trimEnd());

    let cursor = 0;
    let signature: string | null = null;
    let defaultValue: string | null = null;

    // Detect optional "2DA V…" signature on line 0
    const firstLine = lines[0] ?? "";
    if (/^2DA\s/i.test(firstLine)) {
        // Normalize to single space between tokens (e.g. "2DA    V1.0" → "2DA V1.0").
        signature = firstLine.trim().replace(/\s+/g, " ");
        cursor++;
        // The line immediately after the signature is the default value
        if (cursor < lines.length) {
            defaultValue = lines[cursor] ?? null;
            cursor++;
        }
    }

    // Column-names row: first line starting with whitespace after any header lines
    let columnNames: readonly string[] = [];
    while (cursor < lines.length) {
        const line = lines[cursor] ?? "";
        if (line.length === 0) {
            cursor++;
            continue;
        }
        if (line[0] === " " || line[0] === "\t") {
            columnNames = tokenize(line);
            cursor++;
        }
        break;
    }

    // Data rows: remaining lines. Only the column-names row may start with whitespace;
    // any data row with accidental leading whitespace is normalised by stripping it.
    const dataRows: DataRow[] = [];
    for (; cursor < lines.length; cursor++) {
        const line = lines[cursor] ?? "";
        if (line.length === 0) continue;
        const [label, ...values] = tokenize(line); // tokenize() ignores leading whitespace
        if (label === undefined) continue;
        dataRows.push({ label, values });
    }

    return { signature, defaultValue, columnNames, dataRows };
}

/**
 * Formats a 2DA document.
 * Returns the original text unchanged if the file has no column or data content,
 * or if a content-safety validation fails after formatting.
 */
export function format2da(rawText: string): FormatOutput {
    // Strip BOM before any processing; the original is kept only for the document-edit range.
    const text = stripBom(rawText);
    const { signature, defaultValue, columnNames, dataRows } = parse(text);

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

    // Column-names row: indent by (maxLabelWidth + MIN_GAP) to align with data columns
    if (columnNames.length > 0) {
        const indent = " ".repeat(maxLabelWidth + MIN_GAP);
        const parts = columnNames.map((name, i) => name.padEnd((colWidths[i] ?? name.length) + MIN_GAP));
        outputLines.push((indent + parts.join("")).trimEnd());
    }

    // Data rows
    for (const { label, values } of dataRows) {
        const parts = values.map((val, i) => val.padEnd((colWidths[i] ?? val.length) + MIN_GAP));
        outputLines.push((label.padEnd(maxLabelWidth + MIN_GAP) + parts.join("")).trimEnd());
    }

    const formatted = outputLines.join("\n") + "\n";

    // Identity check against rawText so BOM-only differences still produce a change.
    if (formatted === rawText) {
        return { text: rawText };
    }

    // Safety check: non-whitespace tokens must be identical and in the same order.
    // text is already BOM-free so no special handling needed here.
    const originalTokens = text.split(/\s+/).filter((t) => t.length > 0);
    const formattedTokens = formatted.split(/\s+/).filter((t) => t.length > 0);
    if (originalTokens.join("\0") !== formattedTokens.join("\0")) {
        return { text: rawText, warning: "2DA formatter: token mismatch after formatting, skipping" };
    }

    return { text: formatted };
}
