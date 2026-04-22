/**
 * Tests for validate module: runtime validation of YAML-parsed sfall data.
 * Covers error branches for type validation.
 */

import { describe, expect, it } from "vitest";
import {
    validateArray,
    validateSfallCategory,
    validateSfallFunction,
    validateSfallHook,
} from "../src/fallout/validate.ts";

describe("validateSfallFunction", () => {
    it("validates a minimal function", () => {
        const result = validateSfallFunction(
            { name: "func", detail: "void func()" },
            "test",
        );
        expect(result.name).toBe("func");
        expect(result.detail).toBe("void func()");
    });

    it("validates a function with all optional fields", () => {
        const result = validateSfallFunction(
            {
                name: "func",
                detail: "void func()",
                doc: "A function",
                opcode: 0x81_56,
                unsafe: true,
                macro: "MACRO_NAME",
                type: "int",
                args: [{ name: "x", type: "int", doc: "value" }],
            },
            "test",
        );
        expect(result.opcode).toBe(0x81_56);
        expect(result.unsafe).toBe(true);
        expect(result.macro).toBe("MACRO_NAME");
        expect(result.args).toHaveLength(1);
    });

    it("accepts string opcode", () => {
        const result = validateSfallFunction(
            { name: "func", detail: "void func()", opcode: "0x8156" },
            "test",
        );
        expect(result.opcode).toBe("0x8156");
    });

    it("throws on non-object input", () => {
        expect(() => validateSfallFunction(null, "test")).toThrow("Expected object");
        expect(() => validateSfallFunction("string", "test")).toThrow("Expected object");
    });

    it("throws on missing name", () => {
        expect(() => validateSfallFunction({ detail: "x" }, "test")).toThrow("Missing or invalid 'name'");
    });

    it("throws on missing detail", () => {
        expect(() => validateSfallFunction({ name: "x" }, "test")).toThrow("Missing or invalid 'detail'");
    });

    it("throws on invalid doc type", () => {
        expect(() => validateSfallFunction(
            { name: "x", detail: "y", doc: 42 },
            "test",
        )).toThrow("Invalid 'doc'");
    });

    it("throws on invalid opcode type", () => {
        expect(() => validateSfallFunction(
            { name: "x", detail: "y", opcode: true },
            "test",
        )).toThrow("Invalid 'opcode'");
    });

    it("throws on invalid unsafe type", () => {
        expect(() => validateSfallFunction(
            { name: "x", detail: "y", unsafe: "yes" },
            "test",
        )).toThrow("Invalid 'unsafe'");
    });

    it("throws on invalid args (not array)", () => {
        expect(() => validateSfallFunction(
            { name: "x", detail: "y", args: "not-array" },
            "test",
        )).toThrow("Expected array");
    });
});

describe("validateSfallCategory", () => {
    it("validates a category with items", () => {
        const result = validateSfallCategory(
            {
                name: "Cat",
                doc: "Category docs",
                items: [{ name: "func", detail: "void func()" }],
            },
            "test",
        );
        expect(result.name).toBe("Cat");
        expect(result.items).toHaveLength(1);
    });

    it("validates a category without items", () => {
        const result = validateSfallCategory(
            { name: "Cat" },
            "test",
        );
        expect(result.items).toBeUndefined();
    });

    it("throws on non-object", () => {
        expect(() => validateSfallCategory(42, "test")).toThrow("Expected object");
    });

    it("throws on invalid items (not array)", () => {
        expect(() => validateSfallCategory(
            { name: "Cat", items: "invalid" },
            "test",
        )).toThrow("Expected array");
    });
});

describe("validateSfallHook", () => {
    it("validates a minimal hook", () => {
        const result = validateSfallHook(
            { name: "TestHook", doc: "A test hook." },
            "test",
        );
        expect(result.name).toBe("TestHook");
        expect(result.doc).toBe("A test hook.");
    });

    it("validates a hook with optional fields", () => {
        const result = validateSfallHook(
            { name: "TestHook", doc: "Docs", id: "1", filename: "hooks.yml" },
            "test",
        );
        expect(result.id).toBe("1");
        expect(result.filename).toBe("hooks.yml");
    });

    it("throws on missing doc", () => {
        expect(() => validateSfallHook({ name: "X" }, "test")).toThrow("Missing or invalid 'doc'");
    });

    it("throws on invalid name type", () => {
        expect(() => validateSfallHook({ name: 42, doc: "x" }, "test")).toThrow("Missing or invalid 'name'");
    });
});

describe("validateArray", () => {
    it("validates an array of items", () => {
        const result = validateArray(
            [{ name: "h", doc: "d" }],
            validateSfallHook,
            "test",
        );
        expect(result).toHaveLength(1);
    });

    it("throws on non-array", () => {
        expect(() => validateArray("bad", validateSfallHook, "test")).toThrow("Expected array");
    });

    it("throws with indexed context on item error", () => {
        expect(() => validateArray(
            [{ name: "h", doc: "d" }, { name: 42 }],
            validateSfallHook,
            "test",
        )).toThrow("test[1]");
    });
});
