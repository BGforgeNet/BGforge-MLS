/**
 * Property-based tests for the three pure document formatters: format2da, formatTra, formatMsg.
 *
 * Two properties are verified for each formatter:
 *   1. Idempotence — formatting the output a second time produces no further change.
 *   2. No-crash   — any arbitrary string input returns a string without throwing.
 *
 * Generators for idempotence are shaped like valid file content so the formatter's
 * core logic is exercised; the no-crash property uses unrestricted fc.string().
 *
 * numRuns is capped at 50 per property to keep the suite well under ~500ms.
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { format2da } from "../src/infinity-2da/format";
import { formatMsg } from "../src/fallout-msg/format";
import { formatTra } from "../src/weidu-tra/format";
import type { FormatOutput } from "../src/shared/format-utils";

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

type Formatter = (raw: string) => FormatOutput;

/** Apply a formatter once. Returns the formatted text (no-op returns the input unchanged). */
function applyFormat(fn: Formatter, input: string): string {
    return fn(input).text;
}

// ---------------------------------------------------------------------------
// Arbitrary generators
// ---------------------------------------------------------------------------

/** A non-whitespace token suitable for use as a 2DA cell value or label. */
const token2da = fc.stringMatching(/^\S+$/).filter((s) => s.length > 0 && s.length <= 12);

/**
 * Generates a syntactically plausible 2DA document string.
 * Structure: signature line, default-value line, column-names row, data rows.
 */
const arb2da: fc.Arbitrary<string> = fc
    .array(fc.array(token2da, { minLength: 2, maxLength: 5 }), { minLength: 1, maxLength: 8 })
    .chain((rows) => {
        // Derive column count from the first row (label + values, so values = row[0]!.length - 1)
        const colCount = (rows[0]?.length ?? 2) - 1;
        return fc.array(token2da, { minLength: colCount, maxLength: colCount }).map((colNames) => {
            const header = "2DA V1.0\n****\n";
            const colRow = "    " + colNames.join("  ") + "\n";
            const dataRows = rows.map((cells) => cells.join("  ")).join("\n");
            return header + colRow + dataRows + "\n";
        });
    });

/** Content safe inside a tilde-delimited TRA string (no tildes). */
const traStringContent = fc
    .string({ minLength: 0, maxLength: 20 })
    .filter((s) => !s.includes("~") && !s.includes("\n"));

/** Generates one `@N = ~text~` entry line. */
const traEntry: fc.Arbitrary<string> = fc
    .integer({ min: 0, max: 9999 })
    .chain((n) => traStringContent.map((content) => `@${n} = ~${content}~`));

/**
 * Generates a plausible TRA document: one or more entries separated by
 * optional blank lines, with optional surrounding whitespace on prefix parts.
 */
const arbTra: fc.Arbitrary<string> = fc
    .array(traEntry, { minLength: 1, maxLength: 10 })
    .map((entries) => entries.join("\n") + "\n");

/** Content safe inside a MSG brace group — no braces. */
const msgContent = fc.string({ maxLength: 8 }).filter((s) => !/[{}]/.test(s));

/** Generates one `{number}{audio}{text}` MSG entry line. */
const msgEntry: fc.Arbitrary<string> = fc
    .integer({ min: 0, max: 9999 })
    .chain((n) => fc.tuple(msgContent, msgContent).map(([audio, text]) => `{${n}}{${audio}}{${text}}`));

/**
 * Generates a plausible MSG document: one or more entries joined by newlines.
 */
const arbMsg: fc.Arbitrary<string> = fc
    .array(msgEntry, { minLength: 1, maxLength: 10 })
    .map((entries) => entries.join("\n") + "\n");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("formatter properties — format2da", () => {
    it("idempotence: formatting twice equals formatting once", () => {
        fc.assert(
            fc.property(arb2da, (input) => {
                const once = applyFormat(format2da, input);
                const twice = applyFormat(format2da, once);
                expect(twice).toBe(once);
            }),
            { numRuns: 50 },
        );
    });

    it("no-crash on arbitrary input", () => {
        fc.assert(
            fc.property(fc.string(), (input) => {
                const result = applyFormat(format2da, input);
                expect(typeof result).toBe("string");
            }),
            { numRuns: 50 },
        );
    });
});

describe("formatter properties — formatTra", () => {
    it("idempotence: formatting twice equals formatting once", () => {
        fc.assert(
            fc.property(arbTra, (input) => {
                const once = applyFormat(formatTra, input);
                const twice = applyFormat(formatTra, once);
                expect(twice).toBe(once);
            }),
            { numRuns: 50 },
        );
    });

    it("no-crash on arbitrary input", () => {
        fc.assert(
            fc.property(fc.string(), (input) => {
                const result = applyFormat(formatTra, input);
                expect(typeof result).toBe("string");
            }),
            { numRuns: 50 },
        );
    });
});

describe("formatter properties — formatMsg", () => {
    it("idempotence: formatting twice equals formatting once", () => {
        fc.assert(
            fc.property(arbMsg, (input) => {
                const once = applyFormat(formatMsg, input);
                const twice = applyFormat(formatMsg, once);
                expect(twice).toBe(once);
            }),
            { numRuns: 50 },
        );
    });

    it("no-crash on arbitrary input", () => {
        fc.assert(
            fc.property(fc.string(), (input) => {
                const result = applyFormat(formatMsg, input);
                expect(typeof result).toBe("string");
            }),
            { numRuns: 50 },
        );
    });
});
