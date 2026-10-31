/**
 * GemRB's 2DA reader, ported for tests: the oracle the 2DA formatter is held to, beside WeiDU's plain
 * whitespace split. Ported from GemRB's 2DA importer, its line reader and its string splitter.
 *
 * - Lines end at `\n` or `\r\n`; every tab reads as a space.
 * - Line 1 is the signature (only warned about); line 2's default value runs to its first space.
 * - A line starting with `#` is skipped from the column-names line on; an empty line is not skipped.
 * - The column-names line is the next line, split on space runs; an all-blank line gives no columns.
 * - A data row's name runs to its first space. A row with no space is a name with no cells (an empty line
 *   is dropped). The rest splits on space runs, but into at most as many cells as there are columns: the
 *   last cell takes the remainder of the line, inner spacing included, trailing spaces trimmed. With no
 *   columns the split is unbounded.
 */

export interface GemrbRow {
    readonly name: string;
    readonly cells: readonly string[];
}

export interface Gemrb2da {
    readonly defaultValue: string;
    readonly columns: readonly string[];
    readonly rows: readonly GemrbRow[];
}

const BLANK = new Set([" ", "\n", "\r", "\t"]);

function firstNonBlank(s: string, from: number): number {
    for (let i = from; i < s.length; i++) {
        if (!BLANK.has(s[i] ?? "")) return i;
    }
    return -1;
}

function lastNonBlank(s: string): number {
    for (let i = s.length - 1; i >= 0; i--) {
        if (!BLANK.has(s[i] ?? "")) return i;
    }
    return -1;
}

/** GemRB's splitter on a space delimiter; `limit` 0 is unbounded. */
function explode(s: string, limit: number): string[] {
    const cells: string[] = [];
    let beg = firstNonBlank(s, 0);
    if (beg === -1) return cells;
    let cur = beg;
    for (; cur < s.length; cur++) {
        if (s[cur] !== " ") continue;
        cells.push(s.slice(beg, cur));
        beg = firstNonBlank(s, cur + 1);
        if (limit !== 0 && cells.length === limit) break;
        if (beg === -1) {
            cells.push("");
            break;
        }
        cur = beg;
    }
    if (beg !== -1 && beg !== cur) {
        const last = lastNonBlank(s);
        if (last >= beg) cells.push(s.slice(beg, last + 1));
    }
    return cells;
}

export function readLikeGemrb(text: string): Gemrb2da {
    const lines = text
        .split("\n")
        .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line).replaceAll("\t", " "));
    // The reader stops at end of input, so a final newline does not make one more (empty) line.
    if (lines.at(-1) === "") lines.pop();
    let next = 2;
    const defaultLine = lines[1] ?? "";
    const space = defaultLine.indexOf(" ");
    const defaultValue = space === -1 ? defaultLine : defaultLine.slice(0, space);

    const nextLine = (): string | undefined => {
        while (next < lines.length) {
            const line = lines[next++] ?? "";
            if (!line.startsWith("#")) return line;
        }
        return undefined;
    };

    const header = nextLine() ?? "";
    const start = firstNonBlank(header, 0);
    const columns = start === -1 ? [] : explode(header.slice(start), 0);
    // GemRB passes `max(1, columns - 1)` in an unsigned type, so no columns wraps round to no limit.
    const limit = columns.length === 0 ? 0 : Math.max(1, columns.length - 1);

    const rows: GemrbRow[] = [];
    for (let line = nextLine(); line !== undefined; line = nextLine()) {
        const pos = line.indexOf(" ");
        if (pos === -1) {
            if (line.length > 0) rows.push({ name: line, cells: [] });
            continue;
        }
        const cells = explode(line.slice(pos + 1), limit);
        if (cells.at(-1) === "") cells.pop();
        rows.push({ name: line.slice(0, pos), cells });
    }
    return { defaultValue, columns, rows };
}
