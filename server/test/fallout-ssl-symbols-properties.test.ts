/**
 * Property-based tests for the Fallout SSL document symbol extractor.
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

// Mock lsp-connection to suppress console output during tests.
vi.mock("../src/lsp-connection", () => ({
    getConnection: () => ({
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    }),
}));

// Also mock server module accessed by some transitive imports.
vi.mock("../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { getDocumentSymbols } from "../src/fallout-ssl/symbol";
import { initParser } from "../../shared/parsers/fallout-ssl";

beforeAll(async () => {
    await initParser();
});

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Small set of realistic-ish Fallout SSL snippets exercising procedures,
 * macros, and variable declarations.
 */
const sslFragments: fc.Arbitrary<string> = fc.oneof(
    fc.constant("procedure my_proc begin end"),
    fc.constant("#define MY_CONST (42)"),
    fc.constant("#define MY_MACRO(x) (x + 1)"),
    fc.constant("variable global_var;"),
    fc.constant("procedure test_proc(p1, p2)\nbegin\nvariable local_var;\nend"),
    fc.constant("export variable exported_var;"),
    fc.constant(""),
);

/** Concatenates 1–5 fragments with newlines. */
const arbSslText: fc.Arbitrary<string> = fc
    .array(sslFragments, { minLength: 1, maxLength: 5 })
    .map((parts) => parts.join("\n"));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fallout-ssl symbol extractor properties", () => {
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
            fc.property(arbSslText, (text) => {
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
            fc.property(arbSslText, (text) => {
                const first = getDocumentSymbols(text);
                const second = getDocumentSymbols(text);
                expect(second).toEqual(first);
            }),
            { numRuns: 50 },
        );
    });
});
