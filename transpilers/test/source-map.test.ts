/**
 * Base64-VLQ decoding of a source map's `mappings` field (transpilers/common/source-map.ts).
 *
 * Only line granularity is needed - an error message names a line, not a column - so the decoder keeps
 * the first mapped segment of each generated line and discards the rest.
 */
import { describe, expect, it } from "vitest";
import { decodeMappings } from "../common/source-map";

describe("decodeMappings", () => {
    it("decodes nothing from an empty field", () => {
        expect(decodeMappings("")).toEqual([]);
    });

    it("decodes a single segment at the start of both files", () => {
        // A = 0, so: generated column 0, source 0, source line 0, source column 0.
        expect(decodeMappings("AAAA")).toEqual([{ source: 0, line: 0 }]);
    });

    it("accumulates the source line across generated lines, since every field is a delta", () => {
        // Second line's third field is C = 1, a delta of +1 on the source line.
        expect(decodeMappings("AAAA;AACA")).toEqual([
            { source: 0, line: 0 },
            { source: 0, line: 1 },
        ]);
    });

    it("reports a generated line carrying no segments as unmapped", () => {
        expect(decodeMappings("AAAA;;AACA")).toEqual([{ source: 0, line: 0 }, undefined, { source: 0, line: 1 }]);
    });

    it("reports a segment holding only a generated column as unmapped, having no source", () => {
        expect(decodeMappings("A")).toEqual([undefined]);
    });

    it("decodes a negative delta, which is how a map walks backwards through a source", () => {
        // E = 4 -> +2 after the sign bit; D = 3 -> -1.
        expect(decodeMappings("AAEA;AADA")).toEqual([
            { source: 0, line: 2 },
            { source: 0, line: 1 },
        ]);
    });

    it("decodes a value spanning two characters, where one cannot hold it", () => {
        // gC: 'g' carries the continuation bit, 'C' the high chunk - together 32.
        expect(decodeMappings("AAgCA")).toEqual([{ source: 0, line: 32 }]);
    });

    it("keeps the first segment of a line and ignores the rest, which only refine the column", () => {
        // Two segments on one generated line; the second moves the source line on, but the first wins.
        expect(decodeMappings("AAAA,CACA")).toEqual([{ source: 0, line: 0 }]);
    });

    it("tracks the source index across lines so a bundle's later files resolve", () => {
        // Second line's second field is C = 1: the next entry of the map's `sources` array.
        expect(decodeMappings("AAAA;ACAA")).toEqual([
            { source: 0, line: 0 },
            { source: 1, line: 0 },
        ]);
    });
});
