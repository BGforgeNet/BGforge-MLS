/**
 * Unit tests for shared/protocol.ts.
 * Tests workspace symbol query encode/decode round-trip and edge cases.
 */

import { describe, expect, it } from "vitest";
import { encodeWorkspaceSymbolQuery, decodeWorkspaceSymbolQuery } from "../../shared/protocol";

describe("encodeWorkspaceSymbolQuery", () => {
    it("returns the query unchanged when no languageId is provided", () => {
        expect(encodeWorkspaceSymbolQuery("myFunc")).toBe("myFunc");
        expect(encodeWorkspaceSymbolQuery("myFunc", undefined)).toBe("myFunc");
    });

    it("prefixes with scope when languageId is provided", () => {
        const encoded = encodeWorkspaceSymbolQuery("myFunc", "fallout-ssl");
        expect(encoded).toContain("fallout-ssl");
        expect(encoded).toContain("myFunc");
    });
});

describe("decodeWorkspaceSymbolQuery", () => {
    it("returns raw query unchanged when it has no scope prefix", () => {
        const result = decodeWorkspaceSymbolQuery("plainQuery");
        expect(result).toEqual({ query: "plainQuery" });
    });

    it("round-trips an encoded query back to its parts", () => {
        const encoded = encodeWorkspaceSymbolQuery("myFunc", "fallout-ssl");
        const decoded = decodeWorkspaceSymbolQuery(encoded);
        expect(decoded.languageId).toBe("fallout-ssl");
        expect(decoded.query).toBe("myFunc");
    });

    it("returns raw query when prefix is present but no colon follows", () => {
        // separator < 0 branch — no colon after the scope prefix
        // Manually craft a string that starts with the prefix but has no ":" after it
        const prefix = "bgforge-ws:";
        const malformed = `${prefix}nocolon`;
        const result = decodeWorkspaceSymbolQuery(malformed);
        expect(result).toEqual({ query: malformed });
    });

    it("returns raw query when languageId segment is empty", () => {
        // languageId empty after the prefix
        const prefix = "bgforge-ws:";
        const malformed = `${prefix}:query`;
        const result = decodeWorkspaceSymbolQuery(malformed);
        expect(result).toEqual({ query: malformed });
    });
});
