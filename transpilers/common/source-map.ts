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

/** Where a generated line came from: an index into the map's own `sources`, and a 0-based line in it. */
export interface SourceOrigin {
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
 * The origin of each generated line, by position in the returned array.
 *
 * Every field is a delta - generated column resets per line, the source index, line and column carry
 * across the whole field - so the whole string is walked even though only the first segment of each line
 * is kept. A line with no segments, or whose first segment names only a generated column, has no origin.
 */
export function decodeMappings(mappings: string): Array<SourceOrigin | undefined> {
    if (mappings === "") return [];

    const origins: Array<SourceOrigin | undefined> = [];
    let source = 0;
    let line = 0;

    for (const generatedLine of mappings.split(";")) {
        let origin: SourceOrigin | undefined;
        for (const segment of generatedLine.split(",")) {
            if (segment === "") continue;
            // Field 0 is the generated column, which line granularity does not need - but it has to be
            // read to reach the rest, and its own delta is per-line so nothing carries out of here.
            let at = readVlq(segment, 0).next;
            if (at >= segment.length) continue;
            const sourceDelta = readVlq(segment, at);
            at = sourceDelta.next;
            const lineDelta = readVlq(segment, at);
            source += sourceDelta.value;
            line += lineDelta.value;
            origin ??= { source, line };
        }
        origins.push(origin);
    }

    return origins;
}
