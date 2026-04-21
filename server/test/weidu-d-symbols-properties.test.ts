/**
 * Property-based tests for the WeiDU D document symbol extractor.
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

// Mock server module to suppress LSP connection side-effects during tests.
vi.mock("../src/server", () => ({
    connection: {
        console: { log: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { getDocumentSymbols } from "../src/weidu-d/symbol";
import { initParser } from "../src/weidu-d/parser";

beforeAll(async () => {
    await initParser();
});

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Small set of realistic-ish WeiDU D snippets exercising state declarations,
 * BEGIN/END blocks, and APPEND blocks.
 */
const dFragments: fc.Arbitrary<string> = fc.oneof(
    fc.constant("BEGIN ~DIALOG~\nIF ~True()~ THEN BEGIN my_state\n    SAY ~Hello~\nEND"),
    fc.constant("BEGIN ~DIALOG2~\nIF ~~ THEN BEGIN state1\n    SAY ~Hi~\nEND"),
    fc.constant("APPEND ~DIALOG~\nIF ~~ THEN BEGIN appended_state\n    SAY ~Appended~\nEND\nEND"),
    fc.constant("BEGIN ~EMPTY~"),
    fc.constant("")
);

/** Concatenates 1–4 fragments with newlines. */
const arbDText: fc.Arbitrary<string> = fc
    .array(dFragments, { minLength: 1, maxLength: 4 })
    .map((parts) => parts.join("\n"));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("weidu-d symbol extractor properties", () => {
    it("no-crash: arbitrary string input returns an array without throwing", () => {
        fc.assert(
            fc.property(fc.string({ size: "small" }), (text) => {
                const result = getDocumentSymbols(text);
                expect(Array.isArray(result)).toBe(true);
            }),
            { numRuns: 50 }
        );
    });

    it("range sanity: all symbol ranges are non-negative and start <= end", () => {
        fc.assert(
            fc.property(arbDText, (text) => {
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
                        start.line < end.line ||
                        (start.line === end.line && start.character <= end.character);
                    expect(startBefore).toBe(true);
                    // end line must be within the document
                    // (allow end.line === lineCount for EOF-terminated ranges)
                    expect(end.line).toBeLessThanOrEqual(lineCount);
                }
            }),
            { numRuns: 50 }
        );
    });

    it("idempotence: two calls on the same text return deep-equal results", () => {
        fc.assert(
            fc.property(arbDText, (text) => {
                const first = getDocumentSymbols(text);
                const second = getDocumentSymbols(text);
                expect(second).toEqual(first);
            }),
            { numRuns: 50 }
        );
    });
});
