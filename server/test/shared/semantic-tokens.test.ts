/**
 * Unit tests for shared/semantic-tokens.ts — encoding and sort-order branches.
 */

import { describe, expect, it } from "vitest";
import {
    encodeSemanticTokens,
    RESREF_TOKEN_TYPE,
    INT_TOKEN_TYPE,
    type SemanticTokenSpan,
} from "../../src/shared/semantic-tokens";

describe("shared/semantic-tokens", () => {
    describe("encodeSemanticTokens()", () => {
        it("returns empty data for empty span list", () => {
            expect(encodeSemanticTokens([])).toEqual({ data: [] });
        });

        it("skips spans with length <= 0", () => {
            const spans: SemanticTokenSpan[] = [
                { line: 0, startChar: 0, length: 0, tokenType: INT_TOKEN_TYPE, tokenModifiers: 0 },
                { line: 0, startChar: 5, length: -1, tokenType: INT_TOKEN_TYPE, tokenModifiers: 0 },
            ];
            // All spans skipped — builder produces empty data
            const result = encodeSemanticTokens(spans);
            expect(result.data).toHaveLength(0);
        });

        it("skips spans with unknown tokenType", () => {
            const spans: SemanticTokenSpan[] = [
                { line: 0, startChar: 0, length: 5, tokenType: "nonexistent-type", tokenModifiers: 0 },
            ];
            const result = encodeSemanticTokens(spans);
            expect(result.data).toHaveLength(0);
        });

        it("encodes a single valid span", () => {
            const spans: SemanticTokenSpan[] = [
                { line: 2, startChar: 4, length: 6, tokenType: RESREF_TOKEN_TYPE, tokenModifiers: 0 },
            ];
            const result = encodeSemanticTokens(spans);
            // SemanticTokensBuilder encodes 5 numbers per token
            expect(result.data).toHaveLength(5);
        });

        it("sorts spans on the same line by startChar (branch: same line, different startChar)", () => {
            // Two spans on same line — second has earlier startChar, should sort first
            const spans: SemanticTokenSpan[] = [
                { line: 1, startChar: 10, length: 3, tokenType: INT_TOKEN_TYPE, tokenModifiers: 0 },
                { line: 1, startChar: 2, length: 3, tokenType: INT_TOKEN_TYPE, tokenModifiers: 0 },
            ];
            const result = encodeSemanticTokens(spans);
            // Two tokens encoded: 5 numbers each
            expect(result.data).toHaveLength(10);
            // First token: deltaLine=1, deltaStart=2 (absolute startChar for first token)
            expect(result.data[0]).toBe(1); // deltaLine
            expect(result.data[1]).toBe(2); // deltaStartChar of first (sorted) span
        });

        it("sorts spans on the same line and same startChar by length (branch: same line/char, different length)", () => {
            const spans: SemanticTokenSpan[] = [
                { line: 0, startChar: 5, length: 8, tokenType: INT_TOKEN_TYPE, tokenModifiers: 0 },
                { line: 0, startChar: 5, length: 3, tokenType: INT_TOKEN_TYPE, tokenModifiers: 0 },
            ];
            const result = encodeSemanticTokens(spans);
            expect(result.data).toHaveLength(10);
            // First sorted span: startChar=5, length=3 (smaller length comes first)
            expect(result.data[2]).toBe(3); // length of first token
        });

        it("sorts spans with identical line/startChar/length by tokenType (branch: all equal, localeCompare)", () => {
            // Use two distinct valid token types with same position/length
            const spans: SemanticTokenSpan[] = [
                { line: 0, startChar: 0, length: 5, tokenType: RESREF_TOKEN_TYPE, tokenModifiers: 0 },
                { line: 0, startChar: 0, length: 5, tokenType: INT_TOKEN_TYPE, tokenModifiers: 0 },
            ];
            // Both should encode (different types, same slot)
            const result = encodeSemanticTokens(spans);
            // Both spans are valid and get encoded
            expect(result.data).toHaveLength(10);
        });
    });
});
