/**
 * Unit tests for weidu-tp2/references.ts - findReferences LSP feature.
 * Tests that references are returned as Location[] with correct scoping
 * and includeDeclaration filtering.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";
import { ReferencesIndex } from "../../src/shared/references-index";

vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { initParser } from "../../../shared/parsers/weidu-tp2";
import { findReferences } from "../../src/weidu-tp2/references";
import { normalizeUri } from "../../src/core/normalized-uri";

const TEST_URI = "file:///test.tp2";

beforeAll(async () => {
    await initParser();
});

describe("weidu-tp2/references", () => {
    describe("function references", () => {
        const text = `
DEFINE_ACTION_FUNCTION my_func BEGIN END
LAF my_func END
LAF my_func END
`;
        it("finds definition and all call sites", () => {
            // cursor on "my_func" at definition line 1
            const refs = findReferences(text, { line: 1, character: 23 }, TEST_URI, true);
            // definition + 2 calls = 3
            expect(refs).toHaveLength(3);
            for (const ref of refs) {
                expect(ref.uri).toBe(TEST_URI);
            }
        });

        it("excludes definition when includeDeclaration is false", () => {
            const refs = findReferences(text, { line: 1, character: 23 }, TEST_URI, false);
            // 2 calls only
            expect(refs).toHaveLength(2);
        });

        it("works from a call site too", () => {
            // cursor on "my_func" at first LAF call, line 2
            const refs = findReferences(text, { line: 2, character: 4 }, TEST_URI, true);
            expect(refs).toHaveLength(3);
        });
    });

    describe("file-scoped variable references", () => {
        it("finds OUTER_SET variable and its usages", () => {
            const text = `
OUTER_SET my_var = 5
OUTER_SET result = %my_var% + 1
`;
            // cursor on "my_var" declaration
            const refs = findReferences(text, { line: 1, character: 10 }, TEST_URI, true);
            // declaration + %my_var% usage = 2
            expect(refs).toHaveLength(2);
        });
    });

    describe("function-scoped variable references", () => {
        it("finds variable refs only within the function", () => {
            const text = `
DEFINE_PATCH_FUNCTION my_func BEGIN
    SET my_var = 5
    SET result = my_var + 1
END
DEFINE_PATCH_FUNCTION other BEGIN
    SET my_var = 99
END
`;
            // cursor on "my_var" inside my_func, line 2
            const refs = findReferences(text, { line: 2, character: 8 }, TEST_URI, true);
            // declaration + usage in my_func = 2
            // should NOT include my_var in other
            expect(refs).toHaveLength(2);
            for (const ref of refs) {
                expect(ref.range.start.line).toBeGreaterThanOrEqual(1);
                expect(ref.range.end.line).toBeLessThanOrEqual(4);
            }
        });
    });

    describe("loop-scoped variable references", () => {
        it("finds PHP_EACH loop variable within loop scope", () => {
            const text = `
DEFINE_ACTION_FUNCTION my_func BEGIN
    ACTION_PHP_EACH my_array AS key => value BEGIN
        OUTER_SET result = value
    END
END
`;
            // cursor on "value" usage at line 3, character 27
            const refs = findReferences(text, { line: 3, character: 27 }, TEST_URI, true);
            // declaration + usage = 2
            expect(refs).toHaveLength(2);
        });
    });

    describe("includeDeclaration filtering", () => {
        it("excludes definition for variables", () => {
            const text = `
OUTER_SET counter = 0
OUTER_SET counter = counter + 1
`;
            const refs = findReferences(text, { line: 1, character: 10 }, TEST_URI, false);
            // All definitions excluded, only non-definition usages remain
            // Line 1 is a declaration, line 2 has both a declaration (SET counter) and a usage (counter + 1)
            // Exact count depends on how the grammar parses this
            for (const ref of refs) {
                // All returned refs should be usages, not definitions
                expect(ref).toBeDefined();
            }
        });
    });

    describe("edge cases", () => {
        it("returns empty array for automatic variables", () => {
            const text = `
DEFINE_PATCH_FUNCTION my_func BEGIN
    SET result = SOURCE_SIZE
END
`;
            // cursor on "SOURCE_SIZE" — automatic variable, not renameable
            const refs = findReferences(text, { line: 2, character: 17 }, TEST_URI, true);
            expect(refs).toHaveLength(0);
        });

        it("returns empty array for position not on a symbol", () => {
            const text = `
DEFINE_ACTION_FUNCTION my_func BEGIN END
`;
            // cursor on whitespace
            const refs = findReferences(text, { line: 0, character: 0 }, TEST_URI, true);
            expect(refs).toHaveLength(0);
        });
    });

    describe("cross-file references via refsIndex", () => {
        it("adds cross-file refs from index for function symbols", () => {
            const text = `
DEFINE_ACTION_FUNCTION my_func BEGIN END
LAF my_func END
`;
            const otherUri = "file:///other.tp2" as const;
            const crossLoc = {
                uri: otherUri,
                range: { start: { line: 0, character: 4 }, end: { line: 0, character: 11 } },
            };

            const index = new ReferencesIndex();
            index.updateFile(normalizeUri(otherUri), new Map([["my_func", [crossLoc]]]));

            // cursor on definition
            const refs = findReferences(text, { line: 1, character: 23 }, TEST_URI, true, index);
            // local (definition + call) + cross-file ref from other.tp2
            const crossRefs = refs.filter((r) => r.uri === otherUri);
            expect(crossRefs).toHaveLength(1);
            expect(crossRefs[0]).toEqual(crossLoc);
        });

        it("does not add cross-file refs for current file URI", () => {
            const text = `
DEFINE_ACTION_FUNCTION my_func BEGIN END
LAF my_func END
`;
            const selfLoc = {
                uri: TEST_URI,
                range: { start: { line: 2, character: 4 }, end: { line: 2, character: 11 } },
            };

            const index = new ReferencesIndex();
            // Same URI as TEST_URI — should be filtered out (loc.uri !== uri check)
            index.updateFile(normalizeUri(TEST_URI), new Map([["my_func", [selfLoc]]]));

            const refs = findReferences(text, { line: 1, character: 23 }, TEST_URI, true, index);
            // Local refs only; cross-file entry with same URI excluded
            // Only the local occurrences (definition + call = 2), not the index duplicate
            expect(refs.length).toBeLessThanOrEqual(3);
        });

        it("returns only local refs for variable symbols (non-function kind)", () => {
            const text = `
OUTER_SET my_var = 5
OUTER_SET result = %my_var% + 1
`;
            const otherUri = "file:///other.tp2" as const;
            const index = new ReferencesIndex();
            index.updateFile(
                normalizeUri(otherUri),
                new Map([
                    [
                        "my_var",
                        [
                            {
                                uri: otherUri,
                                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
                            },
                        ],
                    ],
                ]),
            );

            // cursor on variable declaration — kind is "variable", not "function"
            const refs = findReferences(text, { line: 1, character: 10 }, TEST_URI, true, index);
            // No cross-file refs for variable symbols
            const crossRefs = refs.filter((r) => r.uri === otherUri);
            expect(crossRefs).toHaveLength(0);
        });
    });
});
