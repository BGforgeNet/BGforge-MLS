/**
 * Unit tests for weidu-tp2 parseFile() - reference extraction.
 * Tests that function/macro definitions and calls are collected.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";

vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { initParser } from "../../../shared/parsers/weidu-tp2";
import { parseFile } from "../../src/weidu-tp2/header-parser";

const TEST_URI = "file:///test.tp2";

beforeAll(async () => {
    await initParser();
});

describe("weidu-tp2/parseFile refs", () => {
    it("collects function definitions and calls", () => {
        const text = `
DEFINE_ACTION_FUNCTION my_func BEGIN END
LAF my_func END
LAF my_func END
`;
        const { refs } = parseFile(TEST_URI, text);
        const funcRefs = refs.get("my_func");
        // 1 definition + 2 calls = 3
        expect(funcRefs).toBeDefined();
        expect(funcRefs!.length).toBe(3);
    });

    it("preserves case in keys (case-sensitive)", () => {
        const text = `
DEFINE_ACTION_FUNCTION MY_FUNC BEGIN END
LAF my_func END
`;
        const { refs } = parseFile(TEST_URI, text);
        // Different cases are separate keys
        const upperRefs = refs.get("MY_FUNC");
        const lowerRefs = refs.get("my_func");
        expect(upperRefs).toBeDefined();
        expect(upperRefs!.length).toBe(1);
        expect(lowerRefs).toBeDefined();
        expect(lowerRefs!.length).toBe(1);
    });

    it("collects macro definitions and calls", () => {
        const text = `
DEFINE_ACTION_MACRO my_macro BEGIN END
LAM my_macro
`;
        const { refs } = parseFile(TEST_URI, text);
        const macroRefs = refs.get("my_macro");
        expect(macroRefs).toBeDefined();
        expect(macroRefs!.length).toBe(2);
    });

    it("collects patch functions", () => {
        const text = `
DEFINE_PATCH_FUNCTION patch_func BEGIN END
`;
        const { refs } = parseFile(TEST_URI, text);
        const funcRefs = refs.get("patch_func");
        expect(funcRefs).toBeDefined();
        expect(funcRefs!.length).toBe(1);
    });

    it("does not index variable assignments", () => {
        const text = `
OUTER_SET my_var = 5
OUTER_SET result = %my_var% + 1
`;
        const { refs } = parseFile(TEST_URI, text);
        // Variables are not indexed (only functions/macros)
        expect(refs.has("my_var")).toBe(false);
    });

    it("returns correct URIs", () => {
        const text = `
DEFINE_ACTION_FUNCTION test_func BEGIN END
`;
        const { refs } = parseFile(TEST_URI, text);
        const funcRefs = refs.get("test_func");
        expect(funcRefs).toBeDefined();
        for (const loc of funcRefs!) {
            expect(loc.uri).toBe(TEST_URI);
        }
    });

    it("returns empty refs for empty text", () => {
        const { refs } = parseFile(TEST_URI, "");
        expect(refs.size).toBe(0);
    });

    it("returns both symbols and refs from single call", () => {
        const text = `
DEFINE_ACTION_FUNCTION my_func BEGIN END
LAF my_func END
`;
        const result = parseFile(TEST_URI, text);
        // Symbols: should contain my_func
        expect(result.symbols.length).toBeGreaterThanOrEqual(1);
        expect(result.symbols.some((s) => s.name === "my_func")).toBe(true);
        // Refs: should contain my_func
        const funcRefs = result.refs.get("my_func");
        expect(funcRefs).toBeDefined();
        expect(funcRefs!.length).toBe(2);
    });
});
