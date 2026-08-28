/**
 * Just enough of the source-map format to answer "which line of which source did this line come from".
 *
 * Hand-rolled rather than taken from a package: this is one well-specified encoding, it is the only part
 * of the format needed, and `@bgforge/transpile` is published - a decoder here keeps its dependency list
 * and its bundle unchanged.
 *
 * Deliberately free of imports, like line-map.ts, so any pass can use it without risking a cycle.
 */

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Where part of a generated line came from: the 0-based generated column the mapping starts at, an
 * index into the map's own `sources`, and a 0-based line in that source.
 *
 * `column` is what tells two origins on one generated line apart. A bundler is free to put statements
 * from different source lines on the same output line - rolldown prints `if (x) { y; }` as `if (x) y;` -
 * and then the line alone no longer identifies where anything came from.
 */
export interface SourceOrigin {
    column: number;
    source: number;
    line: number;
}

/** Reads one variable-length value, returning it with the offset just past its last character. */
function readVlq(field: string, start: number): { value: number; next: number } {
    let result = 0;
    let shift = 0;
    let index = start;
    let digit: number;
    do {
        digit = BASE64.indexOf(field[index] ?? "");
        // An unknown character cannot be told apart from a truncated value, and guessing either way
        // silently shifts every later segment - so the field is rejected rather than half-read.
        if (digit < 0) throw new Error(`invalid base64-VLQ character at offset ${index}`);
        index++;
        // Bit 5 says another character continues this value; the low 5 bits are the payload.
        result += (digit & 31) << shift;
        shift += 5;
    } while (digit & 32);
    // The lowest bit of the assembled value is its sign, not part of the magnitude.
    const magnitude = result >> 1;
    return { value: result & 1 ? -magnitude : magnitude, next: index };
}

/**
 * Every mapped segment of each generated line, in generated-column order, by position in the array.
 *
 * Every field is a delta - the generated column resets per line, the source index and line carry across
 * the whole field - so the whole string is walked regardless. A line with no segments yields an empty
 * array; a segment naming only a generated column contributes nothing, having no source.
 *
 * All segments are kept, not just the first: which one applies depends on the column being asked about,
 * and discarding the rest is what made a collapsed line report its first statement's origin for every
 * statement on it.
 */
export function decodeMappings(mappings: string): Array<readonly SourceOrigin[]> {
    if (mappings === "") return [];

    const perLine: Array<readonly SourceOrigin[]> = [];
    let source = 0;
    let line = 0;

    for (const generatedLine of mappings.split(";")) {
        const origins: SourceOrigin[] = [];
        let column = 0;
        for (const segment of generatedLine.split(",")) {
            if (segment === "") continue;
            const columnDelta = readVlq(segment, 0);
            column += columnDelta.value;
            let at = columnDelta.next;
            if (at >= segment.length) continue;
            const sourceDelta = readVlq(segment, at);
            at = sourceDelta.next;
            const lineDelta = readVlq(segment, at);
            source += sourceDelta.value;
            line += lineDelta.value;
            origins.push({ column, source, line });
        }
        perLine.push(origins);
    }

    return perLine;
}

/**
 * The segment covering `column`: the last one starting at or before it, or the first if none does.
 *
 * Falling back to the first rather than to nothing keeps a position ahead of every segment - a line's
 * leading indentation, say - attributed to the line's own start instead of going unmapped.
 */
export function originAtColumn(origins: readonly SourceOrigin[], column: number): SourceOrigin | undefined {
    let found: SourceOrigin | undefined = origins[0];
    for (const origin of origins) {
        if (origin.column > column) break;
        found = origin;
    }
    return found;
}
