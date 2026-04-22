/**
 * Unit tests for fallout-ssl/signature.ts - local signature help.
 */

import { describe, expect, it, beforeAll, vi } from "vitest";

// Mock the server module to avoid LSP connection issues
vi.mock("../../src/server", () => ({
    connection: {
        console: { log: vi.fn() },
        sendDiagnostics: vi.fn(),
    },
}));

import { getLocalSignature } from "../../src/fallout-ssl/signature";
import { initParser } from "../../src/fallout-ssl/parser";

beforeAll(async () => {
    await initParser();
});

describe("fallout-ssl/signature", () => {
    describe("getLocalSignature()", () => {
        it("returns signature for locally defined procedure", () => {
            const text = `
procedure add(variable a, variable b) begin
    return a + b;
end
`;
            const result = getLocalSignature(text, "add", 0);

            expect(result).not.toBeNull();
            expect(result?.signatures.length).toBe(1);
            expect(result?.signatures[0].label).toContain("add");
        });

        it("returns null for undefined symbol", () => {
            const text = "procedure foo begin end";
            const result = getLocalSignature(text, "undefined_proc", 0);

            expect(result).toBeNull();
        });

        it("includes parameter information", () => {
            const text = `
procedure process(variable item, variable count, variable flag) begin
    // do something
end
`;
            const result = getLocalSignature(text, "process", 0);

            expect(result).not.toBeNull();
            expect(result?.signatures[0].parameters?.length).toBe(3);
        });

        it("sets correct active parameter index", () => {
            const text = `
procedure func(variable a, variable b, variable c) begin end
`;
            const result0 = getLocalSignature(text, "func", 0);
            const result1 = getLocalSignature(text, "func", 1);
            const result2 = getLocalSignature(text, "func", 2);

            expect(result0?.activeParameter).toBe(0);
            expect(result1?.activeParameter).toBe(1);
            expect(result2?.activeParameter).toBe(2);
        });

        it("includes JSDoc information when supported", () => {
            // Note: JSDoc extraction depends on comment being recognized by grammar
            const text = `
/**
 * Calculates something
 * @param int x The x value
 * @param int y The y value
 */
procedure calc(variable x, variable y) begin
    return x + y;
end
`;
            const result = getLocalSignature(text, "calc", 0);

            expect(result).not.toBeNull();
            expect(result?.signatures[0].label).toContain("calc");
            // Parameters should be present
            expect(result?.signatures[0].parameters?.length).toBe(2);
        });

        it("handles procedures with JSDoc return type", () => {
            // Note: Return type extraction depends on JSDoc parsing
            const text = `
/**
 * @return int The result
 */
procedure get_value begin
    return 42;
end
`;
            const result = getLocalSignature(text, "get_value", 0);

            expect(result).not.toBeNull();
            // Just verify the signature exists
            expect(result?.signatures[0].label).toContain("get_value");
        });

        it("handles procedure with no parameters", () => {
            const text = `
procedure no_params begin
    display_msg("hello");
end
`;
            const result = getLocalSignature(text, "no_params", 0);

            expect(result).not.toBeNull();
            expect(result?.signatures[0].parameters?.length ?? 0).toBe(0);
        });

        it("handles function-like macro signature", () => {
            // Note: Macro signature depends on grammar support for preprocessor nodes
            const text = `
/**
 * Adds two numbers
 * @param a First operand
 * @param b Second operand
 */
#define ADD(a, b) ((a) + (b))
`;
            // Result depends on grammar parsing preprocessor nodes
            // Just verify it doesn't crash
            expect(() => getLocalSignature(text, "ADD", 0)).not.toThrow();
        });

        it("returns null for constant macro (no params)", () => {
            const text = `
#define MAX_VALUE 100
`;
            const result = getLocalSignature(text, "MAX_VALUE", 0);

            // Constant macros don't have signature help
            expect(result).toBeNull();
        });

        it("includes documentation in signature", () => {
            const text = `
/**
 * This function does something important.
 */
procedure important begin end
`;
            const result = getLocalSignature(text, "important", 0);

            expect(result).not.toBeNull();
            const doc = result?.signatures[0].documentation;
            expect(doc).toBeDefined();
            const docText = typeof doc === "string" ? doc : (doc as { value: string }).value;
            expect(docText).toContain("important");
        });
    });
});
