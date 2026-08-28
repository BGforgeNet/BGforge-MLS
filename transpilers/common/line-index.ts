/**
 * Position-to-line lookup over one text, built once and queried by binary search.
 *
 * ts-morph answers `Node.getStartLineNumber()` by counting newlines from character 0 of the file on
 * every call, with no cache, so a pass that records a line for each node it emits costs time quadratic
 * in file size. The transpilers do exactly that - every condition, action and statement carries a line
 * for diagnostics and source maps - over bundled text far larger than what the author wrote.
 *
 * Numbering matches ts-morph's: 1-based, counting newlines strictly BEFORE the position, so a position
 * that lands on a newline still belongs to the line that newline ends.
 *
 * Deliberately free of imports, like line-map.ts, so any pass can use it without risking a cycle. That
 * sibling maps lines between passes; this one maps a character position to a line within a single text.
 */

/** Line starts for one text: the offset of the first character of each line. */
export class LineIndex {
    /** Int32Array rather than number[] for the buffer size; a bundled file runs to tens of thousands
     * of lines and every entry fits an int32. */
    private readonly lineStarts: Int32Array;
    private readonly textLength: number;

    constructor(text: string) {
        this.textLength = text.length;
        const starts: number[] = [0];
        for (let i = 0; i < text.length; i++) {
            if (text.codePointAt(i) === 10) starts.push(i + 1);
        }
        this.lineStarts = Int32Array.from(starts);
    }

    /** The 1-based line `pos` sits on. Throws rather than answering for a position outside the text. */
    lineNumberAt(pos: number): number {
        if (pos < 0 || pos > this.textLength) {
            throw new RangeError(`Position ${pos} is out of range for a text of length ${this.textLength}`);
        }
        // First index whose line start is past `pos`. Every earlier entry is a line that began at or
        // before `pos`, so that index IS the count of them, which is the 1-based line number.
        let low = 0;
        let high = this.lineStarts.length;
        while (low < high) {
            const mid = (low + high) >>> 1;
            // `mid < high <= lineStarts.length` holds on every iteration, so the index is in bounds;
            // the assertion is only to shed the `| undefined` noUncheckedIndexedAccess adds.
            if (this.lineStarts[mid]! <= pos) low = mid + 1;
            else high = mid;
        }
        return low;
    }
}
