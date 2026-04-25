/**
 * Semantic token extraction for Infinity Engine 2DA table files.
 *
 * Assigns a cycling token type per column (mod 6), giving each column slot a
 * distinct color so readers can visually trace columns across wide tables.
 *
 * 2DA structure:
 *   Line 0: "2DA V1.0" (file header — handled by TextMate grammar)
 *   Line 1: default value  (used when a cell is empty — also TextMate)
 *   Line 2: column names   (leading-whitespace line — also TextMate)
 *   Lines 3+: data rows    (first token = row label, rest = cell values)
 *
 * Row labels keep their existing TextMate highlighting (entity.name.function).
 * Only the cell values in data rows receive semantic tokens.
 */

import { type SemanticTokenSpan, CELL_2DA_COL_TYPES } from "../shared/semantic-tokens";
import { stripBom } from "@bgforge/format";

/** Regex for matching non-whitespace runs; must be reset before each use. */
const TOKEN_RE = /\S+/g;

/**
 * Returns the start character and length of each non-whitespace token on the line.
 */
function tokenPositions(line: string): { start: number; length: number }[] {
    const tokens: { start: number; length: number }[] = [];
    let match: RegExpExecArray | null;
    TOKEN_RE.lastIndex = 0;
    while ((match = TOKEN_RE.exec(line)) !== null) {
        tokens.push({ start: match.index, length: match[0].length });
    }
    return tokens;
}

/**
 * Emits semantic token spans for all data cell values in a 2DA file.
 * The first data line is row 0; the first value column after the row label is column 0.
 *
 * Structure detection mirrors the TextMate grammar rules and handles optional headers:
 *
 *   - The "2DA V1.0" signature is OPTIONAL. When present it is on line 0 and is
 *     recognised by the prefix "2DA " (case-insensitive). The line immediately
 *     after the signature is the default value and is also skipped.
 *
 *   - Lines starting with whitespace are column-name headers
 *     (TextMate rule `column_names: ^\s+`) — skip.
 *
 *   - Lines starting with non-whitespace are data rows
 *     (TextMate rule `rows: ^\S+`) — emit tokens.
 *
 * The TextMate header's `end: (\w+)` may land on line 1 (word default value) or
 * extend to the first column name on line 2 (non-word default such as `****`).
 * The whitespace-based detection above handles both cases correctly.
 */
export function getSemanticTokenSpans(text: string): SemanticTokenSpan[] {
    const lines = stripBom(text).split("\n");
    const spans: SemanticTokenSpan[] = [];

    // Detect whether a "2DA V…" signature line is present (it is optional).
    // When present, skip lines 0 (signature) and 1 (default value) — TextMate handles them.
    // Semantic tokens only cover data cell values; uncovered ranges keep TextMate colors.
    let skipUntil = 0;
    const firstLine = lines[0] ?? "";
    if (/^2DA\s/i.test(firstLine)) {
        skipUntil = 2;
    }

    // lines.entries() avoids noUncheckedIndexedAccess issues on lines[i]
    for (const [lineIdx, line] of lines.entries()) {
        if (lineIdx < skipUntil) {
            continue;
        }

        // Only the column-names row may start with whitespace; data rows always start
        // with a non-whitespace row label (TextMate `column_names: ^\s+` / `rows: ^\S+`).
        // Any additional whitespace-starting lines are skipped (should not appear in valid files).
        if (line.length === 0 || line[0] === " " || line[0] === "\t") {
            continue;
        }

        const tokens = tokenPositions(line);

        // Defensive: a non-whitespace-starting line with no tokens (shouldn't happen).
        if (tokens.length === 0) {
            continue;
        }

        // tokens[0] = row label (TextMate colors it; we skip)
        // tokens[1..] = cell values for columns 0, 1, 2, ...

        // slice(1).entries() avoids noUncheckedIndexedAccess on tokens[i]
        for (const [colIndex, token] of tokens.slice(1).entries()) {
            spans.push({
                line: lineIdx,
                startChar: token.start,
                length: token.length,
                // Modulo guarantees the index is in range; ! is safe (noUncheckedIndexedAccess can't prove it).
                tokenType: CELL_2DA_COL_TYPES[colIndex % CELL_2DA_COL_TYPES.length]!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
                tokenModifiers: 0,
            });
        }
    }

    return spans;
}
