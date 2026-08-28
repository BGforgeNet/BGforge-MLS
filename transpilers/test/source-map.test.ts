/**
 * Base64-VLQ decoding of a source map's `mappings` field (transpilers/common/source-map.ts).
 *
 * Every mapped segment of a line is kept, in generated-column order. Keeping only the first was enough
 * while a bundler put one statement per line; rolldown prints `if (x) { y; }` as `if (x) y;`, and then
 * the column is the only thing telling the two statements' origins apart.
 */
import { describe, expect, it } from "vitest";
import { decodeMappings, originAtColumn } from "../common/source-map";

describe("decodeMappings", () => {
    it("decodes nothing from an empty field", () => {
        expect(decodeMappings("")).toEqual([]);
    });

    it("decodes a single segment at the start of both files", () => {
        // A = 0, so: generated column 0, source 0, source line 0, source column 0.
        expect(decodeMappings("AAAA")).toEqual([[{ column: 0, source: 0, line: 0 }]]);
    });

    it("accumulates the source line across generated lines, since every field is a delta", () => {
        // Second line's third field is C = 1, a delta of +1 on the source line.
        expect(decodeMappings("AAAA;AACA")).toEqual([
            [{ column: 0, source: 0, line: 0 }],
            [{ column: 0, source: 0, line: 1 }],
        ]);
    });

    it("reports a generated line carrying no segments as having no origins", () => {
        expect(decodeMappings("AAAA;;AACA")).toEqual([
            [{ column: 0, source: 0, line: 0 }],
            [],
            [{ column: 0, source: 0, line: 1 }],
        ]);
    });

    it("drops a segment holding only a generated column, which names no source", () => {
        expect(decodeMappings("A")).toEqual([[]]);
    });

    it("decodes a negative delta, which is how a map walks backwards through a source", () => {
        // E = 4 -> +2 after the sign bit; D = 3 -> -1.
        expect(decodeMappings("AAEA;AADA")).toEqual([
            [{ column: 0, source: 0, line: 2 }],
            [{ column: 0, source: 0, line: 1 }],
        ]);
    });

    it("decodes a value spanning two characters, where one cannot hold it", () => {
        // gC: 'g' carries the continuation bit, 'C' the high chunk - together 32.
        expect(decodeMappings("AAgCA")).toEqual([[{ column: 0, source: 0, line: 32 }]]);
    });

    it("keeps every segment of a line, with the generated column each one starts at", () => {
        // Two segments on one generated line; the second is +1 column on and +1 source line on.
        expect(decodeMappings("AAAA,CACA")).toEqual([
            [
                { column: 0, source: 0, line: 0 },
                { column: 1, source: 0, line: 1 },
            ],
        ]);
    });

    it("resets the generated column each line, since only that field is per-line", () => {
        // Both lines' first field is A = 0, so the second line starts at column 0 again rather than
        // carrying the previous line's column forward.
        expect(decodeMappings("KAAA;AACA")).toEqual([
            [{ column: 5, source: 0, line: 0 }],
            [{ column: 0, source: 0, line: 1 }],
        ]);
    });

    it("tracks the source index across lines so a bundle's later files resolve", () => {
        // Second line's second field is C = 1: the next entry of the map's `sources` array.
        expect(decodeMappings("AAAA;ACAA")).toEqual([
            [{ column: 0, source: 0, line: 0 }],
            [{ column: 0, source: 1, line: 0 }],
        ]);
    });
});

describe("originAtColumn", () => {
    const origins = [
        { column: 0, source: 0, line: 10 },
        { column: 8, source: 0, line: 11 },
        { column: 20, source: 0, line: 12 },
    ];

    it("returns the segment covering the column, not the one after it", () => {
        expect(originAtColumn(origins, 8)).toEqual({ column: 8, source: 0, line: 11 });
        expect(originAtColumn(origins, 19)).toEqual({ column: 8, source: 0, line: 11 });
    });

    it("returns the last segment for a column past all of them", () => {
        expect(originAtColumn(origins, 99)).toEqual({ column: 20, source: 0, line: 12 });
    });

    it("falls back to the first segment for a column ahead of it", () => {
        // A line's leading indentation sits before its first mapping; attributing it to the line's own
        // start beats reporting it as unmapped.
        expect(originAtColumn([{ column: 4, source: 0, line: 7 }], 0)).toEqual({ column: 4, source: 0, line: 7 });
    });

    it("has no answer for a line with no segments", () => {
        expect(originAtColumn([], 0)).toBeUndefined();
    });
});
