/**
 * Unit tests for shared tooltip formatting helpers (tooltip-format.ts).
 * Tests buildSignatureBlock and formatDeprecation.
 */

import { describe, expect, it } from "vitest";
import { buildSignatureBlock, formatDeprecation } from "../../../shared/tooltip-format";

describe("buildSignatureBlock", () => {
    it("renders signature in code fence", () => {
        const result = buildSignatureBlock("int foo(int x)", "test-lang");
        expect(result).toBe("```test-lang\nint foo(int x)\n```");
    });

    it("renders signature with file path", () => {
        const result = buildSignatureBlock("void bar()", "my-lang", "lib/utils.h");
        expect(result).toBe("```my-lang\nvoid bar()\n```\n```bgforge-mls-comment\nlib/utils.h\n```");
    });

    it("omits file path block when filePath is undefined", () => {
        const result = buildSignatureBlock("x", "lang");
        expect(result).not.toContain("bgforge-mls-comment");
    });

    it("handles empty signature", () => {
        const result = buildSignatureBlock("", "lang");
        expect(result).toBe("```lang\n\n```");
    });
});

describe("formatDeprecation", () => {
    it("returns empty string for undefined", () => {
        expect(formatDeprecation(undefined)).toBe("");
    });

    it("returns generic notice for boolean true", () => {
        expect(formatDeprecation(true)).toBe("\n\n**Deprecated**");
    });

    it("returns notice with message for string", () => {
        expect(formatDeprecation("Use bar() instead")).toBe("\n\n**Deprecated:** Use bar() instead");
    });
});
