/**
 * Property-based tests for the WeiDU TP2 document symbol extractor.
 *
 * Three properties are verified:
 *   1. No-crash   — arbitrary string input does not throw; returns an array.
 *   2. Range sanity — every symbol's location ranges are non-negative and ordered.
 *   3. Idempotence — calling getDocumentSymbols twice on the same text returns
 *                    deep-equal results (no hidden mutable state).
 *
 * numRuns capped at 50 per property to keep the suite under ~500ms.
 */

import * as fc from "fast-check";
import { describe, it, expect, beforeAll, vi } from "vitest";

// Mock lsp-connection to suppress LSP connection side-effects during tests.
vi.mock("../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }),
}));

import { getDocumentSymbols } from "../src/weidu-tp2/symbol";
import { initParser } from "../src/weidu-tp2/parser";

beforeAll(async () => {
    await initParser();
});

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Small set of realistic-ish WeiDU TP2 snippets exercising function/macro
 * definitions and file-level variable assignments.
 */
const tp2Fragments: fc.Arbitrary<string> = fc.oneof(
    fc.constant("DEFINE_ACTION_FUNCTION my_func BEGIN END"),
    fc.constant("DEFINE_PATCH_FUNCTION patch_fn BEGIN END"),
    fc.constant("DEFINE_ACTION_MACRO my_macro BEGIN END"),
    fc.constant("OUTER_SET MY_VAR = 42"),
    fc.constant("OUTER_SPRINT MY_STRING ~hello~"),
    fc.constant("DEFINE_ACTION_FUNCTION complex_fn\n    INT_VAR param1 = 0\nBEGIN\n    OUTER_SET local_var = 1\nEND"),
    fc.constant(""),
);

/** Concatenates 1–4 fragments with newlines. */
const arbTp2Text: fc.Arbitrary<string> = fc
    .array(tp2Fragments, { minLength: 1, maxLength: 4 })
    .map((parts) => parts.join("\n"));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("weidu-tp2 symbol extractor properties", () => {
    it("no-crash: arbitrary string input returns an array without throwing", () => {
        fc.assert(
            fc.property(fc.string({ size: "small" }), (text) => {
                const result = getDocumentSymbols(text);
                expect(Array.isArray(result)).toBe(true);
            }),
            { numRuns: 50 },
        );
    });

    it("range sanity: all symbol ranges are non-negative and start <= end", () => {
        fc.assert(
            fc.property(arbTp2Text, (text) => {
                const lineCount = text.split("\n").length;
                const symbols = getDocumentSymbols(text);

                for (const sym of symbols) {
                    const { start, end } = sym.range;
                    expect(start.line).toBeGreaterThanOrEqual(0);
                    expect(start.character).toBeGreaterThanOrEqual(0);
                    expect(end.line).toBeGreaterThanOrEqual(0);
                    expect(end.character).toBeGreaterThanOrEqual(0);
                    // start must not be after end
                    const startBefore =
                        start.line < end.line || (start.line === end.line && start.character <= end.character);
                    expect(startBefore).toBe(true);
                    // end line must be within the document
                    // (allow end.line === lineCount for EOF-terminated ranges)
                    expect(end.line).toBeLessThanOrEqual(lineCount);
                }
            }),
            { numRuns: 50 },
        );
    });

    it("idempotence: two calls on the same text return deep-equal results", () => {
        fc.assert(
            fc.property(arbTp2Text, (text) => {
                const first = getDocumentSymbols(text);
                const second = getDocumentSymbols(text);
                expect(second).toEqual(first);
            }),
            { numRuns: 50 },
        );
    });
});
